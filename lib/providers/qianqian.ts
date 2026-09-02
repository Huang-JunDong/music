/**
 * 千千音乐 Provider — 逐行移植自 music-lib/qianqian（qianqian.go / song.go / download.go /
 * lyric.go / playlist.go / album.go / user_playlist.go），MD5 签名走 91q.com v1 接口。
 */
import crypto from "node:crypto";
import type { MusicProvider, Playlist, PlaylistCategory, PlaylistDetail, Song } from "../types";
import { httpGetJSON, httpGetText } from "../http";
import { getCookie } from "../cookies";

const APP_ID = "16073360";
const SECRET = "0b50b02fd0d73a9c4c8c3a781c30845f";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";
const REFERER = "https://music.91q.com/player";

function headers(): Record<string, string> {
  return { "User-Agent": UA, Referer: REFERER, Cookie: getCookie("qianqian") };
}

interface QqArtist {
  name?: string;
  artistType?: number;
}

interface QqRateFileInfo {
  size?: number;
  format?: string;
}

/** 对齐 signParams：timestamp → 按 key 排序拼接 k=v&... + secret → MD5 → 追加 sign */
function signParams(params: URLSearchParams): void {
  params.set("timestamp", String(Math.floor(Date.now() / 1000)));
  const keys = [...params.keys()].sort();
  const buf = keys.map((k) => `${k}=${params.get(k) ?? ""}`).join("&") + SECRET;
  params.set("sign", crypto.createHash("md5").update(buf, "utf8").digest("hex"));
}

function normalizeAlbumAssetCode(id: string): string {
  const trimmed = id.trim();
  if (trimmed.length < 2) return "";
  if (trimmed[0] === "p" || trimmed[0] === "P") return "P" + trimmed.slice(1);
  return "";
}

function releaseDate(raw: string): string {
  const t = raw.trim();
  return t.length >= 10 ? t.slice(0, 10) : t;
}

function firstNonEmptyStr(...values: (string | undefined | null)[]): string {
  for (const v of values) {
    const t = (v ?? "").trim();
    if (t) return t;
  }
  return "";
}

function joinArtists(artists: QqArtist[] | undefined): string {
  if (!artists || artists.length === 0) return "";
  const names: string[] = [];
  const seen = new Set<string>();
  const addName = (name: string | undefined) => {
    const t = (name ?? "").trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    names.push(t);
  };
  for (const a of artists) {
    if (a.artistType === 38) addName(a.name);
  }
  if (names.length === 0) {
    for (const a of artists) addName(a.name);
  }
  return names.join("、");
}

/** 对齐 qianqianRateStats：按 3000/320/128/64 取第一个 size>0 的档位 */
function rateStats(rateFileInfo: Record<string, QqRateFileInfo> | undefined, duration: number): [number, number] {
  for (const rate of ["3000", "320", "128", "64"]) {
    const size = rateFileInfo?.[rate]?.size ?? 0;
    if (size <= 0) continue;
    if (duration > 0) {
      return [size, Math.floor((size * 8) / 1000 / duration)];
    }
    if (rate === "3000") return [size, 800];
    return [size, parseInt(rate, 10)];
  }
  return [0, 0];
}

function valueString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(Math.trunc(value));
  return "";
}

function albumLink(id: string): string {
  return `https://music.91q.com/album/${id}`;
}

function playlistLink(id: string): string {
  return `https://music.91q.com/songlist/${id}`;
}

function songLink(id: string): string {
  return `https://music.91q.com/song/${id}`;
}

