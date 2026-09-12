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
} from "../types";
import { UpstreamError } from "../types";
import { invokeNcm } from "../netease";
import { createRequest } from "../netease/request";
import { cookieToJson } from "../netease/utils";
import { normalizeSourceCookieString } from "../source-session";
import { md5hex } from "../crypto";
import { parseLrcVerbatim, parseYrcData, convertVerbatimLRC, type VMultiData } from "../lyrics";
import { getCookie } from "../cookies";

// ---------------------------------------------------------------------------
// VIP eapi 高音质下载链（保留缓存策略；加密与请求改走 lib/netease/request）
// ---------------------------------------------------------------------------

interface CachedDownloadURL {
  url: string;
  ext: string;
  expiresAt: number;
}

/** key = songID:levels:md5(cookie)，TTL 10 分钟 */
const downloadURLCache = new Map<string, CachedDownloadURL>();

const neteaseVipCache = new Map<string, { isVip: boolean; expiresAt: number }>();

/** weapi/nuser/account/get → profile.vipType，10 分钟缓存（底层走 user_account 模块） */
async function isNeteaseVipAccount(): Promise<boolean> {
  const cookie = getCookie("netease");
  if (!cookie.trim()) return false;

  const key = md5hex(cookie);
  const cached = neteaseVipCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.isVip;

  try {
    const resp = await invokeNcm<{ code?: number; profile?: { vipType?: number } }>("user_account");
    const isVip = resp.body.code === 200 && (resp.body.profile?.vipType ?? 0) !== 0;
    neteaseVipCache.set(key, { isVip, expiresAt: Date.now() + 10 * 60_000 });
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
      timeout: 0,
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
  user?: { nickname?: string; avatarUrl?: string };
  beReplied?: { content?: string; user?: { nickname?: string } }[];
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

    // VIP eapi 高音质链（levels 逐级 + 10 分钟缓存）
    if (cookie.trim() && (await isNeteaseVipAccount())) {
      const cacheKey = `${songId}:${levels.join(",")}:${md5hex(cookie)}`;
      const cached = downloadURLCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        if (cached.ext) song.ext = cached.ext;
        return cached.url;
      }

      for (const level of levels) {
        try {
          const { url, ext } = await getEAPIDownloadURL(songId, level, cookie);
          if (url) {
            if (ext) song.ext = ext;
            downloadURLCache.set(cacheKey, { url, ext, expiresAt: Date.now() + 10 * 60_000 });
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
        timeout: 0,
      },
    );
    const item = resp.body.data?.[0];
    const url = item?.url;
    if (!url) throw new Error("netease: 未获取到播放链接（可能是 VIP / 版权受限）");
    /* weapi 回退固定 mp3 码率档：缓存 ext 按实际格式（eapi 链路可能已把 song.ext 置为 flac，直接沿用会失真） */
    const fallbackExt = normalizeNeteaseAudioType(item?.type ?? "", "exhigh") || "mp3";
    if (!song.ext || song.ext === "flac") song.ext = fallbackExt;
    downloadURLCache.set(`${songId}:${levels.join(",")}:${md5hex(cookie)}`, {
      url,
      ext: fallbackExt,
      expiresAt: Date.now() + 10 * 60_000,
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
};
