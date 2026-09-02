/**
 * 咪咕音乐 Provider — 移植自 music-lib/migu
 * 覆盖 Go 版全部能力：song parse / album / playlist / 分类歌单 / 歌词
 * （Go 版 migu 无 getRecommendedPlaylists / getUserPlaylists / QR 登录，保持不实现）
 */
import type {
  MusicProvider,
  Playlist,
  PlaylistCategory,
  PlaylistDetail,
  Song,
} from "../types";
import { httpGetJSON, httpGetText, httpGetNoRedirect, firstNonEmpty } from "../http";
import { getCookie } from "../cookies";

const UA_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13B143 Safari/601.1";
const REFERER = "http://music.migu.cn/";
const MAGIC_USER_ID = "15548614588710179085069";

interface MiguArtist {
  id?: string;
  name?: string;
}
interface MiguRateFormat {
  formatType?: string;
  resourceType?: string;
  size?: string;
  androidSize?: string;
  isize?: string;
  asize?: string;
  fileType?: string;
  androidFileType?: string;
  aformat?: string;
  iformat?: string;
  price?: string;
  showTag?: string[];
  showTags?: string[];
}
interface MiguSongItem {
  id?: string;
  name?: string;
  songName?: string;
  singers?: MiguArtist[];
  artists?: MiguArtist[];
  singerList?: MiguArtist[];
  singer?: string;
  albums?: { id?: string; name?: string }[];
  album?: string;
  albumId?: string;
  contentId?: string;
  copyrightId?: string;
  chargeAuditions?: string;
  imgItems?: { imgSizeType?: string; img?: string }[];
  albumImgs?: { imgSizeType?: string; img?: string }[];
  img1?: string;
  img2?: string;
  img3?: string;
  rateFormats?: MiguRateFormat[];
  audioFormats?: MiguRateFormat[];
  duration?: number;
}

function miguHeaders(): Record<string, string> {
  return { "User-Agent": UA_IPHONE, Referer: REFERER };
}

/** cookie 注入（对齐 Go Migu.cookie） */
function miguCookieHeaders(): Record<string, string> {
  const cookie = getCookie("migu");
  return cookie ? { Cookie: cookie } : {};
}

function miguRequestHeaders(): Record<string, string> {
  return { ...miguHeaders(), ...miguCookieHeaders() };
}

function pickImage(items: { imgSizeType?: string; img?: string }[] | undefined): string {
  if (!items) return "";
  for (const preferred of ["02", "01", "03"]) {
    for (const item of items) {
      if (item.imgSizeType === preferred && item.img?.trim()) return item.img;
    }
  }
  for (const item of items) {
    if (item.img?.trim()) return item.img;
  }
  return "";
}

function normalizeImage(url: string): string {
  url = url.trim();
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return "https://d.musicapp.migu.cn" + url;
  return url;
}

function formatExt(formatType: string, formatCode: string): string {
  const ft = (formatType ?? "").toUpperCase();
  if (ft.includes("SQ") || (formatCode ?? "").startsWith("011")) return "flac";
  return "mp3";
}

/** 对齐 Go firstNonZeroString：跳过空串和 "0" */
function firstNonZeroString(...values: (string | undefined)[]): string {
  for (const value of values) {
    const v = (value ?? "").trim();
    if (v && v !== "0") return v;
  }
  return "";
}

function miguAlbumLink(id: string): string {
  return `https://music.migu.cn/v3/music/album/${id}`;
}

function miguPlaylistLink(id: string): string {
  return `https://music.migu.cn/v5/#/playlist?playlistId=${id}&playlistType=ordinary`;
}

