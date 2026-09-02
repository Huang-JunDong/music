/**
 * 本地音乐模块 — 移植 internal/web/local_music.go + local_music_index.go
 * 扫描下载目录（.mp3/.flac/.m4a/.ogg/.wav/.wma/.aac），music-metadata 读取内嵌
 * title/artist/album/cover/lyric/duration，sidecar 同名 .jpg/.png/.lrc 兜底；
 * ID = relPath 的 base64url；SQLite local_music_index 索引 + 10s 快照缓存 + 异步刷新。
 */
import fs from "node:fs";
import path from "node:path";
import { parseFile } from "music-metadata";
import { getDB, downloadDir } from "./store";
import { formatSizeMB } from "./web-core";
import { sanitizeFilename, type Song } from "./types";

export const LOCAL_MUSIC_SOURCE = "local";
export const LEGACY_LOCAL_MUSIC_SOURCE = "local-file";
export const LOCAL_MUSIC_SCAN_CACHE_TTL_MS = 10_000;

const AUDIO_EXTS = new Set([".aac", ".flac", ".m4a", ".mp3", ".ogg", ".wav", ".wma"]);
export const LOCAL_MUSIC_COVER_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"];
export const LOCAL_MUSIC_LYRIC_EXTS = [".lrc", ".txt", ".lyric"];

export function isLocalMusicSource(source: string): boolean {
  const s = (source ?? "").trim();
  return s === LOCAL_MUSIC_SOURCE || s === LEGACY_LOCAL_MUSIC_SOURCE;
}

/* ---------------- 类型 ---------------- */

export interface LocalMusicTrack {
  id: string;
  name: string;
  artist: string;
  album: string;
  cover: string;
  duration: number;
  filename: string;
  relPath: string;
  ext: string;
  size: number;
  sizeText: string;
  /** ISO 时间 */
  modifiedAt: string;
  mtimeMs: number;
  missing: string[];
  alreadyAdded?: boolean;
  extra: Record<string, string>;
}

interface ScanSnapshot {
  dir: string;
  tracks: LocalMusicTrack[];
  exists: boolean;
  err: string | null;
  scannedAt: number;
}

interface LocalMusicState {
  metaCache: Map<string, { track: LocalMusicTrack; size: number; mtimeMs: number }>;
  snapshot: ScanSnapshot | null;
  refreshing: boolean;
  reindexing: boolean;
  autoCacheInFlight: Set<string>;
  autoCacheActive: number;
}

const g = globalThis as unknown as { __localMusicState?: LocalMusicState };

function state(): LocalMusicState {
  if (!g.__localMusicState) {
    g.__localMusicState = {
      metaCache: new Map(),
      snapshot: null,
      refreshing: false,
      reindexing: false,
      autoCacheInFlight: new Set(),
      autoCacheActive: 0,
    };
  }
  return g.__localMusicState;
}

/* ---------------- ID 编解码 ---------------- */

export function encodeLocalMusicID(relPath: string): string {
  return Buffer.from(relPath, "utf8").toString("base64url");
}

export function decodeLocalMusicID(id: string): string {
  return Buffer.from((id ?? "").trim(), "base64url").toString("utf8");
}

/* ---------------- 目录与路径 ---------------- */

export function localMusicDownloadDir(): string {
  return downloadDir() || ".";
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function isPathInside(rootAbs: string, targetAbs: string): boolean {
  const rel = path.relative(rootAbs, targetAbs);
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

function isAudioFile(p: string): boolean {
  return AUDIO_EXTS.has(path.extname(p).toLowerCase());
}

export function parseLocalMusicRangeInt(raw: string | null, fallback: number): number {
  const value = parseInt((raw ?? "").trim(), 10);
  if (Number.isNaN(value) || value < 0) return fallback;
  return Math.min(value, 1000);
}

export function trackAbsPath(track: Pick<LocalMusicTrack, "relPath">): string {
  return path.join(localMusicDownloadDir(), ...track.relPath.split("/"));
}

/** 公共 JSON 形态（对齐 Go localMusicTrack 的 json tag，snake_case） */
export function trackJSON(track: LocalMusicTrack): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: track.id,
    source: LOCAL_MUSIC_SOURCE,
    name: track.name,
    artist: track.artist,
    album: track.album,
    cover: track.cover,
    duration: track.duration,
    filename: track.filename,
    rel_path: track.relPath,
    ext: track.ext,
    size: track.size,
    size_text: track.sizeText,
    modified_at: track.modifiedAt,
    missing: track.missing,
    extra: track.extra,
  };
  if (track.alreadyAdded !== undefined) out.already_added = track.alreadyAdded;
  return out;
}

