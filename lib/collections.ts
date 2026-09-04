/**
 * 收藏歌单（Collection）共享逻辑 — 移植 internal/web/collection.go
 */
import { getDB } from "./store";
import { GetOriginalLink } from "./original-link";
import { getProvider } from "./registry";
import { likeEscape } from "./web-core";
import type { Playlist, Song } from "./types";

export interface CollectionRow {
  id: number;
  name: string;
  description: string;
  cover: string;
  kind: string;
  content_type: string;
  source: string;
  external_id: string;
  link: string;
  creator: string;
  track_count: number;
  created_at: string;
}

export interface SavedSongRow {
  id: number;
  collection_id: number;
  song_id: string;
  source: string;
  extra: string;
  name: string;
  artist: string;
  cover: string;
  duration: number;
  added_at: string;
}

export const COLLECTION_KIND_MANUAL = "manual";
export const COLLECTION_KIND_IMPORTED = "imported";
export const COLLECTION_CONTENT_PLAYLIST = "playlist";
export const COLLECTION_CONTENT_ALBUM = "album";

export function loadCollection(id: number | string): CollectionRow | null {
  const numeric = typeof id === "number" ? id : parseInt(String(id).trim(), 10);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  return (
    (getDB().prepare("SELECT * FROM collections WHERE id = ?").get(numeric) as
      | CollectionRow
      | undefined) ?? null
  );
}

export function normalizedKind(row: CollectionRow): string {
  return (row.kind ?? "").trim() === COLLECTION_KIND_IMPORTED
    ? COLLECTION_KIND_IMPORTED
    : COLLECTION_KIND_MANUAL;
}

export function normalizedContentType(row: CollectionRow): string {
  return (row.content_type ?? "").trim() === COLLECTION_CONTENT_ALBUM
    ? COLLECTION_CONTENT_ALBUM
    : COLLECTION_CONTENT_PLAYLIST;
}

export function normalizedSource(row: CollectionRow): string {
  const source = (row.source ?? "").trim();
  if (!source || source === "local") {
    if (normalizedKind(row) === COLLECTION_KIND_IMPORTED) return "";
    return "local";
  }
  return source;
}

export function isImported(row: CollectionRow): boolean {
  return normalizedKind(row) === COLLECTION_KIND_IMPORTED;
}

export function isManual(row: CollectionRow): boolean {
  return !isImported(row);
}

export function countSavedSongs(collectionId: number): number {
  const row = getDB()
    .prepare("SELECT COUNT(*) AS c FROM saved_songs WHERE collection_id = ?")
    .get(collectionId) as { c: number };
  return row.c;
}

export function originalLink(row: CollectionRow): string {
  const link = (row.link ?? "").trim();
  if (link) return link;
  const source = normalizedSource(row);
  if (!isImported(row) || !source || !(row.external_id ?? "").trim()) return "";
  return GetOriginalLink(source, row.external_id.trim(), normalizedContentType(row));
}

/** 歌单卡片（对齐 Collection.playlistCard，Source=local） */
export function collectionCard(row: CollectionRow): Playlist {
  const imported = isImported(row);
  const contentType = normalizedContentType(row);
  const trackCount = isManual(row) ? countSavedSongs(row.id) : row.track_count;
  const extra: Record<string, string> = {
    collection_kind: normalizedKind(row),
    content_type: contentType,
    editable: isManual(row) ? "true" : "false",
  };
  const remoteSource = normalizedSource(row);
  if (imported && remoteSource) extra.remote_source = remoteSource;

  let creator: string;
  if (imported) {
    const c = (row.creator ?? "").trim();
    creator = c || (contentType === COLLECTION_CONTENT_ALBUM ? "外部导入专辑" : "外部导入歌单");
  } else {
    creator = "我自己";
  }

  return {
    id: String(row.id),
    name: row.name,
    description: row.description ?? "",
    cover: (row.cover ?? "").trim() || `https://picsum.photos/seed/col_${row.id}/400/400`,
    creator,
    track_count: trackCount,
    play_count: 0,
    source: "local",
    link: originalLink(row),
    extra,
  };
}

/* ---------------- 歌曲读写 ---------------- */

function decodeExtraMap(raw: string): Record<string, string> {
  const text = (raw ?? "").trim();
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
      else if (typeof v === "number" && Number.isFinite(v)) out[k] = String(Math.round(v));
      else if (typeof v === "boolean") out[k] = v ? "true" : "false";
      else out[k] = JSON.stringify(v);
    }
    return out;
  } catch {
    return {};
  }
}