/** 对齐 Go convertItemToSongWithOption：allowPaid 控制是否保留付费/VIP 音质 */
function convertItemToSong(item: MiguSongItem, allowPaid = false): Song | null {
  const artistNames: string[] = [];
  const seen = new Set<string>();
  const addName = (name: string | undefined) => {
    const n = (name ?? "").trim();
    if (n && !seen.has(n)) {
      seen.add(n);
      artistNames.push(n);
    }
  };
  (item.singers ?? []).forEach((s) => addName(s.name));
  (item.singerList ?? []).forEach((s) => addName(s.name));
  (item.artists ?? []).forEach((s) => addName(s.name));
  if (!artistNames.length) (item.singer ?? "").split("|").forEach(addName);

  const songName = firstNonEmpty(item.name, item.songName);
  let albumName = (item.album ?? "").trim();
  if (item.albums?.length && (item.albums[0].name ?? "").trim()) {
    albumName = (item.albums[0].name ?? "").trim();
  }

  const rateFormats = item.rateFormats?.length ? item.rateFormats : item.audioFormats;
  if (!rateFormats?.length) return null;

  interface ValidFormat {
    index: number;
    size: number;
    ext: string;
  }
  const candidates: ValidFormat[] = [];
  let duration = item.duration ?? 0;
  let pqSize = 0;

  rateFormats.forEach((fmt, index) => {
    const sizeStr = firstNonZeroString(fmt.androidSize, fmt.asize, fmt.size, fmt.isize);
    const sizeVal = parseInt(sizeStr, 10) || 0;

    let ext = firstNonEmpty(fmt.androidFileType, fmt.fileType);
    if (!ext) {
      ext = formatExt(fmt.formatType ?? "", firstNonEmpty(fmt.aformat, fmt.iformat));
    }

    if (fmt.formatType === "PQ") pqSize = sizeVal;

    // 时长缺失时按码率估算（对齐 Go）
    if (duration === 0 && sizeVal > 0) {
      let bitrate = 0;
      if (fmt.formatType === "PQ") bitrate = 128000;
      else if (fmt.formatType === "HQ") bitrate = 320000;
      else if (fmt.formatType === "LQ") bitrate = 64000;
      if (bitrate > 0) duration = Math.floor((sizeVal * 8) / bitrate);
    }

    const tags = fmt.showTag?.length ? fmt.showTag : fmt.showTags ?? [];
    const isVipTag = tags.includes("vip");
    const priceVal = parseInt(fmt.price ?? "0", 10) || 0;
    const isHiddenPaid = item.chargeAuditions === "1" && priceVal >= 200;

    if (allowPaid || (!isVipTag && !isHiddenPaid)) {
      candidates.push({ index, size: sizeVal, ext });
    }
  });

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.size - a.size);
  const best = candidates[0];
  const bestFormat = rateFormats[best.index];

  const displaySize = pqSize > 0 ? pqSize : best.size;
  const bitrate = duration > 0 && best.size > 0 ? Math.round((best.size * 8) / 1000 / duration) : 0;

  const cover = normalizeImage(
    firstNonEmpty(pickImage(item.imgItems), pickImage(item.albumImgs), item.img1, item.img2, item.img3),
  );
  const contentId = item.contentId ?? "";
  const resourceType = bestFormat.resourceType ?? "";
  const formatType = bestFormat.formatType ?? "";
  const linkID = firstNonEmpty(contentId, item.copyrightId);

  const extra: Record<string, string> = {
    content_id: contentId,
    resource_type: resourceType,
    format_type: formatType,
  };
  if (item.copyrightId) extra.copyright_id = item.copyrightId;

  return {
    source: "migu",
    id: `${contentId}|${resourceType}|${formatType}`,
    name: songName,
    artist: artistNames.join(" / "),
    album: albumName,
    duration,
    size: displaySize,
    bitrate,
    cover,
    url: "",
    ext: best.ext.toLowerCase(),
    link: `https://music.migu.cn/v3/music/song/${linkID}`,
    extra,
  };
}

/** 歌单/专辑条目去重 key（对齐 Go） */
function miguDedupKey(song: Song, item: MiguSongItem): string {
  const key = firstNonEmpty(song.extra?.content_id, item.contentId, song.id, item.copyrightId);
  if (key) return key;
  return `${song.name}|${song.artist}`;
}

// ---------------------------------------------------------------------------
// 歌单（对齐 Go playlist.go）
// ---------------------------------------------------------------------------

