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
} from "../types";
import { invokeNcm } from "../netease";
import { createRequest } from "../netease/request";
import { cookieToJson } from "../netease/utils";
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

/** extra 指定单曲级别，默认 lossless → hires → exhigh */
function preferredDownloadLevels(song: Song): string[] {
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

  async getStreamUrl(song: Song): Promise<string> {
    const songId = song.extra?.song_id || song.id;
    const cookie = getCookie("netease");
    const levels = preferredDownloadLevels(song);

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
    const resp = await createRequest<{ data?: { url?: string; code?: number }[] }>(
      "/api/song/enhance/player/url",
      { ids: [songId], br: 320000 },
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
    const url = resp.body.data?.[0]?.url;
    if (!url) throw new Error("netease: 未获取到播放链接（可能是 VIP / 版权受限）");
    downloadURLCache.set(`${songId}:${levels.join(",")}:${md5hex(cookie)}`, {
      url,
      ext: song.ext ?? "",
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
      const cookieStr = (resp.body.cookie ?? "").trim();
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
