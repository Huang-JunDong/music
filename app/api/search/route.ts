import { NextRequest, NextResponse } from "next/server";
import { DetectSource, getProvider } from "@/lib/registry";
import { defaultSourcesForSearchType, sourcesFromQuery } from "@/lib/web-core";
import { filterSongsByExactArtist } from "@/lib/song-meta";
import { localMusicSearchSongs, isLocalMusicSource } from "@/lib/local-music";
import { localCollectionSearchPlaylists } from "@/lib/collections";
import { breakerAllows, breakerRecordFailure, breakerRecordSuccess } from "@/lib/breaker";
import {
  applyImportCollectionFallback,
  importCollectionFromQuery,
  type ImportCollectionMeta,
} from "@/lib/import-collection";
import type { Playlist, Song } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 审核整改 A-16/A-27：聚合结果上限（每源 top-N + 总量上限，防数 MB 响应）；
 * 链接解析分支不截断（歌单导入依赖完整曲目列表）。
 */
const SEARCH_MAX_PER_SOURCE = 30;
const SEARCH_MAX_TOTAL = 400;

/**
 * GET /api/search?q=&type=song|playlist|album&exact_artist=&sources=(多值/逗号分隔)
 * 并发 allSettled 聚合；q 以 http 开头走链接解析（DetectSource→parse→parsePlaylist→parseAlbum）。
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const keyword = (params.get("q") ?? "").trim();
  if (!keyword) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }
  let searchType = params.get("type") ?? "song";
  if (!["song", "playlist", "album"].includes(searchType)) searchType = "song";
  const exactArtist = (params.get("exact_artist") ?? "").trim();

  let requested = sourcesFromQuery(params);
  if (!requested.length) requested = defaultSourcesForSearchType(searchType);

  let songs: Song[] = [];
  let playlists: Playlist[] = [];
  let importCollection: ImportCollectionMeta | undefined;
  /** 链接解析出的歌单/专辑元数据（供前端 ParsedCollectionCard 渲染、跳详情与一键导入） */
  let parsedPlaylist: Playlist | null = null;
  let error = "";
  const errors: Record<string, string> = {};

  if (keyword.toLowerCase().startsWith("http")) {
    const src = DetectSource(keyword);
    if (!src) {
      error = "不支持该链接的解析，或无法识别来源";
    } else {
      const provider = getProvider(src);
      let parsed = false;

      if (!parsed && provider?.parse) {
        try {
          songs = [await provider.parse(keyword)];
          songs[0].source = songs[0].source || src;
          searchType = "song";
          parsed = true;
        } catch {
          /* try next */
        }
      }
      if (!parsed && provider?.parsePlaylist) {
        try {
          const detail = await provider.parsePlaylist(keyword);
          parsedPlaylist = detail.playlist;
          if (searchType === "playlist") {
            playlists = [detail.playlist];
          } else {
            songs = detail.songs.map((s) => ({ ...s, source: s.source || src }));
            searchType = "song";
            importCollection = importCollectionFromQuery(
              params,
              "playlist",
              src,
              detail.playlist.id,
              (detail.playlist.link ?? "").trim(),
              detail.songs.length,
            );
            applyImportCollectionFallback(importCollection, detail.playlist, detail.songs.length, keyword);
          }
          parsed = true;
        } catch {
          /* try next */
        }
      }
      if (!parsed && provider?.parseAlbum) {
        try {
          const detail = await provider.parseAlbum(keyword);
          parsedPlaylist = detail.playlist;
          if (searchType === "album") {
            playlists = [detail.playlist];
          } else {
            songs = detail.songs.map((s) => ({ ...s, source: s.source || src }));
            searchType = "song";
            importCollection = importCollectionFromQuery(
              params,
              "album",
              src,
              detail.playlist.id,
              (detail.playlist.link ?? "").trim(),
              detail.songs.length,
            );
            applyImportCollectionFallback(importCollection, detail.playlist, detail.songs.length, keyword);
          }
          parsed = true;
        } catch {
          /* try next */
        }
      }
      if (!parsed) {
        error = `解析失败: 暂不支持 ${src} 平台的此链接类型或解析出错`;
      }
    }
  } else {
    const onlineSources = requested.filter((s) => !isLocalMusicSource(s));

    const allSongs: Song[] = [];
    const allPlaylists: Playlist[] = [];
    if (searchType === "song") {
      const results = await Promise.allSettled(
        onlineSources.map(async (source) => {
          const provider = getProvider(source);
          if (!provider) return [] as Song[];
          // 审核整改 A-27：连续失败源短期熔断跳过（30s 窗口，见 lib/breaker.ts）
          if (!breakerAllows(`search:${source}`)) {
            errors[source] = "该源近期失败频繁，已临时跳过";
            return [] as Song[];
          }
          try {
            const songs = (await provider.search(keyword)).map((s) => ({ ...s, source }));
            breakerRecordSuccess(`search:${source}`);
            // 审核整改 A-16：每源 top-N 截断
            return songs.slice(0, SEARCH_MAX_PER_SOURCE);
          } catch (err) {
            breakerRecordFailure(`search:${source}`);
            throw err;
          }
        }),
      );
      results.forEach((result, i) => {
        if (result.status === "fulfilled") allSongs.push(...result.value);
        else
          errors[onlineSources[i]] =
            result.reason instanceof Error ? result.reason.message : String(result.reason);
      });
    } else {
      const results = await Promise.allSettled(
        onlineSources.map(async (source) => {
          const provider = getProvider(source);
          if (!breakerAllows(`search:${source}`)) {
            errors[source] = "该源近期失败频繁，已临时跳过";
            return [] as Playlist[];
          }
          try {
            const playlists = (
              searchType === "playlist"
                ? provider?.searchPlaylist
                  ? await provider.searchPlaylist(keyword)
                  : []
                : provider?.searchAlbum
                  ? await provider.searchAlbum(keyword)
                  : []
            ).map((p) => ({ ...p, source }));
            breakerRecordSuccess(`search:${source}`);
            return playlists.slice(0, SEARCH_MAX_PER_SOURCE);
          } catch (err) {
            breakerRecordFailure(`search:${source}`);
            throw err;
          }
        }),
      );
      results.forEach((result, i) => {
        if (result.status === "fulfilled") allPlaylists.push(...result.value);
        else
          errors[onlineSources[i]] =
            result.reason instanceof Error ? result.reason.message : String(result.reason);
      });
    }
    songs = allSongs;
    playlists = allPlaylists;

    // 审核整改 A-16：聚合总量上限（超额按序截断）
    if (songs.length > SEARCH_MAX_TOTAL) songs = songs.slice(0, SEARCH_MAX_TOTAL);
    if (playlists.length > SEARCH_MAX_TOTAL) playlists = playlists.slice(0, SEARCH_MAX_TOTAL);

    if (requested.some((s) => isLocalMusicSource(s))) {
      if (searchType === "song") {
        songs.push(...localMusicSearchSongs(keyword, 200));
      } else if (searchType === "playlist") {
        playlists.push(...localCollectionSearchPlaylists(keyword));
      }
    }
  }

  if (searchType === "song" && exactArtist && songs.length) {
    songs = filterSongsByExactArtist(songs, exactArtist);
  }

  const payload: Record<string, unknown> = { type: searchType };
  if (searchType === "song") payload.songs = songs;
  else payload.playlists = playlists;
  if (parsedPlaylist) payload.playlist = parsedPlaylist;
  if (importCollection) payload.import_collection = importCollection;
  if (Object.keys(errors).length) payload.errors = errors;
  if (error) payload.error = error;
  return NextResponse.json(payload);
}