async function searchPlaylists(keyword: string, page: number, limit: number): Promise<Playlist[]> {
  const params = new URLSearchParams({
    ua: "Android_migu",
    version: "5.0.1",
    text: keyword,
    pageNo: String(page),
    pageSize: String(limit),
    searchSwitch: JSON.stringify({ song: 0, album: 0, singer: 0, tagSong: 0, mvSong: 0, songlist: 1, bestShow: 1 }),
  });
  const resp = await httpGetJSON<{
    songListResultData?: {
      result?: {
        id?: string;
        name?: string;
        musicNum?: string;
        userName?: string;
        ownerName?: string;
        musicListPicUrl?: string;
        playNum?: string;
        resourceType?: string;
        imgItems?: { imgSizeType?: string; img?: string }[];
      }[];
    };
  }>(`http://pd.musicapp.migu.cn/MIGUM2.0/v1.0/content/search_all.do?${params}`, {
    headers: miguRequestHeaders(),
  });

  const playlists: Playlist[] = [];
  for (const item of resp.songListResultData?.result ?? []) {
    const playlistID = (item.id ?? "").trim();
    const name = (item.name ?? "").trim();
    if (!playlistID || !name) continue;

    playlists.push({
      source: "migu",
      id: playlistID,
      name,
      cover: firstNonEmpty(item.musicListPicUrl, pickImage(item.imgItems)),
      track_count: parseInt(item.musicNum ?? "0", 10) || 0,
      play_count: parseInt(item.playNum ?? "0", 10) || 0,
      creator: firstNonEmpty(item.userName, item.ownerName),
      description: "",
      link: miguPlaylistLink(playlistID),
      extra: {
        type: "playlist",
        playlist_id: playlistID,
        resource_type: firstNonEmpty((item.resourceType ?? "").trim(), "2021"),
      },
    });
  }
  return playlists;
}

async function fetchPlaylistInfo(id: string): Promise<Playlist> {
  let playlistID = id.trim();
  if (!playlistID) throw new Error("playlist id is empty");

  const params = new URLSearchParams({
    needSimple: "00",
    resourceType: "2021",
    resourceId: playlistID,
  });
  const resp = await httpGetJSON<{
    code?: string;
    info?: string;
    resource?: {
      musicListId?: string;
      title?: string;
      summary?: string;
      musicNum?: number;
      originalImgUrl?: string;
      ownerName?: string;
      resourceType?: string;
      imgItem?: { img?: string; imgOri?: string; webpImg?: string };
      opNumItem?: { playNum?: number };
    }[];
  }>(`https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do?${params}`, {
    headers: miguRequestHeaders(),
  });

  if (resp.code && resp.code !== "000000") {
    throw new Error(`migu api error: ${resp.info} (code ${resp.code})`);
  }
  const info = resp.resource?.[0];
  if (!info) throw new Error("migu playlist info not found");

  playlistID = firstNonEmpty(info.musicListId, playlistID);
  return {
    source: "migu",
    id: playlistID,
    name: firstNonEmpty((info.title ?? "").trim(), playlistID),
    cover: firstNonEmpty(info.originalImgUrl, info.imgItem?.img, info.imgItem?.webpImg, info.imgItem?.imgOri),
    track_count: info.musicNum ?? 0,
    play_count: info.opNumItem?.playNum ?? 0,
    creator: (info.ownerName ?? "").trim(),
    description: (info.summary ?? "").trim(),
    link: miguPlaylistLink(playlistID),
    extra: {
      type: "playlist",
      playlist_id: playlistID,
      resource_type: firstNonEmpty((info.resourceType ?? "").trim(), "2021"),
    },
  };
}

async function fetchPlaylistDetail(id: string): Promise<PlaylistDetail> {
  const playlistID = id.trim();
  if (!playlistID) throw new Error("playlist id is empty");

  const songs = await fetchPlaylistSongs(playlistID);

  let playlist: Playlist;
  try {
    playlist = await fetchPlaylistInfo(playlistID);
  } catch {
    playlist = {
      source: "migu",
      id: playlistID,
      name: playlistID,
      cover: "",
      track_count: songs.length,
      play_count: 0,
      creator: "",
      description: "",
      link: miguPlaylistLink(playlistID),
      extra: { type: "playlist", playlist_id: playlistID },
    };
  }
  if (playlist.track_count === 0) playlist.track_count = songs.length;
  if (!playlist.cover && songs.length) playlist.cover = songs[0].cover;
  return { playlist, songs };
}