export function cloneTrack(track: LocalMusicTrack): LocalMusicTrack {
  return {
    ...track,
    missing: [...track.missing],
    extra: { ...track.extra },
  };
}

/* ---------------- 元数据读取 ---------------- */

interface LocalMeta {
  title: string;
  artist: string;
  album: string;
  duration: number;
  /** kbps（format.bitrate bits/s → kbps，对齐 Go ffprobe extra.bitrate） */
  bitrate: number;
  hasCover: boolean;
  hasLyric: boolean;
}

async function readAudioMeta(absPath: string): Promise<LocalMeta | null> {
  try {
    const meta = await parseFile(absPath, { duration: false });
    const common = meta.common;
    const rawLyrics = common.lyrics as unknown as string | string[] | undefined;
    const lyricsText = Array.isArray(rawLyrics)
      ? rawLyrics.join("\n")
      : typeof rawLyrics === "string"
        ? rawLyrics
        : "";
    const title = (common.title ?? "").trim();
    const artist = (common.artist ?? common.albumartist ?? "").trim();
    return {
      title,
      artist,
      album: (common.album ?? "").trim(),
      duration: meta.format.duration ? Math.round(meta.format.duration) : 0,
      bitrate: meta.format.bitrate ? Math.round(meta.format.bitrate / 1000) : 0,
      hasCover: !!common.picture && common.picture.length > 0,
      hasLyric: !!lyricsText.trim(),
    };
  } catch {
    return null;
  }
}

