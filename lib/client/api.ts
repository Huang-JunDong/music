"use client";

/**
 * 前端 API 客户端 — 对接 /api/*（与 Go 版行为一一对应的路由）
 * 含 401 统一分流（跳登录页）与鉴权 API。
 */
import type { Song, Playlist, PlaylistCategory, QRLoginSession, QRLoginResult, SongQuality, Toplist, MvItem, MvListTab, Artist, HotSearch, CommentItem, CheckinStatus, Banner, UserProfile, UserVipInfo, UserFollowsResult, PlayRecordItem, ListenStats, ReportSection, HistoryDailyRecommend, DjCategory, DjRadio, DjProgram, StyleTag, StyleDetail, CloudSong, HighqualityTag, DiscoverBlock, SongWiki, SongCreator, FollowedArtist, SearchMultimatch, CountryCode, CommentTarget } from "../types";
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
  /** P1 B4：歌单/专辑动态数徽标（网易 playlist_detail_dynamic / album_detail_dynamic） */
  dynamic?: { play_count?: number; subscribed_count?: number; comment_count?: number; share_count?: number; on_sale?: boolean };
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
  // 服务端 /api/album 返回 { album, songs }（键名为 album），此处映射到统一的 playlist 字段，
  // 与 /api/playlist 的 { playlist, songs } 对齐，供 CollectionDetail 无差别消费
  return getJSON<PlaylistDetailResponse & { album?: Playlist }>(`/api/album?${p.toString()}`).then((r) => {
    if (!r.playlist && r.album) {
      return { ...r, playlist: r.album };
    }
    return r;
  });
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

/* ---------------- 排行榜 ---------------- */

export interface SourceToplists {
  source: string;
  name?: string;
  count?: number;
  toplists: Toplist[];
  error?: string;
}

export function apiToplists(sources?: string[]): Promise<{ tabs: SourceToplists[]; error?: string }> {
  const p = new URLSearchParams();
  if (sources?.length) p.set("sources", sources.join(","));
  return getJSON(`/api/toplists?${p.toString()}`);
}

export interface ToplistDetailResponse {
  toplist: Toplist;
  songs: Song[];
  error?: string;
}

export function apiToplistSongs(
  source: string,
  id: string,
  meta?: Pick<Toplist, "name" | "cover" | "update_time" | "description" | "track_count">,
): Promise<ToplistDetailResponse> {
  const p = new URLSearchParams({ source, id });
  if (meta?.name) p.set("name", meta.name);
  if (meta?.cover) p.set("cover", meta.cover);
  if (meta?.update_time) p.set("update_time", meta.update_time);
  if (meta?.description) p.set("description", meta.description);
  if (meta?.track_count) p.set("track_count", String(meta.track_count));
  return getJSON(`/api/toplist?${p.toString()}`);
}

/* ---------------- MV ---------------- */

export interface MvListResponse {
  source: string;
  source_name: string;
  tab: MvListTab;
  area: string;
  mvs: MvItem[];
  has_more: boolean;
  error?: string;
}

export function apiMvList(
  source: string,
  opts?: { tab?: MvListTab; area?: string; page?: number; limit?: number },
): Promise<MvListResponse> {
  const p = new URLSearchParams({ source });
  if (opts?.tab) p.set("tab", opts.tab);
  if (opts?.area) p.set("area", opts.area);
  if (opts?.page) p.set("page", String(opts.page));
  if (opts?.limit) p.set("limit", String(opts.limit));
  return getJSON(`/api/mvs?${p.toString()}`);
}

export interface MvPlayResponse {
  mv: MvItem | null;
  url: string;
  error?: string;
}

export function apiMvPlay(source: string, id: string, resolution = 1080): Promise<MvPlayResponse> {
  const p = new URLSearchParams({ source, id, r: String(resolution) });
  return getJSON(`/api/mv?${p.toString()}`);
}

/* ---------------- 歌手主页 ---------------- */

export type ArtistKind = "overview" | "songs" | "albums" | "mvs" | "similar";

export interface ArtistOverviewResponse {
  artist: Artist;
  top_songs: Song[];
  error?: string;
}

export interface ArtistPageResponse {
  songs?: Song[];
  albums?: Playlist[];
  mvs?: MvItem[];
  artists?: Artist[];
  has_more?: boolean;
  error?: string;
}

export function apiArtistOverview(source: string, id: string): Promise<ArtistOverviewResponse> {
  return getJSON(`/api/artist?source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}&kind=overview`);
}