// ---------------------------------------------------------------------------
// 专辑（对齐 Go album.go / migu.go）
// ---------------------------------------------------------------------------

async function fetchAlbumSongs(id: string): Promise<{ songs: Song[]; totalCount: number }> {
  const albumID = id.trim();
  if (!albumID) throw new Error("album id is empty");

  const pageSize = 50;
  const seen = new Set<string>();
  const songs: Song[] = [];
  let totalCount = 0;

  for (let pageNo = 1; ; pageNo++) {
    const params = new URLSearchParams({
      albumId: albumID,
      pageNo: String(pageNo),
      pageSize: String(pageSize),
    });
    const resp = await httpGetJSON<{
      code?: string;
      info?: string;
      data?: { songList?: MiguSongItem[]; totalCount?: number };
    }>(`https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/queryAlbumSong?${params}`, {
      headers: miguRequestHeaders(),
    });

    if (resp.code && resp.code !== "000000") {
      throw new Error(`migu api error: ${resp.info} (code ${resp.code})`);
    }

    if (totalCount === 0) totalCount = resp.data?.totalCount ?? 0;
    const list = resp.data?.songList ?? [];
    if (!list.length) break;

    const before = songs.length;
    for (const item of list) {
      const song = convertItemToSong(item);
      if (!song) continue;

      const key = miguDedupKey(song, item);
      if (seen.has(key)) continue;
      seen.add(key);
      songs.push(song);
    }

    if (list.length < pageSize) break;
    if (totalCount > 0 && songs.length >= totalCount) break;
    if (songs.length === before) break;
  }

  if (!songs.length) throw new Error("album has no playable songs");
  return { songs, totalCount };
}

async function fetchAlbumDetail(id: string): Promise<PlaylistDetail> {
  let albumID = id.trim();
  if (!albumID) throw new Error("album id is empty");

  const { songs, totalCount } = await fetchAlbumSongs(albumID);

  const params = new URLSearchParams({
    needSimple: "00",
    resourceType: "2003",
    resourceId: albumID,
  });
  const resp = await httpGetJSON<{
    code?: string;
    info?: string;
    resource?: {
      resourceType?: string;
      albumId?: string;
      imgItems?: { imgSizeType?: string; img?: string }[];
      title?: string;
      singer?: string;
      summary?: string;
      totalCount?: string;
      publishTime?: string;
      publishCorp?: string;
      albumAliasName?: string;
      albumClass?: string;
      language?: string;
      publishCompany?: string;
      publishDate?: string;
      translateName?: string;
    }[];
  }>(`https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do?${params}`, {
    headers: miguRequestHeaders(),
  });

  if (resp.code && resp.code !== "000000") {
    throw new Error(`migu api error: ${resp.info} (code ${resp.code})`);
  }
  const info = resp.resource?.[0];
  if (!info) throw new Error("album not found");

  albumID = firstNonEmpty((info.albumId ?? "").trim(), albumID);
  let trackCount = parseInt((info.totalCount ?? "").trim(), 10) || 0;
  if (trackCount === 0) trackCount = totalCount > 0 ? totalCount : songs.length;

  const album: Playlist = {
    source: "migu",
    id: albumID,
    name: (info.title ?? "").trim(),
    cover: pickImage(info.imgItems),
    track_count: trackCount,
    play_count: 0,
    creator: (info.singer ?? "").trim(),
    description: (info.summary ?? "").trim(),
    link: miguAlbumLink(albumID),
    extra: {
      type: "album",
      album_id: albumID,
      resource_type: firstNonEmpty((info.resourceType ?? "").trim(), "2003"),
      publish_time: (info.publishTime ?? "").trim(),
      publish_date: (info.publishDate ?? "").trim(),
      publish_corp: (info.publishCorp ?? "").trim(),
      publish_company: (info.publishCompany ?? "").trim(),
      album_alias: (info.albumAliasName ?? "").trim(),
      album_class: (info.albumClass ?? "").trim(),
      language: (info.language ?? "").trim(),
      translate_name: (info.translateName ?? "").trim(),
    },
  };

  return { playlist: album, songs };
}

