/**
 * 网易云音乐 Provider — 底层全部走 lib/netease（api-enhanced 全量接口系统）
 * 覆盖：song parse / album / playlist / 推荐 / 分类 / 用户歌单 / QR 登录 / VIP 高音质下载
 * 业务映射与缓存沿用本项目管理（VIP 判定 10min、下载直链 10min、链接解析、yrc 逐字歌词）
 */
import type {
  MusicProvider,
  Playlist,
  PlaylistCategory,
  PlaylistDetail,
  QRLoginResult,
  QRLoginSession,
  QRLoginStatus,
  Song,
  SongQuality,
  Toplist,
  MvItem,
  MvListOptions,
  MvListResult,
  Artist,
  ArtistOverview,
  HotSearch,
  CommentItem,
  CommentListResult,
  CheckinStatus,
  Banner,
  SourceLoginProfile,
  UserProfile,
  UserVipInfo,
  UserFollowsResult,
  FollowUser,
  PlayRecordItem,
  ListenStats,
  ReportSection,
  HistoryDailyRecommend,
  DjCategory,
  DjRadio,
  DjProgram,
  StyleTag,
  StyleDetail,
  CloudSong,
  CloudListResult,
  DiscoverBlock,
  HighqualityTag,
  SongCreator,
  SongWiki,
  FollowedArtist,
  CommentTarget,
  SearchMultimatch,
  CountryCode,
} from "../types";
import { UpstreamError } from "../types";
import { invokeNcm } from "../netease";
import { createRequest } from "../netease/request";
import { cookieToJson } from "../netease/utils";
import { normalizeSourceCookieString } from "../source-session";
import { md5hex } from "../crypto";
import { parseLrcVerbatim, parseYrcData, convertVerbatimLRC, type VMultiData } from "../lyrics";
import { getCookie } from "../cookies";
import { createTtlCache } from "../response-cache";

// ---------------------------------------------------------------------------
// VIP eapi 高音质下载链（保留缓存策略；加密与请求改走 lib/netease/request）
// ---------------------------------------------------------------------------

interface CachedDownloadURL {
  url: string;
  ext: string;
}

/** key = songID:levels:md5(cookie)，TTL 10 分钟；审核整改 C-04：容量上限 + LRU 淘汰（原裸 Map 懒判过期、从不删除，随曲库无界增长） */
const downloadURLCache = createTtlCache<CachedDownloadURL>(10 * 60_000, 500);

/** VIP 判定缓存（key = md5(cookie)，TTL 10 分钟；同 C-04 治理） */
const neteaseVipCache = createTtlCache<{ isVip: boolean }>(10 * 60_000, 50);

/** 精品歌单链式翻页游标（审核整改 B-03）：key = tag|cookie指纹|页码 → 该页响应 lasttime */
const hqCursorCache = new Map<string, number>();

/** weapi/nuser/account/get → profile.vipType，10 分钟缓存（底层走 user_account 模块） */
async function isNeteaseVipAccount(): Promise<boolean> {
  const cookie = getCookie("netease");
  if (!cookie.trim()) return false;

  const key = md5hex(cookie);
  const cached = neteaseVipCache.get(key);
  if (cached) return cached.isVip;

  try {
    const resp = await invokeNcm<{ code?: number; profile?: { vipType?: number } }>("user_account");
    const isVip = resp.body.code === 200 && (resp.body.profile?.vipType ?? 0) !== 0;
    neteaseVipCache.set(key, { isVip });
    return isVip;
  } catch {
    return false;
  }
}

/** extra 指定单曲级别，默认 lossless → hires → exhigh；quality 偏好参数优先于 extra */
function preferredDownloadLevels(song: Song, quality?: SongQuality): string[] {
  switch (quality) {
    case "standard":
      return ["standard"];
    case "high":
      return ["exhigh"];
    case "lossless":
      return ["lossless"];
    case "best":
      return ["hires", "lossless", "exhigh"];
    default:
      break;
  }
  const extra = song.extra ?? {};
  const level = (extra["netease_level"] ?? extra["level"] ?? "").trim().toLowerCase();
  if (["standard", "exhigh", "lossless", "hires"].includes(level)) return [level];
  return ["lossless", "hires", "exhigh"];
}

function normalizeNeteaseAudioType(audioType: string, quality: string): string {
  const t = audioType.trim().toLowerCase().replace(/^\./, "");
  if (["flac", "mp3", "m4a"].includes(t)) return t;
  if (quality === "lossless" || quality === "hires") return "flac";
  return "";
}

/** eapi 逐级请求高音质直链（对齐 song/enhance/player/url/v1） */
async function getEAPIDownloadURL(
  songId: string,
  quality: string,
  cookie: string,
): Promise<{ url: string; ext: string }> {
  const idNum = parseInt(songId, 10);
  if (!Number.isFinite(idNum)) throw new Error(`invalid song id: ${songId}`);

  const resp = await createRequest<{ data?: { url?: string; code?: number; type?: string }[] }>(
    "/api/song/enhance/player/url/v1",
    {
      ids: [idNum],
      level: quality,
      encodeType: "flac",
    },
    {
      crypto: "eapi",
      cookie: cookieToJson(cookie),
      ua: "",
      randomCNIP: false,
      e_r: undefined,
      domain: "",
      checkToken: false,
      headers: {},
      /* 审核整改 A-02：直链请求显式超时（原 timeout:0 = 无超时）；取 URL 的 JSON 响应 30s 足够 */
      timeout: 30_000,
    },
  );
  const item = resp.body.data?.[0];
  if (!item?.url) throw new Error("eapi download url not found");
  return { url: item.url, ext: normalizeNeteaseAudioType(item.type ?? "", quality) };
}

interface NeteaseSearchSong {
  id: number;
  name: string;
  ar?: { name?: string }[];
  al?: { name?: string; picUrl?: string };
  dt?: number;
  privilege?: { fl?: number };
  h?: { size?: number };
  m?: { size?: number };
  l?: { size?: number };
}

/** 网易歌曲对象（cloudsearch/top_list/artist 系列同构）→ Song；不过滤权限（榜单/歌手页展示全量） */
function mapNeteaseTrackToSong(item: NeteaseSearchSong): Song {
  let size = item.l?.size ?? 0;
  if (item.h?.size) size = item.h.size;
  else if (item.m?.size) size = item.m.size;
  const duration = Math.floor((item.dt ?? 0) / 1000);
  const bitrate = duration > 0 && size > 0 ? Math.round((size * 8) / 1000 / duration) : 128;
  return {
    source: "netease",
    id: String(item.id),
    name: (item.name ?? "").trim(),
    artist: (item.ar ?? []).map((a) => a.name ?? "").join("、"),
    album: item.al?.name ?? "",
    duration,
    size,
    bitrate,
    cover: item.al?.picUrl ?? "",
    link: `https://music.163.com/#/song?id=${item.id}`,
    extra: { song_id: String(item.id) },
  };
}

/** 网易 FM 响应体（/api/v1/radio/get：data[] 为 artists/album 命名） */
interface NcmFmBody {
  code?: number;
  data?: {
    id?: number | string;
    name?: string;
    artists?: { name?: string }[];
    album?: { id?: number; name?: string; picUrl?: string };
    duration?: number;
    privilege?: { fl?: number };
  }[];
}

/** 网易评论响应体（comment_music：hotComments + comments 分页） */
interface NcmCommentBody {
  code?: number;
  total?: number;
  more?: boolean;
  moreHot?: boolean;
  hotComments?: NcmRawComment[];
  comments?: NcmRawComment[];
}

/** simi_playlist / related_playlist 共用的歌单条目结构 */
interface NcmRelatedPlaylistItem {
  id?: number | string;
  name?: string;
  coverImgUrl?: string;
  playCount?: number;
  trackCount?: number;
  creator?: { nickname?: string };
}

interface NcmRawComment {
  commentId?: number | string;
  content?: string;
  time?: number;
  likedCount?: number;
  /** 上游新版返回 {ip, location, userId} 对象，旧版为字符串 */
  ipLocation?: string | { location?: string };
  user?: { nickname?: string; avatarUrl?: string; userId?: number };
  /** 新版楼层结构的回复数（showFloorCount / replyCount） */
  replyCount?: number;
  beReplied?: { content?: string; user?: { nickname?: string; userId?: number } }[];
}

/** 时间戳 → 相对时间文本（"3分钟前 / 2小时前 / 5天前 / 2025-03-01"） */
function relativeTime(ts: number): string {
  if (!ts || ts <= 0) return "";
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min}分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}天前`;
  const date = new Date(ts);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function mapNeteaseComment(c: NcmRawComment): CommentItem {
  const reply = c.beReplied?.[0];
  return {
    id: String(c.commentId ?? ""),
    content: (c.content ?? "").trim(),
    user: (c.user?.nickname ?? "网易用户").trim() || "网易用户",
    avatar: c.user?.avatarUrl ?? "",
    time: relativeTime(c.time ?? 0),
    liked_count: c.likedCount ?? 0,
    reply_to: reply?.user?.nickname ? { user: reply.user.nickname, content: (reply.content ?? "").slice(0, 120) } : undefined,
    location:
      (typeof c.ipLocation === "string" ? c.ipLocation : (c.ipLocation?.location ?? "")).trim() || undefined,
    user_id: c.user?.userId !== undefined ? String(c.user.userId) : undefined,
    reply_count: c.replyCount ?? undefined,
  };
}

/** 防御式深搜（签到系响应字段命名多变）：对象树找布尔字段 */
function deepFindBoolean(node: unknown, keys: string[], depth = 0): boolean | undefined {
  if (depth > 4 || node === null || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = deepFindBoolean(item, keys, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const obj = node as Record<string, unknown>;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "boolean") return v;
    if (v === 1 || v === "true") return true;
    if (v === 0 || v === "false") return false;
  }
  for (const v of Object.values(obj)) {
    const found = deepFindBoolean(v, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** 防御式深搜：对象树找数字字段 */
function deepFindNumber(node: unknown, keys: string[], depth = 0): number | undefined {
  if (depth > 4 || node === null || typeof node !== "object") return undefined;
  const obj = node as Record<string, unknown>;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  }
  for (const v of Object.values(obj)) {
    if (Array.isArray(v)) continue;
    const found = deepFindNumber(v, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** 防御式深搜：对象树找"日期数字数组"（签到进度：[1,2,5,...]） */
function deepFindDayArray(node: unknown, depth = 0): number[] | undefined {
  if (depth > 3 || node === null || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    const nums = node.filter((x) => typeof x === "number" && Number.isFinite(x) && x >= 1 && x <= 31);
    if (nums.length >= 1) return nums as number[];
    for (const item of node) {
      const found = deepFindDayArray(item, depth + 1);
      if (found?.length) return found;
    }
    return undefined;
  }
  for (const v of Object.values(node as Record<string, unknown>)) {
    const found = deepFindDayArray(v, depth + 1);
    if (found?.length) return found;
  }
  return undefined;
}

interface NeteasePlaylistItem {
  id: number | string;
  name: string;
  coverImgUrl?: string;
  picUrl?: string;
  trackCount?: number;
  track_count?: number;
  playCount?: number;
  play_count?: number;
  creator?: { nickname?: string };
  copywriter?: string;
  alg?: string;
  description?: string;
  subscribed?: boolean;
}

/** 链接解析 — song/album/playlist 三类 */
type NeteaseLinkKind = "song" | "album" | "playlist";

function isDigits(value: string): boolean {
  return !!value && /^[0-9]+$/.test(value);
}

function parseNeteaseLinkCandidate(candidate: string): { kind: NeteaseLinkKind; id: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    try {
      parsed = new URL(candidate, "http://netease.placeholder.local");
    } catch {
      return null;
    }
  }

  let kind: NeteaseLinkKind | null = null;
  const segments = parsed.pathname.toLowerCase().split("/").filter(Boolean);
  for (const segment of segments) {
    if (segment === "song" || segment === "album" || segment === "playlist") {
      kind = segment;
    }
  }

  let id = parsed.searchParams.get("id") ?? "";
  if (!isDigits(id)) id = "";

  if (!kind && segments.length >= 2) {
    const last = segments[segments.length - 1];
    const prev = segments[segments.length - 2];
    if (isDigits(last) && (prev === "song" || prev === "album" || prev === "playlist")) {
      kind = prev;
      id = last;
    }
  }

  if (!kind || !id) return null;
  return { kind, id };
}

function parseNeteaseLink(link: string): { kind: NeteaseLinkKind; id: string } | null {
  const candidates: string[] = [link];
  try {
    const parsed = new URL(link);
    if (parsed.pathname && parsed.pathname !== "/") {
      candidates.push(parsed.pathname + (parsed.search || ""));
    }
    const fragment = parsed.hash.replace(/^#/, "").trim().replace(/^!/, "").trim();
    if (fragment) candidates.push(fragment);
  } catch {
    /* 容错：原始链接作为唯一候选 */
  }
  for (const candidate of candidates) {
    const result = parseNeteaseLinkCandidate(candidate);
    if (result) return result;
  }
  return null;
}

/** 专辑/单曲详情中的歌曲结构 */
interface NeteaseAlbumApiSong {
  id: number | string;
  name: string;
  ar?: { name?: string }[];
  al?: { id?: number | string; name?: string; picUrl?: string };
  dt?: number;
  privilege?: { fl?: number };
  h?: { size?: number };
  m?: { size?: number };
  l?: { size?: number };
}

function pickSongSize(item: NeteaseAlbumApiSong): number {
  const fl = item.privilege?.fl ?? 0;
  if (fl >= 320000 && (item.h?.size ?? 0) > 0) return item.h!.size!;
  if (fl >= 192000 && (item.m?.size ?? 0) > 0) return item.m!.size!;
  return item.l?.size ?? 0;
}

function songBitrate(duration: number, size: number, fallback = 128): number {
  if (duration > 0 && size > 0) return Math.round((size * 8) / 1000 / duration);
  return fallback;
}

function joinArtists(ar: { name?: string }[] | undefined, sep = "、"): string {
  return (ar ?? []).map((a) => a.name ?? "").filter(Boolean).join(sep);
}

/** 批量取歌曲详情 — weapi/v3/song/detail（song_detail 模块） */
async function fetchSongsBatch(songIDs: string[]): Promise<Song[]> {
  if (!songIDs.length) return [];
  const resp = await invokeNcm<{ songs?: NeteaseAlbumApiSong[] }>("song_detail", {
    ids: songIDs.join(","),
  });

  return (resp.body.songs ?? []).map((item) => ({
    source: "netease",
    id: String(item.id),
    name: (item.name ?? "").trim(),
    artist: joinArtists(item.ar),
    album: item.al?.name ?? "",
    duration: Math.floor((item.dt ?? 0) / 1000),
    size: 0,
    bitrate: 0,
    cover: item.al?.picUrl ?? "",
    url: "",
    link: `https://music.163.com/#/song?id=${item.id}`,
    extra: { song_id: String(item.id) },
  }));
}

interface NeteaseAlbumInfo {
  id: number | string;
  name: string;
  picUrl?: string;
  size?: number;
  company?: string;
  description?: string;
  briefDesc?: string;
  publishTime?: number;
  artist?: { name?: string };
  artists?: { name?: string }[];
}

function albumCreator(info: NeteaseAlbumInfo): string {
  const artistName = (info.artist?.name ?? "").trim();
  if (artistName) return artistName;
  const names = (info.artists ?? []).map((a) => (a.name ?? "").trim()).filter(Boolean);
  return names.join(", ");
}

function albumDescription(info: NeteaseAlbumInfo): string {
  return (info.description ?? "").trim() || (info.briefDesc ?? "").trim();
}

function albumToPlaylist(info: NeteaseAlbumInfo): Playlist {
  const albumID = String(info.id);
  return {
    source: "netease",
    id: albumID,
    name: (info.name ?? "").trim(),
    cover: info.picUrl ?? "",
    track_count: info.size ?? 0,
    play_count: 0,
    creator: albumCreator(info),
    description: albumDescription(info),
    link: `https://music.163.com/#/album?id=${albumID}`,
    extra: {
      type: "album",
      company: info.company ?? "",
      publish_time: String(info.publishTime ?? 0),
    },
  };
}

/** 专辑详情 — weapi/v1/album/{id}（album 模块） */
async function fetchAlbumDetail(albumID: string): Promise<PlaylistDetail> {
  const resp = await invokeNcm<{
    code?: number;
    album?: NeteaseAlbumInfo;
    songs?: NeteaseAlbumApiSong[];
  }>("album", { id: albumID });

  if (resp.body.code !== 200) throw new Error(`netease api error code: ${resp.body.code}`);
  if (!resp.body.album) throw new Error("netease album not found");

  const album = albumToPlaylist(resp.body.album);

  const songs: Song[] = (resp.body.songs ?? []).map((item) => {
    const size = pickSongSize(item);
    const duration = Math.floor((item.dt ?? 0) / 1000);
    return {
      source: "netease",
      id: String(item.id),
      name: (item.name ?? "").trim(),
      artist: joinArtists(item.ar, ", "),
      album: item.al?.name ?? "",
      album_id: item.al?.id !== undefined ? String(item.al.id) : "",
      duration,
      size,
      bitrate: songBitrate(duration, size),
      cover: item.al?.picUrl ?? "",
      url: "",
      link: `https://music.163.com/#/song?id=${item.id}`,
      extra: { song_id: String(item.id), album_id: item.al?.id !== undefined ? String(item.al.id) : "" },
    };
  });

  return { playlist: album, songs };
}

/** 歌单详情 — v6/playlist/detail（playlist_detail 模块）+ song_detail 批量歌曲 */
async function fetchPlaylistDetail(playlistID: string): Promise<PlaylistDetail> {
  const resp = await invokeNcm<{
    code?: number;
    playlist?: {
      id: number | string;
      name: string;
      coverImgUrl?: string;
      description?: string;
      playCount?: number;
      trackCount?: number;
      creator?: { nickname?: string };
      trackIds?: { id: number | string }[];
    };
  }>("playlist_detail", { id: playlistID, s: 0 });

  if (resp.body.code !== 200) throw new Error(`netease api error code: ${resp.body.code}`);
  if (!resp.body.playlist) throw new Error("netease playlist not found");

  const pl = resp.body.playlist;
  const playlist: Playlist = {
    source: "netease",
    id: String(pl.id),
    name: (pl.name ?? "").trim(),
    cover: pl.coverImgUrl ?? "",
    track_count: pl.trackCount ?? 0,
    play_count: pl.playCount ?? 0,
    creator: pl.creator?.nickname ?? "",
    description: pl.description ?? "",
    link: `https://music.163.com/#/playlist?id=${pl.id}`,
  };

  const allIDs = (pl.trackIds ?? []).map((tid) => String(tid.id));
  const allSongs: Song[] = [];
  const batchSize = 500;
  for (let i = 0; i < allIDs.length; i += batchSize) {
    const batch = allIDs.slice(i, i + batchSize);
    try {
      allSongs.push(...(await fetchSongsBatch(batch)));
    } catch {
      /* 批量失败跳过 */
    }
  }
  return { playlist, songs: allSongs };
}

function mapNeteaseQRStatus(code: number): QRLoginStatus {
  switch (code) {
    case 800:
      return "expired";
    case 801:
      return "waiting";
    case 802:
      return "scanned";
    case 803:
      return "success";
    default:
      return "failed";
  }
}

/** 当前登录用户 uid（user_account；失败抛"需要登录"） */
async function resolveOwnNeteaseUid(): Promise<string> {
  const acc = await invokeNcm<{ code?: number; profile?: { userId?: number } }>("user_account");
  if (acc.body.code !== 200 || !acc.body.profile?.userId) {
    throw new Error("需要登录网易云账号");
  }
  return String(acc.body.profile.userId);
}

/** user_detail / user_detail_new 的 profile 字段 */
interface NeteaseUserDetail {
  userId?: number;
  nickname?: string;
  avatarUrl?: string;
  signature?: string;
  gender?: number;
  follows?: number;
  followeds?: number;
  eventCount?: number;
  playlistCount?: number;
  playlistBeSubscribedCount?: number;
  listenSongs?: number;
  level?: number;
  createTime?: number;
}

/** user_follows / user_followeds / mutual 的用户条目 */
interface NeteaseFollowUser {
  userId?: number;
  nickname?: string;
  avatarUrl?: string;
  signature?: string;
  mutual?: boolean;
}

/** user_record / listen_data_* 的播放条目（song 与 cloudsearch 同构） */
interface NcmRecordItem {
  playCount?: number;
  score?: number;
  song?: NeteaseSearchSong;
}

/** 歌单条目归一化（user_playlist_create/collect 与 user_playlist 同构） */
function mapNeteasePlaylistItem(item: NeteasePlaylistItem, fallbackCreator = ""): Playlist {
  return {
    source: "netease",
    id: String(item.id),
    name: (item.name ?? "").trim(),
    cover: item.coverImgUrl ?? item.picUrl ?? "",
    track_count: item.trackCount ?? item.track_count ?? 0,
    play_count: Math.round(item.playCount ?? item.play_count ?? 0),
    creator: item.creator?.nickname ?? fallbackCreator,
    description: item.description ?? "",
    link: `https://music.163.com/#/playlist?id=${item.id}`,
  };
}