export function apiArtistPage(
  source: string,
  id: string,
  kind: Exclude<ArtistKind, "overview">,
  page = 1,
  limit = 30,
): Promise<ArtistPageResponse> {
  const p = new URLSearchParams({ source, id, kind, page: String(page), limit: String(limit) });
  return getJSON(`/api/artist?${p.toString()}`);
}

/* ---------------- 搜索增强（热搜 / 联想 / 歌手） ---------------- */

export interface SourceHotSearches {
  source: string;
  name?: string;
  count?: number;
  hot_searches: HotSearch[];
  /** 默认搜索词（网易 search_default；QQ 取热搜首位） */
  default_keyword?: string;
  error?: string;
}

export function apiHotSearches(): Promise<{ tabs: SourceHotSearches[]; error?: string }> {
  return getJSON(`/api/hot_searches`);
}

export function apiSearchSuggest(q: string): Promise<{ suggestions: string[] }> {
  return getJSON(`/api/search_suggest?q=${encodeURIComponent(q)}`);
}

export function apiSearchArtists(q: string): Promise<{ artists: Artist[] }> {
  return getJSON(`/api/search_artists?q=${encodeURIComponent(q)}`);
}

/* ---------------- 私人FM ---------------- */

export function apiFm(source: string, mode = ""): Promise<{ source: string; songs: Song[] }> {
  const p = new URLSearchParams({ source });
  if (mode) p.set("mode", mode);
  return getJSON(`/api/fm?${p.toString()}`);
}

export function apiFmTrash(source: string, songId: string): Promise<{ ok: boolean }> {
  return requestJSON(`/api/fm/trash`, "POST", { source, song_id: songId });
}

/* ---------------- 歌曲评论 ---------------- */

export interface CommentsResponse {
  /* 审核整改 R2-#10：error 分支路由不返回列表，标注可选与实际一致 */
  comments?: CommentItem[];
  total: number;
  has_more: boolean;
  error?: string;
}

/** P1 C3：多资源评论（comment_new；sort=recommended 为 QQ 推荐评论） */
export function apiCommentsV2(
  song: Song,
  type: CommentTarget["type"],
  sort: "hot" | "new" | "recommended",
  page: number,
  limit = 20,
): Promise<CommentsResponse> {
  const p = new URLSearchParams(songParams(song));
  if (type !== "song") p.set("type", type);
  if (sort !== "hot") p.set("sort", sort);
  p.set("page", String(page));
  p.set("limit", String(limit));
  return getJSON(`/api/comments?${p.toString()}`);
}

export function apiAddSongComment(song: Song, content: string, replyTo?: string): Promise<{ ok: boolean }> {
  const body: Record<string, string> = { ...Object.fromEntries(songParams(song)), content };
  if (replyTo) body.reply_to = replyTo;
  return requestJSON(`/api/comments`, "POST", body);
}

/** 删除自己的评论（上游校验仅本人评论可删） */
export function apiDeleteSongComment(song: Song, commentId: string): Promise<{ ok: boolean }> {
  const body: Record<string, string> = { ...Object.fromEntries(songParams(song)), comment_id: commentId };
  return requestJSON(`/api/comments`, "DELETE", body);
}

/* ---------------- 新碟架 ---------------- */

export interface AlbumsPageResponse {
  albums: Playlist[];
  has_more: boolean;
  error?: string;
}

export function apiNewAlbums(source: string, area: string, page = 1, limit = 30): Promise<AlbumsPageResponse> {
  const p = new URLSearchParams({ source, kind: "new", area, page: String(page), limit: String(limit) });
  return getJSON(`/api/albums?${p.toString()}`);
}

export function apiFavAlbums(source: string, page = 1, limit = 30): Promise<AlbumsPageResponse> {
  const p = new URLSearchParams({ source, kind: "fav", page: String(page), limit: String(limit) });
  return getJSON(`/api/albums?${p.toString()}`);
}

export function apiSubAlbum(album: Playlist, sub: boolean): Promise<{ ok: boolean }> {
  const body: Record<string, string> = {
    id: album.id,
    name: album.name,
    cover: album.cover,
    creator: album.creator,
    track_count: String(album.track_count),
    source: album.source,
    link: album.link,
    sub: sub ? "true" : "false",
  };
  if (album.extra) body.extra = JSON.stringify(album.extra);
  return requestJSON(`/api/albums`, "POST", body);
}