/** 精确同名 sidecar（song.jpg / song.png …） */
function exactSidecarFile(absPath: string, exts: string[]): string | null {
  const base = absPath.slice(0, absPath.length - path.extname(absPath).length);
  for (const ext of exts) {
    const candidate = base + ext;
    try {
      if (!fs.statSync(candidate).isDirectory()) return candidate;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** 模糊同名 sidecar（忽略扩展名大小写，对齐 localMusicSidecarFile） */
function sidecarFile(absPath: string, exts: string[]): string | null {
  const exact = exactSidecarFile(absPath, exts);
  if (exact) return exact;
  const dir = path.dirname(absPath);
  const baseName = path.basename(absPath.slice(0, absPath.length - path.extname(absPath).length));
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    const entryExt = path.extname(entry.name).toLowerCase();
    if (!exts.includes(entryExt)) continue;
    const entryBase = entry.name.slice(0, entry.name.length - entryExt.length);
    if (entryBase.toLowerCase() === baseName.toLowerCase()) {
      return path.join(dir, entry.name);
    }
  }
  return null;
}

function coverURL(id: string): string {
  return `/api/local_music/cover?id=${encodeURIComponent(id)}`;
}

/** 构建单条 track（含 meta 缓存） */
export async function buildLocalMusicTrack(
  rootAbs: string,
  audioPath: string,
): Promise<LocalMusicTrack> {
  const absPath = path.resolve(audioPath);
  if (!isPathInside(rootAbs, absPath)) throw new Error("path is outside local music dir");
  const info = fs.statSync(absPath);
  if (info.isDirectory() || !isAudioFile(absPath)) throw new Error("not a supported audio file");

  const rel = toPosix(path.relative(rootAbs, absPath));
  const filename = path.basename(absPath);
  const ext = path.extname(filename).toLowerCase().replace(/^\./, "");
  const fallbackName = filename.slice(0, filename.length - path.extname(filename).length);
  const id = encodeLocalMusicID(rel);

  const cacheKey = `${path.resolve(rootAbs)}|${rel}`;
  const cached = state().metaCache.get(cacheKey);
  if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) {
    const track = cloneTrack(cached.track);
    track.alreadyAdded = undefined;
    return track;
  }

  const meta = await readAudioMeta(absPath);
  let name = meta?.title ?? "";
  let artist = meta?.artist ?? "";
  const album = meta?.album ?? "";
  const hasEmbeddedCover = meta?.hasCover ?? false;
  const hasEmbeddedLyric = meta?.hasLyric ?? false;

  const missing: string[] = [];
  if (!name.trim()) {
    name = fallbackName.trim();
    missing.push("title");
  }
  if (!artist.trim()) {
    artist = "未知歌手";
    missing.push("artist");
  }
  if (!album.trim()) missing.push("album");

  const extra: Record<string, string> = {
    local_music: "true",
    file_id: id,
    filename,
    rel_path: rel,
    ext,
    size: String(info.size),
  };
  if (album) extra.album = album;
  if (meta?.duration) extra.duration = String(meta.duration);
  if (meta?.bitrate) extra.bitrate = String(meta.bitrate);

  let cover = "";
  if (hasEmbeddedCover) {
    cover = coverURL(id);
    extra.cover = "true";
    extra.cover_source = "embedded";
  } else if (sidecarFile(absPath, LOCAL_MUSIC_COVER_EXTS)) {
    cover = coverURL(id);
    extra.cover = "true";
    extra.cover_source = "sidecar";
  }
  if (hasEmbeddedLyric) {
    extra.lyric = "true";
    extra.lyric_source = "embedded";
  } else if (sidecarFile(absPath, LOCAL_MUSIC_LYRIC_EXTS)) {
    extra.lyric = "true";
    extra.lyric_source = "sidecar";
  }

  const track: LocalMusicTrack = {
    id,
    name: name.trim(),
    artist: artist.trim(),
    album: album.trim(),
    cover,
    duration: meta?.duration ?? 0,
    filename,
    relPath: rel,
    ext,
    size: info.size,
    sizeText: formatSizeMB(info.size),
    modifiedAt: info.mtime.toISOString(),
    mtimeMs: info.mtimeMs,
    missing,
    extra,
  };
  state().metaCache.set(cacheKey, { track: cloneTrack(track), size: info.size, mtimeMs: info.mtimeMs });
  return track;
}

/* ---------------- 扫描 + 快照缓存 ---------------- */

export async function scanLocalMusicTracks(): Promise<{
  tracks: LocalMusicTrack[];
  dir: string;
  exists: boolean;
  err: string | null;
}> {
  const dir = localMusicDownloadDir();
  let info: fs.Stats;
  try {
    info = fs.statSync(dir);
  } catch {
    return { tracks: [], dir, exists: false, err: null };
  }
  if (!info.isDirectory()) {
    return { tracks: [], dir, exists: false, err: `本地下载路径不是目录: ${dir}` };
  }

  const rootAbs = path.resolve(dir);
  const files: string[] = [];
  const walk = (current: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) continue;
        walk(full);
      } else if (entry.isFile() && isAudioFile(full)) {
        files.push(full);
      }
    }
  };
  walk(rootAbs);

  const tracks: LocalMusicTrack[] = [];
  for (const file of files) {
    try {
      tracks.push(await buildLocalMusicTrack(rootAbs, file));
    } catch {
      /* skip unreadable */
    }
  }
  tracks.sort((a, b) => {
    if (a.mtimeMs !== b.mtimeMs) return b.mtimeMs - a.mtimeMs;
    return a.relPath.toLowerCase() < b.relPath.toLowerCase() ? -1 : 1;
  });
  return { tracks, dir, exists: true, err: null };
}

function storeSnapshot(snapshot: ScanSnapshot): void {
  state().snapshot = {
    ...snapshot,
    tracks: snapshot.tracks.map(cloneTrack),
  };
}

export function invalidateLocalMusicScanCache(): void {
  state().snapshot = null;
}