/** 通过 contentId 获取歌曲详情（对齐 Go fetchSongDetail） */
async function fetchSongDetail(contentID: string): Promise<Song> {
  const params = new URLSearchParams({
    resourceType: "2",
    resourceId: contentID,
  });
  const resp = await httpGetJSON<{ resource?: MiguSongItem[] }>(
    `http://c.musicapp.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do?${params}`,
    { headers: miguRequestHeaders() },
  );

  const item = resp.resource?.[0];
  if (!item) throw new Error("song detail not found");

  const song = convertItemToSong(item);
  if (!song) throw new Error("no valid format found for this song");
  return song;
}

/** 分类关键词（对齐 Go miguPlaylistCategoryKeywords） */
const MIGU_PLAYLIST_CATEGORY_KEYWORDS: { name: string; group: string; hot?: boolean }[] = [
  { name: "华语", group: "语种", hot: true },
  { name: "欧美", group: "语种", hot: true },
  { name: "日语", group: "语种" },
  { name: "韩语", group: "语种" },
  { name: "粤语", group: "语种" },
  { name: "流行", group: "风格", hot: true },
  { name: "摇滚", group: "风格", hot: true },
  { name: "民谣", group: "风格", hot: true },
  { name: "电子", group: "风格" },
  { name: "说唱", group: "风格" },
  { name: "古风", group: "风格" },
  { name: "轻音乐", group: "风格" },
  { name: "影视", group: "场景", hot: true },
  { name: "ACG", group: "场景" },
  { name: "治愈", group: "场景" },
  { name: "运动", group: "场景" },
  { name: "学习", group: "场景" },
  { name: "睡前", group: "场景" },
];