export function decodeExtraObject(raw: string): unknown {
  const text = (raw ?? "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function savedSongToSong(row: SavedSongRow): Song {
  const extra = decodeExtraMap(row.extra);
  return {
    id: row.song_id,
    source: row.source,
    name: row.name ?? "",
    artist: row.artist ?? "",
    album: extra.album ?? "",
    album_id: extra.album_id ?? "",
    link: extra.link ?? "",
    cover: row.cover ?? "",
    duration: row.duration ?? 0,
    size: 0,
    bitrate: 0,
    url: "",
    extra: Object.keys(extra).length ? extra : undefined,
  };
}

function ensureSongSource(songs: Song[], source: string): Song[] {
  for (const song of songs) {
    if (!(song.source ?? "").trim()) song.source = source;
  }
  return songs;
}

/** imported 歌单实时拉上游；manual 读表 */
export async function loadCollectionSongs(row: CollectionRow): Promise<Song[]> {
  if (isImported(row)) {
    const source = normalizedSource(row);
    if (!source) throw new Error("missing imported source");
    const externalID = (row.external_id ?? "").trim();
    const link = originalLink(row);
    const contentType = normalizedContentType(row);
    const provider = getProvider(source);

    if (contentType === COLLECTION_CONTENT_ALBUM) {
      if (externalID && provider?.getAlbumSongs) {
        try {
          const songs = await provider.getAlbumSongs(externalID);
          if (songs.length) return ensureSongSource(songs, source);
        } catch {
          /* fallthrough */
        }
      }
      if (link && provider?.parseAlbum) {
        const detail = await provider.parseAlbum(link);
        return ensureSongSource(detail.songs, source);
      }
    } else {
      if (externalID && provider?.getPlaylistSongs) {
        try {
          const songs = await provider.getPlaylistSongs(externalID);
          if (songs.length) return ensureSongSource(songs, source);
        } catch {
          /* fallthrough */
        }
      }
      if (link && provider?.parsePlaylist) {
        const detail = await provider.parsePlaylist(link);
        return ensureSongSource(detail.songs, source);
      }
    }
    throw new Error(`failed to fetch imported ${contentType} songs`);
  }

  const rows = getDB()
    .prepare("SELECT * FROM saved_songs WHERE collection_id = ? ORDER BY id DESC")
    .all(row.id) as SavedSongRow[];
  return rows.map(savedSongToSong);
}

/** /collections/[id]/songs 的响应数组（对齐 collectionSongsJSON） */
export async function collectionSongsJSON(row: CollectionRow): Promise<Record<string, unknown>[]> {
  if (isImported(row)) {
    const songs = await loadCollectionSongs(row);
    return songs.map((song) => ({
      collection_id: row.id,
      id: song.id,
      source: song.source,
      extra: song.extra ?? null,
      name: song.name,
      artist: song.artist,
      album: song.album,
      album_id: song.album_id ?? "",
      cover: song.cover,
      duration: song.duration,
      link: song.link ?? "",
    }));
  }

  const rows = getDB()
    .prepare("SELECT * FROM saved_songs WHERE collection_id = ? ORDER BY id DESC")
    .all(row.id) as SavedSongRow[];
  return rows.map((s) => {
    const extraMap = decodeExtraMap(s.extra);
    return {
      db_id: s.id,
      collection_id: s.collection_id,
      id: s.song_id,
      source: s.source,
      extra: decodeExtraObject(s.extra),
      name: s.name,
      artist: s.artist,
      album: extraMap.album ?? "",
      album_id: extraMap.album_id ?? "",
      cover: s.cover,
      duration: s.duration,
      link: extraMap.link ?? "",
      added_at: s.added_at,
    };
  });
}

export interface SaveSongInput {
  id: string;
  source: string;
  name?: string;
  artist?: string;
  cover?: string;
  duration?: number;
  extra?: unknown;
}

/** INSERT OR IGNORE（唯一索引 collection+song+source），返回是否真正插入 */
export function insertSavedSong(collectionId: number, song: SaveSongInput): boolean {
  let extraStr = "";
  if (song.extra !== undefined && song.extra !== null) {
    try {
      extraStr = JSON.stringify(song.extra);
    } catch {
      extraStr = "";
    }
  }
  const result = getDB()
    .prepare(
      `INSERT OR IGNORE INTO saved_songs (collection_id, song_id, source, extra, name, artist, cover, duration)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(
      collectionId,
      song.id,
      song.source,
      extraStr,
      song.name ?? "",
      song.artist ?? "",
      song.cover ?? "",
      song.duration ?? 0,
    );
  return result.changes > 0;
}

export function savedSongRow(collectionId: number, song: SaveSongInput): SavedSongRow {
  let extraStr = "";
  if (song.extra !== undefined && song.extra !== null) {
    try {
      extraStr = JSON.stringify(song.extra);
    } catch {
      extraStr = "";
    }
  }
  const result = getDB()
    .prepare(
      `INSERT OR IGNORE INTO saved_songs (collection_id, song_id, source, extra, name, artist, cover, duration)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(
      collectionId,
      song.id,
      song.source,
      extraStr,
      song.name ?? "",
      song.artist ?? "",
      song.cover ?? "",
      song.duration ?? 0,
    );
  return {
    id: Number(result.lastInsertRowid),
    collection_id: collectionId,
    song_id: song.id,
    source: song.source,
    extra: extraStr,
    name: song.name ?? "",
    artist: song.artist ?? "",
    cover: song.cover ?? "",
    duration: song.duration ?? 0,
    added_at: new Date().toISOString().replace("T", " ").slice(0, 19),
  };
}

/** 本地收藏歌单关键词搜索（/api/search type=playlist 勾选 local 用） */
export function localCollectionSearchPlaylists(keyword: string): Playlist[] {
  keyword = (keyword ?? "").trim();
  if (!keyword) return [];
  // 审核整改 A-25：LIKE 元字符转义（防 %/_ 全表扫描）
  const like = `%${likeEscape(keyword)}%`;
  const rows = getDB()
    .prepare(
      "SELECT * FROM collections WHERE name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR creator LIKE ? ESCAPE '\\' ORDER BY id DESC",
    )
    .all(like, like, like) as CollectionRow[];
  return rows.map(collectionCard);
}