/** 后台刷新快照（in-flight 去重；快照仍新鲜时跳过） */
export function refreshLocalMusicScanAsync(dir?: string): void {
  const target = dir ?? localMusicDownloadDir();
  const s = state();
  if (s.refreshing) return;
  const snap = s.snapshot;
  if (
    snap &&
    path.resolve(snap.dir) === path.resolve(target) &&
    Date.now() - snap.scannedAt < LOCAL_MUSIC_SCAN_CACHE_TTL_MS
  ) {
    return;
  }
  s.refreshing = true;
  void (async () => {
    try {
      const result = await scanLocalMusicTracks();
      if (path.resolve(result.dir) !== path.resolve(target)) return;
      await syncTracksToIndex(result.tracks);
      storeSnapshot({
        dir: result.dir,
        tracks: result.tracks,
        exists: result.exists,
        err: result.err,
        scannedAt: Date.now(),
      });
    } catch {
      /* ignore */
    } finally {
      state().refreshing = false;
    }
  })();
}

/** 带缓存的扫描（TTL 10s；过期返回旧快照并异步刷新，refreshing=true） */
export async function scanLocalMusicTracksCached(force: boolean): Promise<{
  tracks: LocalMusicTrack[];
  dir: string;
  exists: boolean;
  err: string | null;
  refreshing: boolean;
  scannedAt: number;
}> {
  const dir = localMusicDownloadDir();
  const snapshot = state().snapshot;
  if (!force && snapshot && path.resolve(snapshot.dir) === path.resolve(dir)) {
    const age = Date.now() - snapshot.scannedAt;
    if (age < LOCAL_MUSIC_SCAN_CACHE_TTL_MS) {
      return {
        tracks: snapshot.tracks.map(cloneTrack),
        dir: snapshot.dir,
        exists: snapshot.exists,
        err: snapshot.err,
        refreshing: false,
        scannedAt: snapshot.scannedAt,
      };
    }
    if (!snapshot.err) {
      refreshLocalMusicScanAsync(dir);
      return {
        tracks: snapshot.tracks.map(cloneTrack),
        dir: snapshot.dir,
        exists: snapshot.exists,
        err: snapshot.err,
        refreshing: true,
        scannedAt: snapshot.scannedAt,
      };
    }
  }

  const result = await scanLocalMusicTracks();
  const scannedAt = Date.now();
  storeSnapshot({
    dir: result.dir,
    tracks: result.tracks,
    exists: result.exists,
    err: result.err,
    scannedAt,
  });
  return {
    tracks: result.tracks.map(cloneTrack),
    dir: result.dir,
    exists: result.exists,
    err: result.err,
    refreshing: false,
    scannedAt,
  };
}

/* ---------------- SQLite 索引 ---------------- */

interface IndexRow {
  id: string;
  name: string;
  artist: string;
  album: string;
  rel_path: string;
  ext: string;
  size: number;
  duration: number;
  cover: number;
  lyric: number;
  modified_at: string;
}

function rowToTrack(row: IndexRow): LocalMusicTrack {
  const extra: Record<string, string> = {
    local_music: "true",
    file_id: row.id,
    rel_path: row.rel_path,
    ext: row.ext,
  };
  if (row.cover) extra.cover = "true";
  if (row.lyric) extra.lyric = "true";
  return {
    id: row.id,
    name: row.name,
    artist: row.artist,
    album: row.album,
    cover: row.cover ? coverURL(row.id) : "",
    duration: row.duration,
    filename: path.basename(row.rel_path),
    relPath: row.rel_path,
    ext: row.ext,
    size: row.size,
    sizeText: formatSizeMB(row.size),
    modifiedAt: row.modified_at,
    mtimeMs: Date.parse(row.modified_at) || 0,
    missing: [],
    extra,
  };
}