/** 评论资源类型 → 网易 resourceTypeMap 数字键（threadId 前缀） */
function ncmCommentTypeOf(type: CommentTarget["type"]): string {
  const map: Record<CommentTarget["type"], string> = { song: "0", mv: "1", playlist: "2", album: "3", dj: "4", video: "5" };
  return map[type];
}

/** 视频详情原始拉取（video_detail 主信息 + video_detail_info 播放/点赞统计） */
async function videoDetailById(videoId: string): Promise<MvItem> {
  const [detailRes, infoRes] = await Promise.allSettled([
    invokeNcm<{ code?: number; data?: { vid?: number | string; title?: string; coverUrl?: string; durationms?: number; creator?: { nickname?: string }; publishTime?: number } }>("video_detail", { id: videoId }),
    invokeNcm<{ code?: number; data?: { playCount?: number; likedCount?: number } }>("video_detail_info", { vid: videoId }),
  ]);
  if (detailRes.status !== "fulfilled" || detailRes.value.body.code !== 200 || !detailRes.value.body.data) {
    /* 三审 R3：网络/登录类失败透传真实原因（原一律"视频不存在"归因失真） */
    if (detailRes.status === "rejected") {
      const reason = detailRes.reason;
      throw new Error(reason instanceof Error ? reason.message : String(reason));
    }
    throw new Error("视频不存在");
  }
  const v = detailRes.value.body.data;
  const info = infoRes.status === "fulfilled" && infoRes.value.body.code === 200 ? infoRes.value.body.data : undefined;
  return {
    source: "netease",
    id: String(v.vid ?? videoId),
    name: (v.title ?? "").trim(),
    artist: v.creator?.nickname ?? "",
    cover: v.coverUrl ?? "",
    duration: Math.floor((v.durationms ?? 0) / 1000),
    play_count: info?.playCount ?? 0,
    publish_time: v.publishTime ? new Date(v.publishTime).toISOString().slice(0, 10) : undefined,
    extra: { kind: "video", liked_count: String(info?.likedCount ?? 0) },
  };
}

/** 活动型报告响应 → 扁平卡片（一级原始字段截取，未知结构的安全降级渲染） */
function flattenReportCards(data: Record<string, unknown> | undefined, max = 12): { label: string; value: string }[] {
  if (!data || typeof data !== "object") return [];
  const cards: { label: string; value: string }[] = [];
  const push = (label: string, value: unknown) => {
    if (cards.length >= max) return;
    if (typeof value === "number") cards.push({ label, value: value.toLocaleString("zh-CN") });
    else if (typeof value === "string" && value.trim() && value.length <= 64) cards.push({ label, value: value.trim() });
  };
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "object") {
      for (const [k2, v2] of Object.entries(value as Record<string, unknown>)) push(`${key}.${k2}`, v2);
    } else {
      push(key, value);
    }
  }
  return cards;
}

/** 电台原始结构（dj_recommend/dj_hot/dj_radio_hot/dj_recommend_type/dj_today_perfered/dj_detail 同构） */
interface NcmDjRadio {
  id?: number | string;
  name?: string;
  picUrl?: string;
  desc?: string;
  copywriter?: string;
  rcmtext?: string;
  subCount?: number;
  programCount?: number;
  playCount?: number;
  dj?: { nickname?: string };
  category?: string;
  categoryId?: number;
  lastProgram?: NcmDjProgram;
  lastProgramId?: number | string;
}

/** 电台节目原始结构（dj_program/dj_program_detail） */
interface NcmDjProgram {
  id?: number | string;
  rid?: number | string;
  name?: string;
  coverUrl?: string;
  description?: string;
  duration?: number;
  listenerCount?: number;
  likedCount?: number;
  createTime?: number;
  mainSong?: { id?: number | string; name?: string; duration?: number };
  dj?: { nickname?: string };
  radio?: { name?: string };
}

/** 云盘条目原始结构（user_cloud/user_cloud_detail） */
interface NcmCloudItem {
  songId?: number | string;
  fileName?: string;
  addTime?: number;
  fileInfo?: { filename?: string; size?: number }[];
  simpleSong?: NeteaseSearchSong & { artists?: { name?: string }[]; matched?: boolean };
}

function mapNcmDjRadio(r: NcmDjRadio): DjRadio {
  return {
    id: String(r.id ?? ""),
    name: (r.name ?? "").trim(),
    pic_url: r.picUrl ?? "",
    category: r.category,
    dj: r.dj?.nickname,
    description: r.desc ?? r.copywriter ?? r.rcmtext ?? "",
    program_count: r.programCount ?? 0,
    sub_count: r.subCount ?? 0,
    play_count: r.playCount ?? 0,
    link: r.id ? `https://music.163.com/#/djradio?id=${r.id}` : undefined,
  };
}

/** homepage_block_page 区块编码 → 中文标题 */
function blockTitleOf(code: string): string {
  if (code.includes("DAILY_RCMD")) return "每日推荐";
  if (code.includes("PLAYLIST_RCMD") || code.includes("PERSONALIZED")) return "推荐歌单";
  if (code.includes("OFFICIAL_PLAYLIST") || code.includes("EXCLUSIVE")) return "专属歌单";
  if (code.includes("SONG_LIST")) return "新歌速递";
  if (code.includes("ALBUM_NEW")) return "新碟上架";
  if (code.includes("VIDEO")) return "视频";
  if (code.includes("DJ")) return "播客电台";
  if (code.includes("MUSIC_MV") || code.includes("_MV")) return "推荐 MV";
  return code.replace(/_/g, " ");
}

/** 区块 JSON 内递归提取歌单形态对象（creatives/resources 结构差异大，容错扫描优先） */
function extractBlockPlaylists(node: unknown, depth = 0, out: Playlist[] = [], seen = new Set<string>()): Playlist[] {
  if (depth > 6 || !node || typeof node !== "object" || out.length >= 30) return out;
  if (Array.isArray(node)) {
    for (const item of node) extractBlockPlaylists(item, depth + 1, out, seen);
    return out;
  }
  const obj = node as Record<string, unknown>;
  const id = obj.id ?? obj.resourceId ?? obj.targetId;
  const name = typeof obj.name === "string" ? obj.name : typeof obj.title === "string" ? obj.title : undefined;
  const pic = typeof obj.picUrl === "string" ? obj.picUrl : typeof obj.coverUrl === "string" ? obj.coverUrl : undefined;
  const resourceType = String(obj.resourceType ?? "");
  const looksPlaylist = (resourceType === "PLAYLIST" || obj.playCount !== undefined || obj.trackCount !== undefined || obj.canPlay === true) && !!name;
  if (id !== undefined && name && pic && looksPlaylist && (typeof id === "number" || /^\d+$/.test(String(id)))) {
    const key = String(id);
    if (!seen.has(key)) {
      seen.add(key);
      out.push({
        source: "netease",
        id: key,
        name: name.trim(),
        cover: pic,
        track_count: Number(obj.trackCount ?? 0),
        play_count: Math.round(Number(obj.playCount ?? 0)),
        creator: typeof obj.copywriter === "string" ? obj.copywriter : "",
        description: "",
        link: `https://music.163.com/#/playlist?id=${key}`,
      });
    }
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") extractBlockPlaylists(value, depth + 1, out, seen);
  }
  return out;
}

function mapNcmDjProgram(p: NcmDjProgram): DjProgram {
  const mainSongId = p.mainSong?.id !== undefined ? String(p.mainSong.id) : String(p.id ?? "");
  const durationSec = Math.floor((p.duration ?? p.mainSong?.duration ?? 0) / 1000);
  const song: Song | undefined = mainSongId
    ? {
        source: "netease",
        id: mainSongId,
        name: (p.name ?? p.mainSong?.name ?? "").trim(),
        artist: p.dj?.nickname ?? "",
        album: p.radio?.name ?? "",
        duration: durationSec,
        size: 0,
        bitrate: 128,
        cover: p.coverUrl ?? "",
        link: `https://music.163.com/#/program?id=${p.id}`,
        extra: { program_id: String(p.id ?? "") },
      }
    : undefined;
  return {
    id: String(p.id ?? ""),
    radio_id: p.rid !== undefined ? String(p.rid) : undefined,
    name: (p.name ?? "").trim(),
    cover: p.coverUrl ?? "",
    description: p.description ?? "",
    duration: durationSec,
    listener_count: p.listenerCount ?? 0,
    liked_count: p.likedCount ?? 0,
    publish_time: p.createTime ? new Date(p.createTime).toISOString().slice(0, 10) : undefined,
    song,
  };
}