/** 歌单曲目分页拉取（对齐 Go GetPlaylistSongs：允许付费音质 + 去重） */
async function fetchPlaylistSongs(id: string): Promise<Song[]> {
  const playlistID = id.trim();
  if (!playlistID) throw new Error("playlist id is empty");

  const pageSize = 50;
  const seen = new Set<string>();
  const songs: Song[] = [];
  let totalCount = 0;

  for (let pageNo = 1; ; pageNo++) {
    const params = new URLSearchParams({
      pageNo: String(pageNo),
      pageSize: String(pageSize),
      playlistId: playlistID,
    });
    const resp = await httpGetJSON<{
      code?: string;
      info?: string;
      data?: { songList?: MiguSongItem[]; totalCount?: number };
    }>(`https://app.c.nf.migu.cn/MIGUM3.0/resource/playlist/song/v2.0?${params}`, {
      headers: miguRequestHeaders(),
    });

    if (resp.code && resp.code !== "000000") {
      throw new Error(`migu api error: ${resp.info} (code ${resp.code})`);
    }
    if (totalCount === 0) totalCount = resp.data?.totalCount ?? 0;
    const list = resp.data?.songList ?? [];
    if (!list.length) break;

    const before = songs.length;
    for (const item of list) {
      // 歌单曲目允许付费音质（对齐 Go convertItemToSongAllowPaid）
      const song = convertItemToSong(item, true);
      if (!song) continue;

      const key = miguDedupKey(song, item);
      if (seen.has(key)) continue;
      seen.add(key);
      songs.push(song);
    }

    if (list.length < pageSize) break;
    if (totalCount > 0 && songs.length >= totalCount) break;
    if (songs.length === before) break;
  }

  if (!songs.length) throw new Error("playlist has no playable songs");
  return songs;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export const migu: MusicProvider = {
  name: "migu",
  label: "咪咕音乐",

  async search(keyword: string): Promise<Song[]> {
    const params = new URLSearchParams({
      ua: "Android_migu",
      version: "5.0.1",
      text: keyword,
      pageNo: "1",
      pageSize: "10",
      searchSwitch: JSON.stringify({ song: 1, album: 0, singer: 0, tagSong: 0, mvSong: 0, songlist: 0, bestShow: 1 }),
    });
    const resp = await httpGetJSON<{ songResultData?: { result?: MiguSongItem[] } }>(
      `http://pd.musicapp.migu.cn/MIGUM2.0/v1.0/content/search_all.do?${params}`,
      { headers: miguRequestHeaders() },
    );

    const songs: Song[] = [];
    for (const item of resp.songResultData?.result ?? []) {
      const song = convertItemToSong(item);
      if (song) songs.push(song);
    }
    return songs;
  },

  async parse(link: string): Promise<Song> {
    // 支持格式: https://music.migu.cn/v3/music/song/60054701934
    const match = link.match(/music\.migu\.cn\/v3\/music\/song\/(\d+)/);
    if (!match) throw new Error("invalid migu link");
    const contentID = match[1];

    const song = await fetchSongDetail(contentID);
    try {
      song.url = await migu.getStreamUrl(song);
    } catch {
      /* 对齐 Go：URL 获取失败不影响单曲解析 */
    }
    return song;
  },

  async getStreamUrl(song: Song): Promise<string> {
    // 对齐 Go GetDownloadURL：已带直链的 Song 直接返回
    const directURL = (song.url ?? "").trim();
    if (directURL) return directURL;
    let { content_id: contentId, resource_type: resourceType, format_type: formatType } = song.extra ?? {};
    if (!contentId || !resourceType || !formatType) {
      const parts = song.id.split("|");
      if (parts.length === 3) {
        contentId = parts[0];
        resourceType = parts[1];
        formatType = parts[2];
      }
    }
    if (!contentId || !resourceType || !formatType) throw new Error("migu: 无效的歌曲 ID");

    const params = new URLSearchParams({
      toneFlag: formatType,
      netType: "00",
      userId: MAGIC_USER_ID,
      ua: "Android_migu",
      version: "5.1",
      copyrightId: "0",
      contentId,
      resourceType,
      channel: "0",
    });
    const apiUrl = `http://app.pd.nf.migu.cn/MIGUM2.0/v1.0/content/sub/listenSong.do?${params}`;

    const resp = await httpGetNoRedirect(apiUrl, { headers: miguRequestHeaders() });
    // 对齐 Go：仅 302 时取 Location
    if (resp.status === 302) {
      const location = resp.headers.get("location");
      if (location) return location;
    }
    return apiUrl;
  },

  async getLyric(song: Song): Promise<string> {
    // 对齐 Go migu/lyric.go：resourceinfo 取 lrcUrl/lyricUrl 再下载
    let contentId = song.extra?.content_id ?? "";
    if (!contentId) {
      const parts = song.id.split("|");
      if (parts.length >= 1) contentId = parts[0];
    }
    if (!contentId) throw new Error("migu: 无效的歌曲 ID");

    const params = new URLSearchParams({
      resourceId: contentId,
      resourceType: "2",
    });
    const resp = await httpGetJSON<{
      resource?: { lrcUrl?: string; lyricUrl?: string }[];
    }>(`http://c.musicapp.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do?${params}`, {
      headers: miguRequestHeaders(),
    });

    const info = resp.resource?.[0];
    if (!info) throw new Error("migu: 歌词资源未找到");

    let lyricUrl = firstNonEmpty(info.lrcUrl, info.lyricUrl);
    if (!lyricUrl) throw new Error("migu: 歌词链接未找到");
    lyricUrl = lyricUrl.replace("http://", "https://");

    const lrc = await httpGetText(lyricUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
        Referer: "https://y.migu.cn/",
        ...miguCookieHeaders(),
      },
    });
    if (!lrc.trim()) throw new Error("migu: 歌词内容为空");
    return lrc;
  },

  // ---- AlbumProvider ----

  async searchAlbum(keyword: string): Promise<Playlist[]> {
    const params = new URLSearchParams({
      ua: "Android_migu",
      version: "5.0.1",
      text: keyword,
      pageNo: "1",
      pageSize: "10",
      searchSwitch: JSON.stringify({ song: 0, album: 1, singer: 0, tagSong: 0, mvSong: 0, songlist: 0, bestShow: 1 }),
    });
    const resp = await httpGetJSON<{
      albumResultData?: {
        result?: {
          id?: string;
          resourceType?: string;
          name?: string;
          singer?: string;
          publishDate?: string;
          desc?: string;
          imgItems?: { imgSizeType?: string; img?: string }[];
        }[];
      };
    }>(`http://pd.musicapp.migu.cn/MIGUM2.0/v1.0/content/search_all.do?${params}`, {
      headers: miguRequestHeaders(),
    });

    const albums: Playlist[] = [];
    for (const item of resp.albumResultData?.result ?? []) {
      const albumID = (item.id ?? "").trim();
      if (!albumID) continue;

      let description = (item.desc ?? "").trim();
      if (!description) description = (item.publishDate ?? "").trim();

      albums.push({
        source: "migu",
        id: albumID,
        name: (item.name ?? "").trim(),
        cover: pickImage(item.imgItems),
        track_count: 0,
        play_count: 0,
        creator: (item.singer ?? "").trim(),
        description,
        link: miguAlbumLink(albumID),
        extra: {
          type: "album",
          album_id: albumID,
          resource_type: firstNonEmpty((item.resourceType ?? "").trim(), "2003"),
          publish_date: (item.publishDate ?? "").trim(),
        },
      });
    }

    if (!albums.length) throw new Error("no albums found");
    return albums;
  },

  async getAlbumSongs(id: string): Promise<Song[]> {
    return (await fetchAlbumSongs(id)).songs;
  },

  async parseAlbum(link: string): Promise<PlaylistDetail> {
    const patterns = [
      /music\.migu\.cn\/(?:v3|v5)\/music\/album\/(\d+)/,
      /albumId=(\d+)/,
      /resourceId=(\d+)/,
    ];
    for (const pattern of patterns) {
      const match = link.match(pattern);
      if (match) return fetchAlbumDetail(match[1]);
    }
    throw new Error("invalid migu album link");
  },

  // ---- PlaylistProvider ----

  async searchPlaylist(keyword: string): Promise<Playlist[]> {
    return searchPlaylists(keyword, 1, 10);
  },

  async getPlaylistSongs(id: string): Promise<Song[]> {
    return fetchPlaylistSongs(id);
  },

  async parsePlaylist(link: string): Promise<PlaylistDetail> {
    const patterns = [/playlistId=(\d+)/, /musicListId=(\d+)/, /(?:playlist|songlist)\/(\d+)/];
    for (const pattern of patterns) {
      const match = link.match(pattern);
      if (match) return fetchPlaylistDetail(match[1]);
    }

    if (link && !link.includes("/")) {
      return fetchPlaylistDetail(link);
    }
    throw new Error("invalid migu playlist link");
  },

  // ---- PlaylistCategoryProvider ----

  async getPlaylistCategories(): Promise<PlaylistCategory[]> {
    const categories: PlaylistCategory[] = [
      { source: "migu", id: "", name: "全部", group: "全部", count: 0 },
    ];
    for (const item of MIGU_PLAYLIST_CATEGORY_KEYWORDS) {
      categories.push({
        source: "migu",
        id: item.name,
        name: item.name,
        group: item.group,
        count: 0,
        hot: item.hot ?? false,
      });
    }
    return categories;
  },

  async getCategoryPlaylists(categoryId: string, page: number, limit: number): Promise<Playlist[]> {
    let categoryID = categoryId.trim();
    if (!categoryID) categoryID = "华语";
    if (page < 1) page = 1;
    if (limit < 1) limit = 20;

    const playlists = await searchPlaylists(categoryID, page, limit);
    for (const pl of playlists) {
      pl.extra = { ...pl.extra, category_id: categoryID };
    }
    if (!playlists.length) throw new Error("no category playlists found");
    return playlists;
  },
};