/** 全量重建索引（事务内 DELETE + INSERT） */
export async function syncTracksToIndex(tracks: LocalMusicTrack[]): Promise<void> {
  const db = getDB();
  const insert = db.prepare(
    `INSERT INTO local_music_index (id, name, artist, album, rel_path, ext, size, duration, cover, lyric, modified_at)
     VALUES (@id, @name, @artist, @album, @rel_path, @ext, @size, @duration, @cover, @lyric, @modified_at)`,
  );
  const tx = db.transaction((rows: IndexRow[]) => {
    db.prepare("DELETE FROM local_music_index").run();
    for (const row of rows) insert.run(row);
  });
  const rows: IndexRow[] = tracks.map((t) => ({
    id: t.id,
    name: t.name,
    artist: t.artist,
    album: t.album,
    rel_path: t.relPath,
    ext: t.ext,
    size: t.size,
    duration: t.duration,
    cover: t.cover ? 1 : 0,
    lyric: t.extra.lyric === "true" ? 1 : 0,
    modified_at: t.modifiedAt,
  }));
  tx(rows);
}

export function upsertLocalMusicIndexRow(track: LocalMusicTrack): void {
  getDB()
    .prepare(
      `INSERT INTO local_music_index (id, name, artist, album, rel_path, ext, size, duration, cover, lyric, modified_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, artist=excluded.artist, album=excluded.album,
         rel_path=excluded.rel_path, ext=excluded.ext, size=excluded.size, duration=excluded.duration,
         cover=excluded.cover, lyric=excluded.lyric, modified_at=excluded.modified_at`,
    )
    .run(
      track.id,
      track.name,
      track.artist,
      track.album,
      track.relPath,
      track.ext,
      track.size,
      track.duration,
      track.cover ? 1 : 0,
      track.extra.lyric === "true" ? 1 : 0,
      track.modifiedAt,
    );
}

export function deleteLocalMusicIndexRow(id: string): void {
  if (!id?.trim()) return;
  getDB().prepare("DELETE FROM local_music_index WHERE id = ?").run(id);
}

/** 从索引分页读取（快速路径），校验文件仍在磁盘上 */
export function loadTracksFromIndex(
  offset: number,
  limit: number,
): { tracks: LocalMusicTrack[]; total: number } | null {
  const db = getDB();
  const total = (db.prepare("SELECT COUNT(*) AS c FROM local_music_index").get() as { c: number }).c;
  if (total === 0) return null;
  if (limit <= 0) limit = 200;
  const rows = db
    .prepare("SELECT * FROM local_music_index ORDER BY modified_at DESC LIMIT ? OFFSET ?")
    .all(limit, offset) as IndexRow[];

  const tracks: LocalMusicTrack[] = [];
  const missingIDs: string[] = [];
  for (const row of rows) {
    const abs = path.join(localMusicDownloadDir(), ...row.rel_path.split("/"));
    try {
      if (fs.statSync(abs).isDirectory()) {
        missingIDs.push(row.id);
        continue;
      }
    } catch {
      missingIDs.push(row.id);
      continue;
    }
    tracks.push(rowToTrack(row));
  }
  if (missingIDs.length) {
    const del = db.prepare("DELETE FROM local_music_index WHERE id = ?");
    for (const id of missingIDs) del.run(id);
  }
  if (!tracks.length) return null;
  return { tracks, total: Math.max(0, total - missingIDs.length) };
}

/** 扫描完成后异步把结果写入索引（不阻塞响应；空扫描也清理旧行） */
export function syncTracksToIndexAsync(tracks: LocalMusicTrack[]): void {
  void syncTracksToIndex(tracks).catch(() => {
    /* ignore */
  });
}

/** 全量重建索引 + 清缓存（reindex 接口用） */
export async function reindexLocalMusic(): Promise<void> {
  const s = state();
  if (s.reindexing) return;
  s.reindexing = true;
  try {
    const result = await scanLocalMusicTracks();
    await syncTracksToIndex(result.tracks);
    storeSnapshot({
      dir: result.dir,
      tracks: result.tracks,
      exists: result.exists,
      err: result.err,
      scannedAt: Date.now(),
    });
  } finally {
    state().reindexing = false;
  }
}

export function isReindexing(): boolean {
  return state().reindexing;
}

/* ---------------- 单曲定位 / 歌词 / 封面 ---------------- */