export const netease: MusicProvider = {
  name: "netease",
  label: "网易云音乐",
  supportsFlac: true,

  async search(keyword: string): Promise<Song[]> {
    const resp = await invokeNcm<{ result?: { songs?: NeteaseSearchSong[] } }>("cloudsearch", {
      keywords: keyword,
      type: 1,
      limit: 10,
    });

    // VIP 账号不过滤无权限曲目
    let isVip = false;
    try {
      isVip = await isNeteaseVipAccount();
    } catch {
      isVip = false;
    }

    const songs: Song[] = [];
    for (const item of resp.body.result?.songs ?? []) {
      const fl = item.privilege?.fl ?? 0;
      if (!isVip && fl === 0) continue; // 非会员无播放权限

      let size = item.l?.size ?? 0;
      if (fl >= 320000 && item.h?.size) size = item.h.size;
      else if (fl >= 192000 && item.m?.size) size = item.m.size;

      const duration = Math.floor((item.dt ?? 0) / 1000);
      const bitrate = duration > 0 && size > 0 ? Math.round((size * 8) / 1000 / duration) : 128;

      songs.push({
        source: "netease",
        id: String(item.id),
        name: (item.name ?? "").trim(),
        artist: (item.ar ?? []).map((a) => a.name ?? "").join("、"),
        album: item.al?.name ?? "",
        duration,
        size,
        bitrate,
        cover: item.al?.picUrl ?? "",
        link: `https://music.163.com/#/song?id=${item.id}`,
        extra: { song_id: String(item.id) },
      });
    }
    return songs;
  },

  async parse(link: string): Promise<Song> {
    const parsed = parseNeteaseLink(link);
    if (!parsed) throw new Error("invalid netease link");
    if (parsed.kind === "playlist") throw new Error("netease playlist link detected, use parsePlaylist");
    if (parsed.kind === "album") throw new Error("netease album link detected, use parseAlbum");

    const songs = await fetchSongsBatch([parsed.id]);
    if (!songs.length) throw new Error("netease song not found");
    const song = songs[0];
    try {
      song.url = await netease.getStreamUrl(song);
    } catch {
      /* URL 获取失败不影响单曲解析 */
    }
    return song;
  },

  async getStreamUrl(song: Song, quality?: SongQuality): Promise<string> {
    const songId = song.extra?.song_id || song.id;
    const cookie = getCookie("netease");
    const levels = preferredDownloadLevels(song, quality);
    const cacheKey = `${songId}:${levels.join(",")}:${md5hex(cookie)}`;
    /* 三审 R3：缓存读取统一前置（原仅在 VIP 分支内读取——weapi 回退写入的条目永不命中，
       白占 500 容量并挤占 VIP 用户 LRU 空间） */
    if (cookie.trim()) {
      const cached = downloadURLCache.get(cacheKey);
      if (cached) {
        if (cached.ext) song.ext = cached.ext;
        return cached.url;
      }
    }

    // VIP eapi 高音质链（levels 逐级 + 10 分钟缓存）
    if (cookie.trim() && (await isNeteaseVipAccount())) {

      for (const level of levels) {
        try {
          const { url, ext } = await getEAPIDownloadURL(songId, level, cookie);
          if (url) {
            if (ext) song.ext = ext;
            downloadURLCache.set(cacheKey, { url, ext });
            return url;
          }
        } catch {
          /* try next level */
        }
      }
    }

    // Fall back to the original weapi route（song/enhance/player/url）
    // br 按音质偏好映射（standard=128k；其余 320k —— weapi 老接口无损不可靠，无损走 eapi 链路）
    const br = quality === "standard" ? 128000 : 320000;
    const resp = await createRequest<{ data?: { url?: string; code?: number; type?: string }[] }>(
      "/api/song/enhance/player/url",
      { ids: [songId], br },
      {
        crypto: "weapi",
        cookie: cookieToJson(cookie),
        ua: "",
        randomCNIP: false,
        e_r: undefined,
        domain: "",
        checkToken: false,
        headers: {},
        /* 审核整改 A-02：weapi 回退显式超时（原 timeout:0 = 无超时） */
        timeout: 30_000,
      },
    );
    const item = resp.body.data?.[0];
    let url = item?.url;
    /* P1 C4：播放直链全失败时的下载接口降级链（song_download_url_v1 → song_download_url，VIP 下载额度兜底） */
    if (!url) {
      for (const moduleName of ["song_download_url_v1", "song_download_url"] as const) {
        try {
          const dl = await invokeNcm<{ code?: number; data?: { url?: string; type?: string } }>(moduleName, {
            id: Number(songId),
            br: 999000,
          });
          const dlUrl = dl.body.data?.url;
          if (dlUrl) {
            url = dlUrl;
            if (!song.ext || song.ext === "mp3") song.ext = dl.body.data?.type?.includes("flac") ? "flac" : song.ext || "mp3";
            break;
          }
        } catch {
          /* try next fallback */
        }
      }
    }
    if (!url) throw new Error("netease: 未获取到播放链接（可能是 VIP / 版权受限）");
    /* weapi 回退固定 mp3 码率档：缓存 ext 按实际格式（eapi 链路可能已把 song.ext 置为 flac，直接沿用会失真） */
    const fallbackExt = normalizeNeteaseAudioType(item?.type ?? "", "exhigh") || "mp3";
    if (!song.ext || song.ext === "flac") song.ext = fallbackExt;
    downloadURLCache.set(`${songId}:${levels.join(",")}:${md5hex(cookie)}`, {
      url,
      ext: fallbackExt,
    });
    return url;
  },

  async getLyric(song: Song): Promise<string> {
    const songId = song.extra?.song_id || song.id;
    const resp = await invokeNcm<{
      code?: number;
      lrc?: { lyric?: string };
      yrc?: { lyric?: string };
      tlyric?: { lyric?: string };
      romalrc?: { lyric?: string };
    }>("lyric_new", { id: songId });

    if (resp.body.code !== 200) throw new Error("netease: 歌词接口错误");

    // yrc 逐字歌词优先；tags ti/ar/al；ConvertVerbatimLRC（orig→roma→ts）
    const tags: Record<string, string> = {
      ti: song.name ?? "",
      ar: song.artist ?? "",
      al: song.album ?? "",
    };
    const data: VMultiData = {};
    const yrcText = (resp.body.yrc?.lyric ?? "").trim();
    const lrcText = (resp.body.lrc?.lyric ?? "").trim();
    if (yrcText) {
      data.orig = parseYrcData(yrcText);
    } else if (lrcText) {
      const parsed = parseLrcVerbatim(lrcText);
      for (const [k, v] of Object.entries(parsed.tags)) {
        if (!(tags[k] ?? "").trim()) tags[k] = v;
      }
      data.orig = parsed.data;
    }
    const tsText = (resp.body.tlyric?.lyric ?? "").trim();
    if (tsText) data.ts = parseLrcVerbatim(tsText).data;
    const romaText = (resp.body.romalrc?.lyric ?? "").trim();
    if (romaText) data.roma = parseLrcVerbatim(romaText).data;

    if (!data.orig?.length) throw new Error("netease: 歌词未找到");
    return convertVerbatimLRC(tags, data);
  },

  // ---- AlbumProvider ----

  async searchAlbum(keyword: string): Promise<Playlist[]> {
    const resp = await invokeNcm<{ code?: number; result?: { albums?: NeteaseAlbumInfo[] } }>(
      "cloudsearch",
      { keywords: keyword, type: 10, limit: 10 },
    );
    if (resp.body.code !== 200) throw new Error(`netease api error code: ${resp.body.code}`);
    return (resp.body.result?.albums ?? []).map(albumToPlaylist);
  },

  async getAlbumSongs(albumID: string): Promise<Song[]> {
    return (await fetchAlbumDetail(albumID)).songs;
  },

  async parseAlbum(link: string): Promise<PlaylistDetail> {
    const parsed = parseNeteaseLink(link);
    if (!parsed || parsed.kind !== "album") throw new Error("invalid netease album link");
    return fetchAlbumDetail(parsed.id);
  },

  // ---- PlaylistProvider ----

  async searchPlaylist(keyword: string): Promise<Playlist[]> {
    const resp = await invokeNcm<{ result?: { playlists?: NeteasePlaylistItem[] } }>("cloudsearch", {
      keywords: keyword,
      type: 1000,
      limit: 10,
    });
    return (resp.body.result?.playlists ?? []).map((item) => ({
      source: "netease",
      id: String(item.id),
      name: (item.name ?? "").trim(),
      cover: item.coverImgUrl ?? "",
      track_count: item.trackCount ?? 0,
      play_count: item.playCount ?? 0,
      creator: item.creator?.nickname ?? "",
      description: item.description ?? "",
      link: `https://music.163.com/#/playlist?id=${item.id}`,
    }));
  },

  async getPlaylistSongs(playlistID: string): Promise<Song[]> {
    return (await fetchPlaylistDetail(playlistID)).songs;
  },

  async parsePlaylist(link: string): Promise<PlaylistDetail> {
    const parsed = parseNeteaseLink(link);
    if (!parsed || parsed.kind !== "playlist") throw new Error("invalid netease playlist link");
    return fetchPlaylistDetail(parsed.id);
  },

  // ---- ToplistProvider（/toplist 榜单目录 + /top/list 榜单曲目） ----

  async getToplists(): Promise<Toplist[]> {
    const resp = await invokeNcm<{
      code?: number;
      list?: {
        id?: number | string;
        name?: string;
        coverImgUrl?: string;
        updateFrequency?: string;
        updateTime?: number;
        description?: string;
        playCount?: number;
        trackCount?: number;
        /** 前三首摘要（first=歌名 second=歌手） */
        tracks?: { first?: string; second?: string }[];
      }[];
    }>("toplist");

    if (resp.body.code !== 200) throw new Error(`netease api error code: ${resp.body.code}`);

    return (resp.body.list ?? [])
      .filter((item) => item.id !== undefined && String(item.id) !== "")
      .map((item) => {
        const highlights = (item.tracks ?? []).slice(0, 3).map((t) => {
          const first = (t.first ?? "").trim();
          const second = (t.second ?? "").trim();
          return second ? `${first} - ${second}` : first;
        });
        return {
          source: "netease",
          id: String(item.id),
          name: (item.name ?? "").trim(),
          cover: item.coverImgUrl ?? "",
          update_time: (item.updateFrequency ?? "").trim(),
          description: (item.description ?? "").trim(),
          highlights,
          play_count: Math.round(item.playCount ?? 0),
          track_count: item.trackCount ?? 0,
          link: `https://music.163.com/#/discover/toplist?id=${item.id}`,
          extra: { toplist_id: String(item.id) },
        };
      });
  },

  async getToplistSongs(toplistId: string): Promise<Song[]> {
    const resp = await invokeNcm<{
      code?: number;
      playlist?: { tracks?: NeteaseSearchSong[] };
    }>("top_list", { id: toplistId });

    if (resp.body.code !== 200) throw new Error(`netease api error code: ${resp.body.code}`);

    // tracks 与 cloudsearch 结果同构（ar/al/dt）；榜单本身即官方可播列表，不做权限过滤
    return (resp.body.playlist?.tracks ?? []).map(mapNeteaseTrackToSong);
  },

  // ---- MvProvider（mv/first 最新 · mv/exclusive/rcmd 网易出品 · top/mv 榜单 · mv/all 全部筛选） ----

  /** 网易 MV 列表条目（各列表接口同构：duration 毫秒） */
  async getMvList(opts: MvListOptions): Promise<MvListResult> {
    const tab = opts.tab ?? "latest";
    const limit = Math.min(Math.max(opts.limit, 1), 50);
    const offset = (opts.page - 1) * limit;
    const area = (opts.area ?? "").trim() || "全部";

    /* latest=mv_first（area 中文，无 offset 仅首页）/ exclusive=网易出品 / top=MV榜 / all=mv_all tags 筛选 */
    let module: string;
    const params: Record<string, unknown> = { limit, total: true };
    if (tab === "latest") {
      module = "mv_first";
      params.area = area === "全部" ? "" : area;
    } else if (tab === "exclusive") {
      module = "mv_exclusive_rcmd";
      params.offset = offset;
    } else if (tab === "top") {
      module = "top_mv";
      params.area = area === "全部" ? "" : area;
      params.offset = offset;
    } else {
      module = "mv_all";
      params.area = area;
      params.type = "全部";
      params.order = "最热";
      params.offset = offset;
    }

    const resp = await invokeNcm<{
      code?: number;
      pageCount?: number;
      data?: { id?: number | string; name?: string; cover?: string; artistName?: string; playCount?: number; duration?: number }[];
    }>(module, params);

    if (resp.body.code !== 200) throw new Error(`netease api error code: ${resp.body.code}`);

    const mvs: MvItem[] = (resp.body.data ?? [])
      .filter((item) => item.id !== undefined && String(item.id) !== "")
      .map((item) => ({
        source: "netease",
        id: String(item.id),
        name: (item.name ?? "").trim(),
        artist: (item.artistName ?? "").trim(),
        cover: item.cover ?? "",
        duration: Math.floor((item.duration ?? 0) / 1000),
        play_count: Math.round(item.playCount ?? 0),
        link: `https://music.163.com/#/mv?id=${item.id}`,
        extra: { mvid: String(item.id) },
      }));

    /* mv_first 无 offset（仅首页）；其余按 pageCount 或满页推断 */
    let hasMore = mvs.length >= limit;
    if (tab === "latest") hasMore = false;
    if (typeof resp.body.pageCount === "number") hasMore = opts.page < resp.body.pageCount;
    return { mvs, has_more: hasMore };
  },

  async getMvDetail(mvId: string): Promise<MvItem> {
    const resp = await invokeNcm<{
      code?: number;
      data?: {
        id?: number | string;
        name?: string;
        cover?: string;
        artistName?: string;
        artists?: { name?: string }[];
        playCount?: number;
        publishTime?: number;
        duration?: number;
        desc?: string;
      };
    }>("mv_detail", { mvid: mvId });

    if (resp.body.code !== 200) throw new Error(`netease api error code: ${resp.body.code}`);
    const d = resp.body.data;
    if (!d?.id) throw new Error("netease mv not found");

    const artist = (d.artistName ?? "").trim() || (d.artists ?? []).map((a) => a.name ?? "").join("、");
    return {
      source: "netease",
      id: String(d.id),
      name: (d.name ?? "").trim(),
      artist,
      cover: d.cover ?? "",
      duration: Math.floor((d.duration ?? 0) / 1000),
      play_count: Math.round(d.playCount ?? 0),
      publish_time: d.publishTime ? new Date(d.publishTime).toISOString().slice(0, 10) : undefined,
      link: `https://music.163.com/#/mv?id=${d.id}`,
      extra: { desc: (d.desc ?? "").slice(0, 500) },
    };
  },

  async getMvUrl(mvId: string, resolution?: number): Promise<string> {
    const resp = await invokeNcm<{ code?: number; data?: { url?: string | null } }>("mv_url", {
      id: mvId,
      r: resolution ?? 1080,
    });
    if (resp.body.code !== 200) throw new Error(`netease api error code: ${resp.body.code}`);
    const url = (resp.body.data?.url ?? "").trim();
    if (!url) throw new Error("该 MV 暂无法播放（可能需要 VIP 或已下架）");
    return url;
  },

  // ---- ArtistProvider（artists 概览 + artist_songs/album/mv 分页 + simi_artist 相似） ----

  async getArtistOverview(artistId: string): Promise<ArtistOverview> {
    /* artists（概览+热门50）与 artist_desc（详细简介）并行；desc 失败不阻断 */
    const [overviewRes, descRes] = await Promise.allSettled([
      invokeNcm<{
        code?: number;
        artist?: {
          id?: number | string;
          name?: string;
          picUrl?: string;
          alias?: string[];
          briefDesc?: string;
          albumSize?: number;
          musicSize?: number;
          mvSize?: number;
        };
        hotSongs?: NeteaseSearchSong[];
      }>("artists", { id: artistId }),
      invokeNcm<{
        code?: number;
        briefDesc?: string;
        introduction?: unknown;
      }>("artist_desc", { id: artistId }),
    ]);

    if (overviewRes.status === "rejected" || overviewRes.value.body.code !== 200) {
      const code = overviewRes.status === "fulfilled" ? overviewRes.value.body.code : 0;
      throw new Error(`netease artist not found (code: ${code})`);
    }
    const a = overviewRes.value.body.artist;
    if (!a?.id) throw new Error("netease artist not found");

    /* introduction 为 [{ti, txt}] 分节数组（新版结构），briefDesc 为字符串简介 */
    const flattenIntro = (v: unknown): string => {
      if (typeof v === "string") return v;
      if (Array.isArray(v)) {
        return v
          .map((seg) =>
            seg && typeof seg === "object"
              ? `${String((seg as { ti?: unknown }).ti ?? "").trim()}：${String((seg as { txt?: unknown }).txt ?? "").trim()}`
              : "",
          )
          .filter((line) => line.trim() && !line.endsWith("："))
          .join("\n");
      }
      return "";
    };
    const descFromDetail =
      descRes.status === "fulfilled" && descRes.value.body.code === 200
        ? ((descRes.value.body.briefDesc ?? "").trim() || flattenIntro(descRes.value.body.introduction))
        : "";

    const artist: Artist = {
      source: "netease",
      id: String(a.id),
      name: (a.name ?? "").trim(),
      avatar: a.picUrl ?? "",
      alias: (a.alias ?? []).filter(Boolean).join(" / "),
      brief: (descFromDetail || (a.briefDesc ?? "")).trim().slice(0, 800),
      song_count: a.musicSize ?? 0,
      album_count: a.albumSize ?? 0,
      mv_count: a.mvSize ?? 0,
      link: `https://music.163.com/#/artist?id=${a.id}`,
      extra: { artist_id: String(a.id) },
    };

    return { artist, top_songs: (overviewRes.value.body.hotSongs ?? []).map(mapNeteaseTrackToSong) };
  },

  async getArtistSongs(artistId: string, page: number, limit: number): Promise<{ songs: Song[]; has_more: boolean }> {
    const l = Math.min(Math.max(limit, 1), 100);
    const resp = await invokeNcm<{
      code?: number;
      more?: boolean;
      total?: number;
      songs?: NeteaseSearchSong[];
    }>("artist_songs", { id: artistId, order: "hot", limit: l, offset: (page - 1) * l });

    if (resp.body.code !== 200) throw new Error(`netease api error code: ${resp.body.code}`);
    const songs = (resp.body.songs ?? []).map(mapNeteaseTrackToSong);
    const total = resp.body.total ?? 0;
    return { songs, has_more: resp.body.more === true || (total > 0 && page * l < total) };
  },

  async getArtistAlbums(artistId: string, page: number, limit: number): Promise<{ albums: Playlist[]; has_more: boolean }> {
    const l = Math.min(Math.max(limit, 1), 100);
    const resp = await invokeNcm<{
      code?: number;
      more?: boolean;
      total?: number;
      hotAlbums?: { id?: number | string; name?: string; picUrl?: string; size?: number; publishTime?: number }[];
    }>("artist_album", { id: artistId, limit: l, offset: (page - 1) * l });

    if (resp.body.code !== 200) throw new Error(`netease api error code: ${resp.body.code}`);
    const albums: Playlist[] = (resp.body.hotAlbums ?? [])
      .filter((item) => item.id !== undefined && String(item.id) !== "")
      .map((item) => ({
        source: "netease",
        id: String(item.id),
        name: (item.name ?? "").trim(),
        cover: item.picUrl ?? "",
        track_count: item.size ?? 0,
        play_count: 0,
        creator: "",
        description: item.publishTime ? new Date(item.publishTime).toISOString().slice(0, 10) : "",
        link: `https://music.163.com/#/album?id=${item.id}`,
      }));
    const total = resp.body.total ?? 0;
    return { albums, has_more: resp.body.more === true || (total > 0 && page * l < total) };
  },

  async getArtistMvs(artistId: string, page: number, limit: number): Promise<{ mvs: MvItem[]; has_more: boolean }> {
    const l = Math.min(Math.max(limit, 1), 50);
    const resp = await invokeNcm<{
      code?: number;
      hasMore?: boolean;
      total?: number;
      mvs?: { id?: number | string; name?: string; imgurl?: string; imgurl16v9?: string; playCount?: number; duration?: number; artistName?: string }[];
    }>("artist_mv", { id: artistId, limit: l, offset: (page - 1) * l });

    if (resp.body.code !== 200) throw new Error(`netease api error code: ${resp.body.code}`);
    const mvs: MvItem[] = (resp.body.mvs ?? [])
      .filter((item) => item.id !== undefined && String(item.id) !== "")
      .map((item) => ({
        source: "netease",
        id: String(item.id),
        name: (item.name ?? "").trim(),
        artist: (item.artistName ?? "").trim(),
        cover: item.imgurl16v9 ?? item.imgurl ?? "",
        duration: Math.floor((item.duration ?? 0) / 1000),
        play_count: Math.round(item.playCount ?? 0),
        link: `https://music.163.com/#/mv?id=${item.id}`,
        extra: { mvid: String(item.id) },
      }));
    const total = resp.body.total ?? 0;
    return { mvs, has_more: resp.body.hasMore === true || (total > 0 && page * l < total) };
  },

  async getSimilarArtists(artistId: string): Promise<Artist[]> {
    /* 相似歌手需登录态，失败静默返回空（页面隐藏该区） */
    try {
      const resp = await invokeNcm<{
        code?: number;
        artists?: { id?: number | string; name?: string; picUrl?: string; alias?: string[] }[];
      }>("simi_artist", { id: artistId });
      if (resp.body.code !== 200) return [];
      return (resp.body.artists ?? [])
        .filter((a) => a.id !== undefined && String(a.id) !== "")
        .map((a) => ({
          source: "netease",
          id: String(a.id),
          name: (a.name ?? "").trim(),
          avatar: a.picUrl ?? "",
          alias: (a.alias ?? []).filter(Boolean).join(" / "),
          link: `https://music.163.com/#/artist?id=${a.id}`,
        }));
    } catch {
      return [];
    }
  },

  // ---- SearchEnhancementProvider（search/hot/detail 热搜 · search/suggest 联想 · cloudsearch type=100 歌手） ----

  async getHotSearches(): Promise<HotSearch[]> {
    const resp = await invokeNcm<{
      code?: number;
      data?: { searchWord?: string; score?: number; contentImage?: string; iconUrl?: string }[];
    }>("search_hot_detail");

    if (resp.body.code !== 200) throw new Error(`netease api error code: ${resp.body.code}`);

    const out: HotSearch[] = [];
    for (const item of resp.body.data ?? []) {
      const keyword = (item.searchWord ?? "").trim();
      if (!keyword) continue;
      out.push({
        source: "netease",
        keyword,
        score: item.score ?? 0,
        cover: item.contentImage ?? item.iconUrl ?? "",
      });
      if (out.length >= 20) break;
    }
    return out;
  },

  async getSearchSuggest(keyword: string): Promise<string[]> {
    const q = keyword.trim();
    if (!q) return [];
    const resp = await invokeNcm<{
      code?: number;
      result?:
        | { allMatch?: { keyword?: string }[] }
        | {
            albums?: { name?: string }[];
            artists?: { name?: string }[];
            songs?: { name?: string }[];
            order?: string[];
          };
    }>("search_suggest", { keywords: q });

    if (resp.body.code !== 200) return [];
    const r = resp.body.result as Record<string, unknown> | undefined;
    if (!r) return [];

    /* 旧版：result.allMatch[].keyword；新版 /search/suggest/web：result.{albums,artists,songs,order} 实体 */
    const allMatch = r.allMatch as { keyword?: string }[] | undefined;
    if (Array.isArray(allMatch)) {
      return allMatch.map((m) => (m.keyword ?? "").trim()).filter(Boolean).slice(0, 8);
    }
    const order = Array.isArray(r.order) ? (r.order as string[]) : ["songs", "artists", "albums"];
    const out: string[] = [];
    for (const key of order) {
      const list = r[key];
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const name = (item && typeof item === "object" ? String((item as { name?: unknown }).name ?? "") : "").trim();
        if (name && !out.includes(name)) out.push(name);
        if (out.length >= 8) return out;
      }
    }
    return out;
  },

  /** 默认搜索词（搜索框占位/「大家都在搜」，showKeyword 优先） */
  async getDefaultSearchKeyword(): Promise<string | null> {
    try {
      const resp = await invokeNcm<{
        code?: number;
        data?: { showKeyword?: string; realkeyword?: string };
      }>("search_default");
      if (resp.body.code !== 200) return null;
      return (resp.body.data?.showKeyword ?? resp.body.data?.realkeyword ?? "").trim() || null;
    } catch {
      return null;
    }
  },

  async searchArtists(keyword: string): Promise<Artist[]> {
    const q = keyword.trim();
    if (!q) return [];
    const resp = await invokeNcm<{
      code?: number;
      result?: { artists?: { id?: number | string; name?: string; picUrl?: string; alias?: string[] }[] };
    }>("cloudsearch", { keywords: q, type: 100, limit: 8 });

    if (resp.body.code !== 200) throw new Error(`netease api error code: ${resp.body.code}`);
    return (resp.body.result?.artists ?? [])
      .filter((a) => a.id !== undefined && String(a.id) !== "")
      .map((a) => ({
        source: "netease",
        id: String(a.id),
        name: (a.name ?? "").trim(),
        avatar: a.picUrl ?? "",
        alias: (a.alias ?? []).filter(Boolean).join(" / "),
        link: `https://music.163.com/#/artist?id=${a.id}`,
      }));
  },

  // ---- FmProvider（personal_fm 私人电台 · personal_fm_mode 模式 · fm_trash 垃圾桶） ----

  /** 网易 FM 歌曲结构（/api/v1/radio/get data[]：artists/album 命名，区别于 cloudsearch 的 ar/al） */
  async getFmSongs(mode?: string): Promise<Song[]> {
    const resp = mode
      ? await invokeNcm<NcmFmBody>("personal_fm_mode", { mode, limit: 3 })
      : await invokeNcm<NcmFmBody>("personal_fm");

    if (resp.body.code !== 200) throw new Error(`netease api error code: ${resp.body.code}`);

    return (resp.body.data ?? [])
      .filter((item) => item.id !== undefined && String(item.id) !== "")
      .map((item) => {
        const duration = Math.floor((item.duration ?? 0) / 1000);
        return {
          source: "netease",
          id: String(item.id),
          name: (item.name ?? "").trim(),
          artist: (item.artists ?? []).map((a) => a.name ?? "").join("、"),
          album: item.album?.name ?? "",
          album_id: item.album?.id ? String(item.album.id) : "",
          duration,
          size: 0,
          bitrate: 128,
          cover: item.album?.picUrl ?? "",
          link: `https://music.163.com/#/song?id=${item.id}`,
          extra: { song_id: String(item.id) },
        } satisfies Song;
      });
  },

  async trashFmSong(songId: string): Promise<void> {
    const resp = await invokeNcm<{ code?: number }>("fm_trash", { id: songId });
    if (resp.body.code !== 200 && resp.body.code !== 802) {
      throw new Error(`netease fm trash failed: ${resp.body.code}`);
    }
  },

  // ---- CommentProvider（comment_music 列表 · comment_add/reply 发表） ----

  async getSongComments(song, opts): Promise<CommentListResult> {
    const l = Math.min(Math.max(opts.limit, 1), 100);
    const offset = (opts.page - 1) * l;
    const resp = await invokeNcm<NcmCommentBody>("comment_music", {
      id: song.id,
      limit: opts.sort === "hot" ? Math.max(l * 3, 60) : l,
      offset: opts.sort === "hot" ? 0 : offset,
    });

    if (resp.body.code !== 200) throw new Error(`netease api error code: ${resp.body.code}`);

    /* 网易一次返回 hotComments（首页热门，无分页）+ comments（最新分页） */
    const raw =
      opts.sort === "hot"
        ? (resp.body.hotComments ?? []).slice(0, l * 2)
        : (resp.body.comments ?? []);
    const comments = raw.map(mapNeteaseComment);
    return {
      comments,
      total: resp.body.total ?? comments.length,
      has_more: opts.sort === "hot" ? false : resp.body.more === true,
    };
  },

  async addSongComment(song, content, replyTo?): Promise<void> {
    const body = replyTo
      ? await invokeNcm<{ code?: number; comment?: { commentId?: number } }>("comment_reply", {
          type: "music",
          id: song.id,
          cid: replyTo,
          content,
        })
      : await invokeNcm<{ code?: number; comment?: { commentId?: number } }>("comment_add", {
          type: "music",
          id: song.id,
          content,
        });
    if (body.body.code !== 200 && body.body.code !== 802) {
      throw new Error(body.body.code === 301 ? "评论需要登录网易云账号" : `评论失败 (code: ${body.body.code})`);
    }
  },

  /** 删除自己的评论（t=0 删除；threadId 为歌曲评论区标识；上游仅允许删本人评论） */
  async deleteSongComment(song, commentId: string): Promise<void> {
    const resp = await invokeNcm<{ code?: number }>("comment_delete", {
      t: 0,
      type: 0,
      id: commentId,
      threadId: `R_SO_4_${song.id}`,
      timestamp: Date.now(),
    });
    if (resp.body.code !== 200) {
      throw new Error(
        resp.body.code === 301
          ? "删除评论需要登录网易云账号"
          : resp.body.code === 404
            ? "仅能删除自己的评论"
            : `删除失败 (code: ${resp.body.code})`,
      );
    }
  },

  // ---- LikeProvider（likelist 喜欢列表 · like 红心/取消） ----

  async getLikeList(): Promise<string[]> {
    /* 未登录（无 MUSIC_U）时接口报 301：容错返回空集（前端显示全灰心） */
    try {
      const resp = await invokeNcm<{ code?: number; ids?: number[] }>("likelist");
      if (resp.body.code !== 200) return [];
      return (resp.body.ids ?? []).map(String);
    } catch {
      return [];
    }
  },

  async likeSong(song, like): Promise<void> {
    const resp = await invokeNcm<{ code?: number; playlistId?: number }>("like", {
      id: song.id,
      like: like ? "true" : "false",
    });
    if (resp.body.code !== 200 && resp.body.code !== 802) {
      throw new Error(resp.body.code === 301 ? "红心需要登录网易云账号" : `操作失败 (code: ${resp.body.code})`);
    }
  },

  // ---- AlbumDiscoveryProvider（album_new 新碟 · album_sublist 已收藏 · album_sub 收藏切换） ----

  /** 中文地区 → 网易 area 枚举（ALL/ZH/EA/KR/JP） */
  async getNewAlbums(opts): Promise<{ albums: Playlist[]; has_more: boolean }> {
    const l = Math.min(Math.max(opts.limit, 1), 100);
    const areaMap: Record<string, string> = { 全部: "ALL", 华语: "ZH", 欧美: "EA", 日本: "JP", 韩国: "KR", 港台: "ZH" };
    const area = areaMap[(opts.area ?? "全部").trim()] ?? "ALL";
    const resp = await invokeNcm<{
      code?: number;
      albums?: { id?: number | string; name?: string; picUrl?: string; artist?: { name?: string } | { name?: string }[]; size?: number; publishTime?: number }[];
    }>("album_new", { area, limit: l, offset: (opts.page - 1) * l });

    if (resp.body.code !== 200) throw new Error(`netease api error code: ${resp.body.code}`);
    const albums: Playlist[] = (resp.body.albums ?? [])
      .filter((a) => a.id !== undefined && String(a.id) !== "")
      .map((a) => {
        const artist = Array.isArray(a.artist)
          ? a.artist.map((x) => x.name ?? "").join("、")
          : (a.artist?.name ?? "");
        return {
          source: "netease",
          id: String(a.id),
          name: (a.name ?? "").trim(),
          cover: a.picUrl ?? "",
          track_count: a.size ?? 0,
          play_count: 0,
          creator: artist,
          description: a.publishTime ? new Date(a.publishTime).toISOString().slice(0, 10) : "",
          link: `https://music.163.com/#/album?id=${a.id}`,
        };
      });
    return { albums, has_more: albums.length >= l };
  },

  async getFavAlbums(page: number, limit: number): Promise<{ albums: Playlist[]; has_more: boolean }> {
    const l = Math.min(Math.max(limit, 1), 100);
    const resp = await invokeNcm<{
      code?: number;
      hasMore?: boolean;
      data?: { id?: number | string; name?: string; picUrl?: string; artists?: { name?: string }[]; size?: number; publishTime?: number }[];
    }>("album_sublist", { limit: l, offset: (page - 1) * l });

    if (resp.body.code !== 200) throw new Error(resp.body.code === 301 ? "收藏专辑需要登录网易云账号" : `netease api error code: ${resp.body.code}`);
    const albums: Playlist[] = (resp.body.data ?? [])
      .filter((a) => a.id !== undefined && String(a.id) !== "")
      .map((a) => ({
        source: "netease",
        id: String(a.id),
        name: (a.name ?? "").trim(),
        cover: a.picUrl ?? "",
        track_count: a.size ?? 0,
        play_count: 0,
        creator: (a.artists ?? []).map((x) => x.name ?? "").join("、"),
        description: a.publishTime ? new Date(a.publishTime).toISOString().slice(0, 10) : "",
        link: `https://music.163.com/#/album?id=${a.id}`,
      }));
    return { albums, has_more: resp.body.hasMore === true || albums.length >= l };
  },

  async subAlbum(album, sub: boolean): Promise<void> {
    const resp = await invokeNcm<{ code?: number }>("album_sub", { id: album.id, t: sub ? 1 : 0 });
    if (resp.body.code !== 200 && resp.body.code !== 802) {
      throw new Error(resp.body.code === 301 ? "收藏专辑需要登录网易云账号" : `操作失败 (code: ${resp.body.code})`);
    }
  },

  // ---- CheckinProvider（daily_signin 每日 · yunbei_sign 云贝 · vip_sign 乐签 + 状态查询） ----

  /** 防御式深搜：对象树中找布尔字段（signed/todaySigned/isSign…），最多下探 4 层 */
  async getCheckinStatus(): Promise<CheckinStatus> {
    const status: CheckinStatus = {};

    /* 签到进度（当月已签日期） + 云贝今日 + VIP 乐签信息 三路并行，单路失败不影响整体 */
    const [progressRes, yunbeiRes, vipRes] = await Promise.allSettled([
      invokeNcm<Record<string, any>>("signin_progress", { moduleId: "1207signin-1207signin" }),
      invokeNcm<Record<string, any>>("yunbei_today"),
      invokeNcm<Record<string, any>>("vip_sign_info"),
    ]);

    const today = new Date().getDate();

    if (progressRes.status === "fulfilled") {
      const body = progressRes.value.body ?? {};
      if (body.code === 301) status.need_login = true;
      else {
        /* 宽松提取已签日期数组（data.progress / data.signDays / data.days 等命名差异兼容） */
        const days = deepFindDayArray(body.data ?? body);
        const progress = Array.isArray(days) ? days.filter((d) => typeof d === "number" && d >= 1 && d <= 31) : [];
        status.daily = { signed: progress.includes(today), progress };
      }
    }
    if (yunbeiRes.status === "fulfilled") {
      const body = yunbeiRes.value.body ?? {};
      if (body.code === 301) status.need_login = true;
      else {
        const signed = deepFindBoolean(body.data ?? body, ["signed", "isSigned", "todaySigned", "sign"]);
        status.yunbei = { signed: signed === true };
      }
    }
    if (vipRes.status === "fulfilled") {
      const body = vipRes.value.body ?? {};
      if (body.code === 301) status.need_login = true;
      else {
        const data = body.data ?? body;
        const signed = deepFindBoolean(data, ["todaySigned", "signed", "isSign", "isSignedToday"]);
        const total = deepFindNumber(data, ["totalSignDays", "totalDays", "signDays", "continuousDays"]);
        status.vip = { signed: signed === true, total_days: total };
      }
    }
    return status;
  },

  async doCheckin(kind): Promise<void> {
    const module = kind === "daily" ? "daily_signin" : kind === "yunbei" ? "yunbei_sign" : "vip_sign";
    const params = kind === "daily" ? { type: 0 } : {};
    const resp = await invokeNcm<Record<string, any>>(module, params);
    /* 200 成功；-2 已签（幂等成功）；301 未登录 */
    const code = resp.body?.code;
    if (code === 301) throw new Error("签到需要登录网易云账号");
    if (code !== 200 && code !== -2) {
      const msg = (resp.body?.msg as string) || (resp.body?.message as string) || `code: ${code}`;
      throw new Error(`签到失败：${msg}`);
    }
  },

  // ---- DiscoveryProvider（banner 轮播 · personalized_newsong 新歌速递 · recommend_songs 每日推荐） ----

  async getBanners(): Promise<Banner[]> {
    const resp = await invokeNcm<{
      code?: number;
      banners?: { imageUrl?: string; typeTitle?: string; url?: string; targetId?: number | string; targetType?: number }[];
    }>("banner", { type: 0 });

    if (resp.body.code !== 200) throw new Error(`netease api error code: ${resp.body.code}`);

    /* targetType：1 单曲(外链) / 10 专辑 / 1000 歌单 / 1014 MV */
    const targetMap: Record<number, "album" | "playlist" | "mv"> = { 10: "album", 1000: "playlist", 1014: "mv" };
    return (resp.body.banners ?? [])
      .filter((b) => (b.imageUrl ?? "").trim())
      .map((b) => ({
        source: "netease",
        image: b.imageUrl!,
        title: "",
        tag: (b.typeTitle ?? "").trim(),
        link: (b.url ?? "").trim(),
        target:
          targetMap[b.targetType ?? 0] && b.targetId !== undefined
            ? { type: targetMap[b.targetType ?? 0], id: String(b.targetId) }
            : undefined,
      }));
  },

  async getNewSongs(): Promise<Song[]> {
    const resp = await invokeNcm<{
      code?: number;
      result?: {
        id?: number | string;
        name?: string;
        picUrl?: string;
        song?: { artists?: { name?: string }[]; album?: { id?: number; name?: string; picUrl?: string }; duration?: number };
      }[];
    }>("personalized_newsong", { limit: 10 });

    if (resp.body.code !== 200) throw new Error(`netease api error code: ${resp.body.code}`);

    return (resp.body.result ?? [])
      .filter((item) => item.id !== undefined && String(item.id) !== "")
      .map((item) => ({
        source: "netease",
        id: String(item.id),
        name: (item.name ?? "").trim(),
        artist: (item.song?.artists ?? []).map((a) => a.name ?? "").join("、"),
        album: item.song?.album?.name ?? "",
        album_id: item.song?.album?.id ? String(item.song.album.id) : "",
        duration: Math.floor((item.song?.duration ?? 0) / 1000),
        size: 0,
        bitrate: 128,
        cover: item.picUrl ?? item.song?.album?.picUrl ?? "",
        link: `https://music.163.com/#/song?id=${item.id}`,
        extra: { song_id: String(item.id) },
      }));
  },

  async getDailySongs(): Promise<Song[]> {
    const resp = await invokeNcm<{
      code?: number;
      data?: { dailySongs?: NeteaseSearchSong[] };
    }>("recommend_songs");

    if (resp.body.code === 301) throw new Error("NEED_LOGIN");
    if (resp.body.code !== 200) throw new Error(`netease api error code: ${resp.body.code}`);
    return (resp.body.data?.dailySongs ?? []).map(mapNeteaseTrackToSong);
  },

  // ---- SimilarProvider（simi_song 相似歌曲 · simi_playlist 包含此歌的歌单） ----

  async getSimilarSongs(song): Promise<Song[]> {
    const resp = await invokeNcm<{ code?: number; songs?: NeteaseSearchSong[] }>("simi_song", {
      id: song.id,
      limit: 12,
      offset: 0,
    });
    if (resp.body.code !== 200) throw new Error(`netease api error code: ${resp.body.code}`);
    return (resp.body.songs ?? []).map(mapNeteaseTrackToSong);
  },

  /** 相关歌单：simi_playlist（相似歌单）与 related_playlist（相关推荐）双源合并去重，单源失败降级另一源 */
  async getRelatedPlaylists(song): Promise<Playlist[]> {
    const mapItem = (p: NonNullable<NcmRelatedPlaylistItem>): Playlist => ({
      source: "netease",
      id: String(p.id ?? ""),
      name: (p.name ?? "").trim(),
      cover: p.coverImgUrl ?? "",
      track_count: p.trackCount ?? 0,
      play_count: Math.round(p.playCount ?? 0),
      creator: p.creator?.nickname ?? "",
      description: "",
      link: `https://music.163.com/#/playlist?id=${p.id}`,
    });

    const [simiRes, relatedRes] = await Promise.allSettled([
      invokeNcm<{ code?: number; playlists?: NcmRelatedPlaylistItem[] }>("simi_playlist", {
        id: song.id,
        limit: 9,
        offset: 0,
      }),
      invokeNcm<{ code?: number; playlists?: NcmRelatedPlaylistItem[] }>("related_playlist", { id: song.id }),
    ]);

    const merged: Playlist[] = [];
    const seen = new Set<string>();
    for (const res of [simiRes, relatedRes]) {
      if (res.status !== "fulfilled" || res.value.body.code !== 200) continue;
      for (const p of res.value.body.playlists ?? []) {
        const id = String(p.id ?? "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        merged.push(mapItem(p));
        if (merged.length >= 9) return merged;
      }
    }
    /* 双源全部硬失败才抛错（与上层"失败静默空"策略配合） */
    if (merged.length === 0 && simiRes.status === "rejected" && relatedRes.status === "rejected") {
      throw simiRes.reason instanceof Error ? simiRes.reason : new Error("netease related playlists failed");
    }
    return merged;
  },

  // ---- RecentProvider（record_recent_song/album/playlist 最近播放 · scrobble 听歌埋点） ----

  /** 最近播放列表通用壳：data.list[].resource */
  async getRecentSongs(limit: number): Promise<Song[]> {
    const resp = await invokeNcm<{
      code?: number;
      data?: { list?: { resource?: NeteaseSearchSong }[] };
    }>("record_recent_song", { limit: Math.min(Math.max(limit, 1), 100) });

    if (resp.body.code === 301) throw new Error("NEED_LOGIN");
    if (resp.body.code !== 200) throw new Error(`netease api error code: ${resp.body.code}`);
    return (resp.body.data?.list ?? [])
      .map((e) => e.resource)
      .filter((r): r is NeteaseSearchSong => !!r && r.id !== undefined)
      .map(mapNeteaseTrackToSong);
  },

  async getRecentAlbums(limit: number): Promise<Playlist[]> {
    const resp = await invokeNcm<{
      code?: number;
      data?: { list?: { resource?: { id?: number | string; name?: string; picUrl?: string; artist?: { name?: string } | { name?: string }[]; size?: number } }[] };
    }>("record_recent_album", { limit: Math.min(Math.max(limit, 1), 100) });

    if (resp.body.code === 301) throw new Error("NEED_LOGIN");
    if (resp.body.code !== 200) throw new Error(`netease api error code: ${resp.body.code}`);
    return (resp.body.data?.list ?? [])
      .map((e) => e.resource)
      .filter((r) => !!r && r.id !== undefined)
      .map((r) => {
        const artist = Array.isArray(r!.artist)
          ? (r!.artist as { name?: string }[]).map((x) => x.name ?? "").join("、")
          : (r!.artist as { name?: string } | undefined)?.name ?? "";
        return {
          source: "netease",
          id: String(r!.id),
          name: (r!.name ?? "").trim(),
          cover: r!.picUrl ?? "",
          track_count: r!.size ?? 0,
          play_count: 0,
          creator: artist,
          description: "",
          link: `https://music.163.com/#/album?id=${r!.id}`,
        };
      });
  },

  async getRecentPlaylists(limit: number): Promise<Playlist[]> {
    const resp = await invokeNcm<{
      code?: number;
      data?: { list?: { resource?: { id?: number | string; name?: string; coverImgUrl?: string; playCount?: number; trackCount?: number; creator?: { nickname?: string } } }[] };
    }>("record_recent_playlist", { limit: Math.min(Math.max(limit, 1), 100) });

    if (resp.body.code === 301) throw new Error("NEED_LOGIN");
    if (resp.body.code !== 200) throw new Error(`netease api error code: ${resp.body.code}`);
    return (resp.body.data?.list ?? [])
      .map((e) => e.resource)
      .filter((r) => !!r && r.id !== undefined)
      .map((r) => ({
        source: "netease",
        id: String(r!.id),
        name: (r!.name ?? "").trim(),
        cover: r!.coverImgUrl ?? "",
        track_count: r!.trackCount ?? 0,
        play_count: Math.round(r!.playCount ?? 0),
        creator: r!.creator?.nickname ?? "",
        description: "",
        link: `https://music.163.com/#/playlist?id=${r!.id}`,
      }));
  },

  /** 听歌打卡（同步网易账号听歌历史，喂每日推荐） */
  async scrobbleSong(song): Promise<void> {
    const resp = await invokeNcm<{ code?: number }>("scrobble", {
      id: song.id,
      sourceid: song.id,
      time: song.duration > 0 ? song.duration : 60,
    });
    /* 200 成功；301 未登录静默跳过由调用方处理 */
    if (resp.body.code !== 200) {
      throw new Error(`scrobble failed: ${resp.body.code}`);
    }
  },

  // ---- PlaylistManageProvider（playlist_create/delete/tracks，需登录） ----

  async createPlaylist(name: string): Promise<string> {
    const resp = await invokeNcm<{ code?: number; id?: number | string }>("playlist_create", {
      name,
      privacy: "0",
    });
    if (resp.body.code !== 200 || !resp.body.id) {
      throw new Error(resp.body.code === 301 ? "创建歌单需要登录网易云账号" : `创建失败 (code: ${resp.body.code})`);
    }
    return String(resp.body.id);
  },

  async deletePlaylist(playlistId: string): Promise<void> {
    const resp = await invokeNcm<{ code?: number }>("playlist_delete", { id: playlistId });
    if (resp.body.code !== 200) {
      throw new Error(resp.body.code === 301 ? "删除歌单需要登录网易云账号" : `删除失败 (code: ${resp.body.code})`);
    }
  },

  async addSongsToPlaylist(playlistId: string, songs: Song[]): Promise<void> {
    const ids = songs.map((s) => s.id).join(",");
    if (!ids) return;
    const resp = await invokeNcm<{ code?: number; body?: { code?: number } }>("playlist_tracks", {
      op: "add",
      pid: playlistId,
      tracks: ids,
    });
    /* 成功 code 200；502=部分歌曲已存在（幂等成功） */
    const code = resp.body.code ?? resp.body.body?.code ?? 0;
    if (code !== 200 && code !== 502) {
      throw new Error(code === 301 ? "需要登录网易云账号" : `添加失败 (code: ${code})`);
    }
  },

  async removeSongsFromPlaylist(playlistId: string, songs: Song[]): Promise<void> {
    const ids = songs.map((s) => s.id).join(",");
    if (!ids) return;
    const resp = await invokeNcm<{ code?: number; body?: { code?: number } }>("playlist_tracks", {
      op: "del",
      pid: playlistId,
      tracks: ids,
    });
    const code = resp.body.code ?? resp.body.body?.code ?? 0;
    if (code !== 200) {
      throw new Error(code === 301 ? "需要登录网易云账号" : `移除失败 (code: ${code})`);
    }
  },

  /** 编辑源站歌单（名称必传防上游清空；desc 未传时置空串——上游为全量覆盖语义） */
  async updatePlaylistInfo(playlistId: string, info: { name: string; desc?: string; tags?: string[] }): Promise<void> {
    const name = info.name.trim();
    if (!name) throw new UpstreamError("歌单名称不能为空");
    const resp = await invokeNcm<{ code?: number }>("playlist_update", {
      id: playlistId,
      name,
      desc: info.desc?.trim() ?? "",
      tags: info.tags?.length ? info.tags.join(";") : "",
    });
    if (resp.body.code !== 200) {
      throw new Error(
        resp.body.code === 301 ? "编辑歌单需要登录网易云账号" : `编辑失败 (code: ${resp.body.code})`,
      );
    }
  },

  // ---- PhoneLoginProvider（login_status 档案 · login_cellphone 密码/验证码 · captcha_sent · logout 注销） ----

  /** 注销网易账号（上游 logout；未登录静默跳过；本地 cookie 清理由路由层负责） */
  async logout(): Promise<void> {
    if (!getCookie("netease").trim()) return;
    await invokeNcm<Record<string, unknown>>("logout");
  },

  async getLoginProfile(): Promise<SourceLoginProfile> {
    const resp = await invokeNcm<{
      data?: { code?: number; profile?: { nickname?: string; avatarUrl?: string }; account?: { status?: number } };
    }>("login_status");
    const d = resp.body.data;
    if (d?.code === 200 && d.profile?.nickname) {
      return { logged_in: true, nickname: d.profile.nickname, avatar: d.profile.avatarUrl ?? "" };
    }
    return { logged_in: false };
  },

  async loginByPhonePassword(phone: string, password: string, countryCode?: number): Promise<string> {
    const resp = await invokeNcm<{ code?: number; message?: string; cookie?: string }>("login_cellphone", {
      phone,
      password,
      ...(countryCode && countryCode !== 86 ? { countrycode: countryCode } : {}),
    });
    if (resp.body.code !== 200) {
      const msg =
        resp.body.code === 400 ? "手机号错误" :
        resp.body.code === 502 ? "密码错误" :
        `登录失败 (code: ${resp.body.code})`;
      throw new UpstreamError(msg);
    }
    /* 成功：合并存储（管理员全局通路由路由层会话控制；此处合并进当前会话/全局） */
    if (resp.cookie?.length) {
      try {
        const { mergeStoredCookie } = await import("../netease");
        mergeStoredCookie(resp.cookie);
      } catch {
        /* ignore */
      }
    }
    return normalizeSourceCookieString((resp.cookie ?? []).join("; "));
  },

  async sendPhoneCode(phone: string, countryCode?: number): Promise<void> {
    const resp = await invokeNcm<{ code?: number; message?: string }>("captcha_sent", {
      phone,
      ctcode: countryCode ?? 86,
    });
    if (resp.body.code !== 200) {
      throw new UpstreamError(resp.body.message || `验证码发送失败 (code: ${resp.body.code})`);
    }
  },

  async loginByPhoneCode(phone: string, code: string, countryCode?: number): Promise<string> {
    const resp = await invokeNcm<{ code?: number; message?: string; cookie?: string }>("login_cellphone", {
      phone,
      captcha: code,
      ...(countryCode && countryCode !== 86 ? { countrycode: countryCode } : {}),
    });
    if (resp.body.code !== 200) {
      throw new UpstreamError(resp.body.message || `验证码登录失败 (code: ${resp.body.code})`);
    }
    if (resp.cookie?.length) {
      try {
        const { mergeStoredCookie } = await import("../netease");
        mergeStoredCookie(resp.cookie);
      } catch {
        /* ignore */
      }
    }
    return normalizeSourceCookieString((resp.cookie ?? []).join("; "));
  },

  // ---- ArtistLibraryProvider（artist_list 入驻歌手库 · toplist_artist 歌手榜） ----

  /** 统一筛选 → 网易枚举：area -1/7/96/8/16/0 · type -1全部/1男/2女/3组合 · initial 字母/0热门 */
  async getArtistLibrary(opts): Promise<{ artists: Artist[]; has_more: boolean }> {
    const l = Math.min(Math.max(opts.limit, 1), 100);
    const areaMap: Record<string, number> = { 全部: -1, 华语: 7, 港台: 7, 欧美: 96, 日本: 8, 韩国: 16, 其他: 0 };
    const typeMap: Record<string, string> = { 全部: "-1", 男: "1", 女: "2", 组合: "3" };
    const area = areaMap[opts.area] ?? -1;
    const type = typeMap[opts.sex] ?? "-1";
    /* 字母 a-z → charCode；"#"（其他）传 0 */
    const initial = /^[a-zA-Z]$/.test(opts.initial) ? opts.initial.toUpperCase() : opts.initial === "#" ? 0 : undefined;

    const resp = await invokeNcm<{
      code?: number;
      more?: boolean;
      total?: number;
      artists?: { id?: number | string; name?: string; picUrl?: string; img1v1Url?: string; alias?: string[] }[];
    }>("artist_list", {
      initial,
      type,
      area,
      limit: l,
      offset: (opts.page - 1) * l,
    });

    if (resp.body.code !== 200) throw new Error(`netease api error code: ${resp.body.code}`);

    const artists: Artist[] = (resp.body.artists ?? [])
      .filter((a) => a.id !== undefined && String(a.id) !== "")
      .map((a) => ({
        source: "netease",
        id: String(a.id),
        name: (a.name ?? "").trim(),
        avatar: a.picUrl ?? a.img1v1Url ?? "",
        alias: (a.alias ?? []).filter(Boolean).join(" / "),
        link: `https://music.163.com/#/artist?id=${a.id}`,
      }));
    const total = resp.body.total ?? 0;
    return { artists, has_more: resp.body.more === true || (total > 0 && opts.page * l < total) };
  },

  /** 歌手榜（type 1华语 2欧美 3日语 4韩语；响应 list.artists） */
  async getArtistToplist(type: number): Promise<Artist[]> {
    const resp = await invokeNcm<{
      code?: number;
      list?: { artists?: { id?: number | string; name?: string; picUrl?: string; img1v1Url?: string; alias?: string[]; brief?: string; score?: number }[] };
      artistToplist?: { artists?: { id?: number | string; name?: string; picUrl?: string; img1v1Url?: string; alias?: string[] }[] };
    }>("toplist_artist", { type: Math.min(Math.max(type, 1), 4) });

    if (resp.body.code !== 200) throw new Error(`netease api error code: ${resp.body.code}`);

    const raw = resp.body.list?.artists ?? resp.body.artistToplist?.artists ?? [];
    return raw
      .filter((a) => a.id !== undefined && String(a.id) !== "")
      .map((a) => ({
        source: "netease",
        id: String(a.id),
        name: (a.name ?? "").trim(),
        avatar: a.picUrl ?? a.img1v1Url ?? "",
        alias: (a.alias ?? []).filter(Boolean).join(" / "),
        link: `https://music.163.com/#/artist?id=${a.id}`,
      }));
  },

  // ---- RecommendedPlaylistProvider ----

  async getRecommendedPlaylists(): Promise<Playlist[]> {
    const resp = await invokeNcm<{
      code?: number;
      result?: { id: number | string; name: string; picUrl?: string; playCount?: number; trackCount?: number; copywriter?: string; alg?: string }[];
    }>("personalized", { limit: 30 });

    if (resp.body.code !== 200) throw new Error(`netease api error code: ${resp.body.code}`);

    return (resp.body.result ?? []).map((item) => {
      const copywriter = (item.copywriter ?? "").trim();
      return {
        source: "netease",
        id: String(item.id),
        name: (item.name ?? "").trim(),
        cover: item.picUrl ?? "",
        track_count: item.trackCount ?? 0,
        play_count: Math.round(item.playCount ?? 0),
        creator: copywriter || "网易云推荐",
        description: copywriter,
        link: `https://music.163.com/#/playlist?id=${item.id}`,
        extra: item.alg ? { alg: item.alg } : undefined,
      };
    });
  },

  // ---- PlaylistCategoryProvider ----

  async getPlaylistCategories(): Promise<PlaylistCategory[]> {
    const resp = await invokeNcm<{
      code?: number;
      categories?: Record<string, string>;
      all?: { name?: string; hot?: boolean; resourceCount?: number };
      sub?: { name?: string; category?: number; hot?: boolean; resourceCount?: number }[];
    }>("playlist_catlist");

    if (resp.body.code !== 200) throw new Error(`netease api error code: ${resp.body.code}`);

    const categories: PlaylistCategory[] = [
      {
        source: "netease",
        id: "",
        name: "全部",
        group: "全部",
        count: resp.body.all?.resourceCount ?? 0,
        hot: resp.body.all?.hot ?? false,
      },
    ];
    for (const item of resp.body.sub ?? []) {
      const name = (item.name ?? "").trim();
      if (!name) continue;
      categories.push({
        source: "netease",
        id: name,
        name,
        group: resp.body.categories?.[String(item.category ?? "")] ?? "",
        count: item.resourceCount ?? 0,
        hot: item.hot ?? false,
        extra: { category: String(item.category ?? 0) },
      });
    }
    return categories;
  },

  async getCategoryPlaylists(categoryId: string, page: number, limit: number): Promise<Playlist[]> {
    let categoryID = categoryId.trim();
    if (!categoryID) categoryID = "全部";
    if (page < 1) page = 1;
    if (limit <= 0) limit = 30;
    if (limit > 100) limit = 100;

    const resp = await invokeNcm<{
      code?: number;
      playlists?: NeteasePlaylistItem[];
    }>("top_playlist", {
      cat: categoryID,
      order: "hot",
      limit,
      offset: (page - 1) * limit,
    });

    if (resp.body.code !== 200) throw new Error(`netease api error code: ${resp.body.code}`);

    return (resp.body.playlists ?? []).map((item) => ({
      source: "netease",
      id: String(item.id),
      name: (item.name ?? "").trim(),
      cover: item.coverImgUrl ?? "",
      track_count: item.trackCount ?? 0,
      play_count: Math.round(item.playCount ?? 0),
      creator: item.creator?.nickname ?? "",
      description: item.description ?? "",
      link: `https://music.163.com/#/playlist?id=${item.id}`,
      extra: { category_id: categoryID },
    }));
  },

  // ---- UserPlaylistProvider ----

  async getUserPlaylists(page: number, limit: number): Promise<Playlist[]> {
    const cookie = getCookie("netease");
    if (!cookie.trim()) throw new Error("netease user playlists require cookie");
    if (page < 1) page = 1;
    if (limit <= 0) limit = 30;
    if (limit > 100) limit = 100;

    const accountResp = await invokeNcm<{
      code?: number;
      profile?: { userId?: number; nickname?: string };
    }>("user_account");

    const userID = accountResp.body.profile?.userId ?? 0;
    if (accountResp.body.code !== 200 || !userID) {
      throw new Error(`netease account api error code: ${accountResp.body.code}`);
    }

    const resp = await invokeNcm<{ code?: number; playlist?: NeteasePlaylistItem[] }>("user_playlist", {
      uid: userID,
      limit,
      offset: (page - 1) * limit,
    });

    if (resp.body.code !== 200) throw new Error(`netease user playlist api error code: ${resp.body.code}`);

    return (resp.body.playlist ?? []).map((item) => {
      const playlistID = String(item.id);
      const creator = (item.creator?.nickname ?? "").trim() || (accountResp.body.profile?.nickname ?? "");
      return {
        source: "netease",
        id: playlistID,
        name: (item.name ?? "").trim(),
        cover: item.coverImgUrl ?? "",
        track_count: item.trackCount ?? 0,
        play_count: Math.round(item.playCount ?? 0),
        creator,
        description: item.description ?? "",
        link: `https://music.163.com/#/playlist?id=${playlistID}`,
        extra: {
          user_id: String(userID),
          subscribed: String(!!item.subscribed),
        },
      };
    });
  },

  // ---- QRLoginProvider ----

  async createQRLogin(): Promise<QRLoginSession> {
    const resp = await invokeNcm<{ code?: number; data?: { unikey?: string } }>("login_qr_key");
    const key = (resp.body.data?.unikey ?? "").trim();
    if (resp.body.code !== 200 || !key) {
      throw new Error(`netease qr key api error: code=${resp.body.code}`);
    }
    return {
      source: "netease",
      key,
      url: `https://music.163.com/login?codekey=${encodeURIComponent(key)}`,
      expires_at: Math.floor(Date.now() / 1000) + 5 * 60,
    };
  },

  async checkQRLogin(key: string): Promise<QRLoginResult> {
    const trimmed = key.trim();
    if (!trimmed) throw new Error("netease qr login key is empty");

    const resp = await invokeNcm<{ code?: number; message?: string; cookie?: string }>(
      "login_qr_check",
      { key: trimmed },
    );

    const status = mapNeteaseQRStatus(resp.body.code ?? 0);
    const result: QRLoginResult = {
      source: "netease",
      key: trimmed,
      status,
      message: resp.body.message,
      extra: { code: String(resp.body.code ?? 0) },
    };
    if (status === "success") {
      /* 上游 body.cookie 为 Set-Cookie 数组 join（混入 Max-Age/Expires/Path 属性段），
         规范化剥离后再用——编码后超 4096 会被浏览器静默丢弃 Set-Cookie（表现：登录成功但未登录态） */
      const cookieStr = normalizeSourceCookieString((resp.body.cookie ?? "").trim());
      result.cookie = cookieStr;
      result.cookies = cookieToJson(cookieStr);
      // 登录成功：合并存储（module cookie 数组更全，包含 MUSIC_U）
      if (resp.cookie?.length) {
        try {
          const { mergeStoredCookie } = await import("../netease");
          mergeStoredCookie(resp.cookie);
        } catch {
          /* 存储失败不影响登录结果 */
        }
      }
    }
    return result;
  },

  // ---- P1 Wave A：用户资产（user_detail / user_level / user_subcount / vip_info / user_follows / user_playlist / 听歌报告） ----

  /** 用户详情（user_detail 主、user_detail_new 兜底 + user_level 等级进度 + user_subcount 注册天数） */
  async getUserProfile(uid?: string): Promise<UserProfile> {
    const userID = (uid ?? "").trim() || (await resolveOwnNeteaseUid());
    /* 三审 R3：uid 数字校验（防 NaN 序列化为 null 上送） */
    if (!Number.isFinite(Number(userID))) throw new Error("用户 id 必须为数字");
    const [detailRes, levelRes, subcountRes] = await Promise.allSettled([
      invokeNcm<{ code?: number; profile?: NeteaseUserDetail; playlistCount?: number }>("user_detail", { uid: Number(userID) }),
      invokeNcm<{ code?: number; data?: { level?: number; now?: number; nextPlay?: number; listenSongCnt?: number } }>("user_level"),
      invokeNcm<{ code?: number; createDays?: number }>("user_subcount"),
    ]);
    let profile: NeteaseUserDetail | undefined;
    let playlistCount = 0;
    if (detailRes.status === "fulfilled" && detailRes.value.body.code === 200 && detailRes.value.body.profile) {
      profile = detailRes.value.body.profile;
      playlistCount = detailRes.value.body.playlistCount ?? 0;
    } else {
      /* user_detail_new 兜底（响应包 data.profile） */
      const fresh = await invokeNcm<{ code?: number; data?: { profile?: NeteaseUserDetail } }>("user_detail_new", { uid: Number(userID) });
      if (fresh.body.code !== 200 || !fresh.body.data?.profile) throw new Error("netease user detail not found");
      profile = fresh.body.data.profile;
    }
    if (!profile) throw new Error("netease user detail not found");

    const level = levelRes.status === "fulfilled" && levelRes.value.body.code === 200 ? levelRes.value.body.data : undefined;
    const createDays = subcountRes.status === "fulfilled" && subcountRes.value.body.code === 200 ? subcountRes.value.body.createDays : undefined;

    return {
      source: "netease",
      id: userID,
      nickname: (profile.nickname ?? "").trim(),
      avatar: profile.avatarUrl ?? "",
      signature: profile.signature ?? "",
      level: level?.level ?? profile.level,
      level_progress: level?.nextPlay && level.nextPlay > 0 ? { now: level.now ?? 0, next: level.nextPlay } : undefined,
      listen_song_count: level?.listenSongCnt ?? profile.listenSongs ?? 0,
      create_playlist_count: profile.playlistCount ?? playlistCount,
      collected_playlist_count: profile.playlistBeSubscribedCount ?? 0,
      follow_count: profile.follows ?? 0,
      followed_count: profile.followeds ?? 0,
      event_count: profile.eventCount ?? 0,
      gender: profile.gender,
      create_days: createDays,
      link: `https://music.163.com/#/user/home?id=${userID}`,
    };
  },

  /** VIP 信息（vip_info_v2 + vip_info + vip_sign_detail 乐签） */
  async getUserVipInfo(): Promise<UserVipInfo> {
    /* 审核整改 C-05/C-13：移除结果弃用的 vip_sign_history 请求；全部信源失败（未登录/网络错误）
       时抛错而非静默伪装成"普通账号"（防短 TTL 缓存固化误判，错误态不缓存）。 */
    const [v2Res, v1Res, signRes] = await Promise.allSettled([
      invokeNcm<{ code?: number; data?: { redVipLevel?: number; redVipLevelIconUrl?: string } }>("vip_info_v2"),
      invokeNcm<{ code?: number; data?: { associator?: { vipExpr?: number }; musicPackage?: { vipExpr?: number } } }>("vip_info"),
      invokeNcm<{ code?: number; data?: { totalSignDay?: number; todaySign?: number } }>("vip_sign_detail"),
    ]);
    const v2 = v2Res.status === "fulfilled" && v2Res.value.body.code === 200 ? v2Res.value.body.data : undefined;
    const v1 = v1Res.status === "fulfilled" && v1Res.value.body.code === 200 ? v1Res.value.body.data : undefined;
    const sign = signRes.status === "fulfilled" && signRes.value.body.code === 200 ? signRes.value.body.data : undefined;
    if (!v2 && !v1) {
      const reason = v2Res.status === "rejected" ? v2Res.reason : v1Res.status === "rejected" ? v1Res.reason : undefined;
      throw new Error(reason instanceof Error ? reason.message : "VIP 信息获取失败");
    }

    const redLevel = v2?.redVipLevel ?? 0;
    const expireMs = v1?.associator?.vipExpr ?? v1?.musicPackage?.vipExpr ?? 0;
    /* 三审 R3：v2 单独失败时以 v1 有效期兜底（原该场景黑胶用户被误判为普通账号，与 expire_at 自相矛盾） */
    const isVip = redLevel > 0 || expireMs > 0;
    return {
      source: "netease",
      is_vip: isVip,
      /* 审核整改 C-13：修复死三元（原两分支同为"黑胶VIP"）——redVipLevel>=6 为典藏档 */
      vip_name: isVip ? (redLevel >= 6 ? "黑胶VIP(典藏)" : "黑胶VIP") : "普通账号",
      icon_url: v2?.redVipLevelIconUrl,
      expire_at: expireMs > 0 ? Math.floor(expireMs / 1000) : undefined,
      total_days: sign?.totalSignDay,
      signed_today: sign?.todaySign === 1,
    };
  },

  /** 关注/粉丝/互关（user_follows / user_followeds / user_mutualfollow_get + user_follow_mixed 兜底） */
  async getUserFollows(uid: string, kind: "follows" | "followeds" | "mutual", page: number, limit: number): Promise<UserFollowsResult> {
    if (page < 1) page = 1;
    if (limit <= 0) limit = 30;
    const offset = (page - 1) * limit;
    const userID = uid.trim() || (await resolveOwnNeteaseUid());

    const mapUser = (u: NeteaseFollowUser): FollowUser => ({
      source: "netease",
      id: String(u.userId ?? ""),
      nickname: (u.nickname ?? "").trim(),
      avatar: u.avatarUrl ?? "",
      signature: u.signature ?? "",
      mutual: !!u.mutual,
      link: u.userId ? `https://music.163.com/#/user/home?id=${u.userId}` : undefined,
    });

    if (kind === "follows") {
      const resp = await invokeNcm<{ code?: number; follow?: NeteaseFollowUser[]; more?: boolean }>("user_follows", { uid: Number(userID), limit, offset });
      if (resp.body.code !== 200) throw new Error(`netease follows api error code: ${resp.body.code}`);
      return { users: (resp.body.follow ?? []).filter((u) => u.userId).map(mapUser), has_more: resp.body.more === true };
    }
    if (kind === "followeds") {
      const resp = await invokeNcm<{ code?: number; followeds?: NeteaseFollowUser[]; more?: boolean }>("user_followeds", { uid: Number(userID), limit, offset, lastTime: -1 });
      if (resp.body.code !== 200) throw new Error(`netease followeds api error code: ${resp.body.code}`);
      return { users: (resp.body.followeds ?? []).filter((u) => u.userId).map(mapUser), has_more: resp.body.more === true };
    }
    /* 互关：上游无公开互关列表接口（user_mutualfollow_get 为单好友检测、user_follow_mixed
       为「当前账号」接口且参数名不同）——改用关注列表条目自带的 mutual 标记过滤 */
    const resp = await invokeNcm<{ code?: number; follow?: NeteaseFollowUser[]; more?: boolean }>("user_follows", {
      uid: Number(userID),
      /* 互关是关注列表的子集，按比例放大拉取量以提高单页命中率 */
      limit: Math.min(limit * 3, 100),
      offset,
    });
    if (resp.body.code !== 200) throw new Error(`netease mutualfollow api error code: ${resp.body.code}`);
    const mutualUsers = (resp.body.follow ?? []).filter((u) => u.userId && u.mutual === true);
    return { users: mutualUsers.slice(0, limit).map(mapUser), has_more: resp.body.more === true && mutualUsers.length >= limit };
  },

  /** 他人主页：创建的歌单（user_playlist_create；上游将 playlist 嵌套在 data 下） */
  async getUserCreatedPlaylists(uid: string, page: number, limit: number): Promise<Playlist[]> {
    /* 审核整改 C-07：offset 用钳制后的 limit（原 offset 用原始值，limit>100 时翻页跳页） */
    const l = Math.min(Math.max(limit, 1), 100);
    const resp = await invokeNcm<{ code?: number; playlist?: NeteasePlaylistItem[]; data?: { playlist?: NeteasePlaylistItem[]; subCount?: number } }>("user_playlist_create", {
      uid: Number(uid),
      limit: l,
      offset: (Math.max(page, 1) - 1) * l,
    });
    if (resp.body.code !== 200) throw new Error(`netease user_playlist_create api error code: ${resp.body.code}`);
    const list = resp.body.playlist ?? resp.body.data?.playlist ?? [];
    return list.map((item) => mapNeteasePlaylistItem(item, uid));
  },

  /** 他人主页：收藏的歌单（user_playlist_collect；同上 data 嵌套） */
  async getUserCollectedPlaylists(uid: string, page: number, limit: number): Promise<Playlist[]> {
    /* 审核整改 C-07：同 getUserCreatedPlaylists */
    const l = Math.min(Math.max(limit, 1), 100);
    const resp = await invokeNcm<{ code?: number; playlist?: NeteasePlaylistItem[]; data?: { playlist?: NeteasePlaylistItem[]; subCount?: number } }>("user_playlist_collect", {
      uid: Number(uid),
      limit: l,
      offset: (Math.max(page, 1) - 1) * l,
    });
    if (resp.body.code !== 200) throw new Error(`netease user_playlist_collect api error code: ${resp.body.code}`);
    const list = resp.body.playlist ?? resp.body.data?.playlist ?? [];
    return list.map((item) => mapNeteasePlaylistItem(item, uid));
  },

  /** 听歌排行（user_record：type 1=周榜 0=全部） */
  async getUserPlayRecord(type: 0 | 1): Promise<PlayRecordItem[]> {
    const uid = await resolveOwnNeteaseUid();
    const resp = await invokeNcm<{ code?: number; weekData?: NcmRecordItem[]; allData?: NcmRecordItem[] }>("user_record", { uid: Number(uid), type });
    if (resp.body.code !== 200) throw new Error(`netease user_record api error code: ${resp.body.code}`);
    const list = type === 1 ? resp.body.weekData : resp.body.allData;
    return (list ?? []).map((item) => ({
      song: mapNeteaseTrackToSong(item.song as NeteaseSearchSong),
      play_count: item.playCount ?? 0,
      score: item.score,
    }));
  },

  /** 听歌数据画像（listen_data_total + listen_data_today_song + listen_data_song_play_rank + recent_listen_list） */
  async getListenStats(): Promise<ListenStats> {
    const [totalRes, todayRes, rankRes, recentRes] = await Promise.allSettled([
      invokeNcm<{ code?: number; data?: Record<string, unknown> }>("listen_data_total"),
      invokeNcm<{ code?: number; data?: { list?: NcmRecordItem[] } }>("listen_data_today_song"),
      invokeNcm<{ code?: number; data?: { list?: NcmRecordItem[] } }>("listen_data_song_play_rank"),
      invokeNcm<{ code?: number; data?: { total?: number } }>("recent_listen_list"),
    ]);
    const total = totalRes.status === "fulfilled" && totalRes.value.body.code === 200 ? totalRes.value.body.data : undefined;
    const today = todayRes.status === "fulfilled" && todayRes.value.body.code === 200 ? todayRes.value.body.data : undefined;
    const rank = rankRes.status === "fulfilled" && rankRes.value.body.code === 200 ? rankRes.value.body.data : undefined;
    const recent = recentRes.status === "fulfilled" && recentRes.value.body.code === 200 ? recentRes.value.body.data : undefined;
    /* 审核整改 C-13：核心信源失败（未登录/网络故障）时抛错，不再静默返回空 stats。
       修复：recent_listen_list 匿名亦可成功，不作为登录信号——仅以三个登录态接口判定 */
    if (!total && !today && !rank) {
      const reason =
        totalRes.status === "rejected" ? totalRes.reason : todayRes.status === "rejected" ? todayRes.reason : rankRes.status === "rejected" ? rankRes.reason : undefined;
      throw new Error(reason instanceof Error ? reason.message : "听歌数据加载失败");
    }

    const stats: ListenStats = { source: "netease" };
    if (total) {
      stats.total_listen_days = Number(total.totalListenDays ?? total.listenDays ?? 0) || undefined;
      stats.total_listen_count = Number(total.totalListenSongs ?? total.listenSongs ?? 0) || undefined;
      /* 修复：上游实际返回 totalDuration（累计收听秒数），账号无天数/次数字段时仍可展示画像 */
      stats.total_listen_duration = Number(total.totalDuration ?? 0) || undefined;
    }
    const todayList = (today?.list ?? []).filter((i) => i.song);
    if (todayList.length) {
      stats.today_listen_count = todayList.reduce((sum, i) => sum + (i.playCount ?? 0), 0);
      stats.today_songs = todayList.slice(0, 10).map((i) => ({ song: mapNeteaseTrackToSong(i.song as NeteaseSearchSong), count: i.playCount ?? 0 }));
    }
    if (rank?.list?.length) {
      stats.gene_tags = rank.list.slice(0, 6).map((i, idx) => ({
        name: `#${idx + 1} ${(i.song as NeteaseSearchSong | undefined)?.name ?? ""}`,
        value: `播放 ${i.playCount ?? 0} 次`,
      }));
    }
    if (recent?.total) {
      stats.recent_listen_count = recent.total;
    }
    return stats;
  },

  /** 年度/周期报告（summary_annual + listen_data_year_report，活动型接口按 section 独立降级） */
  async getAnnualReport(): Promise<ReportSection[]> {
    const [annualRes, yearRes] = await Promise.allSettled([
      invokeNcm<{ code?: number; data?: Record<string, unknown> }>("summary_annual"),
      invokeNcm<{ code?: number; data?: Record<string, unknown> }>("listen_data_year_report"),
    ]);
    const sections: ReportSection[] = [];
    if (annualRes.status === "fulfilled" && annualRes.value.body.code === 200) {
      const cards = flattenReportCards(annualRes.value.body.data);
      if (cards.length) sections.push({ key: "annual", title: "年度总结", cards });
    }
    if (yearRes.status === "fulfilled" && yearRes.value.body.code === 200) {
      const cards = flattenReportCards(yearRes.value.body.data);
      if (cards.length) sections.push({ key: "year_report", title: "听歌画像", cards });
    }
    if (!sections.length) throw new Error("年度报告暂未生成（活动型接口存在时效）");
    return sections;
  },

  /** 历史每日推荐回忆杀（history_recommend_songs 列表 · history_recommend_songs_detail 按日期回溯） */
  async getHistoryDailyRecommends(date?: string): Promise<HistoryDailyRecommend[]> {
    if (date) {
      const resp = await invokeNcm<{ code?: number; data?: { daySongs?: NeteaseSearchSong[] } }>("history_recommend_songs_detail", { date });
      if (resp.body.code !== 200) throw new Error(`netease history detail api error code: ${resp.body.code}`);
      return [{ date, songs: (resp.body.data?.daySongs ?? []).map(mapNeteaseTrackToSong) }];
    }
    const resp = await invokeNcm<{ code?: number; data?: { dailyList?: { date?: string }[]; weekList?: { date?: string }[] } }>("history_recommend_songs");
    if (resp.body.code !== 200) throw new Error(`netease history recommend api error code: ${resp.body.code}`);
    const list = resp.body.data?.dailyList ?? resp.body.data?.weekList ?? [];
    return list
      .map((item) => ({ date: (item.date ?? "").trim(), songs: [] as Song[] }))
      .filter((item) => item.date)
      .slice(0, 30);
  },

  // ---- P1 B1：播客电台（dj_catelist / dj_recommend / dj_hot / dj_today_perfered / dj_detail / dj_program …） ----

  async getDjCategories(): Promise<DjCategory[]> {
    const [catelistRes, excludeRes, recRes] = await Promise.allSettled([
      invokeNcm<{ code?: number; categories?: { id?: number; name?: string; subcount?: number }[] }>("dj_catelist"),
      invokeNcm<{ code?: number; categories?: { id?: number; name?: string; subcount?: number; hot?: boolean }[] }>("dj_category_excludehot"),
      invokeNcm<{ code?: number; data?: { categoryId?: number; categoryName?: string; djCount?: number }[] }>("dj_category_recommend"),
    ]);
    const merged = new Map<string, DjCategory>();
    const push = (id: unknown, name: unknown, count: number, hot = false) => {
      const key = String(id ?? "");
      const label = String(name ?? "").trim();
      if (!key || !label || merged.has(key)) return;
      merged.set(key, { id: key, name: label, radio_count: count, hot });
    };
    if (catelistRes.status === "fulfilled" && catelistRes.value.body.code === 200) {
      for (const c of catelistRes.value.body.categories ?? []) push(c.id, c.name, c.subcount ?? 0);
    }
    if (excludeRes.status === "fulfilled" && excludeRes.value.body.code === 200) {
      for (const c of excludeRes.value.body.categories ?? []) push(c.id, c.name, c.subcount ?? 0, c.hot === true);
    }
    if (recRes.status === "fulfilled" && recRes.value.body.code === 200) {
      for (const c of recRes.value.body.data ?? []) push(c.categoryId, c.categoryName, c.djCount ?? 0, true);
    }
    if (!merged.size) throw new Error("播客分类加载失败");
    return [...merged.values()];
  },

  async getDjRadios(kind, categoryId, page = 1, limit = 30): Promise<{ radios: DjRadio[]; has_more: boolean }> {
    const l = Math.min(Math.max(limit, 1), 100);
    const offset = (page - 1) * l;
    const cat = (categoryId ?? "").trim();

    let radios: NcmDjRadio[] = [];
    let hasMore = false;
    if (kind === "today") {
      const resp = await invokeNcm<{ code?: number; data?: NcmDjRadio[]; more?: boolean; hasMore?: boolean }>("dj_today_perfered", { page: page - 1, limit: l });
      if (resp.body.code !== 200) throw new Error(`netease dj today api error code: ${resp.body.code}`);
      radios = resp.body.data ?? [];
      hasMore = resp.body.more === true || resp.body.hasMore === true;
    } else if (cat) {
      /* 分类维度：dj_recommend_type 优先（审核整改 C-13：整包结果本地分页，对齐 page/limit 语义），
         空结果回退 dj_radio_hot 分页 */
      const resp = await invokeNcm<{ code?: number; djRadios?: NcmDjRadio[] }>("dj_recommend_type", { type: cat });
      if (resp.body.code === 200 && resp.body.djRadios?.length) {
        radios = resp.body.djRadios.slice(offset, offset + l);
        hasMore = offset + radios.length < resp.body.djRadios.length;
      } else {
        const hot = await invokeNcm<{ code?: number; djRadios?: NcmDjRadio[]; more?: boolean }>("dj_radio_hot", { cateId: cat, limit: l, offset });
        if (hot.body.code !== 200) throw new Error(`netease dj radio hot api error code: ${hot.body.code}`);
        radios = hot.body.djRadios ?? [];
        hasMore = hot.body.more === true;
      }
    } else if (kind === "hot") {
      const resp = await invokeNcm<{ code?: number; djRadios?: NcmDjRadio[]; more?: boolean }>("dj_hot", { limit: l, offset });
      if (resp.body.code !== 200) throw new Error(`netease dj hot api error code: ${resp.body.code}`);
      radios = resp.body.djRadios ?? [];
      hasMore = resp.body.more === true;
    } else {
      /* 推荐：dj_recommend + dj_personalize_recommend 合并去重 */
      const [recRes, perRes] = await Promise.allSettled([
        invokeNcm<{ code?: number; djRadios?: NcmDjRadio[]; userRadioList?: NcmDjRadio[] }>("dj_recommend"),
        invokeNcm<{ code?: number; data?: NcmDjRadio[] }>("dj_personalize_recommend", { limit: l }),
      ]);
      const seen = new Set<string>();
      const add = (r: NcmDjRadio) => {
        const key = String(r.id ?? "");
        if (!key || seen.has(key)) return;
        seen.add(key);
        radios.push(r);
      };
      if (recRes.status === "fulfilled" && recRes.value.body.code === 200) {
        for (const r of recRes.value.body.djRadios ?? []) add(r);
        for (const r of recRes.value.body.userRadioList ?? []) add(r);
      }
      if (perRes.status === "fulfilled" && perRes.value.body.code === 200) {
        for (const r of perRes.value.body.data ?? []) add(r);
      }
      if (!radios.length) throw new Error("推荐电台加载失败");
    }
    return { radios: radios.map(mapNcmDjRadio), has_more: hasMore };
  },

  async getDjRadioDetail(radioId: string): Promise<DjRadio> {
    const resp = await invokeNcm<{ code?: number; data?: NcmDjRadio }>("dj_detail", { rid: Number(radioId) });
    if (resp.body.code !== 200 || !resp.body.data) throw new Error(`netease dj detail api error code: ${resp.body.code}`);
    return mapNcmDjRadio(resp.body.data);
  },

  async getDjPrograms(radioId: string, page: number, limit: number): Promise<{ programs: DjProgram[]; has_more: boolean }> {
    const l = Math.min(Math.max(limit, 1), 100);
    const resp = await invokeNcm<{ code?: number; programs?: NcmDjProgram[]; count?: number; more?: boolean }>("dj_program", {
      rid: Number(radioId),
      limit: l,
      offset: (page - 1) * l,
      asc: 0,
    });
    if (resp.body.code !== 200) throw new Error(`netease dj program api error code: ${resp.body.code}`);
    const programs = (resp.body.programs ?? []).map(mapNcmDjProgram);
    const count = resp.body.count ?? 0;
    return { programs, has_more: resp.body.more === true || count > page * l };
  },

  async getDjProgramDetail(programId: string): Promise<DjProgram> {
    const resp = await invokeNcm<{ code?: number; program?: NcmDjProgram }>("dj_program_detail", { id: Number(programId) });
    if (resp.body.code !== 200 || !resp.body.program) throw new Error(`netease dj program detail api error code: ${resp.body.code}`);
    return mapNcmDjProgram(resp.body.program);
  },

  // ---- P1 B2：曲风探索（style_list / style_detail / style_song / style_album / style_artist / style_playlist / style_preference） ----

  async getStyles(): Promise<StyleTag[]> {
    /* 修复：上游 /api/tag/list/get 实际字段为 tagId/tagName/childrenTags（分组两级树）；
       保留 id/name/children 读取作兼容兜底 */
    const resp = await invokeNcm<{
      code?: number;
      data?: { id?: number; name?: string; hot?: boolean; children?: { id?: number; name?: string; hot?: boolean }[]; tagId?: number; tagName?: string; childrenTags?: { tagId?: number; tagName?: string; hot?: boolean }[] }[];
    }>("style_list");
    if (resp.body.code !== 200) throw new Error(`netease style list api error code: ${resp.body.code}`);
    const tags: StyleTag[] = [];
    for (const item of resp.body.data ?? []) {
      const id = String(item.id ?? item.tagId ?? "");
      const name = (item.name ?? item.tagName ?? "").trim();
      if (!id || !name) continue;
      tags.push({ id, name, hot: item.hot === true });
      for (const child of item.children ?? item.childrenTags ?? []) {
        const cid = String(child.id ?? child.tagId ?? "");
        const cname = (child.name ?? child.tagName ?? "").trim();
        if (!cid || !cname || cid === id) continue;
        tags.push({ id: cid, name: cname, parent_id: id, hot: child.hot === true });
      }
    }
    if (!tags.length) throw new Error("曲风列表为空");
    return tags;
  },

  async getStyleDetail(styleId: string): Promise<StyleDetail> {
    const resp = await invokeNcm<{ code?: number; data?: { id?: number; name?: string; detail?: string; description?: string } }>("style_detail", { tagId: Number(styleId) });
    if (resp.body.code !== 200) throw new Error(`netease style detail api error code: ${resp.body.code}`);
    return {
      id: String(resp.body.data?.id ?? styleId),
      name: (resp.body.data?.name ?? "").trim(),
      description: resp.body.data?.detail ?? resp.body.data?.description,
    };
  },

  async getStyleSongs(styleId: string, page: number, limit: number): Promise<{ songs: Song[]; has_more: boolean }> {
    /* 审核整改 C-07：cursor/has_more 统一用钳制后的 limit（原 offset 用原始值、上限 100，limit>100 时翻页跳页） */
    const l = Math.min(Math.max(limit, 1), 100);
    const resp = await invokeNcm<{ code?: number; songs?: NeteaseSearchSong[]; data?: { songs?: NeteaseSearchSong[] }; cursor?: number | string; hasMore?: boolean }>("style_song", {
      tagId: Number(styleId),
      cursor: (Math.max(page, 1) - 1) * l,
      size: l,
      sort: 0,
    });
    if (resp.body.code !== 200) throw new Error(`netease style song api error code: ${resp.body.code}`);
    const raw = resp.body.songs ?? resp.body.data?.songs ?? [];
    return { songs: raw.map(mapNeteaseTrackToSong), has_more: resp.body.hasMore === true || raw.length >= l };
  },

  async getStyleAlbums(styleId: string, page: number, limit: number): Promise<{ albums: Playlist[]; has_more: boolean }> {
    /* 审核整改 C-07：同 getStyleSongs；修复：上游 albums 嵌套在 data 下 */
    const l = Math.min(Math.max(limit, 1), 100);
    const resp = await invokeNcm<{ code?: number; albums?: NeteasePlaylistItem[]; data?: { albums?: NeteasePlaylistItem[]; hasMore?: boolean } }>("style_album", {
      tagId: Number(styleId),
      cursor: (Math.max(page, 1) - 1) * l,
      size: l,
    });
    if (resp.body.code !== 200) throw new Error(`netease style album api error code: ${resp.body.code}`);
    const albums = (resp.body.albums ?? resp.body.data?.albums ?? []).map((item) => mapNeteasePlaylistItem(item));
    const hasMore = resp.body.hasMore === true || resp.body.data?.hasMore === true;
    return { albums, has_more: hasMore || albums.length >= l };
  },

  async getStyleArtists(styleId: string, page: number, limit: number): Promise<{ artists: Artist[]; has_more: boolean }> {
    /* 审核整改 C-07：同 getStyleSongs；修复：上游 artists/分页信息嵌套在 data 下（data.page.more） */
    const l = Math.min(Math.max(limit, 1), 100);
    const resp = await invokeNcm<{ code?: number; artists?: { id?: number | string; name?: string; picUrl?: string; img1v1Url?: string; alias?: string[] }[]; data?: { artists?: { id?: number | string; name?: string; picUrl?: string; img1v1Url?: string; alias?: string[] }[]; page?: { more?: boolean } } }>("style_artist", {
      tagId: Number(styleId),
      cursor: (Math.max(page, 1) - 1) * l,
      size: l,
    });
    if (resp.body.code !== 200) throw new Error(`netease style artist api error code: ${resp.body.code}`);
    const raw = resp.body.artists ?? resp.body.data?.artists ?? [];
    const artists = raw
      .filter((a) => a.id !== undefined && String(a.id) !== "")
      .map((a) => ({
        source: "netease",
        id: String(a.id),
        name: (a.name ?? "").trim(),
        avatar: a.picUrl ?? a.img1v1Url ?? "",
        alias: (a.alias ?? []).filter(Boolean).join(" / "),
        link: `https://music.163.com/#/artist?id=${a.id}`,
      }));
    return { artists, has_more: resp.body.data?.page?.more === true || artists.length >= l };
  },

  async getStylePlaylists(styleId: string, page: number, limit: number): Promise<{ playlists: Playlist[]; has_more: boolean }> {
    /* 审核整改 C-07：同 getStyleSongs；修复：上游 playlist 嵌套在 data 下 */
    const l = Math.min(Math.max(limit, 1), 100);
    const resp = await invokeNcm<{ code?: number; playlists?: NeteasePlaylistItem[]; data?: { playlist?: NeteasePlaylistItem[]; hasMore?: boolean } }>("style_playlist", {
      tagId: Number(styleId),
      cursor: (Math.max(page, 1) - 1) * l,
      size: l,
    });
    if (resp.body.code !== 200) throw new Error(`netease style playlist api error code: ${resp.body.code}`);
    const playlists = (resp.body.playlists ?? resp.body.data?.playlist ?? []).map((item) => mapNeteasePlaylistItem(item));
    const hasMore = resp.body.hasMore === true || resp.body.data?.hasMore === true;
    return { playlists, has_more: hasMore || playlists.length >= l };
  },

  /** 曲风偏好（style_preference 为读取接口：/api/tag/my/preference/get） */
  async getStylePreferences(): Promise<string[]> {
    const resp = await invokeNcm<{ code?: number; data?: { tagList?: { id?: number; name?: string }[] } }>("style_preference");
    if (resp.body.code !== 200) throw new Error(`netease style preference api error code: ${resp.body.code}`);
    return (resp.body.data?.tagList ?? []).map((t) => String(t.id ?? "")).filter(Boolean);
  },

  // ---- P1 B3：云盘音乐（user_cloud 列表 / user_cloud_detail / cloud_match / cloud_lyric_get / user_cloud_del） ----

  async getCloudSongs(page: number, limit: number): Promise<CloudListResult> {
    const l = Math.min(Math.max(limit, 1), 200);
    const resp = await invokeNcm<{ code?: number; count?: number; size?: number; maxSize?: number; data?: NcmCloudItem[] }>("user_cloud", {
      limit: l,
      offset: (page - 1) * l,
    });
    if (resp.body.code === 301) throw new Error("云盘需要登录网易云账号");
    if (resp.body.code !== 200) throw new Error(`netease cloud api error code: ${resp.body.code}`);
    const songs: CloudSong[] = (resp.body.data ?? []).map((item) => {
      const song = mapNeteaseTrackToSong(item.simpleSong as NeteaseSearchSong);
      /* simpleSong 无 ar/al 时回退云盘命名 */
      if (!song.artist && item.simpleSong?.artists?.length) {
        song.artist = item.simpleSong.artists.map((a) => a.name ?? "").join("、");
      }
      const fileInfo = item.fileInfo?.[0];
      return {
        song,
        filename: item.fileName ?? fileInfo?.filename,
        file_size: fileInfo?.size ?? 0,
        add_time: item.addTime ? new Date(item.addTime).toISOString() : undefined,
        cloud_id: String(item.songId ?? item.simpleSong?.id ?? ""),
        match_state: item.simpleSong?.matched
          ? undefined
          : song.artist || song.album
            ? undefined
            : "未匹配",
      };
    });
    const count = resp.body.count ?? 0;
    return {
      songs,
      has_more: count > page * l,
      size: resp.body.size,
      max_size: resp.body.maxSize,
    };
  },

  async getCloudSongDetail(cloudId: string): Promise<CloudSong> {
    const resp = await invokeNcm<{ code?: number; data?: NcmCloudItem[] }>("user_cloud_detail", { id: cloudId });
    if (resp.body.code !== 200) throw new Error(`netease cloud detail api error code: ${resp.body.code}`);
    const item = resp.body.data?.[0];
    if (!item) throw new Error("云盘歌曲不存在");
    const song = mapNeteaseTrackToSong(item.simpleSong as NeteaseSearchSong);
    if (!song.artist && item.simpleSong?.artists?.length) {
      song.artist = item.simpleSong.artists.map((a) => a.name ?? "").join("、");
    }
    return { song, filename: item.fileName, cloud_id: cloudId };
  },

  async matchCloudSong(cloudId: string, songId: string): Promise<void> {
    const uid = await resolveOwnNeteaseUid();
    const resp = await invokeNcm<{ code?: number }>("cloud_match", { uid: Number(uid), sid: Number(cloudId), asid: Number(songId) });
    if (resp.body.code !== 200) throw new Error(`云盘匹配失败 (code: ${resp.body.code})`);
  },

  async getCloudLyric(cloudId: string): Promise<string> {
    const uid = await resolveOwnNeteaseUid();
    const resp = await invokeNcm<{ code?: number; lrc?: { lyric?: string }; klyric?: { lyric?: string } }>("cloud_lyric_get", {
      uid: Number(uid),
      sid: Number(cloudId),
    });
    if (resp.body.code !== 200) throw new Error(`云盘歌词获取失败 (code: ${resp.body.code})`);
    return resp.body.lrc?.lyric ?? "";
  },

  async deleteCloudSong(cloudId: string): Promise<void> {
    const resp = await invokeNcm<{ code?: number }>("user_cloud_del", { id: Number(cloudId) });
    if (resp.body.code !== 200) throw new Error(`云盘删除失败 (code: ${resp.body.code})`);
  },

  // ---- P1 B4：发现页二期（homepage_block_page / recommend_resource / privatecontent / personalized_mv / 精品歌单 / playlist_hot / album_list …） ----

  /** 首页区块聚合（homepage_block_page）：容错解析官方 App 区块结构为统一 DiscoverBlock */
  async getHomepageBlocks(): Promise<DiscoverBlock[]> {
    const resp = await invokeNcm<{ code?: number; data?: { blocks?: Record<string, unknown>[] } }>("homepage_block_page", { refresh: "true" });
    if (resp.body.code !== 200) throw new Error(`netease homepage block api error code: ${resp.body.code}`);
    const blocks: DiscoverBlock[] = [];
    for (const raw of resp.body.data?.blocks ?? []) {
      const blockCode = String(raw.blockCode ?? "");
      const block: DiscoverBlock = { key: blockCode || `block-${blocks.length}`, title: blockTitleOf(blockCode) };
      const found = extractBlockPlaylists(raw);
      if (found.length) block.playlists = found.slice(0, 10);
      if (block.playlists?.length) blocks.push(block);
    }
    return blocks;
  },

  /** 每日推荐歌单（recommend_resource，需登录） */
  async getDailyRecommendPlaylists(): Promise<Playlist[]> {
    const resp = await invokeNcm<{ code?: number; recommend?: { id?: number | string; name?: string; picUrl?: string; playcount?: number; playCount?: number }[] }>("recommend_resource");
    if (resp.body.code === 301) throw new Error("每日推荐需要登录网易云账号");
    if (resp.body.code !== 200) throw new Error(`netease recommend resource api error code: ${resp.body.code}`);
    return (resp.body.recommend ?? []).map((item) => ({
      source: "netease",
      id: String(item.id ?? ""),
      name: (item.name ?? "").trim(),
      cover: item.picUrl ?? "",
      track_count: 0,
      play_count: Math.round(item.playcount ?? item.playCount ?? 0),
      creator: "每日推荐",
      description: "根据你的口味生成",
      link: `https://music.163.com/#/playlist?id=${item.id}`,
    }));
  },

  /** 独家放送（personalized_privatecontent + personalized_privatecontent_list 合并去重） */
  async getPrivateContents(): Promise<Banner[]> {
    const [aRes, bRes] = await Promise.allSettled([
      invokeNcm<{ code?: number; result?: { picUrl?: string; name?: string; copywriter?: string; url?: string; targetId?: number | string; targetType?: number }[] }>("personalized_privatecontent"),
      invokeNcm<{ code?: number; result?: { picUrl?: string; name?: string; copywriter?: string; url?: string; targetId?: number | string; targetType?: number }[] }>("personalized_privatecontent_list", { limit: 60 }),
    ]);
    const seen = new Set<string>();
    const banners: Banner[] = [];
    /* 三审 R3：targetType 映射对齐 getBanners（原硬编码 "playlist"，MV/专辑类点击跳错资源） */
    const targetMap: Record<number, "album" | "playlist" | "mv"> = { 10: "album", 1000: "playlist", 1014: "mv" };
    const push = (item: { picUrl?: string; name?: string; copywriter?: string; url?: string; targetId?: number | string; targetType?: number }) => {
      const img = item.picUrl ?? "";
      const title = (item.name ?? "").trim();
      if (!img || !title || seen.has(img)) return;
      seen.add(img);
      const targetType = targetMap[item.targetType ?? 0];
      banners.push({
        source: "netease",
        image: img,
        title,
        tag: item.copywriter ?? "独家放送",
        link: item.url,
        target: targetType && item.targetId !== undefined ? { type: targetType, id: String(item.targetId) } : undefined,
      });
    };
    let okCount = 0;
    if (aRes.status === "fulfilled" && aRes.value.body.code === 200) {
      okCount++;
      for (const i of aRes.value.body.result ?? []) push(i);
    }
    if (bRes.status === "fulfilled" && bRes.value.body.code === 200) {
      okCount++;
      for (const i of bRes.value.body.result ?? []) push(i);
    }
    /* 三审 R3：全部信源失败时抛错（对齐 getHomepageBlocks；原静默空数组与"无内容"混同，路由层转 error 不缓存） */
    if (!okCount) {
      const rejected = [aRes, bRes].find((r) => r.status === "rejected");
      const reason = rejected && rejected.status === "rejected" ? rejected.reason : undefined;
      throw new Error(reason instanceof Error ? reason.message : "独家放送加载失败");
    }
    return banners;
  },

  /** 推荐 MV（personalized_mv） */
  async getRecommendedMvs(): Promise<MvItem[]> {
    const resp = await invokeNcm<{ code?: number; result?: { id?: number | string; name?: string; picUrl?: string; artistName?: string; playCount?: number; duration?: number }[] }>("personalized_mv");
    if (resp.body.code !== 200) throw new Error(`netease personalized mv api error code: ${resp.body.code}`);
    return (resp.body.result ?? []).map((m) => ({
      source: "netease",
      id: String(m.id ?? ""),
      name: (m.name ?? "").trim(),
      artist: m.artistName ?? "",
      cover: m.picUrl ?? "",
      duration: Math.floor((m.duration ?? 0) / 1000),
      play_count: Math.round(m.playCount ?? 0),
    }));
  },

  /** 精品歌单标签（playlist_highquality_tags） */
  async getHighqualityTags(): Promise<HighqualityTag[]> {
    const resp = await invokeNcm<{ code?: number; tags?: { id?: number; name?: string; hot?: boolean; category?: number; hotTag?: boolean }[] }>("playlist_highquality_tags");
    if (resp.body.code !== 200) throw new Error(`netease highquality tags api error code: ${resp.body.code}`);
    return (resp.body.tags ?? [])
      .filter((t) => t.id !== undefined)
      .map((t) => ({ id: String(t.id), name: (t.name ?? "").trim(), hot: t.hotTag === true || t.hot === true }));
  },

  /** 精品歌单列表（top_playlist_highquality：before = 上一页响应 lasttime 毫秒游标） */
  async getHighqualityPlaylists(tag: string, page: number, limit: number): Promise<{ playlists: Playlist[]; has_more: boolean }> {
    /* 审核整改 B-03：before 是毫秒时间游标而非数值偏移——原 (page-1)*l（30/60 之类小数值）
       恒小于全部歌单 updateTime，翻页恒返回第一页。现以每页响应 lasttime 建立链式游标
       （tag + 凭证指纹 + 页码维度记录）；游标丢失（进程重启/清缓存）时该页退化为第一页数据，
       从第 1 页重新翻页即可重建。 */
    const l = Math.min(Math.max(limit, 1), 100);
    const p = Math.max(page, 1);
    const cursorKey = `${tag || "全部"}|${md5hex(getCookie("netease") || "")}`;
    const before = p > 1 ? hqCursorCache.get(`${cursorKey}|${p - 1}`) ?? 0 : 0;
    const resp = await invokeNcm<{ code?: number; playlists?: (NeteasePlaylistItem & { updateTime?: number })[]; more?: boolean; lasttime?: number }>("top_playlist_highquality", {
      cat: tag || "全部",
      limit: l,
      before,
    });
    if (resp.body.code !== 200) throw new Error(`netease highquality playlists api error code: ${resp.body.code}`);
    if (resp.body.lasttime && (p === 1 || hqCursorCache.has(`${cursorKey}|${p - 1}`))) {
      /* 三审 R3：仅"有效链页"写入游标（跳页响应是第一页数据，写入会污染后续页序）；
         容量治理改为 LRU 淘汰最旧一条（原 size>600 全清，多 tag 并发翻页一次触顶全部丢失） */
      hqCursorCache.set(`${cursorKey}|${p}`, Number(resp.body.lasttime));
      if (hqCursorCache.size > 600) {
        const oldest = hqCursorCache.keys().next().value;
        if (oldest !== undefined) hqCursorCache.delete(oldest);
      }
    }
    const playlists = (resp.body.playlists ?? []).map((item) => mapNeteasePlaylistItem(item));
    return { playlists, has_more: resp.body.more === true || playlists.length >= l };
  },

  /** 热门歌单分类标签（playlist_hot） */
  async getHotPlaylistTags(): Promise<PlaylistCategory[]> {
    const resp = await invokeNcm<{ code?: number; tags?: { id?: number; name?: string; category?: number; hot?: boolean; useCount?: number }[] }>("playlist_hot");
    if (resp.body.code !== 200) throw new Error(`netease playlist hot api error code: ${resp.body.code}`);
    return (resp.body.tags ?? []).map((t) => ({
      source: "netease",
      id: String(t.id ?? t.name ?? ""),
      name: (t.name ?? "").trim(),
      group: t.category === 0 ? "语种" : t.category === 1 ? "风格" : t.category === 2 ? "场景" : t.category === 3 ? "情感" : t.category === 4 ? "主题" : "热门",
      count: t.useCount ?? 0,
      hot: t.hot === true,
    }));
  },

  /** 收藏/取消收藏歌单（playlist_subscribe） */
  async subscribePlaylist(playlistId: string, sub: boolean): Promise<void> {
    /* 三审 R3：id 数字校验（对齐 qq 侧 subscribePlaylist） */
    const pid = Number(playlistId);
    if (!Number.isFinite(pid)) throw new Error("歌单 id 必须为数字");
    const resp = await invokeNcm<{ code?: number }>("playlist_subscribe", { id: pid, t: sub ? 1 : 0 });
    if (resp.body.code !== 200) throw new Error(sub ? "收藏歌单失败" : "取消收藏失败");
  },

  /** 我喜欢的（MLOG 视频）歌单（playlist_mylike：/api/mlog/playlist/mylike/bytime/get） */
  async getMyLikedPlaylists(): Promise<Playlist[]> {
    const resp = await invokeNcm<{ code?: number; data?: { playlistMylike?: { id?: number | string; name?: string; cover?: string; playcnt?: number; playCount?: number }[]; list?: { id?: number | string; name?: string; cover?: string; playcnt?: number; playCount?: number }[] } }>("playlist_mylike", { time: -1, limit: 30 });
    if (resp.body.code === 301) throw new Error("需要登录网易云账号");
    if (resp.body.code !== 200) throw new Error(`netease playlist mylike api error code: ${resp.body.code}`);
    const raw = resp.body.data?.playlistMylike ?? resp.body.data?.list ?? [];
    return raw
      .filter((p) => p.id !== undefined)
      .map((p) => ({
        source: "netease",
        id: String(p.id),
        name: (p.name ?? "").trim(),
        cover: p.cover ?? "",
        track_count: 0,
        play_count: Math.round(p.playcnt ?? p.playCount ?? 0),
        creator: "",
        description: "MLOG 视频歌单",
        link: `https://music.163.com/#/mlog/playlist?id=${p.id}`,
      }));
  },

  /** 专辑列表（album_list 全量 / album_list_style 精选变体） */
  async getAlbumList(area: string, style: string, page: number, limit: number): Promise<{ albums: Playlist[]; has_more: boolean }> {
    const l = Math.min(Math.max(limit, 1), 100);
    const areaMap: Record<string, string> = { 全部: "ALL", 华语: "ZH", 欧美: "EA", 日本: "JP", 韩国: "KR", 港台: "ZH" };
    const areaCode = areaMap[area.trim()] ?? "ALL";
    const moduleName = style.trim() ? "album_list_style" : "album_list";
    const styleAreaMap: Record<string, string> = { 全部: "Z_H", 华语: "Z_H", 欧美: "E_A", 日本: "JP", 韩国: "KR", 港台: "Z_H" };
    const resp = await invokeNcm<{ code?: number; albums?: { id?: number | string; name?: string; picUrl?: string; artist?: { name?: string } | { name?: string }[]; artists?: { name?: string }[]; size?: number; publishTime?: number }[]; hasMore?: boolean; total?: number }>(
      moduleName,
      {
        area: moduleName === "album_list_style" ? (styleAreaMap[area.trim()] ?? "Z_H") : areaCode,
        limit: l,
        offset: (page - 1) * l,
      },
    );
    if (resp.body.code !== 200) throw new Error(`netease album list api error code: ${resp.body.code}`);
    const albums = (resp.body.albums ?? [])
      .filter((a) => a.id !== undefined && String(a.id) !== "")
      .map((a) => {
        const artist = Array.isArray(a.artist)
          ? a.artist.map((x) => x.name ?? "").join("、")
          : (a.artist?.name ?? (a.artists ?? []).map((x) => x.name ?? "").join("、"));
        return {
          source: "netease",
          id: String(a.id),
          name: (a.name ?? "").trim(),
          cover: a.picUrl ?? "",
          track_count: a.size ?? 0,
          play_count: 0,
          creator: artist,
          description: a.publishTime ? new Date(a.publishTime).toISOString().slice(0, 10) : "",
          link: `https://music.163.com/#/album?id=${a.id}`,
        };
      });
    return { albums, has_more: resp.body.hasMore === true || albums.length >= l };
  },

  /** 歌单动态数（playlist_detail_dynamic：收藏/评论/分享徽标） */
  async getPlaylistDynamic(playlistId: string): Promise<{ play_count?: number; subscribed_count?: number; comment_count?: number; share_count?: number }> {
    /* 三审 R3：id 数字校验 */
    const pid = Number(playlistId);
    if (!Number.isFinite(pid)) throw new Error("歌单 id 必须为数字");
    const resp = await invokeNcm<{ code?: number; playCount?: number; subscribedCount?: number; commentCount?: number; shareCount?: number }>("playlist_detail_dynamic", { id: pid });
    if (resp.body.code !== 200) throw new Error(`netease playlist dynamic api error code: ${resp.body.code}`);
    return {
      play_count: resp.body.playCount,
      subscribed_count: resp.body.subscribedCount,
      comment_count: resp.body.commentCount,
      share_count: resp.body.shareCount,
    };
  },

  /** 专辑动态数（album_detail_dynamic） */
  async getAlbumDynamic(albumId: string): Promise<{ comment_count?: number; share_count?: number; on_sale?: boolean }> {
    /* 三审 R3：id 数字校验 */
    const aid = Number(albumId);
    if (!Number.isFinite(aid)) throw new Error("专辑 id 必须为数字");
    const resp = await invokeNcm<{ code?: number; commentCount?: number; shareCount?: number; onSale?: boolean }>("album_detail_dynamic", { id: aid });
    if (resp.body.code !== 200) throw new Error(`netease album dynamic api error code: ${resp.body.code}`);
    return { comment_count: resp.body.commentCount, share_count: resp.body.shareCount, on_sale: resp.body.onSale };
  },

  // ---- P1 C1：歌曲百科（song_wiki_info / song_wiki_summary / song_creators / song_music_detail / song_red_count / song_copyright_rcmd） ----

  /** 百科图文段落（song_wiki_info 主 + song_wiki_summary 兜底，容错解析活动型结构） */
  async getSongWiki(song: Song): Promise<SongWiki> {
    const songId = Number(song.id);
    const [infoRes, summaryRes] = await Promise.allSettled([
      invokeNcm<{ code?: number; data?: Record<string, unknown> }>("song_wiki_info", { id: songId }),
      invokeNcm<{ code?: number; data?: Record<string, unknown> }>("song_wiki_summary", { id: songId }),
    ]);
    const sections: { title: string; content: string }[] = [];
    const collectSections = (node: unknown, depth: number) => {
      if (depth > 6 || !node || typeof node !== "object" || sections.length >= 10) return;
      if (Array.isArray(node)) {
        for (const item of node) collectSections(item, depth + 1);
        return;
      }
      const obj = node as Record<string, unknown>;
      const title = typeof obj.title === "string" ? obj.title : typeof obj.blockTitle === "string" ? obj.blockTitle : undefined;
      const content =
        typeof obj.content === "string" ? obj.content :
        typeof obj.desc === "string" ? obj.desc :
        typeof obj.text === "string" ? obj.text : undefined;
      if (title && content && content.length > 8) sections.push({ title: title.trim(), content: content.trim() });
      for (const value of Object.values(obj)) {
        if (value && typeof value === "object") collectSections(value, depth + 1);
      }
    };
    for (const r of [infoRes, summaryRes]) {
      if (r.status === "fulfilled" && r.value.body.code === 200) collectSections(r.value.body.data, 0);
    }
    return { source: "netease", song_id: song.id, sections };
  },

  /** 创作人员名单（song_creators：角色分组） */
  async getSongCreators(song: Song): Promise<SongCreator[]> {
    const resp = await invokeNcm<{ code?: number; data?: { members?: { title?: string; artists?: { name?: string }[] }[] } | Record<string, unknown> }>("song_creators", { id: Number(song.id) });
    if (resp.body.code !== 200) throw new Error(`netease song creators api error code: ${resp.body.code}`);
    const creators: SongCreator[] = [];
    const collect = (node: unknown, depth: number, role?: string) => {
      if (depth > 5 || !node || typeof node !== "object" || creators.length >= 30) return;
      if (Array.isArray(node)) {
        for (const item of node) collect(item, depth + 1, role);
        return;
      }
      const obj = node as Record<string, unknown>;
      const name = typeof obj.name === "string" ? obj.name.trim() : "";
      const title = typeof obj.title === "string" ? obj.title : role;
      if (name && title) creators.push({ name, role: title });
      for (const value of Object.values(obj)) {
        if (value && typeof value === "object") collect(value, depth + 1, title);
      }
    };
    collect(resp.body.data, 0);
    return creators;
  },

  /** 歌曲详细信息（song_music_detail → 扁平元信息） */
  async getSongMusicDetail(song: Song): Promise<{ label: string; value: string }[]> {
    const resp = await invokeNcm<{ code?: number; data?: Record<string, unknown> }>("song_music_detail", { id: Number(song.id) });
    if (resp.body.code !== 200) throw new Error(`netease song music detail api error code: ${resp.body.code}`);
    /* 修复：上游键名为 h.br / m.size 之类内部缩写，直接展示可读性差——映射为中文标签、
       null 表示丢弃（md5 等无展示价值），码率/大小做单位换算 */
    const LABELS: Record<string, string | null> = {
      songId: "歌曲 ID",
      "h.br": "无损码率", "h.size": "无损大小", "h.sr": "采样率", "h.md5": null,
      "m.br": "高品质码率", "m.size": "高品质大小", "m.sr": null, "m.md5": null,
      "l.br": "标准码率", "l.size": "标准大小", "l.sr": null, "l.md5": null,
    };
    const prettyValue = (display: string, raw: string): string => {
      /* flattenReportCards 输出千分位字符串（"320,000"），先还原为数值再做单位换算 */
      const n = Number(String(raw).replace(/,/g, ""));
      if (!String(raw).trim() || !Number.isFinite(n)) return String(raw);
      if (display.includes("码率") && n > 1000) return `${Math.round(n / 1000)} kbps`;
      if (display.includes("大小") && n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
      if (display.includes("采样率")) return `${(n / 1000).toFixed(1)} kHz`;
      return String(raw);
    };
    return flattenReportCards(resp.body.data, 12)
      .map((c) => {
        const mapped = LABELS[c.label];
        if (mapped === null) return null; // 显式丢弃
        const label = mapped ?? c.label;
        /* 未映射的短缩写键（如 x.yy 形态）视为噪音丢弃 */
        if (mapped === undefined && /^[a-z]\.[a-z0-9]+$/i.test(c.label)) return null;
        const value = mapped !== undefined ? prettyValue(mapped, c.value) : c.value;
        if (value === undefined || value === "") return null;
        return { label, value: String(value) };
      })
      .filter((c): c is { label: string; value: string } => !!c);
  },

  /** 精彩（红）评论数（song_red_count） */
  async getSongRedCount(song: Song): Promise<number> {
    const resp = await invokeNcm<{ code?: number; data?: { redCount?: number } }>("song_red_count", { id: Number(song.id) });
    if (resp.body.code !== 200) throw new Error(`netease song red count api error code: ${resp.body.code}`);
    return resp.body.data?.redCount ?? 0;
  },

  /** 版权受限替代推荐（song_copyright_rcmd） */
  async getCopyrightSubstitutes(song: Song): Promise<Song[]> {
    const resp = await invokeNcm<{ code?: number; data?: { songs?: NeteaseSearchSong[] } | NeteaseSearchSong[] }>("song_copyright_rcmd", { id: Number(song.id) });
    if (resp.body.code !== 200) throw new Error(`netease copyright rcmd api error code: ${resp.body.code}`);
    const raw = Array.isArray(resp.body.data) ? resp.body.data : resp.body.data?.songs;
    return (raw ?? []).map(mapNeteaseTrackToSong);
  },

  // ---- P1 C2：歌手页增强（artist_detail / artist_detail_dynamic / artist_follow_count / artist_video / artist_sub / artist_sublist） ----

  /** 歌手头部统计与简介（artist_detail head + artist_detail_dynamic 粉丝数 + artist_follow_count） */
  async getArtistWiki(artistId: string): Promise<{ desc: string; follower_count?: number }> {
    const [headRes, dynamicRes] = await Promise.allSettled([
      invokeNcm<{ code?: number; data?: { artist?: { briefDesc?: string } } }>("artist_detail", { id: Number(artistId) }),
      invokeNcm<{ code?: number; followerCount?: number; fansCount?: number }>("artist_detail_dynamic", { id: Number(artistId) }),
    ]);
    let follower: number | undefined;
    if (dynamicRes.status === "fulfilled" && dynamicRes.value.body.code === 200) {
      follower = dynamicRes.value.body.followerCount ?? dynamicRes.value.body.fansCount;
    }
    if (follower === undefined) {
      /* artist_follow_count 兜底取精确粉丝数 */
      const fc = await invokeNcm<{ code?: number; data?: { followerCount?: number; cnt?: number } }>("artist_follow_count", { id: Number(artistId) });
      if (fc.body.code === 200) follower = fc.body.data?.followerCount ?? fc.body.data?.cnt;
    }
    let desc = "";
    if (headRes.status === "fulfilled" && headRes.value.body.code === 200) {
      desc = (headRes.value.body.data?.artist?.briefDesc ?? "").trim();
    }
    return { desc, follower_count: follower };
  },

  /** 关注/取关歌手（artist_sub） */
  async followArtist(artistId: string, follow: boolean): Promise<void> {
    const resp = await invokeNcm<{ code?: number }>("artist_sub", { id: Number(artistId), t: follow ? 1 : 0 });
    if (resp.body.code !== 200) throw new Error(follow ? "关注歌手失败" : "取消关注失败");
  },

  /** 已关注歌手列表（artist_sublist） */
  async getFollowedArtists(page: number, limit: number): Promise<{ artists: FollowedArtist[]; has_more: boolean }> {
    const l = Math.min(Math.max(limit, 1), 100);
    const resp = await invokeNcm<{ code?: number; data?: { id?: number; name?: string; picUrl?: string; img1v1Url?: string; alias?: string[]; brief?: string }[]; hasMore?: boolean; count?: number }>("artist_sublist", {
      limit: l,
      offset: (page - 1) * l,
    });
    if (resp.body.code === 301) throw new Error("需要登录网易云账号");
    if (resp.body.code !== 200) throw new Error(`netease artist sublist api error code: ${resp.body.code}`);
    const artists: FollowedArtist[] = (resp.body.data ?? [])
      .filter((a) => a.id !== undefined)
      .map((a) => ({
        source: "netease",
        id: String(a.id),
        name: (a.name ?? "").trim(),
        avatar: a.picUrl ?? a.img1v1Url ?? "",
        alias: (a.alias ?? []).filter(Boolean).join(" / "),
        brief: a.brief,
        followed: true,
        link: `https://music.163.com/#/artist?id=${a.id}`,
      }));
    return { artists, has_more: resp.body.hasMore === true || artists.length >= l };
  },

  /** 歌手视频（artist_video：cursor 分页，映射为 MvItem） */
  async getArtistVideos(artistId: string, page: number, limit: number): Promise<{ videos: MvItem[]; has_more: boolean }> {
    /* 修复：上游 data.records[].resource.mlogBaseData（threadId 前缀 R_MV_5_ 实为 MV 资源，
       走 MV 播放链路；R_MLOG_* 才是视频/mlog）。保留 datas[].data.vid 解析兜底。 */
    const resp = await invokeNcm<{
      code?: number;
      data?: {
        hasMore?: boolean;
        records?: { id?: number | string; resource?: { mlogBaseData?: { id?: number | string; text?: string; desc?: string; threadId?: string; coverUrl?: string; duration?: number; pubTime?: number; creator?: unknown } } }[];
        datas?: { data?: { vid?: number | string; title?: string; coverUrl?: string; duration?: number; playTime?: number; publishTime?: number; creator?: { nickname?: string } } }[];
      };
    }>("artist_video", {
      id: Number(artistId),
      size: Math.min(Math.max(limit, 1), 50),
      cursor: (page - 1) * limit,
    });
    if (resp.body.code !== 200) throw new Error(`netease artist video api error code: ${resp.body.code}`);

    const videos: MvItem[] = [];
    const records = resp.body.data?.records ?? [];
    for (const rec of records) {
      const m = rec.resource?.mlogBaseData;
      const rawId = String(m?.id ?? rec.id ?? "");
      if (!m || !rawId) continue;
      /* threadId 形如 R_MV_5_<id> / R_MLOG_5_<id>：R_MV 前缀按 MV 播放，其余按视频 */
      const isMvResource = (m.threadId ?? "").startsWith("R_MV_");
      const title = (m.text ?? m.desc ?? "").trim();
      videos.push({
        source: "netease",
        id: rawId,
        name: title || `视频 ${rawId}`,
        artist: "",
        cover: m.coverUrl ?? "",
        duration: Math.floor((m.duration ?? 0) / 1000),
        play_count: 0,
        publish_time: m.pubTime ? new Date(m.pubTime).toISOString().slice(0, 10) : undefined,
        extra: { kind: isMvResource ? "mv" : "video" },
      });
    }
    if (!videos.length) {
      for (const w of resp.body.data?.datas ?? []) {
        const v = w.data;
        if (!v?.vid) continue;
        videos.push({
          source: "netease",
          id: String(v.vid),
          name: (v.title ?? "").trim(),
          artist: v.creator?.nickname ?? "",
          cover: v.coverUrl ?? "",
          duration: Math.floor((v.duration ?? 0) / 1000),
          play_count: v.playTime ?? 0,
          publish_time: v.publishTime ? new Date(v.publishTime).toISOString().slice(0, 10) : undefined,
          extra: { kind: "video" },
        });
      }
    }
    return { videos, has_more: resp.body.data?.hasMore === true || videos.length >= limit };
  },

  // ---- P1 C3：评论体系增强（comment_new / comment_floor / comment_like / hug_comment / comment_album|playlist|mv|video|dj|event） ----

  /** 新版评论（comment_new 楼层结构；解析失败自动回退旧版 comment_music/多资源 comment_*） */
  async getCommentsV2(target: CommentTarget, opts): Promise<CommentListResult> {
    const l = Math.min(Math.max(opts.limit, 1), 50);
    /* 三审 R3：page 钳制（C-07 模式补覆盖；page=0 时原 offset 为负） */
    const p = Math.max(opts.page, 1);
    const sortType = opts.sort === "new" ? 3 : 99; /* 99=推荐/热度 3=时间 */
    try {
      const resp = await invokeNcm<{ code?: number; data?: { comments?: (NcmRawComment & { commentId?: number | string })[]; hasMore?: boolean; totalCount?: number } }>("comment_new", {
        type: ncmCommentTypeOf(target.type),
        id: target.id,
        pageNo: p,
        pageSize: l,
        sortType,
      });
      if (resp.body.code !== 200 || !resp.body.data?.comments) throw new Error("fallback to legacy");
      const comments = resp.body.data.comments.map(mapNeteaseComment);
      return {
        comments,
        total: resp.body.data.totalCount ?? comments.length,
        has_more: resp.body.data.hasMore === true,
      };
    } catch {
      /* 新版结构异常 → 旧版多资源接口兜底（song→comment_music，album→comment_album …） */
      const legacy: Record<CommentTarget["type"], string> = {
        song: "comment_music",
        album: "comment_album",
        playlist: "comment_playlist",
        mv: "comment_mv",
        video: "comment_video",
        dj: "comment_dj",
      };
      const resp = await invokeNcm<NcmCommentBody>(legacy[target.type], {
        id: target.id,
        limit: l,
        offset: (p - 1) * l,
        before: 0,
      });
      if (resp.body.code === 301) throw new Error("评论需要登录网易云账号");
      if (resp.body.code !== 200) throw new Error(`netease ${legacy[target.type]} api error code: ${resp.body.code}`);
      /* 设计取舍（三审 R3 登记）：热评走 legacy 兜底时上游无热评分页语义，
         slice 首两页 + has_more=false（前端"加载更多"仅对最新排序生效） */
      const raw = opts.sort === "new" ? resp.body.comments : (resp.body.hotComments ?? resp.body.comments ?? []);
      const sliced = opts.sort === "new" ? raw : (raw ?? []).slice(0, l * 2);
      const comments = (sliced ?? []).map(mapNeteaseComment);
      return { comments, total: resp.body.total ?? comments.length, has_more: opts.sort === "new" ? resp.body.more === true : false };
    }
  },

  /** 楼层回复详情（comment_floor） */
  async getCommentFloor(target: CommentTarget, parentCommentId: string, page: number, limit: number): Promise<CommentListResult> {
    const l = Math.min(Math.max(limit, 1), 50);
    const resp = await invokeNcm<{ code?: number; data?: { comments?: NcmRawComment[]; hasMore?: boolean; totalCount?: number } }>("comment_floor", {
      parentCommentId: Number(parentCommentId),
      type: ncmCommentTypeOf(target.type),
      id: target.id,
      time: -1,
      limit: l,
    });
    if (resp.body.code !== 200) throw new Error(`netease comment floor api error code: ${resp.body.code}`);
    const comments = (resp.body.data?.comments ?? []).map(mapNeteaseComment);
    return { comments, total: resp.body.data?.totalCount ?? comments.length, has_more: resp.body.data?.hasMore === true };
  },

  /** 点赞评论（comment_like：t 1/0） */
  async likeComment(target: CommentTarget, commentId: string, like: boolean): Promise<void> {
    const resp = await invokeNcm<{ code?: number }>("comment_like", {
      cid: Number(commentId),
      t: like ? 1 : 0,
      type: ncmCommentTypeOf(target.type),
      id: target.id,
    });
    if (resp.body.code !== 200) throw new Error(like ? "点赞失败" : "取消点赞失败");
  },

  /** 抱抱评论（hug_comment：需评论作者 uid） */
  async hugComment(target: CommentTarget, commentId: string, targetUserId: string): Promise<void> {
    const resp = await invokeNcm<{ code?: number }>("hug_comment", {
      uid: Number(targetUserId),
      cid: Number(commentId),
      type: ncmCommentTypeOf(target.type),
      sid: target.id,
    });
    if (resp.body.code !== 200) throw new Error("抱抱失败");
  },

  // ---- P1 C4：播放增强（playmode_intelligence_list / playlist_track_all / playlist_order_update / song_order_update / simi_user） ----

  /** 心动模式智能队列（playmode_intelligence_list：以种子歌曲生成） */
  async getIntelligenceList(seed: Song): Promise<Song[]> {
    const resp = await invokeNcm<{ code?: number; data?: NeteaseSearchSong[] }>("playmode_intelligence_list", {
      id: Number(seed.id),
      pid: "",
      sid: Number(seed.id),
      count: 20,
    });
    if (resp.body.code !== 200) throw new Error(`netease intelligence api error code: ${resp.body.code}`);
    return (resp.body.data ?? []).map(mapNeteaseTrackToSong);
  },

  /** 大歌单增量分页（playlist_track_all：曲目分页不落全量） */
  async getAllPlaylistTracks(playlistId: string, page: number, limit: number): Promise<{ songs: Song[]; has_more: boolean }> {
    const l = Math.min(Math.max(limit, 1), 1000);
    const resp = await invokeNcm<{ code?: number; songs?: NeteaseSearchSong[]; privileges?: unknown[] }>("playlist_track_all", {
      id: Number(playlistId),
      limit: l,
      offset: (page - 1) * l,
    });
    if (resp.body.code !== 200) throw new Error(`netease playlist track all api error code: ${resp.body.code}`);
    const songs = (resp.body.songs ?? []).map(mapNeteaseTrackToSong);
    return { songs, has_more: songs.length >= l };
  },

  /** 歌单排序（playlist_order_update：ids 逗号串） */
  async updatePlaylistOrder(playlistIds: string[]): Promise<void> {
    const resp = await invokeNcm<{ code?: number }>("playlist_order_update", { ids: playlistIds.join(",") });
    if (resp.body.code !== 200) throw new Error(`歌单排序失败 (code: ${resp.body.code})`);
  },

  /** 红心歌曲排序（song_order_update：pid = 我喜欢的歌单，取自 user_playlist 首项） */
  async updateLikedSongOrder(songIds: string[]): Promise<void> {
    const uid = await resolveOwnNeteaseUid();
    const pl = await invokeNcm<{ code?: number; playlist?: { id?: number }[] }>("user_playlist", { uid: Number(uid), limit: 1, offset: 0 });
    const pid = pl.body.playlist?.[0]?.id;
    if (!pid) throw new Error("未找到「我喜欢的音乐」歌单");
    const resp = await invokeNcm<{ body?: { code?: number }; code?: number }>("song_order_update", {
      pid,
      ids: songIds.join(","),
    });
    const code = (resp as { body?: { code?: number } }).body?.code ?? (resp as { code?: number }).code;
    if (code !== 200) throw new Error(`红心排序失败 (code: ${code})`);
  },

  /** 听过此歌的用户（simi_user） */
  async getSimilarUsers(song: Song): Promise<FollowUser[]> {
    const resp = await invokeNcm<{ code?: number; userprofiles?: { userId?: number; nickname?: string; avatarUrl?: string; signature?: string; mutual?: boolean }[] }>("simi_user", {
      id: Number(song.id),
      limit: 20,
      offset: 0,
    });
    if (resp.body.code !== 200) throw new Error(`netease simi user api error code: ${resp.body.code}`);
    return (resp.body.userprofiles ?? [])
      .filter((u) => u.userId)
      .map((u) => ({
        source: "netease",
        id: String(u.userId),
        nickname: (u.nickname ?? "").trim(),
        avatar: u.avatarUrl ?? "",
        signature: u.signature ?? "",
        mutual: u.mutual,
        link: `https://music.163.com/#/user/home?id=${u.userId}`,
      }));
  },

  // ---- P1 C5：搜索二期（search_multimatch 多类型匹配） ----

  /** 多类型匹配（search_multimatch：song/artist/album/playlist 直达卡素材） */
  async getSearchMultimatch(keyword: string): Promise<SearchMultimatch> {
    /* 修复：模块入参键为 keywords（原传 s 被忽略→上游 400）；响应各类型数组直接挂在 result 下
       （原按 song.songs / artist.artists 双层读取恒为空） */
    const resp = await invokeNcm<{
      code?: number;
      result?: {
        song?: NeteaseSearchSong[];
        artist?: { id?: number; name?: string; picUrl?: string; img1v1Url?: string }[];
        album?: { id?: number; name?: string; picUrl?: string; artist?: { name?: string } }[];
        playlist?: { id?: number; name?: string; coverImgUrl?: string }[];
      };
    }>("search_multimatch", { type: 1, keywords: keyword });
    if (resp.body.code !== 200) throw new Error(`netease multimatch api error code: ${resp.body.code}`);
    const raw = resp.body.result ?? {};
    const result: SearchMultimatch = {};
    const songs = (raw.song ?? []).slice(0, 3).map(mapNeteaseTrackToSong);
    const artists = (raw.artist ?? []).slice(0, 3).map((a) => ({
      source: "netease" as const,
      id: String(a.id ?? ""),
      name: (a.name ?? "").trim(),
      avatar: a.picUrl ?? a.img1v1Url ?? "",
    }));
    const albums = (raw.album ?? []).slice(0, 3).map((al) => ({
      source: "netease" as const,
      id: String(al.id ?? ""),
      name: (al.name ?? "").trim(),
      cover: al.picUrl ?? "",
      track_count: 0,
      play_count: 0,
      creator: al.artist?.name ?? "",
      description: "",
      link: `https://music.163.com/#/album?id=${al.id}`,
    }));
    const playlists = (raw.playlist ?? []).slice(0, 3).map((pl) => ({
      source: "netease" as const,
      id: String(pl.id ?? ""),
      name: (pl.name ?? "").trim(),
      cover: pl.coverImgUrl ?? "",
      track_count: 0,
      play_count: 0,
      creator: "",
      description: "",
      link: `https://music.163.com/#/playlist?id=${pl.id}`,
    }));
    if (songs.length) {
      const s = songs[0];
      result.card = { type: "song", id: s.id, name: s.name, cover: s.cover, artist: s.artist };
      result.songs = songs;
    } else if (artists.length) {
      result.card = { type: "artist", id: artists[0].id, name: artists[0].name, cover: artists[0].avatar };
      result.artists = artists;
    } else if (albums.length) {
      result.card = { type: "album", id: albums[0].id, name: albums[0].name, cover: albums[0].cover, artist: albums[0].creator };
      result.albums = albums;
    } else if (playlists.length) {
      result.card = { type: "playlist", id: playlists[0].id, name: playlists[0].name, cover: playlists[0].cover };
      result.playlists = playlists;
    }
    return result;
  },

  // ---- P1 C6：账号管理增强（login_refresh / register_anonimous / countries_code_list） ----

  /** 刷新登录态（login_refresh：CSRF token 续期并合并 cookie） */
  async refreshLogin(): Promise<void> {
    const resp = await invokeNcm<{ code?: number }>("login_refresh");
    if (resp.body.code !== 200) throw new Error(`登录态刷新失败 (code: ${resp.body.code})`);
  },

  /** 匿名注册（register_anonimous：返回匿名凭证 cookie 串） */
  async registerAnonymous(): Promise<string> {
    const resp = await invokeNcm<{ code?: number; cookie?: string }>("register_anonimous");
    if (resp.body.code !== 200 || !resp.body.cookie) throw new Error("匿名注册失败");
    return normalizeSourceCookieString(resp.body.cookie);
  },

  /** 国际区号列表（countries_code_list；上游为「字母分组 → countryList」两级结构） */
  async getCountryCodes(): Promise<CountryCode[]> {
    const resp = await invokeNcm<{
      code?: number;
      data?: { countryCode?: string; countryName?: string; countryNameZh?: string; label?: string; countryList?: { zh?: string; en?: string; locale?: string; code?: string }[] }[];
    }>("countries_code_list");
    if (resp.body.code !== 200) throw new Error(`netease countries api error code: ${resp.body.code}`);
    const out: CountryCode[] = [];
    for (const group of resp.body.data ?? []) {
      if (Array.isArray(group.countryList)) {
        /* 分组结构：{ label: "A", countryList: [{ zh, en, locale, code }] } */
        for (const c of group.countryList) {
          const code = (c.code ?? "").trim();
          if (!code) continue;
          out.push({ code, name: (c.en ?? "").trim(), zh_name: c.zh });
        }
      } else if (group.countryCode) {
        /* 兼容扁平结构 */
        out.push({ code: (group.countryCode ?? "").trim(), name: (group.countryName ?? "").trim(), zh_name: group.countryNameZh });
      }
    }
    return out;
  },

  // ---- P1 C7：MV/视频增强（mv_sub / mv_sublist / simi_mv / video_detail / video_detail_info / video_url / related_allvideo） ----

  /** 收藏/取消收藏 MV（mv_sub） */
  async subMv(mvId: string, sub: boolean): Promise<void> {
    const resp = await invokeNcm<{ code?: number }>("mv_sub", { mvid: Number(mvId), t: sub ? 1 : 0 });
    if (resp.body.code !== 200) throw new Error(sub ? "收藏 MV 失败" : "取消收藏失败");
  },

  /** 收藏 MV 列表（mv_sublist） */
  async getSubbedMvs(page: number, limit: number): Promise<{ mvs: MvItem[]; has_more: boolean }> {
    const l = Math.min(Math.max(limit, 1), 100);
    const resp = await invokeNcm<{ code?: number; data?: { id?: number | string; name?: string; cover?: string; duration?: number; playTime?: number; artistName?: string; artists?: { name?: string }[] }[]; hasMore?: boolean; count?: number }>("mv_sublist", {
      limit: l,
      offset: (page - 1) * l,
    });
    if (resp.body.code === 301) throw new Error("需要登录网易云账号");
    if (resp.body.code !== 200) throw new Error(`netease mv sublist api error code: ${resp.body.code}`);
    const mvs: MvItem[] = (resp.body.data ?? [])
      .filter((m) => m.id !== undefined)
      .map((m) => ({
        source: "netease",
        id: String(m.id),
        name: (m.name ?? "").trim(),
        artist: m.artistName ?? (m.artists ?? []).map((a) => a.name ?? "").join("、"),
        cover: m.cover ?? "",
        duration: Math.floor((m.duration ?? 0) / 1000),
        play_count: m.playTime ?? 0,
      }));
    return { mvs, has_more: resp.body.hasMore === true || mvs.length >= l };
  },

  /** 相似 MV（simi_mv） */
  async getSimilarMvs(mvId: string): Promise<MvItem[]> {
    const resp = await invokeNcm<{ code?: number; mvs?: { id?: number | string; name?: string; cover?: string; duration?: number; playCount?: number; artistName?: string; artists?: { name?: string }[] }[] }>("simi_mv", { mvid: Number(mvId) });
    if (resp.body.code !== 200) throw new Error(`netease simi mv api error code: ${resp.body.code}`);
    return (resp.body.mvs ?? [])
      .filter((m) => m.id !== undefined)
      .map((m) => ({
        source: "netease",
        id: String(m.id),
        name: (m.name ?? "").trim(),
        artist: m.artistName ?? (m.artists ?? []).map((a) => a.name ?? "").join("、"),
        cover: m.cover ?? "",
        duration: Math.floor((m.duration ?? 0) / 1000),
        play_count: m.playCount ?? 0,
      }));
  },

  /** 视频详情（video_detail 主信息 + video_detail_info 播放/点赞统计；mlog id 自动转换） */
  async getVideoDetail(videoId: string): Promise<MvItem> {
    try {
      return await videoDetailById(videoId);
    } catch (primaryErr) {
      /* mlog id 兜底：转换为真实视频 id 后重试（部分视频流条目是 mlog 资源） */
      try {
        const conv = await invokeNcm<{ code?: number; data?: string | number; pid?: string | number; vid?: string | number }>("mlog_to_video", { id: videoId });
        const converted = conv.body.data ?? conv.body.pid ?? conv.body.vid;
        if (converted !== undefined && converted !== null && String(converted) !== videoId) {
          return await videoDetailById(String(converted));
        }
      } catch {
        /* 转换失败透传主错误 */
      }
      throw primaryErr;
    }
  },

  /** 视频播放链接（video_url 多分辨率；mlog id 自动转换） */
  async getVideoUrl(videoId: string, resolution = 1080): Promise<string> {
    const fetchUrl = async (id: string) => {
      const resp = await invokeNcm<{ code?: number; urls?: { id?: string; url?: string; r?: number }[] }>("video_url", { id, r: resolution });
      if (resp.body.code !== 200) throw new Error(`netease video url api error code: ${resp.body.code}`);
      const url = resp.body.urls?.[0]?.url;
      if (!url) throw new Error("视频链接不可用");
      return url;
    };
    try {
      return await fetchUrl(videoId);
    } catch (primaryErr) {
      /* mlog id 兜底：转换为真实视频 id 后重试 */
      try {
        const conv = await invokeNcm<{ code?: number; data?: string | number; pid?: string | number; vid?: string | number }>("mlog_to_video", { id: videoId });
        const converted = conv.body.data ?? conv.body.pid ?? conv.body.vid;
        if (converted !== undefined && converted !== null && String(converted) !== videoId) {
          return await fetchUrl(String(converted));
        }
      } catch {
        /* 转换失败透传主错误 */
      }
      throw primaryErr;
    }
  },

  /** 相关视频（related_allvideo：MV/视频混合推荐） */
  async getRelatedVideos(videoId: string): Promise<MvItem[]> {
    const resp = await invokeNcm<{ code?: number; datas?: { data?: { vid?: number | string; title?: string; coverUrl?: string; durationms?: number; playTime?: number; creator?: { nickname?: string } } }[] }>("related_allvideo", { id: videoId });
    if (resp.body.code !== 200) throw new Error(`netease related allvideo api error code: ${resp.body.code}`);
    return (resp.body.datas ?? [])
      .map((w) => w.data)
      .filter((v): v is NonNullable<typeof v> => !!v?.vid)
      .map((v) => ({
        source: "netease",
        id: String(v.vid),
        name: (v.title ?? "").trim(),
        artist: v.creator?.nickname ?? "",
        cover: v.coverUrl ?? "",
        duration: Math.floor((v.durationms ?? 0) / 1000),
        play_count: v.playTime ?? 0,
        extra: { kind: "video" },
      }));
  },
};
