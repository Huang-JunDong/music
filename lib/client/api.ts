"use client";

/**
 * 前端 API 客户端 — 对接 /api/*（与 Go 版行为一一对应的路由）
 * 含 401 统一分流（跳登录页）与鉴权 API。
 */
import type { Song, Playlist, PlaylistCategory, QRLoginSession, QRLoginResult, SongQuality } from "../types";
import { songParams } from "../play-url";

export class ApiError extends Error {
  status: number;
  setupRequired?: boolean;
  loginRequired?: boolean;
  constructor(message: string, status: number, flags?: { setupRequired?: boolean; loginRequired?: boolean }) {
    super(message);
    this.status = status;
    this.setupRequired = flags?.setupRequired;
    this.loginRequired = flags?.loginRequired;
  }
}

/** 401 → 触发登录跳转（AppShell 监听）；登录/初始化/密码流程自身不触发 */
function handleAuthFailure(flags?: { setupRequired?: boolean; loginRequired?: boolean }) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("musicdl:auth-required", { detail: flags ?? {} }));
}

/** 登录流程类端点：401 由表单自身处理，不触发全局分流 */
const AUTH_FLOW_PREFIXES = ["/api/login", "/api/setup", "/api/logout", "/api/password"];

async function getJSON<T>(url: string): Promise<T> {
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) {
    let message = `HTTP ${resp.status}`;
    let flags: { setupRequired?: boolean; loginRequired?: boolean } | undefined;
    try {
      const body = await resp.json();
      if (body?.error) message = body.error;
      flags = body;
    } catch {
      /* ignore */
    }
    if (resp.status === 401 && !AUTH_FLOW_PREFIXES.some((p) => url.startsWith(p))) {
      handleAuthFailure(flags);
    }
    throw new ApiError(message, resp.status, flags);
  }
  return resp.json() as Promise<T>;
}

/**
 * 统一写请求封装（审核整改 A-28/A-15）：POST/PUT/DELETE 全部经此发出——
 * 统一携带 X-Requested-With 头（服务端 checkWriteGuard 同源 CSRF 防护要求）、
 * 统一 r.ok 校验与 401 全局分流（原先六个端点绕过封装导致 401 不分流）。
 */