/* ---------------- 签到中心 ---------------- */

export function apiCheckinStatus(): Promise<{ status: CheckinStatus; error?: string }> {
  return getJSON(`/api/checkin`);
}

export type CheckinKind = "daily" | "yunbei" | "vip";

export function apiDoCheckin(kind: CheckinKind): Promise<{ ok: boolean }> {
  return requestJSON(`/api/checkin`, "POST", { kind });
}

/* ---------------- P1 Wave A：用户资产与报告 ---------------- */

export function apiUserProfile(source: string, uid?: string): Promise<{ profile?: UserProfile; error?: string }> {
  const p = new URLSearchParams({ source });
  if (uid) p.set("uid", uid);
  return getJSON(`/api/user_profile?${p.toString()}`);
}

export function apiVipInfo(source: string): Promise<{ vip?: UserVipInfo; error?: string }> {
  return getJSON(`/api/vip_info?source=${encodeURIComponent(source)}`);
}

export function apiUserFollows(
  source: string,
  uid: string,
  kind: "follows" | "followeds" | "mutual",
  page = 1,
  limit = 30,
): Promise<{ users?: UserFollowsResult["users"]; has_more?: boolean; error?: string }> {
  const p = new URLSearchParams({ source, uid, kind, page: String(page), limit: String(limit) });
  return getJSON(`/api/user_follows?${p.toString()}`);
}

/** 他人主页歌单（tab: created 创建 / collected 收集） */
export function apiOwnerPlaylists(
  source: string,
  uid: string,
  tab: "created" | "collected",
  page = 1,
  limit = 50,
): Promise<{ playlists?: Playlist[]; error?: string }> {
  const p = new URLSearchParams({ source, owner: uid, tab, page: String(page), limit: String(limit) });
  return getJSON(`/api/user_playlists?${p.toString()}`);
}

export function apiReportSections(source: string): Promise<{ sections?: ReportSection[]; error?: string; need_login?: boolean }> {
  return getJSON(`/api/report?source=${encodeURIComponent(source)}&section=annual`);
}

export function apiListenStats(source: string): Promise<{ stats?: ListenStats; error?: string; need_login?: boolean }> {
  return getJSON(`/api/report?source=${encodeURIComponent(source)}&section=stats`);
}

export function apiPlayRecord(source: string, type: 0 | 1): Promise<{ items?: PlayRecordItem[]; error?: string; need_login?: boolean }> {
  return getJSON(`/api/report?source=${encodeURIComponent(source)}&section=record&type=${type}`);
}

export function apiHistoryDailyRecommends(
  source: string,
  date?: string,
): Promise<{ days?: HistoryDailyRecommend[]; error?: string; need_login?: boolean }> {
  const p = new URLSearchParams({ source, section: "history" });
  if (date) p.set("date", date);
  return getJSON(`/api/report?${p.toString()}`);
}

/* ---------------- P1 Wave B：播客 / 曲风 / 云盘 / 发现二期 ---------------- */

export function apiDjCategories(): Promise<{ categories?: DjCategory[]; error?: string }> {
  return getJSON(`/api/podcast?categories=1`);
}

export function apiDjRadios(
  kind: "recommend" | "hot" | "today",
  category?: string,
  page = 1,
  limit = 30,
): Promise<{ radios?: DjRadio[]; has_more?: boolean; error?: string }> {
  const p = new URLSearchParams({ kind, page: String(page), limit: String(limit) });
  if (category) p.set("category", category);
  return getJSON(`/api/podcast?${p.toString()}`);
}

export function apiDjRadioDetail(
  id: string,
  programPage = 1,
  programLimit = 30,
): Promise<{ radio?: DjRadio; programs?: DjProgram[]; programs_has_more?: boolean; programs_error?: string; error?: string }> {
  return getJSON(`/api/podcast_detail?id=${encodeURIComponent(id)}&program_page=${programPage}&program_limit=${programLimit}`);
}

/** P1 B1：单节目完整详情（dj_program_detail，完整描述） */
export function apiDjProgramDetail(programId: string): Promise<{ program?: DjProgram; error?: string }> {
  return getJSON(`/api/podcast_detail?program_id=${encodeURIComponent(programId)}`);
}

export function apiStyles(): Promise<{ tags?: StyleTag[]; top_tags?: StyleTag[]; preferences?: string[]; error?: string }> {
  return getJSON(`/api/styles`);
}

