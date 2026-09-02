/**
 * Apple Music Provider — 逐行移植自 music-lib/apple/apple.go，
 * 走 amp-api.music.apple.com（从官网 index-legacy js 抓取匿名 Bearer token）。
 */
import type { MusicProvider, Playlist, PlaylistCategory, PlaylistDetail, Song } from "../types";
import { httpGetJSON, httpGetText } from "../http";
import { getCookie } from "../cookies";

const APPLE_HOMEPAGE = "https://music.apple.com";
const AMP_API = "https://amp-api.music.apple.com";
const DEFAULT_STOREFRONT = "us";

/** token 缓存（对齐 Apple.token 字段） */
let cachedToken = "";

interface AppleArtwork {
  url?: string;
  width?: number;
  height?: number;
}

interface AppleSongAttributes {
  name?: string;
  artistName?: string;
  albumName?: string;
  durationInMillis?: number;
  artwork?: AppleArtwork;
  url?: string;
  previews?: { url?: string }[];
  extendedAssetUrls?: { enhancedHls?: string };
  isrc?: string;
}

interface AppleAlbumAttributes {
  name?: string;
  artistName?: string;
  trackCount?: number;
  artwork?: AppleArtwork;
  url?: string;
  releaseDate?: string;
  recordLabel?: string;
  editorialNotes?: { short?: string };
}

interface ApplePlaylistAttributes {
  name?: string;
  curatorName?: string;
  trackCount?: number;
  artwork?: AppleArtwork;
  url?: string;
  description?: { short?: string; standard?: string };
  editorialNotes?: { short?: string; standard?: string };
  lastModifiedDate?: string;
}

interface AppleResource {
  id?: string;
  type?: string;
  attributes?: Record<string, unknown>;
  relationships?: {
    tracks?: { data?: AppleResource[]; href?: string; next?: string };
    lyrics?: { data?: { attributes?: { ttml?: string } }[] };
  };
}

function coverURL(artwork: AppleArtwork | undefined, size: number): string {
  if (!artwork?.url) return "";
  const s = String(size);
  return artwork.url.replaceAll("{w}", s).replaceAll("{h}", s);
}

/** 对齐 New(cookie)：从 cookie 串解析 media-user-token / token / storefront */
function parseConfig(): { cookie: string; token: string; storefront: string } {
  const raw = getCookie("apple");
  let cookie = raw;
  let token = "";
  let storefront = DEFAULT_STOREFRONT;
  if (raw) {
    const parts = parseCookieParts(raw);
    if (parts["media-user-token"]) cookie = parts["media-user-token"];
    if (parts["storefront"]) storefront = parts["storefront"];
    if (parts["token"]) token = parts["token"];
  }
  return { cookie, token, storefront };
}

function parseCookieParts(cookie: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of cookie.split(";")) {
    const t = part.trim();
    const idx = t.indexOf("=");
    if (idx > 0) {
      const key = t.slice(0, idx).trim();
      const val = t.slice(idx + 1).trim();
      result[key] = val;
    }
  }
  return result;
}

