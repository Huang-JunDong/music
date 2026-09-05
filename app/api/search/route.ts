import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { DetectSource, getProvider } from "@/lib/registry";
import { defaultSourcesForSearchType, sourcesFromQuery } from "@/lib/web-core";
import { filterSongsByExactArtist } from "@/lib/song-meta";
import { localMusicSearchSongs, isLocalMusicSource } from "@/lib/local-music";
import { localCollectionSearchPlaylists } from "@/lib/collections";
import { breakerAllows, breakerRecordFailure, breakerRecordSuccess } from "@/lib/breaker";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";
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
 * 重复搜索短缓存（90s）+ 并发去重：切类型 tab / URL 参数变化 / 多用户同词时零回源，
 * 避免一次搜索 8 源并发的上游突发放大（限流/熔断雪崩）。
 * 仅缓存完全成功的结果（部分源失败时重试可自愈，不缓存）；key 含音源凭证指纹防跨账号串数据。
 */
const searchCache = createTtlCache<Record<string, unknown>>(90_000, 50);

/**
 * GET /api/search?q=&type=song|playlist|album&exact_artist=&sources=(多值/逗号分隔)
 * 并发 allSettled 聚合；q 以 http 开头走链接解析（DetectSource→parse→parsePlaylist→parseAlbum）。
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);

async function getHandler(req: NextRequest) {
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

  const cacheKey = `${searchType}|${exactArtist}|${requested.join(",")}|${keyword}|${sourceCookieFingerprint(req)}`;
  const payload = await searchCache.wrap(
    cacheKey,
    async (): Promise<Record<string, unknown>> => {
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

      const result: Record<string, unknown> = { type: searchType };
      if (searchType === "song") result.songs = songs;
      else result.playlists = playlists;
      if (parsedPlaylist) result.playlist = parsedPlaylist;
      if (importCollection) result.import_collection = importCollection;
      if (Object.keys(errors).length) result.errors = errors;
      if (error) result.error = error;
      return result;
    },
    // 仅缓存完全成功的结果（有源失败/熔断跳过时重试可自愈）
    (p) => !p.error && !p.errors,
  );

  return NextResponse.json(payload);
}