export function apiStyleMeta(id: string): Promise<{ style?: StyleDetail; error?: string }> {
  return getJSON(`/api/styles/detail?id=${encodeURIComponent(id)}&kind=meta`);
}

export interface StyleResourceResponse {
  songs?: Song[];
  albums?: Playlist[];
  artists?: Artist[];
  playlists?: Playlist[];
  has_more?: boolean;
  error?: string;
}

export function apiStyleResource(
  id: string,
  kind: "song" | "album" | "artist" | "playlist",
  page = 1,
  limit = 30,
): Promise<StyleResourceResponse> {
  return getJSON(`/api/styles/detail?id=${encodeURIComponent(id)}&kind=${kind}&page=${page}&limit=${limit}`);
}

/** P1 B3：云盘单条详情（user_cloud_detail：文件名/大小/添加时间） */
export function apiCloudSongDetail(cloudId: string): Promise<{ song?: CloudSong; error?: string }> {
  return getJSON(`/api/cloud?id=${encodeURIComponent(cloudId)}`);
}

export function apiCloudSongs(
  page = 1,
  limit = 50,
): Promise<{ songs?: CloudSong[]; has_more?: boolean; size?: number; max_size?: number; error?: string; need_login?: boolean }> {
  return getJSON(`/api/cloud?page=${page}&limit=${limit}`);
}

export function apiCloudMatch(cloudId: string, targetSongId: string): Promise<{ ok: boolean }> {
  return requestJSON(`/api/cloud`, "POST", { action: "match", id: cloudId, target: targetSongId });
}

export function apiCloudLyric(cloudId: string): Promise<{ lyric?: string; error?: string }> {
  return requestJSON(`/api/cloud`, "POST", { action: "lyric", id: cloudId });
}

export function apiCloudDelete(cloudId: string): Promise<{ ok: boolean }> {
  return requestJSON(`/api/cloud`, "POST", { action: "delete", id: cloudId });
}

export function apiHighquality(
  tag = "全部",
  page = 1,
  withTags = false,
): Promise<{ playlists?: Playlist[]; has_more?: boolean; tags?: HighqualityTag[]; hot_tags?: { id: string; name: string; hot?: boolean }[]; error?: string }> {
  const p = new URLSearchParams({ tag, page: String(page) });
  if (withTags) p.set("with_tags", "1");
  return getJSON(`/api/highquality?${p.toString()}`);
}

export function apiDiscoverBlocks(): Promise<{ blocks?: DiscoverBlock[]; error?: string }> {
  return getJSON(`/api/discover?kind=blocks`);
}

export function apiPrivateContents(): Promise<{ banners?: Banner[]; error?: string }> {
  return getJSON(`/api/discover?kind=privatecontents`);
}

export function apiRecommendedMvs(): Promise<{ mvs?: MvItem[]; error?: string }> {
  return getJSON(`/api/discover?kind=recommended_mvs`);
}

export function apiDailyPlaylists(): Promise<{ playlists?: Playlist[]; need_login?: boolean; error?: string }> {
  return getJSON(`/api/discover?kind=daily_playlists`);
}

export function apiMyLikedPlaylists(): Promise<{ playlists?: Playlist[]; error?: string }> {
  return getJSON(`/api/discover?kind=my_liked`);
}

/** 专辑筛选列表（P1 B4：album_list / album_list_style） */
export function apiAlbumList(
  source: string,
  area: string,
  style = "",
  page = 1,
  limit = 30,
): Promise<{ albums?: Playlist[]; has_more?: boolean; error?: string }> {
  const p = new URLSearchParams({ source, kind: "list", area, page: String(page), limit: String(limit) });
  if (style) p.set("style", style);
  return getJSON(`/api/albums?${p.toString()}`);
}

/** 收藏/取消收藏歌单（P1 B4） */
export function apiSubscribePlaylist(source: string, playlistId: string, sub: boolean): Promise<{ ok: boolean }> {
  return requestJSON(`/api/playlist/manage`, "POST", {
    action: sub ? "subscribe" : "unsubscribe",
    source,
    playlist_id: playlistId,
  });
}

/** 歌单排序（P1 C4：playlist_order_update，置顶 = 目标移至首位后接其余歌单 id） */
export function apiUpdatePlaylistOrder(source: string, playlistIds: string[]): Promise<{ ok: boolean }> {
  return requestJSON(`/api/playlist/manage`, "POST", {
    action: "order",
    source,
    playlist_ids: playlistIds,
  });
}