/** 对齐 fetchAppleToken：官网首页 → index-legacy*.js → eyJh 开头的 JWT */
async function fetchAppleToken(): Promise<string> {
  const body = await httpGetText(APPLE_HOMEPAGE, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  });
  const match = body.match(/\/(assets\/index-legacy[~\-][^/"]+\.js)/);
  if (!match) throw new Error("apple: index.js URI not found");

  const jsBody = await httpGetText(`${APPLE_HOMEPAGE}/${match[1]}`, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  });
  const tokenMatch = jsBody.match(/[=["'](eyJh[^"']+)/);
  if (!tokenMatch) throw new Error("apple: token not found in index.js");
  return tokenMatch[1];
}

async function ensureToken(config: { token: string }): Promise<string> {
  if (config.token) return config.token;
  if (!cachedToken) {
    cachedToken = await fetchAppleToken();
  }
  return cachedToken;
}

async function ampHeaders(): Promise<Record<string, string>> {
  const config = parseConfig();
  const token = await ensureToken(config);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Origin: APPLE_HOMEPAGE,
  };
  if (config.cookie) headers.Cookie = `media-user-token=${config.cookie}`;
  return headers;
}

async function ampGet<T>(uri: string, params?: URLSearchParams): Promise<T> {
  let fullURL = uri.startsWith("/") ? AMP_API + uri : uri;
  if (params && [...params.keys()].length > 0) fullURL += "?" + params.toString();
  return httpGetJSON<T>(fullURL, { headers: await ampHeaders() });
}

// ---------- 转换 ----------

function songFromCatalog(res: AppleResource): Song {
  const attr = (res.attributes ?? {}) as AppleSongAttributes;
  const previewURL = attr.previews?.[0]?.url ?? "";
  return {
    source: "apple",
    id: res.id ?? "",
    name: attr.name ?? "",
    artist: attr.artistName ?? "",
    album: attr.albumName ?? "",
    duration: Math.floor((attr.durationInMillis ?? 0) / 1000),
    size: 0,
    bitrate: 0,
    url: previewURL,
    cover: coverURL(attr.artwork, 600),
    link: attr.url ?? "",
    ext: "m4a",
    extra: { isrc: attr.isrc ?? "" },
  };
}

function albumToPlaylist(res: AppleResource): Playlist {
  const attr = (res.attributes ?? {}) as AppleAlbumAttributes;
  return {
    source: "apple",
    id: res.id ?? "",
    name: attr.name ?? "",
    cover: coverURL(attr.artwork, 300),
    track_count: attr.trackCount ?? 0,
    play_count: 0,
    creator: attr.artistName ?? "",
    description: attr.editorialNotes?.short ?? "",
    link: attr.url ?? "",
    extra: {
      release_date: attr.releaseDate ?? "",
      record_label: attr.recordLabel ?? "",
    },
  };
}

function playlistToPlaylist(res: AppleResource): Playlist {
  const attr = (res.attributes ?? {}) as ApplePlaylistAttributes;
  let description = attr.description?.short ?? "";
  if (!description) description = attr.description?.standard ?? "";
  if (!description) description = attr.editorialNotes?.short ?? "";
  if (!description) description = attr.editorialNotes?.standard ?? "";
  return {
    source: "apple",
    id: res.id ?? "",
    name: attr.name ?? "",
    cover: coverURL(attr.artwork, 300),
    track_count: attr.trackCount ?? 0,
    play_count: 0,
    creator: attr.curatorName ?? "",
    description,
    link: attr.url ?? "",
  };
}

// ---------- ID 提取 ----------

function isRawID(value: string, mediaType: string): boolean {
  if (/[/?#]/.test(value) || value.includes("://")) return false;
  if (mediaType === "playlist") {
    if (value.startsWith("pl.")) return /^[a-zA-Z0-9._-]+$/.test(value);
    return /^[a-zA-Z0-9_-]+$/.test(value);
  }
  return /^\d+$/.test(value);
}

function extractIDFromPath(path: string, mediaType: string): string {
  const segments = path.replace(/^\/+|\/+$/g, "").split("/");
  if (!segments[0] && segments.length === 0) return "";
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment !== mediaType && segment !== mediaType + "s") continue;
    if (i + 2 < segments.length) return segments[i + 2];
    if (i + 1 < segments.length) return segments[i + 1];
  }
  return "";
}

/** 对齐 extractAppleID */
function extractAppleID(link: string, mediaType: string): string {
  const trimmed = link.trim();
  if (!trimmed) return "";

  if (isRawID(trimmed, mediaType)) return trimmed;

  let parsedPath = "";
  let queryI = "";
  try {
    const u = new URL(trimmed);
    parsedPath = u.pathname;
    queryI = u.searchParams.get("i") ?? "";
  } catch {
    // 非 URL，走正则兜底
  }
  if (parsedPath) {
    if (mediaType === "song" && queryI.trim()) return queryI.trim();
    const id = extractIDFromPath(parsedPath, mediaType);
    if (id) return id;
  }

  const patterns = [
    new RegExp(`${mediaType}/[^/]+/(\\d+)`),
    new RegExp(`${mediaType}s?/[^/]+/[^/]+/(\\d+)`),
    /\/(\d+)$/,
    /[?&]i=(\d+)/,
  ];
  if (mediaType === "playlist") {
    patterns.push(/playlists?\/[^/?#]+\/([a-zA-Z0-9._-]+)/, /playlists?\/([a-zA-Z0-9._-]+)(?:[?#]|$)/);
  }
  for (const p of patterns) {
    const m = trimmed.match(p);
    if (m) return m[1];
  }
  return "";
}

/** 对齐 fetchAllTrackResources：跟随 next 分页拉全量 tracks */
async function fetchAllTrackResources(tracks: { data?: AppleResource[]; next?: string }): Promise<AppleResource[]> {
  const all = [...(tracks.data ?? [])];
  let nextURI = (tracks.next ?? "").trim();
  while (nextURI) {
    const page = await ampGet<{ data?: AppleResource[]; next?: string }>(nextURI);
    all.push(...(page.data ?? []));
    nextURI = (page.next ?? "").trim();
  }
  return all;
}

async function fetchPlaylistDetail(playlistID: string): Promise<PlaylistDetail> {
  const { storefront } = parseConfig();
  const params = new URLSearchParams({ "limit[tracks]": "300", extend: "extendedAssetUrls" });
  const resp = await ampGet<{ data?: AppleResource[] }>(
    `/v1/catalog/${storefront}/playlists/${playlistID}`,
    params,
  );
  const item = resp.data?.[0];
  if (!item) throw new Error(`apple playlist not found: ${playlistID}`);

  const tracks = await fetchAllTrackResources(item.relationships?.tracks ?? {});
  const itemWithTracks: AppleResource = {
    ...item,
    relationships: { ...item.relationships, tracks: { ...item.relationships?.tracks, data: tracks } },
  };

  const pl = playlistToPlaylist(itemWithTracks);
  const songs = tracks.map((t) => songFromCatalog(t));
  if (pl.track_count === 0 || songs.length > pl.track_count) pl.track_count = songs.length;
  return { playlist: pl, songs };
}

/** 对齐 GetPlaylistCategories 的静态 curator 分类 */
const CURATOR_CATEGORIES: PlaylistCategory[] = [
  { id: "1526756058", name: "热门", source: "apple", group: "", count: 0 },
  { id: "1479949880", name: "C-Pop", source: "apple", group: "", count: 0 },
  { id: "1019400042", name: "国语流行", source: "apple", group: "", count: 0 },
  { id: "1019398918", name: "粤语流行", source: "apple", group: "", count: 0 },
  { id: "1019399540", name: "国际流行", source: "apple", group: "", count: 0 },
  { id: "1019399551", name: "K-Pop", source: "apple", group: "", count: 0 },
  { id: "1019399547", name: "J-Pop", source: "apple", group: "", count: 0 },
  { id: "989061415", name: "嘻哈/说唱", source: "apple", group: "", count: 0 },
  { id: "1019400044", name: "R&B", source: "apple", group: "", count: 0 },
  { id: "1019400046", name: "摇滚", source: "apple", group: "", count: 0 },
  { id: "1019397973", name: "另类音乐", source: "apple", group: "", count: 0 },
  { id: "976439535", name: "舞曲", source: "apple", group: "", count: 0 },
  { id: "976439536", name: "电子", source: "apple", group: "", count: 0 },
  { id: "976439541", name: "独立音乐", source: "apple", group: "", count: 0 },
  { id: "1019399549", name: "爵士乐", source: "apple", group: "", count: 0 },
  { id: "1019398924", name: "古典音乐", source: "apple", group: "", count: 0 },
  { id: "976439528", name: "蓝调", source: "apple", group: "", count: 0 },
  { id: "976439534", name: "乡村音乐", source: "apple", group: "", count: 0 },
  { id: "1531542847", name: "拉丁音乐", source: "apple", group: "", count: 0 },
  { id: "988656348", name: "非洲音乐", source: "apple", group: "", count: 0 },
  { id: "976439543", name: "金属乐", source: "apple", group: "", count: 0 },
  { id: "976439550", name: "朋克乐", source: "apple", group: "", count: 0 },
  { id: "1019400049", name: "不插电", source: "apple", group: "", count: 0 },
  { id: "1231181168", name: "影视原声", source: "apple", group: "", count: 0 },
  { id: "1441811365", name: "DJ 混音精选", source: "apple", group: "", count: 0 },
  { id: "1532467784", name: "瞩目之星", source: "apple", group: "", count: 0 },
  { id: "1554938339", name: "年代之声", source: "apple", group: "", count: 0 },
  { id: "1564180390", name: "空间音频", source: "apple", group: "", count: 0 },
  { id: "989010186", name: "亲子", source: "apple", group: "", count: 0 },
];

/** 对齐 Parse：单曲详情（含 preview 直链） */
async function parseAppleSong(link: string): Promise<Song> {
  const { storefront } = parseConfig();
  const songID = extractAppleID(link, "song");
  if (!songID) throw new Error(`invalid apple music song link: ${link}`);

  const params = new URLSearchParams({ extend: "extendedAssetUrls", include: "lyrics,albums" });
  const resp = await ampGet<{ data?: AppleResource[] }>(
    `/v1/catalog/${storefront}/songs/${songID}`,
    params,
  );
  if (!resp.data?.length) throw new Error(`apple song not found: ${songID}`);
  return songFromCatalog(resp.data[0]);
}

/** 对齐 ParseAlbum：专辑详情 */
async function parseAppleAlbum(link: string): Promise<PlaylistDetail> {
  const { storefront } = parseConfig();
  const albumID = extractAppleID(link, "album");
  if (!albumID) throw new Error(`invalid apple music album link: ${link}`);

  const params = new URLSearchParams({ extend: "extendedAssetUrls" });
  const resp = await ampGet<{ data?: AppleResource[] }>(
    `/v1/catalog/${storefront}/albums/${albumID}`,
    params,
  );
  const album = resp.data?.[0];
  if (!album) throw new Error(`apple album not found: ${albumID}`);

  const pl = albumToPlaylist(album);
  const songs = (album.relationships?.tracks?.data ?? []).map((t) => songFromCatalog(t));
  return { playlist: pl, songs };
}

export const apple: MusicProvider = {
  name: "apple",
  label: "Apple Music",

  /** Search 搜索歌曲 */
  async search(keyword: string): Promise<Song[]> {
    const { storefront } = parseConfig();
    const params = new URLSearchParams({ term: keyword, types: "songs", limit: "30" });
    const resp = await ampGet<{ results?: { songs?: { data?: AppleResource[] } } }>(
      `/v1/catalog/${storefront}/search`,
      params,
    );
    return (resp.results?.songs?.data ?? []).map((item) => songFromCatalog(item));
  },

  /** Parse 解析单曲链接（preview 直链） */
  async parse(link: string): Promise<Song> {
    return parseAppleSong(link);
  },

  /** GetDownloadURL：返回 preview URL（完整下载需 gamdl DRM 解密） */
  async getStreamUrl(song: Song): Promise<string> {
    if (song.url) return song.url;
    const parsed = await parseAppleSong(song.id);
    if (!parsed.url) {
      throw new Error("apple music: no preview URL available (full download requires gamdl)");
    }
    return parsed.url;
  },

  /** GetLyrics 获取 TTML 歌词 */
  async getLyric(song: Song): Promise<string> {
    const { storefront } = parseConfig();
    const songID = song.id;
    if (!songID) throw new Error("song id is empty");

    const params = new URLSearchParams({ include: "lyrics", extend: "extendedAssetUrls" });
    const resp = await ampGet<{ data?: AppleResource[] }>(
      `/v1/catalog/${storefront}/songs/${songID}`,
      params,
    );
    for (const rel of resp.data?.[0]?.relationships?.lyrics?.data ?? []) {
      const text = rel.attributes?.ttml ?? "";
      if (text) return text;
    }
    return "";
  },

  /** SearchAlbum 搜索专辑 */
  async searchAlbum(keyword: string): Promise<Playlist[]> {
    const { storefront } = parseConfig();
    const params = new URLSearchParams({ term: keyword, types: "albums", limit: "20" });
    const resp = await ampGet<{ results?: { albums?: { data?: AppleResource[] } } }>(
      `/v1/catalog/${storefront}/search`,
      params,
    );
    return (resp.results?.albums?.data ?? []).map((item) => albumToPlaylist(item));
  },

  /** GetAlbumSongs 获取专辑歌曲 */
  async getAlbumSongs(id: string): Promise<Song[]> {
    return (await parseAppleAlbum(id)).songs;
  },

  /** ParseAlbum 解析专辑链接 */
  async parseAlbum(link: string): Promise<PlaylistDetail> {
    return parseAppleAlbum(link);
  },

  /** SearchPlaylist 搜索歌单 */
  async searchPlaylist(keyword: string): Promise<Playlist[]> {
    const { storefront } = parseConfig();
    const params = new URLSearchParams({ term: keyword, types: "playlists", limit: "20" });
    const resp = await ampGet<{ results?: { playlists?: { data?: AppleResource[] } } }>(
      `/v1/catalog/${storefront}/search`,
      params,
    );
    return (resp.results?.playlists?.data ?? []).map((item) => playlistToPlaylist(item));
  },

  /** GetPlaylistSongs 获取歌单歌曲 */
  async getPlaylistSongs(id: string): Promise<Song[]> {
    const playlistID = extractAppleID(id, "playlist");
    if (!playlistID) throw new Error(`invalid apple music playlist link: ${id}`);
    return (await fetchPlaylistDetail(playlistID)).songs;
  },

  /** ParsePlaylist 解析歌单链接 */
  async parsePlaylist(link: string): Promise<PlaylistDetail> {
    const playlistID = extractAppleID(link, "playlist");
    if (!playlistID) throw new Error(`invalid apple music playlist link: ${link}`);
    return fetchPlaylistDetail(playlistID);
  },

  /** GetPlaylistCategories：静态 curator 分类 */
  async getPlaylistCategories(): Promise<PlaylistCategory[]> {
    return CURATOR_CATEGORIES.map((c) => ({ ...c }));
  },

  /** GetCategoryPlaylists：curator 下的歌单（cn 商店） */
  async getCategoryPlaylists(categoryId: string, page: number, limit: number): Promise<Playlist[]> {
    if (limit <= 0) limit = 20;
    const apiMax = 25;
    let offset = (page - 1) * limit;
    const storefront = "cn";

    const all: Playlist[] = [];
    while (all.length < limit) {
      let batchSize = apiMax;
      if (limit - all.length < batchSize) batchSize = limit - all.length;

      const params = new URLSearchParams({
        limit: String(batchSize),
        offset: String(offset),
        l: "zh-Hans-CN",
      });

      let resp: { data?: AppleResource[]; next?: string };
      try {
        resp = await ampGet<{ data?: AppleResource[]; next?: string }>(
          `/v1/catalog/${storefront}/apple-curators/${categoryId}/playlists`,
          params,
        );
      } catch (err) {
        if (all.length > 0) break; // 返回已拿到的
        throw err;
      }

      for (const item of resp.data ?? []) all.push(playlistToPlaylist(item));
      if ((resp.data ?? []).length < batchSize || !resp.next) break;
      offset += (resp.data ?? []).length;
    }
    return all;
  },

  // GetUserPlaylists：Go 无实现 → 不实现
};