export async function localMusicTrackByID(id: string): Promise<LocalMusicTrack> {
  const rel = decodeLocalMusicID(id).trim();
  if (!rel) throw new Error("empty local music id");
  const cleanRel = path.normalize(rel);
  if (
    path.isAbsolute(cleanRel) ||
    cleanRel === "." ||
    cleanRel === ".." ||
    cleanRel.startsWith(`..${path.sep}`)
  ) {
    throw new Error("invalid local music path");
  }
  const rootAbs = path.resolve(localMusicDownloadDir());
  const absPath = path.resolve(rootAbs, cleanRel);
  if (!isPathInside(rootAbs, absPath)) throw new Error("local music path escaped root");
  return buildLocalMusicTrack(rootAbs, absPath);
}

/** 读取本地封面：内嵌 picture 优先，sidecar 兜底 */
export async function readLocalMusicCover(
  track: LocalMusicTrack,
): Promise<{ data: Buffer; mime: string; ext: string } | null> {
  const absPath = trackAbsPath(track);
  try {
    const meta = await parseFile(absPath);
    const pic = meta.common.picture?.[0];
    if (pic && pic.data && pic.data.length > 0) {
      const mime = (pic.format ?? "").trim() || "image/jpeg";
      return {
        data: Buffer.from(pic.data),
        mime,
        ext: imageExtByMime(mime),
      };
    }
  } catch {
    /* fallthrough */
  }
  const sidecar = sidecarFile(absPath, LOCAL_MUSIC_COVER_EXTS);
  if (!sidecar) return null;
  try {
    const data = fs.readFileSync(sidecar);
    const ext = path.extname(sidecar).toLowerCase();
    return { data, mime: imageMimeByExt(ext), ext };
  } catch {
    return null;
  }
}

/** 读取本地歌词：内嵌 lyrics 优先，sidecar .lrc/.txt/.lyric 兜底 */
export async function readLocalMusicLyrics(track: LocalMusicTrack): Promise<string> {
  const absPath = trackAbsPath(track);
  try {
    const meta = await parseFile(absPath);
    const rawLyrics = meta.common.lyrics as unknown as string | string[] | undefined;
    const lyrics = (Array.isArray(rawLyrics) ? rawLyrics.join("\n") : rawLyrics ?? "").trim();
    if (lyrics) return lyrics;
  } catch {
    /* fallthrough */
  }
  const sidecar = sidecarFile(absPath, LOCAL_MUSIC_LYRIC_EXTS);
  if (!sidecar) return "";
  try {
    return fs.readFileSync(sidecar, "utf8").trim();
  } catch {
    return "";
  }
}

export function imageMimeByExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    case ".gif":
      return "image/gif";
    default:
      return "image/jpeg";
  }
}

export function imageExtByMime(mime: string): string {
  switch (mime.trim().toLowerCase()) {
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/bmp":
    case "image/x-ms-bmp":
      return ".bmp";
    case "image/gif":
      return ".gif";
    default:
      return ".jpg";
  }
}

export function localMusicCoverFilename(track: LocalMusicTrack, ext: string): string {
  const fixedExt = ext?.trim() || ".jpg";
  const name = track.name.trim() || track.filename.replace(/\.[^.]+$/, "");
  const artist = track.artist.trim() || "Unknown";
  return sanitizeFilename(`${name} - ${artist}${fixedExt}`);
}

export function localMusicLyricFilename(track: LocalMusicTrack): string {
  const name = track.name.trim() || track.filename.replace(/\.[^.]+$/, "");
  const artist = track.artist.trim() || "Unknown";
  return sanitizeFilename(`${name} - ${artist}.lrc`);
}

/* ---------------- 删除 / 上传 / 匹配 ---------------- */

export async function deleteLocalMusicTrack(id: string): Promise<void> {
  const track = await localMusicTrackByID(id);
  fs.rmSync(trackAbsPath(track), { force: true });
  deleteLocalMusicIndexRow(track.id);
  invalidateLocalMusicScanCache();
}

export function sanitizeLocalMusicUploadName(name: string): string {
  let clean = (name ?? "").trim().replaceAll("\\", "/");
  clean = path.basename(clean);
  const ext = path.extname(clean).toLowerCase();
  if (!AUDIO_EXTS.has(ext)) {
    throw new Error("仅支持 mp3、flac、m4a、ogg、wav、wma、aac 音频文件");
  }
  let base = clean.slice(0, clean.length - ext.length).trim();
  base = sanitizeFilename(base).trim() || "local-music";
  return base + ext;
}