/* ---------------- P1 Wave C：体验增强 ---------------- */

/** C1 歌曲百科聚合（wiki + creators + meta + 红评数 + 版权替代 + QQ 标签/制作人/其他版本/收藏数） */
export function apiSongWiki(song: Song): Promise<{ wiki?: SongWiki; error?: string }> {
  const p = new URLSearchParams(songParams(song));
  return getJSON(`/api/song_wiki?${p.toString()}`);
}

/** C2 歌手头部统计与长文简介（artist_detail/dynamic + QQ GetSingerDetail） */
export function apiArtistWiki(source: string, id: string): Promise<{ desc?: string; follower_count?: number; error?: string }> {
  return getJSON(`/api/artist?source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}&kind=wiki`);
}

/** C2 关注/取关歌手（artist_sub，乐观更新由调用方负责） */
export function apiFollowArtist(source: string, id: string, follow: boolean): Promise<{ ok: boolean }> {
  return requestJSON(`/api/artist`, "POST", { source, id, action: follow ? "follow" : "unfollow" });
}

/** C2 已关注歌手列表（artist_sublist · QQ GetFollowSingerList） */
export function apiFollowedArtists(
  source: string,
  page = 1,
  limit = 30,
): Promise<{ artists?: FollowedArtist[]; has_more?: boolean; error?: string; need_login?: boolean }> {
  return getJSON(`/api/followed_artists?source=${encodeURIComponent(source)}&page=${page}&limit=${limit}`);
}

/** C2 歌手视频（artist_video，网易专属） */
export function apiArtistVideos(
  source: string,
  id: string,
  page = 1,
  limit = 20,
): Promise<{ videos?: MvItem[]; has_more?: boolean; error?: string }> {
  return getJSON(`/api/artist?source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}&kind=videos&page=${page}&limit=${limit}`);
}

/** C3 楼层回复（comment_floor） */
export function apiCommentFloor(
  song: Song,
  type: CommentTarget["type"],
  parentId: string,
  page = 1,
  limit = 20,
): Promise<CommentsResponse> {
  const p = new URLSearchParams(songParams(song));
  if (type !== "song") p.set("type", type);
  p.set("floor", "1");
  p.set("parent_id", parentId);
  p.set("page", String(page));
  p.set("limit", String(limit));
  return getJSON(`/api/comments?${p.toString()}`);
}

/** C3 点赞/取消点赞评论（comment_like） */
export function apiLikeComment(song: Song, type: CommentTarget["type"], commentId: string, like: boolean): Promise<{ ok: boolean }> {
  const body: Record<string, string> = {
    ...Object.fromEntries(songParams(song)),
    action: like ? "like" : "unlike",
    comment_id: commentId,
  };
  if (type !== "song") body.type = type;
  return requestJSON(`/api/comments`, "POST", body);
}

/** C3 抱抱评论（hug_comment，需评论作者 id） */
export function apiHugComment(song: Song, type: CommentTarget["type"], commentId: string, targetUserId: string): Promise<{ ok: boolean }> {
  const body: Record<string, string> = {
    ...Object.fromEntries(songParams(song)),
    action: "hug",
    comment_id: commentId,
    target_user_id: targetUserId,
  };
  if (type !== "song") body.type = type;
  return requestJSON(`/api/comments`, "POST", body);
}

/** C4 心动模式（以种子歌曲生成智能队列，seed 携带歌曲参数） */
export function apiIntelligenceFm(seed: Song): Promise<{ songs?: Song[]; error?: string }> {
  const p = new URLSearchParams(songParams(seed));
  p.set("mode", `seed:${seed.id}`);
  return getJSON(`/api/fm?${p.toString()}`);
}

/** C4 大歌单增量分页（playlist_track_all） */
export function apiPlaylistTracksPage(
  source: string,
  id: string,
  page = 1,
  limit = 200,
): Promise<{ songs?: Song[]; has_more?: boolean; error?: string }> {
  return getJSON(`/api/playlist?source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}&all=1&page=${page}&limit=${limit}`);
}

/** C5 最优匹配/综合搜索（search_multimatch / smartbox / do_search_v2） */
export function apiSearchMatch(source: string, q: string, mode: "match" | "general" = "match"): Promise<SearchMultimatch & { error?: string }> {
  return getJSON(`/api/search?q=${encodeURIComponent(q)}&source=${encodeURIComponent(source)}&mode=${mode}`);
}