/** 对齐 sanitizeQianqianAlbumKeyword：标点替换为空格后合并空白 */
function sanitizeAlbumKeyword(keyword: string): string {
  const replaced = keyword
    .trim()
    .replace(/[:："'“”‘’()（）[\]【】,，/\\.-]/g, " ");
  return replaced.split(/\s+/).filter(Boolean).join(" ");
}

// ---------- 内部请求 ----------

interface AlbumSearchItem {
  albumAssetCode?: string;
  title?: string;
  pic?: string;
  introduce?: string;
  releaseDate?: string;
  genre?: string;
  lang?: string;
  artist?: QqArtist[];
  trackList?: unknown[];
}

interface SearchRawResp<T> {
  state?: boolean;
  errno?: number;
  errmsg?: string;
  data?: T;
}

async function searchAlbumItemsOnce(keyword: string): Promise<{ items: AlbumSearchItem[]; retryWithSanitized: boolean }> {
  const params = new URLSearchParams({
    word: keyword,
    type: "3",
    pageNo: "1",
    pageSize: "10",
    appid: APP_ID,
  });
  signParams(params);
  const raw = await httpGetJSON<SearchRawResp<unknown>>(
    `https://music.91q.com/v1/search?${params}`,
    { headers: headers() },
  );

  if (!raw.state) {
    if (raw.errno === 23001) {
      throw Object.assign(new Error(`api error: ${raw.errmsg ?? ""} (code ${raw.errno})`), {
        retryWithSanitized: true,
      });
    }
    if (raw.errno !== 22000) {
      throw new Error(`api error: ${raw.errmsg ?? ""} (code ${raw.errno})`);
    }
  }

  const data = raw.data;
  if (data == null || Array.isArray(data)) throw new Error("no albums found");

  const dataObj = data as { typeAlbum?: AlbumSearchItem[] };
  if (!dataObj.typeAlbum || dataObj.typeAlbum.length === 0) throw new Error("no albums found");
  return { items: dataObj.typeAlbum, retryWithSanitized: false };
}

async function searchAlbumItems(keyword: string): Promise<AlbumSearchItem[]> {
  const keywords = [keyword];
  const sanitized = sanitizeAlbumKeyword(keyword);
  if (sanitized && sanitized !== keyword) keywords.push(sanitized);

  let lastErr: Error | null = null;
  for (const currentKeyword of keywords) {
    try {
      return (await searchAlbumItemsOnce(currentKeyword)).items;
    } catch (err) {
      lastErr = err as Error;
      const retry = (err as { retryWithSanitized?: boolean }).retryWithSanitized === true;
      if (retry && currentKeyword === keyword) continue;
      break;
    }
  }
  throw lastErr ?? new Error("no albums found");
}

async function fetchSongInfo(tsid: string): Promise<Song> {
  const params = new URLSearchParams({ TSID: tsid, appid: APP_ID });
  signParams(params);
  const resp = await httpGetJSON<{
    data?: { title?: string; albumTitle?: string; pic?: string; duration?: number; artist?: QqArtist[]; lyric?: string }[];
  }>(`https://music.91q.com/v1/song/info?${params}`, { headers: headers() });

  const item = resp.data?.[0];
  if (!item) throw new Error("song info not found");

  return {
    source: "qianqian",
    id: tsid,
    name: item.title ?? "",
    artist: joinArtists(item.artist),
    album: item.albumTitle ?? "",
    duration: item.duration ?? 0,
    size: 0,
    bitrate: 0,
    url: "",
    cover: item.pic ?? "",
    link: songLink(tsid),
    extra: { tsid },
  };
}

/** 对齐 fetchDownloadURL：3000 → 320 → 128 → 64 逐档尝试 */
async function fetchDownloadURL(tsid: string): Promise<string> {
  for (const rate of ["3000", "320", "128", "64"]) {
    const params = new URLSearchParams({ TSID: tsid, appid: APP_ID, rate });
    signParams(params);
    try {
      const resp = await httpGetJSON<{
        data?: { path?: string; format?: string; size?: number; duration?: number; trail_audio_info?: { path?: string } };
      }>(`https://music.91q.com/v1/song/tracklink?${params}`, { headers: headers() });
      const downloadURL = resp.data?.path || resp.data?.trail_audio_info?.path || "";
      if (downloadURL) return downloadURL;
    } catch {
      // 对齐 Go：出错 continue 下一档
    }
  }
  throw new Error("download url not found");
}

async function resolveAlbumAssetCode(id: string): Promise<string> {
  const trimmed = id.trim();
  if (!trimmed) throw new Error("album id is empty");

  const normalized = normalizeAlbumAssetCode(trimmed);
  if (normalized) return normalized;

  const params = new URLSearchParams({ albumid: trimmed, appid: APP_ID });
  signParams(params);
  const resp = await httpGetJSON<SearchRawResp<{ psid?: string }[]>>(
    `https://music.91q.com/v1/album/albumid2psid?${params}`,
    { headers: headers() },
  );
  if (!resp.state && resp.errno !== 22000) {
    throw new Error(`api error: ${resp.errmsg ?? ""} (code ${resp.errno})`);
  }
  for (const item of resp.data ?? []) {
    const psid = normalizeAlbumAssetCode(item.psid ?? "");
    if (psid) return psid;
  }
  throw new Error("album asset code not found");
}

/** 对齐 fetchPlaylistDetail：tracklist/info */
async function fetchPlaylistDetail(id: string): Promise<PlaylistDetail> {
  const playlistID = id.trim();
  if (!playlistID) throw new Error("playlist id is empty");

  const params = new URLSearchParams({ id: playlistID, appid: APP_ID, type: "0" });
  signParams(params);
  const resp = await httpGetJSON<{
    data?: {
      id?: unknown;
      title?: string;
      pic?: string;
      desc?: string;
      description?: string;
      trackCount?: number;
      tagList?: string[];
      creator?: string;
      author?: string;
      userName?: string;
      nickName?: string;
      ownerName?: string;
      trackList?: { TSID?: string; title?: string; albumTitle?: string; pic?: string; duration?: number; artist?: QqArtist[]; isVip?: number }[];
    };
    errno?: number;
    errmsg?: string;
  }>(`https://music.91q.com/v1/tracklist/info?${params}`, { headers: headers() });

  if ((resp.errno ?? 0) !== 0 && resp.errno !== 22000) {
    throw new Error(`api error: ${resp.errmsg ?? ""} (code ${resp.errno})`);
  }
  const data = resp.data ?? {};

  const songs: Song[] = [];
  for (const item of data.trackList ?? []) {
    let cover = (item.pic ?? "").trim();
    if (!cover) cover = (data.pic ?? "").trim();
    songs.push({
      source: "qianqian",
      id: item.TSID ?? "",
      name: item.title ?? "",
      artist: joinArtists(item.artist),
      album: item.albumTitle ?? "",
      duration: item.duration ?? 0,
      size: 0,
      bitrate: 0,
      url: "",
      cover,
      link: songLink(item.TSID ?? ""),
      extra: { tsid: item.TSID ?? "" },
    });
  }
  if (songs.length === 0) throw new Error("playlist is empty or invalid");

  let trackCount = data.trackCount ?? 0;
  if (trackCount === 0) trackCount = songs.length;

  let description = firstNonEmptyStr(data.desc, data.description);
  if (!description && (data.tagList ?? []).length > 0) description = (data.tagList ?? []).join("、");

  const playlist: Playlist = {
    source: "qianqian",
    id: playlistID,
    name: firstNonEmptyStr(data.title, playlistID),
    cover: firstNonEmptyStr(data.pic, songs[0].cover),
    track_count: trackCount,
    play_count: 0,
    creator: firstNonEmptyStr(data.creator, data.author, data.userName, data.nickName, data.ownerName),
    description,
    link: playlistLink(playlistID),
    extra: { type: "playlist", playlist_id: playlistID },
  };
  return { playlist, songs };
}

/** 对齐 fetchAlbumDetail：album/info */
async function fetchAlbumDetail(id: string): Promise<PlaylistDetail> {
  const albumID = await resolveAlbumAssetCode(id);

  const params = new URLSearchParams({ albumAssetCode: albumID, appid: APP_ID });
  signParams(params);
  const resp = await httpGetJSON<{
    state?: boolean;
    errno?: number;
    errmsg?: string;
    data?: {
      albumAssetCode?: string;
      title?: string;
      pic?: string;
      introduce?: string;
      releaseDate?: string;
      genre?: string;
      lang?: string;
      artist?: QqArtist[];
      trackList?: {
        duration?: number;
        artist?: QqArtist[];
        assetId?: string;
        sort?: number;
        title?: string;
        isVip?: number;
        isPaid?: number;
        rateFileInfo?: Record<string, QqRateFileInfo>;
      }[];
    };
  }>(`https://music.91q.com/v1/album/info?${params}`, { headers: headers() });

  if (!resp.state && resp.errno !== 22000) {
    throw new Error(`api error: ${resp.errmsg ?? ""} (code ${resp.errno})`);
  }
  const data = resp.data ?? {};
  if (normalizeAlbumAssetCode(data.albumAssetCode ?? "") === "") throw new Error("album not found");

  const album: Playlist = {
    source: "qianqian",
    id: albumID,
    name: data.title ?? "",
    cover: data.pic ?? "",
    track_count: (data.trackList ?? []).length,
    play_count: 0,
    creator: joinArtists(data.artist),
    description: data.introduce ?? "",
    link: albumLink(albumID),
    extra: {
      type: "album",
      album_id: albumID,
      release_date: releaseDate(data.releaseDate ?? ""),
      genre: (data.genre ?? "").trim(),
      lang: (data.lang ?? "").trim(),
    },
  };

  const songs: Song[] = [];
  for (const item of data.trackList ?? []) {
    const songID = (item.assetId ?? "").trim();
    if (!songID) continue;

    let artist = joinArtists(item.artist);
    if (!artist) artist = album.creator;
    const [size, bitrate] = rateStats(item.rateFileInfo, item.duration ?? 0);

    const extra: Record<string, string> = { tsid: songID, album_id: albumID };
    if ((item.sort ?? 0) > 0) extra.track = String(item.sort);

    songs.push({
      source: "qianqian",
      id: songID,
      name: item.title ?? "",
      artist,
      album: album.name,
      album_id: album.id,
      duration: item.duration ?? 0,
      size,
      bitrate,
      url: "",
      cover: album.cover,
      link: songLink(songID),
      extra,
    });
  }
  if (songs.length === 0) throw new Error("album is empty or invalid");
  if (album.track_count === 0) album.track_count = songs.length;

  return { playlist: album, songs };
}

// ---------- Provider ----------

export const qianqian: MusicProvider = {
  name: "qianqian",
  label: "千千音乐",
  supportsFlac: true,

  /** Search 搜索歌曲（type=1，过滤 VIP 曲目） */
  async search(keyword: string): Promise<Song[]> {
    const params = new URLSearchParams({
      word: keyword,
      type: "1",
      pageNo: "1",
      pageSize: "10",
      appid: APP_ID,
    });
    signParams(params);
    const resp = await httpGetJSON<{
      data?: {
        typeTrack?: {
          TSID?: string;
          title?: string;
          albumTitle?: string;
          albumAssetCode?: string;
          pic?: string;
          duration?: number;
          lyric?: string;
          artist?: QqArtist[];
          rateFileInfo?: Record<string, QqRateFileInfo>;
          isVip?: number;
        }[];
      };
    }>(`https://music.91q.com/v1/search?${params}`, { headers: headers() });

    const songs: Song[] = [];
    for (const item of resp.data?.typeTrack ?? []) {
      if ((item.isVip ?? 0) !== 0) continue;
      const [size, bitrate] = rateStats(item.rateFileInfo, item.duration ?? 0);
      const albumID = normalizeAlbumAssetCode(item.albumAssetCode ?? "");
      songs.push({
        source: "qianqian",
        id: item.TSID ?? "",
        name: item.title ?? "",
        artist: joinArtists(item.artist),
        album: item.albumTitle ?? "",
        album_id: albumID,
        duration: item.duration ?? 0,
        size,
        bitrate,
        url: "",
        cover: item.pic ?? "",
        link: songLink(item.TSID ?? ""),
        extra: { tsid: item.TSID ?? "", album_id: albumID },
      });
    }
    return songs;
  },

  /** Parse 解析单曲链接（music.91q.com/song/{tsid}） */
  async parse(link: string): Promise<Song> {
    const m = link.match(/music\.91q\.com\/song\/(\w+)/);
    if (!m) throw new Error("invalid qianqian link");
    const tsid = m[1];

    const song = await fetchSongInfo(tsid);
    try {
      song.url = await fetchDownloadURL(tsid);
    } catch {
      // 对齐 Go：拿不到链接时仍返回元数据
    }
    return song;
  },

  /** GetDownloadURL 获取下载链接 */
  async getStreamUrl(song: Song): Promise<string> {
    if (song.source !== "qianqian") throw new Error("source mismatch");
    if (song.url) return song.url;
    const tsid = song.extra?.tsid || song.id;
    return fetchDownloadURL(tsid);
  },

  /** GetLyrics 获取歌词（song/info → lyric URL → 下载 LRC） */
  async getLyric(song: Song): Promise<string> {
    if (song.source !== "qianqian") throw new Error("source mismatch");
    const tsid = song.extra?.tsid || song.id;

    const params = new URLSearchParams({ TSID: tsid, appid: APP_ID });
    signParams(params);
    const resp = await httpGetJSON<{ data?: { lyric?: string }[] }>(
      `https://music.91q.com/v1/song/info?${params}`,
      { headers: headers() },
    );
    const lyricURL = resp.data?.[0]?.lyric ?? "";
    if (!lyricURL) throw new Error("lyric url not found");

    return httpGetText(lyricURL, { headers: { "User-Agent": UA, Cookie: getCookie("qianqian") } });
  },

  /** SearchAlbum 搜索专辑 */
  async searchAlbum(keyword: string): Promise<Playlist[]> {
    const items = await searchAlbumItems(keyword);
    const albums: Playlist[] = [];
    for (const item of items) {
      const albumID = normalizeAlbumAssetCode(item.albumAssetCode ?? "");
      if (!albumID) continue;
      albums.push({
        source: "qianqian",
        id: albumID,
        name: item.title ?? "",
        cover: item.pic ?? "",
        track_count: (item.trackList ?? []).length,
        play_count: 0,
        creator: joinArtists(item.artist),
        description: item.introduce ?? "",
        link: albumLink(albumID),
        extra: {
          type: "album",
          album_id: albumID,
          release_date: releaseDate(item.releaseDate ?? ""),
          genre: (item.genre ?? "").trim(),
          lang: (item.lang ?? "").trim(),
        },
      });
    }
    if (albums.length === 0) throw new Error("no albums found");
    return albums;
  },

  /** GetAlbumSongs 获取专辑歌曲 */
  async getAlbumSongs(id: string): Promise<Song[]> {
    return (await fetchAlbumDetail(id)).songs;
  },

  /** ParseAlbum 解析专辑链接 */
  async parseAlbum(link: string): Promise<PlaylistDetail> {
    const patterns = [
      /music\.91q\.com\/album\/([A-Za-z0-9]+)/,
      /albumAssetCode=([A-Za-z0-9]+)/,
      /albumid=(\d+)/,
    ];
    for (const pattern of patterns) {
      const m = link.match(pattern);
      if (m) return fetchAlbumDetail(m[1]);
    }
    throw new Error("invalid qianqian album link");
  },

  /** SearchPlaylist 搜索歌单（type=6） */
  async searchPlaylist(keyword: string): Promise<Playlist[]> {
    const params = new URLSearchParams({
      word: keyword,
      type: "6",
      pageNo: "1",
      pageSize: "10",
      appid: APP_ID,
      timestamp: String(Math.floor(Date.now() / 1000)),
    });
    signParams(params);
    const raw = await httpGetJSON<SearchRawResp<unknown>>(
      `https://music.91q.com/v1/search?${params}`,
      { headers: headers() },
    );
    if (!raw.state) return []; // 对齐 Go：失败/无结果返回空列表

    const data = raw.data;
    if (data == null || Array.isArray(data)) return [];
    const dataObj = data as {
      typeSonglist?: { id?: unknown; title?: string; pic?: string; trackCount?: number; tag?: string }[];
    };

    const playlists: Playlist[] = [];
    for (const item of dataObj.typeSonglist ?? []) {
      const id = valueString(item.id);
      if (!id) continue;
      playlists.push({
        source: "qianqian",
        id,
        name: item.title ?? "",
        cover: item.pic ?? "",
        track_count: item.trackCount ?? 0,
        play_count: 0,
        creator: "", // 千千搜索结果不返回 Creator
        description: item.tag ?? "",
        link: playlistLink(id),
        extra: { type: "playlist", playlist_id: id },
      });
    }
    return playlists;
  },

  /** GetPlaylistSongs 获取歌单歌曲 */
  async getPlaylistSongs(id: string): Promise<Song[]> {
    return (await fetchPlaylistDetail(id)).songs;
  },

  /** ParsePlaylist 解析歌单链接 */
  async parsePlaylist(link: string): Promise<PlaylistDetail> {
    const patterns = [
      /music\.91q\.com\/(?:songlist|tracklist|playlist)\/([A-Za-z0-9]+)/,
      /(?:songlistid|tracklistid|playlistid|id)=([A-Za-z0-9]+)/,
    ];
    for (const pattern of patterns) {
      const m = link.match(pattern);
      if (m) return fetchPlaylistDetail(m[1]);
    }
    if (link.length > 0 && !link.includes("/")) {
      return fetchPlaylistDetail(link);
    }
    throw new Error("invalid qianqian playlist link");
  },

  /** GetPlaylistCategories 歌单分类（tracklist/category） */
  async getPlaylistCategories(): Promise<PlaylistCategory[]> {
    const params = new URLSearchParams({ appid: APP_ID });
    signParams(params);
    const resp = await httpGetJSON<{
      state?: boolean;
      errno?: number;
      errmsg?: string;
      data?: { categoryName?: string; subCate?: { id?: string; categoryName?: string; count?: number }[] }[];
    }>(`https://music.91q.com/v1/tracklist/category?${params}`, { headers: headers() });

    if (!resp.state && resp.errno !== 22000) {
      throw new Error(`api error: ${resp.errmsg ?? ""} (code ${resp.errno})`);
    }

    const categories: PlaylistCategory[] = [
      { source: "qianqian", id: "", name: "全部", group: "全部", count: 0 },
    ];
    for (const group of resp.data ?? []) {
      const groupName = (group.categoryName ?? "").trim();
      for (const item of group.subCate ?? []) {
        const id = (item.id ?? "").trim();
        const name = (item.categoryName ?? "").trim();
        if (!id || !name) continue;
        categories.push({
          source: "qianqian",
          id,
          name,
          group: groupName,
          count: item.count ?? 0,
        });
      }
    }
    return categories;
  },

  /** GetCategoryPlaylists 分类歌单（tracklist/list） */
  async getCategoryPlaylists(categoryId: string, page: number, limit: number): Promise<Playlist[]> {
    let catId = categoryId.trim();
    if (page < 1) page = 1;
    if (limit <= 0) limit = 30;
    if (limit > 100) limit = 100;

    const params = new URLSearchParams({
      appid: APP_ID,
      pageNo: String(page),
      pageSize: String(limit),
    });
    if (catId) params.set("subCateId", catId);
    signParams(params);

    const resp = await httpGetJSON<{
      state?: boolean;
      errno?: number;
      errmsg?: string;
      data?: { result?: { id?: unknown; title?: string; pic?: string; trackCount?: number; desc?: string; tagList?: string[] }[] };
    }>(`https://music.91q.com/v1/tracklist/list?${params}`, { headers: headers() });

    if (!resp.state && resp.errno !== 22000) {
      throw new Error(`api error: ${resp.errmsg ?? ""} (code ${resp.errno})`);
    }

    const playlists: Playlist[] = [];
    for (const item of resp.data?.result ?? []) {
      const id = valueString(item.id);
      if (!id) continue;
      let description = (item.desc ?? "").trim();
      if (!description && (item.tagList ?? []).length > 0) description = (item.tagList ?? []).join("、");
      playlists.push({
        source: "qianqian",
        id,
        name: item.title ?? "",
        cover: item.pic ?? "",
        track_count: item.trackCount ?? 0,
        play_count: 0,
        creator: "",
        description,
        link: playlistLink(id),
        extra: { type: "playlist", playlist_id: id, category_id: catId },
      });
    }
    return playlists;
  },

  // GetUserPlaylists：Go 返回 ErrUserPlaylistsUnsupported → 不实现
};