async function requestJSON<T>(url: string, method: string, body?: unknown): Promise<T> {
  const resp = await fetch(url, {
    method,
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    if (resp.status === 401 && !AUTH_FLOW_PREFIXES.some((p) => url.startsWith(p))) {
      handleAuthFailure(data);
    }
    throw new ApiError(data?.error ?? `HTTP ${resp.status}`, resp.status, data);
  }
  return data as T;
}

async function postJSON<T>(url: string, body?: unknown, method = "POST"): Promise<T> {
  return requestJSON<T>(url, method, body);
}

/**
 * 通用控制台请求（审核整改 P3-07/P1-01：/netease、/qq API 控制台统一走此入口）：
 * - 非 GET/HEAD 自动携带 X-Requested-With 头（服务端 checkWriteGuard CSRF 防护要求），body 为 JSON
 * - 返回原始 Response 由调用方自行展示状态码/耗时（控制台不做 401 全局分流）
 * - GET 不强制 no-store，保留 ETag/304 协商缓存（网关短缓存路由依赖）
 */
export function apiConsoleFetch(
  url: string,
  options: { method?: string; body?: unknown; cache?: RequestCache } = {},
): Promise<Response> {
  const method = options.method ?? "GET";
  if (method === "GET" || method === "HEAD") {
    return fetch(url, { method, ...(options.cache ? { cache: options.cache } : {}) });
  }
  return fetch(url, {
    method,
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
}

async function delJSON<T>(url: string, body?: unknown): Promise<T> {
  return requestJSON<T>(url, "DELETE", body);
}

/* ---------------- 鉴权 ---------------- */

export interface AuthStatus {
  logged_in: boolean;
  username?: string;
  setup_required?: boolean;
  auth_disabled?: boolean;
}

export function apiAuthStatus(): Promise<AuthStatus> {
  return getJSON("/api/login");
}

export function apiLogin(username: string, password: string): Promise<{ status: string; username?: string }> {
  return postJSON("/api/login", { username, password });
}

export function apiSetup(body: {
  setup_token: string;
  username: string;
  password: string;
  confirm_password: string;
}): Promise<{ status: string }> {
  return postJSON("/api/setup", body);
}

export function apiLogout(): Promise<{ status: string }> {
  return postJSON("/api/logout");
}

/* ---------------- 密码管理（审核补充：忘记密码 / 重置 / 修改） ---------------- */

export function apiPasswordForgot(username: string): Promise<{ status: string; hint?: string }> {
  return postJSON("/api/password/forgot", { username });
}

export function apiPasswordReset(body: {
  username: string;
  reset_token: string;
  new_password: string;
  confirm_password: string;
}): Promise<{ status: string }> {
  return postJSON("/api/password/reset", body);
}

export function apiPasswordChange(body: {
  old_password: string;
  new_password: string;
  confirm_password?: string;
}): Promise<{ status: string }> {
  return postJSON("/api/password/change", body);
}

/* ---------------- 搜索 ---------------- */

export interface ImportCollection {
  name: string;
  description: string;
  cover: string;
  creator: string;
  track_count: number;
  source: string;
  external_id: string;
  content_type: string;
  link: string;
  hover_text?: string;
}

export interface SearchResponse {
  type: "song" | "playlist" | "album";
  songs?: Song[];
  /** 服务端返回扁平歌单/专辑数组（聚合搜索与链接解析共用；前端直接渲染网格） */
  playlists?: Playlist[];
  import_collection?: ImportCollection | null;
  playlist?: Playlist | null;
  album?: Playlist | null;
  error?: string;
  errors?: Record<string, string>;
}

export function apiSearch(params: {
  q: string;
  type?: "song" | "playlist" | "album";
  sources?: string[];
  exact_artist?: string;
}): Promise<SearchResponse> {
  const p = new URLSearchParams({ q: params.q });
  if (params.type) p.set("type", params.type);
  if (params.sources?.length) p.set("sources", params.sources.join(","));
  if (params.exact_artist) p.set("exact_artist", params.exact_artist);
  return getJSON(`/api/search?${p.toString()}`);
}

/* ---------------- 歌单 / 专辑 ---------------- */

export interface PlaylistDetailResponse {
  playlist: Playlist;
  songs: Song[];
  import_collection?: ImportCollection;
  error?: string;
}

export function apiPlaylistDetail(
  source: string,
  id: string,
  meta?: { name?: string; cover?: string; creator?: string; description?: string; track_count?: number; link?: string },
): Promise<PlaylistDetailResponse> {
  const p = new URLSearchParams({ source, id });
  if (meta?.name) p.set("name", meta.name);
  if (meta?.cover) p.set("cover", meta.cover);
  if (meta?.creator) p.set("creator", meta.creator);
  if (meta?.description) p.set("description", meta.description);
  if (meta?.track_count) p.set("track_count", String(meta.track_count));
  if (meta?.link) p.set("link", meta.link);
  return getJSON(`/api/playlist?${p.toString()}`);
}

export function apiAlbumDetail(
  source: string,
  id: string,
  meta?: { name?: string; cover?: string; artist?: string; track_count?: number },
): Promise<PlaylistDetailResponse> {
  const p = new URLSearchParams({ source, id });
  if (meta?.name) p.set("name", meta.name);
  if (meta?.cover) p.set("cover", meta.cover);
  if (meta?.artist) p.set("creator", meta.artist);
  if (meta?.track_count) p.set("track_count", String(meta.track_count));
  return getJSON(`/api/album?${p.toString()}`);
}

/* ---------------- 发现页 ---------------- */

export interface SourcePlaylists {
  source: string;
  name?: string;
  count?: number;
  playlists: Playlist[];
  error?: string;
}

export interface TabsResponse {
  tabs: SourcePlaylists[];
  error?: string;
}

export function apiRecommend(sources?: string[]): Promise<TabsResponse> {
  const p = new URLSearchParams();
  if (sources?.length) p.set("sources", sources.join(","));
  return getJSON(`/api/recommend?${p.toString()}`);
}

export function apiUserPlaylists(sources?: string[]): Promise<TabsResponse> {
  const p = new URLSearchParams();
  if (sources?.length) p.set("sources", sources.join(","));
  return getJSON(`/api/user_playlists?${p.toString()}`);
}

export interface CategoryGroup {
  name: string;
  categories: { id: string; name: string; hot: boolean; url: string; source: string }[];
}

export interface SourceCategoryView {
  source: string;
  name: string;
  count: number;
  groups: CategoryGroup[];
}

export interface CategoriesResponse {
  sources: SourceCategoryView[];
  error?: string;
}

export function apiPlaylistCategories(sources?: string[]): Promise<CategoriesResponse> {
  const p = new URLSearchParams();
  if (sources?.length) p.set("sources", sources.join(","));
  return getJSON(`/api/playlist_categories?${p.toString()}`);
}

export function apiCategoryPlaylists(
  source: string,
  categoryId: string,
  categoryName?: string,
): Promise<{ playlists: Playlist[]; source_name: string; category_name: string }> {
  const p = new URLSearchParams({ source, category_id: categoryId });
  if (categoryName) p.set("category_name", categoryName);
  return getJSON(`/api/category_playlists?${p.toString()}`);
}

/* ---------------- 歌曲 / 换源 ---------------- */

export interface InspectResponse {
  valid: boolean;
  url: string;
  size: string;
  bitrate: string;
  duration?: number;
  song?: Song;
}

export function apiInspect(song: Song, quality?: SongQuality): Promise<InspectResponse> {
  const p = songParams(song);
  if (quality && quality !== "best") p.set("quality", quality);
  return getJSON(`/api/inspect?${p.toString()}`);
}

export function apiSwitchSource(song: Song, target?: string): Promise<Song> {
  const p = new URLSearchParams({
    name: song.name,
    artist: song.artist,
    source: song.source,
    duration: String(song.duration),
  });
  if (target) p.set("target", target);
  return getJSON(`/api/switch_source?${p.toString()}`);
}

/** 保存到服务器下载目录（save_local，对齐 Go .btn-download；需 X-Requested-With 通过 write_guard） */
export function apiSaveToLocal(
  song: Song,
  opts: { embed?: boolean } = {},
): Promise<{ status: string; saved: boolean; path: string; filename: string; skipped?: boolean; warning?: string; webdav_error?: string }> {
  const p = songParams(song);
  p.set("save_local", "1");
  if (opts.embed) p.set("embed", "1");
  return fetch(`/api/download?${p.toString()}`, {
    method: "POST",
    headers: { "X-Requested-With": "XMLHttpRequest" },
  }).then(async (r) => {
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(body?.error ?? `HTTP ${r.status}`, r.status, body);
    return body;
  });
}

/** 批量下载预检（对齐 Go /api/downloads/precheck） */
export function apiDownloadsPrecheck(
  songs: Pick<Song, "name" | "artist">[],
): Promise<{ total: number; skipped: number }> {
  return postJSON("/api/downloads/precheck", {
    songs: songs.map((s) => ({ name: s.name, artist: s.artist })),
  });
}

/* ---------------- 本地歌单 ---------------- */

export interface LocalCollection {
  id: number;
  name: string;
  description: string;
  cover: string;
  kind: "manual" | "imported";
  content_type: "playlist" | "album";
  source: string;
  external_id: string;
  link: string;
  creator: string;
  track_count: number;
  created_at: string;
}

export function apiCollections(includeImported = false): Promise<LocalCollection[]> {
  return getJSON(`/api/collections${includeImported ? "?include_imported=1" : ""}`);
}

export function apiCreateCollection(body: {
  name: string;
  description?: string;
  cover?: string;
}): Promise<{ id: number; name: string }> {
  return postJSON("/api/collections", body);
}

export function apiImportCollection(body: {
  content_type: "playlist" | "album";
  source: string;
  external_id: string;
  name?: string;
  link?: string;
  description?: string;
  cover?: string;
  creator?: string;
  track_count?: number;
}): Promise<{ id: number; name: string; duplicate?: boolean }> {
  return postJSON("/api/collections/import", body);
}

export function apiUpdateCollection(
  id: number,
  body: { name: string; description?: string; cover?: string },
): Promise<{ status: string }> {
  return postJSON(`/api/collections/${id}`, body, "PUT");
}

export function apiDeleteCollection(id: number): Promise<{ status: string }> {
  return delJSON(`/api/collections/${id}`);
}

export function apiCollectionSongs(
  id: number,
): Promise<(Song & { db_id?: number; collection_id?: number; added_at?: string })[]> {
  return getJSON(`/api/collections/${id}/songs`);
}

export function apiAddSongToCollection(id: number, song: Song): Promise<{ status: string }> {
  return postJSON(`/api/collections/${id}/songs`, {
    id: song.id,
    source: song.source,
    name: song.name,
    artist: song.artist,
    cover: song.cover,
    duration: song.duration,
    extra: song.extra,
  });
}

export function apiBatchAddToCollection(
  id: number,
  songs: Song[],
): Promise<{ status: string; requested: number; added: number; duplicate: number; failed: number }> {
  return postJSON(
    `/api/collections/${id}/songs/batch`,
    {
      songs: songs.map((s) => ({
        id: s.id,
        source: s.source,
        name: s.name,
        artist: s.artist,
        cover: s.cover,
        duration: s.duration,
        extra: s.extra,
      })),
    },
  );
}

export function apiRemoveSongFromCollection(id: number, songId: string, source: string): Promise<{ status: string }> {
  return delJSON(`/api/collections/${id}/songs`, { songs: [{ id: songId, source }] });
}

/** 批量把本地音乐加入自建歌单（对齐 Go POST /collections/:id/local_music/batch） */
export function apiAddLocalMusicBatch(
  id: number,
  trackIds: string[],
): Promise<{ status: string; requested: number; added: number; duplicate: number; failed: number }> {
  return postJSON(`/api/collections/${id}/local_music/batch`, { ids: trackIds });
}

/** 播放时后台缓存到本地（autoCacheOnPlay；XHR + 同源校验由服务端守卫） */
export function apiAutoCacheOnPlay(song: Song): Promise<{ status: string }> {
  return postJSON<{ status: string }>("/api/local_music/auto_cache", {
    id: song.id,
    source: song.source,
    name: song.name,
    artist: song.artist,
    album: song.album,
    cover: song.cover,
    extra: song.extra,
  }).catch(() => ({ status: "error" }));
}

/* ---------------- 播放历史 ---------------- */

/** 拉取服务端播放历史（页面加载时恢复 store；免登录可读，静默失败回退空） */
export function apiPlayHistory(): Promise<Song[]> {
  return getJSON<{ songs: Song[] }>("/api/history").then(
    (r) => (Array.isArray(r?.songs) ? r.songs : []),
    () => [],
  );
}

/** 记录一次播放到服务端（fire-and-forget：上报失败不打断播放，本地内存历史仍有效） */
export function apiReportPlayHistory(song: Song): Promise<void> {
  return postJSON("/api/history", {
    id: song.id,
    source: song.source,
    name: song.name,
    artist: song.artist,
    album: song.album,
    album_id: song.album_id,
    cover: song.cover,
    duration: song.duration,
    link: song.link,
    size: song.size,
    bitrate: song.bitrate,
    ext: song.ext,
    extra: song.extra,
  }).then(
    () => undefined,
    () => undefined,
  );
}

/** 清空当前会话的服务端播放历史（免登录清自己的数据；返回成败供调用方决定是否清本地，审核整改 P2-3） */
export function apiClearPlayHistory(): Promise<boolean> {
  return delJSON("/api/history").then(
    () => true,
    () => false,
  );
}

/* ---------------- 本地音乐 ---------------- */

export interface LocalTrack {
  id: string;
  source: string;
  name: string;
  artist: string;
  album: string;
  cover: string;
  duration: number;
  filename: string;
  rel_path: string;
  ext: string;
  size: number;
  size_text: string;
  modified_at: string;
  missing: string[];
  already_added?: boolean;
  extra: Record<string, string>;
}

export interface LocalMusicResponse {
  download_dir: string;
  exists: boolean;
  tracks: LocalTrack[];
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
  refreshing: boolean;
  scanned_at: string;
}

export function apiLocalMusic(
  opts: { offset?: number; limit?: number; refresh?: boolean; collection_id?: number; signal?: AbortSignal } = {},
): Promise<LocalMusicResponse> {
  const p = new URLSearchParams();
  if (opts.offset) p.set("offset", String(opts.offset));
  if (opts.limit) p.set("limit", String(opts.limit));
  if (opts.refresh) p.set("refresh", "1");
  if (opts.collection_id) p.set("collection_id", String(opts.collection_id));
  return fetch(`/api/local_music?${p.toString()}`, { cache: "no-store", signal: opts.signal }).then(async (r) => {
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(body?.error ?? `HTTP ${r.status}`, r.status, body);
    return body as LocalMusicResponse;
  });
}

export function apiUploadLocalMusic(file: File): Promise<{ status: string; track: LocalTrack }> {
  const form = new FormData();
  form.append("file", file);
  /* A-15/A-28：写请求统一携带 X-Requested-With（upload 路由 checkWriteGuard 的 CSRF 同源校验要求；
     multipart 不手设 Content-Type——boundary 由浏览器生成） */
  return fetch("/api/local_music/upload", {
    method: "POST",
    headers: { "X-Requested-With": "XMLHttpRequest" },
    body: form,
  }).then(async (r) => {
    const body = await r.json();
    if (!r.ok) throw new Error(body?.error ?? "上传失败");
    return body;
  });
}

export function apiDeleteLocalMusic(id: string): Promise<{ status: string }> {
  return delJSON(`/api/local_music?id=${encodeURIComponent(id)}`);
}

export function apiLocalDuplicates(
  page = 1,
  pageSize = 10,
): Promise<{
  groups: {
    name: string;
    artist: string;
    songs: { id: string; name: string; artist: string; size: number; duration: number; ext: string; rel_path: string }[];
  }[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}> {
  return getJSON(`/api/local_music/duplicates?page=${page}&page_size=${pageSize}`);
}

export function apiReindexLocalMusic(): Promise<{ status: string }> {
  return postJSON("/api/local_music/reindex");
}

/** 批量匹配本地已有（对齐 Go batchMatchLocalMusic：搜索结果页标记"本地已有"并优先本地播放） */
export interface LocalMatchItem {
  qi: number;
  id: string;
  name: string;
  artist: string;
  size?: number;
  ext?: string;
}

export function apiLocalMusicBatchMatch(
  songs: Pick<Song, "name" | "artist">[],
): Promise<{ matches: LocalMatchItem[] }> {
  return postJSON(
    "/api/local_music/batch_match",
    songs.map((s) => ({ name: s.name, artist: s.artist })),
  );
}

/* ---------------- 设置 / Cookie / QR ---------------- */

export function apiSettings(): Promise<Record<string, unknown>> {
  return getJSON("/api/settings");
}

export function apiSaveSettings(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return postJSON("/api/settings", body);
}

export function apiGetCookies(): Promise<Record<string, string>> {
  return getJSON("/api/cookies");
}

export function apiSaveCookies(cookies: Record<string, string>): Promise<{ status: string }> {
  return postJSON("/api/cookies", cookies);
}

export function apiCreateQRLogin(source: string): Promise<QRLoginSession> {
  return fetch(`/api/qr_login/${source}`, {
    method: "POST",
    headers: { "X-Requested-With": "XMLHttpRequest" },
  }).then(async (r) => {
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(body?.error ?? `HTTP ${r.status}`, r.status, body);
    return body;
  });
}

export function apiCheckQRLogin(source: string, key: string): Promise<QRLoginResult> {
  return getJSON(`/api/qr_login/${source}?key=${encodeURIComponent(key)}`);
}

/* ---------------- 浏览器级音源账号会话（多用户：每个访客登录自己的账号） ---------------- */

export interface QRLoginStatus {
  source: string;
  cookie_source: string;
  logged_in: boolean;
}

/** 查询当前浏览器是否已登录自己的音源账号 */
export function apiQRLoginStatus(source: string): Promise<QRLoginStatus> {
  return getJSON(`/api/qr_login/${source}?status=1`);
}

/** 退出"我的音源账号"（清除浏览器会话凭证，不影响服务器全局配置） */
export function apiQRLogout(source: string): Promise<{ status: string }> {
  return fetch(`/api/qr_login/${source}`, {
    method: "DELETE",
    headers: { "X-Requested-With": "XMLHttpRequest" },
  }).then(async (r) => {
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(body?.error ?? `HTTP ${r.status}`, r.status, body);
    return body;
  });
}

/* ---------------- 下载记录（字段对齐 Go：ID/Name/.../CreatedAt） ---------------- */

export interface DownloadRecord {
  ID: number;
  Name: string;
  Artist: string;
  Source: string;
  Status: string;
  Error: string;
  CreatedAt: string;
}

export function apiDownloadRecords(
  page = 1,
  pageSize = 20,
  status?: "" | "success" | "skipped" | "failed",
): Promise<{
  records: DownloadRecord[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}> {
  const s = status ? `&status=${encodeURIComponent(status)}` : "";
  return getJSON(`/api/downloads/records?page=${page}&page_size=${pageSize}${s}`);
}

export function apiClearDownloadRecords(): Promise<{ status: string }> {
  return delJSON("/api/downloads/records");
}

/* ---------------- 系统环境状态 ---------------- */

export interface SystemStatus {
  app_version: string;
  ffmpeg_available: boolean;
  ffmpeg_path: string;
  ffmpeg_source: "path" | "builtin" | "env" | "unavailable";
  download_dir: string;
  platform: string;
}

export function apiSystemStatus(): Promise<SystemStatus> {
  return getJSON("/api/system/status");
}