/** C6 凭证续期（login_refresh · QQ refreshCredential） */
export function apiAccountRefresh(source: string): Promise<{ ok: boolean; error?: string }> {
  return requestJSON(`/api/account`, "POST", { action: "refresh", source });
}

/** C6 凭证过期探测（QQ checkExpired） */
export function apiAccountCheckExpired(source: string): Promise<{ expired?: boolean }> {
  return requestJSON(`/api/account`, "POST", { action: "check_expired", source });
}

/** C6 匿名注册兜底（register_anonimous，凭证自动写入浏览器会话） */
export function apiRegisterAnonymous(): Promise<{ ok: boolean; error?: string }> {
  return requestJSON(`/api/account`, "POST", { action: "anonymous" });
}

/** C6 国际区号（countries_code_list） */
export function apiCountries(): Promise<{ countries?: CountryCode[] }> {
  return getJSON(`/api/countries`);
}

/** C7 收藏/取消收藏 MV（mv_sub） */
export function apiSubMv(id: string, sub: boolean): Promise<{ ok: boolean }> {
  return requestJSON(`/api/mv`, "POST", { source: "netease", id, action: sub ? "sub" : "unsub" });
}

/** C7 收藏 MV 列表（mv_sublist） */
export function apiSubbedMvs(page = 1, limit = 30): Promise<{ mvs?: MvItem[]; has_more?: boolean; error?: string }> {
  return getJSON(`/api/mv?source=netease&sublist=1&page=${page}&limit=${limit}`);
}

/** C7 相似 MV（simi_mv） */
export function apiSimilarMvs(id: string): Promise<{ mvs?: MvItem[] }> {
  return getJSON(`/api/mv?source=netease&similar=1&id=${encodeURIComponent(id)}`);
}

/** C7 视频详情+链接（video_detail + video_url，网易 video 体系） */
export function apiVideoPlay(id: string, resolution = 1080): Promise<{ video?: MvItem; url?: string; error?: string }> {
  return getJSON(`/api/video?id=${encodeURIComponent(id)}&r=${resolution}`);
}

/** C7 相关视频（related_allvideo） */
export function apiRelatedVideos(id: string): Promise<{ related?: MvItem[] }> {
  return getJSON(`/api/video?id=${encodeURIComponent(id)}&related=1`);
}

/** C7 歌曲相关 MV（QQ GetSongRelatedMv，播放页入口） */
export function apiRelatedMvs(song: Song): Promise<{ mvs?: MvItem[]; error?: string }> {
  const p = new URLSearchParams(songParams(song));
  return getJSON(`/api/mvs?${p.toString()}&related=1`);
}

/* ---------------- 相似推荐 ---------------- */

export function apiSimilarSongs(song: Song): Promise<{ songs: Song[]; error?: string }> {
  const p = new URLSearchParams(songParams(song));
  p.set("kind", "songs");
  return getJSON(`/api/similar?${p.toString()}`);
}

export function apiRelatedPlaylists(song: Song): Promise<{ playlists: Playlist[]; error?: string }> {
  const p = new URLSearchParams(songParams(song));
  p.set("kind", "playlists");
  return getJSON(`/api/similar?${p.toString()}`);
}

/** 听过此歌的用户（P1 C4：网易 simi_user，相似弹窗扩展） */
export function apiSimilarUsers(song: Song): Promise<{ users?: UserFollowsResult["users"]; error?: string }> {
  const p = new URLSearchParams(songParams(song));
  p.set("kind", "users");
  return getJSON(`/api/similar?${p.toString()}`);
}

/* ---------------- 最近播放（网易账号） ---------------- */

export type RecentKind = "song" | "album" | "playlist";

export interface RecentResponse {
  songs?: Song[];
  albums?: Playlist[];
  playlists?: Playlist[];
  need_login?: boolean;
  error?: string;
}

export function apiRecent(kind: RecentKind, limit = 50): Promise<RecentResponse> {
  return getJSON(`/api/recent?kind=${kind}&limit=${limit}`);
}

/* ---------------- 歌手库 ---------------- */

export interface ArtistLibraryResponse {
  artists: Artist[];
  has_more: boolean;
  error?: string;
}