export function uniqueLocalMusicPath(dir: string, filename: string): string {
  const ext = path.extname(filename);
  const base = filename.slice(0, filename.length - ext.length);
  let candidate = path.join(dir, filename);
  if (!fs.existsSync(candidate)) return candidate;
  for (let i = 1; ; i++) {
    candidate = path.join(dir, `${base} (${i})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
}

export async function saveUploadedLocalMusic(
  filename: string,
  data: Buffer,
): Promise<LocalMusicTrack> {
  const safeName = sanitizeLocalMusicUploadName(filename);
  const dir = localMusicDownloadDir();
  fs.mkdirSync(dir, { recursive: true });
  const rootAbs = path.resolve(dir);
  const dstPath = uniqueLocalMusicPath(rootAbs, safeName);
  fs.writeFileSync(dstPath, data);
  try {
    const track = await buildLocalMusicTrack(rootAbs, dstPath);
    invalidateLocalMusicScanCache();
    return track;
  } catch (err) {
    fs.rmSync(dstPath, { force: true });
    throw err;
  }
}

/** 在索引中找本地匹配（先精确后模糊，跳过已消失文件） */
export function findLocalMusicMatch(
  name: string,
  artist: string,
): { row: IndexRow; absPath: string } | null {
  const db = getDB();
  const rootAbs = path.resolve(localMusicDownloadDir());
  const seen = new Set<string>();
  const stale: string[] = [];

  const findExisting = (rows: IndexRow[]): { row: IndexRow; absPath: string } | null => {
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      const absPath = path.join(rootAbs, ...row.rel_path.split("/"));
      try {
        if (fs.statSync(absPath).isDirectory()) {
          stale.push(row.id);
          continue;
        }
      } catch {
        stale.push(row.id);
        continue;
      }
      return { row, absPath };
    }
    return null;
  };
  const lookup = (sql: string, ...args: unknown[]): { row: IndexRow; absPath: string } | null => {
    const rows = db.prepare(sql).all(...args) as IndexRow[];
    return findExisting(rows.slice(0, 20));
  };
  const cleanup = () => {
    if (stale.length) {
      const del = db.prepare("DELETE FROM local_music_index WHERE id = ?");
      for (const id of stale) del.run(id);
    }
  };

  try {
    if (artist) {
      let hit = lookup(
        "SELECT * FROM local_music_index WHERE name = ? AND artist = ? ORDER BY modified_at DESC",
        name,
        artist,
      );
      if (hit) return hit;
      hit = lookup(
        "SELECT * FROM local_music_index WHERE name LIKE ? AND artist = ? ORDER BY modified_at DESC",
        `%${name}%`,
        artist,
      );
      return hit;
    }
    let hit = lookup(
      "SELECT * FROM local_music_index WHERE name = ? ORDER BY modified_at DESC",
      name,
    );
    if (hit) return hit;
    return lookup(
      "SELECT * FROM local_music_index WHERE name LIKE ? ORDER BY modified_at DESC",
      `%${name}%`,
    );
  } finally {
    cleanup();
  }
}

/* ---------------- 搜索 / 收藏标记 ---------------- */

/** 索引表关键词搜索（用于 /api/search 勾选 local 源） */
export function localMusicSearchSongs(keyword: string, limit = 200): Song[] {
  keyword = (keyword ?? "").trim();
  if (!keyword) return [];
  const like = `%${keyword}%`;
  const db = getDB();
  const rows = db
    .prepare(
      "SELECT * FROM local_music_index WHERE name LIKE ? OR artist LIKE ? OR album LIKE ? ORDER BY modified_at DESC LIMIT ?",
    )
    .all(like, like, like, limit) as IndexRow[];

  const songs: Song[] = [];
  for (const row of rows) {
    const abs = path.join(localMusicDownloadDir(), ...row.rel_path.split("/"));
    try {
      if (fs.statSync(abs).isDirectory()) {
        deleteLocalMusicIndexRow(row.id);
        continue;
      }
    } catch {
      deleteLocalMusicIndexRow(row.id);
      continue;
    }
    const track = rowToTrack(row);
    songs.push({
      id: track.id,
      source: LOCAL_MUSIC_SOURCE,
      name: track.name,
      artist: track.artist,
      album: track.album,
      cover: track.cover,
      duration: track.duration,
      size: track.size,
      bitrate: 0,
      url: "",
      link: "",
      extra: track.extra,
    });
  }
  return songs;
}

/** 标记分页内曲目是否已加入某收藏歌单 */
export function markAlreadyAddedLocalTracks(collectionId: number, tracks: LocalMusicTrack[]): void {
  if (!collectionId || !tracks.length) return;
  const db = getDB();
  const collection = db
    .prepare("SELECT * FROM collections WHERE id = ?")
    .get(collectionId) as { kind: string } | undefined;
  if (!collection || collection.kind === "imported") return;
  const placeholders = tracks.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT song_id FROM saved_songs WHERE collection_id = ? AND source IN ('local','local-file') AND song_id IN (${placeholders})`,
    )
    .all(collectionId, ...tracks.map((t) => t.id)) as { song_id: string }[];
  const added = new Set(rows.map((r) => r.song_id));
  for (const track of tracks) track.alreadyAdded = added.has(track.id);
}

/* ---------------- 播放时自动缓存 ---------------- */

export function reserveAutoCache(key: string): "started" | "in_progress" | "busy" {
  const s = state();
  if (s.autoCacheInFlight.has(key)) return "in_progress";
  if (s.autoCacheActive >= 2) return "busy";
  s.autoCacheInFlight.add(key);
  s.autoCacheActive++;
  return "started";
}

export function releaseAutoCache(key: string): void {
  const s = state();
  s.autoCacheInFlight.delete(key);
  s.autoCacheActive = Math.max(0, s.autoCacheActive - 1);
}

/** 下载歌曲文件到指定目录（供 auto_cache / videogen 复用；不写下载记录） */
export async function saveSongToFile(
  song: {
    id: string;
    source: string;
    name?: string;
    artist?: string;
    album?: string;
    cover?: string;
    extra?: Record<string, string>;
    ext?: string;
  },
  outDir: string,
  fetchAudio: () => Promise<{ data: Buffer; contentType: string; url: string }>,
  filenameTemplate?: string,
): Promise<{ savedPath: string; filename: string }> {
  const { buildDownloadFilename, detectExtByContentType, extFromUrlPath } = await import("./web-core");
  const { data, contentType, url } = await fetchAudio();
  let ext = detectExtByContentType(contentType) || extFromUrlPath(url);
  if (!ext) ext = (song.ext ?? "").replace(/^\./, "").toLowerCase();
  if (!ext) ext = "mp3";
  const filename = buildDownloadFilename(
    {
      id: song.id,
      name: song.name || "Unknown",
      artist: song.artist || "Unknown",
      album: song.album ?? "",
      source: song.source,
    },
    ext,
    filenameTemplate,
  );
  const targetDir = (outDir ?? "").trim() || localMusicDownloadDir();
  fs.mkdirSync(targetDir, { recursive: true });
  const safe = filename.split("/").map((s) => s.trim()).filter((s) => s && s !== "." && s !== "..");
  const savedPath = path.join(targetDir, ...(safe.length ? safe : ["download"]));
  fs.mkdirSync(path.dirname(savedPath), { recursive: true });
  fs.writeFileSync(savedPath, data);
  return { savedPath, filename: safe.join("/") || path.basename(savedPath) };
}

/** 缓存完成后定向索引单个文件（避免全量重扫） */
export async function indexAutoCachedFile(savedPath: string): Promise<void> {
  if (!savedPath?.trim()) return;
  const rootAbs = path.resolve(localMusicDownloadDir());
  try {
    const track = await buildLocalMusicTrack(rootAbs, savedPath);
    upsertLocalMusicIndexRow(track);
    invalidateLocalMusicScanCache();
  } catch {
    /* ignore */
  }
}