export function apiArtistLibrary(
  source: string,
  opts?: { area?: string; sex?: string; initial?: string; page?: number; limit?: number },
): Promise<ArtistLibraryResponse> {
  const p = new URLSearchParams({ source });
  if (opts?.area && opts.area !== "全部") p.set("area", opts.area);
  if (opts?.sex && opts.sex !== "全部") p.set("sex", opts.sex);
  if (opts?.initial) p.set("initial", opts.initial);
  if (opts?.page) p.set("page", String(opts.page));
  if (opts?.limit) p.set("limit", String(opts.limit));
  return getJSON(`/api/artists?${p.toString()}`);
}

/** 歌手榜（网易专属：type 1华语 2欧美 3日语 4韩语） */
export function apiArtistToplist(type = 1): Promise<{ artists: Artist[]; error?: string }> {
  return getJSON(`/api/artists?source=netease&kind=toplist&type=${type}`);
}

/* ---------------- 源站歌单管理 ---------------- */

export function apiCreatePlaylist(source: string, name: string): Promise<{ ok: boolean; playlist_id?: string }> {
  return requestJSON(`/api/playlist/manage`, "POST", { action: "create", source, name });
}

/** 删除源站歌单（高危操作，UI 需二次确认） */
export function apiDeletePlaylist(source: string, playlistId: string): Promise<{ ok: boolean }> {
  return requestJSON(`/api/playlist/manage`, "POST", { action: "delete", source, playlist_id: playlistId });
}

/** 编辑源站歌单信息（仅网易支持；name 必传防上游清空） */
export function apiUpdateSourcePlaylist(
  source: string,
  playlistId: string,
  name: string,
  desc?: string,
): Promise<{ ok: boolean }> {
  return requestJSON(`/api/playlist/manage`, "POST", {
    action: "update",
    source,
    playlist_id: playlistId,
    name,
    desc: desc ?? "",
  });
}

export function apiManagePlaylistSongs(
  action: "add_songs" | "remove_songs",
  source: string,
  playlistId: string,
  songs: Song[],
): Promise<{ ok: boolean; count?: number }> {
  return requestJSON(`/api/playlist/manage`, "POST", {
    action,
    source,
    playlist_id: playlistId,
    songs: songs.map((s) => Object.fromEntries(songParams(s))),
  });
}

/* ---------------- 手机号登录 ---------------- */

export function apiPhoneLoginSendCode(source: string, phone: string, countryCode?: string): Promise<{ ok: boolean }> {
  return requestJSON(`/api/phone_login/${encodeURIComponent(source)}`, "POST", {
    phone,
    mode: "send_code",
    ...(countryCode && countryCode !== "86" ? { country_code: Number(countryCode) } : {}),
  });
}

export function apiPhoneLogin(
  source: string,
  phone: string,
  mode: "code" | "password",
  secret: string,
  countryCode?: string,
): Promise<{ ok: boolean; saved?: string }> {
  return requestJSON(`/api/phone_login/${encodeURIComponent(source)}`, "POST", {
    phone,
    mode,
    ...(countryCode && countryCode !== "86" ? { country_code: Number(countryCode) } : {}),
    ...(mode === "code" ? { code: secret } : { password: secret }),
  });
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

/** 重建本地音乐索引（/local 页工具栏） */
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
  /* 审核整改 R2-#11：路径参数编码卫生 */
  return fetch(`/api/qr_login/${encodeURIComponent(source)}`, {
    method: "POST",
    headers: { "X-Requested-With": "XMLHttpRequest" },
  }).then(async (r) => {
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(body?.error ?? `HTTP ${r.status}`, r.status, body);
    return body;
  });
}

export function apiCheckQRLogin(source: string, key: string): Promise<QRLoginResult> {
  return getJSON(`/api/qr_login/${encodeURIComponent(source)}?key=${encodeURIComponent(key)}`);
}

/* ---------------- 浏览器级音源账号会话（多用户：每个访客登录自己的账号） ---------------- */

export interface QRLoginStatus {
  source: string;
  cookie_source: string;
  logged_in: boolean;
}

/** 查询当前浏览器是否已登录自己的音源账号 */
export function apiQRLoginStatus(source: string): Promise<QRLoginStatus> {
  return getJSON(`/api/qr_login/${encodeURIComponent(source)}?status=1`);
}

/** 退出"我的音源账号"（清除浏览器会话凭证，不影响服务器全局配置） */
export function apiQRLogout(source: string): Promise<{ status: string }> {
  return fetch(`/api/qr_login/${encodeURIComponent(source)}`, {
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
