/**
 * QQ 音乐 Provider — 逐行移植自 music-lib/qq 包：
 * - qq.go：fetchAlbumDetail（专辑详情分页）/ fetchPlaylistDetail（歌单详情）/ fetchSongDetail(ByID)
 * - song.go：Search（搜索 + 非 VIP 过滤）/ Parse（链接解析）
 * - download.go：GetDownloadURL（musicu.fcg vkey 直链，VIP 多音质降级）
 * - lyric.go：GetLyrics（PlayLyricInfo QRC 加密歌词 → verbatim LRC）
 * - playlist.go：SearchPlaylist / GetPlaylistSongs / ParsePlaylist / GetRecommendedPlaylists / 分类歌单
 * - album.go：SearchAlbum / GetAlbumSongs / ParseAlbum
 * - user_playlist.go：GetUserPlaylists（收藏歌曲/自建歌单/收藏歌单/目录歌单）
 * - login.go：CreateQRLogin / CheckQRLogin（QQ 扫码）+ CreateWXQRLogin / CheckWXQRLogin（微信扫码，导出为独立函数）
 * - account.go：IsVipAccount（VIP 探测 + 缓存）
 * 注：crypto.go 为本地 mflac 文件解密工具，与直链播放流程无关，未迁移。
 */
import type {
  MusicProvider,
  Song,
  Playlist,
  PlaylistCategory,
  PlaylistDetail,
  QRLoginSession,
  QRLoginResult,
} from "../types";
import {
  httpGetText,
  httpPostJSON,
  httpGetNoRedirect,
  httpRequest,
  httpPostRawBodyText,
  responseCookies,
  firstNonEmpty,
} from "../http";
import { getCookie, setCookie } from "../cookies";
import { decryptQRCHex, parseQRC, convertVerbatimLRC, defaultDisplayOrder, type QrcMultiData } from "../qrc";

const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13B143 Safari/601.1";
const SEARCH_REFERER = "http://m.y.qq.com";
const DOWNLOAD_REFERER = "http://y.qq.com";
const LYRIC_REFERER = "https://y.qq.com/portal/player.html";
const UA_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

const QQ_QR_SHOW_API = "https://ssl.ptlogin2.qq.com/ptqrshow";
const QQ_QR_CHECK_API = "https://ssl.ptlogin2.qq.com/ptqrlogin";
const QQ_WX_QR_CONNECT_API = "https://open.weixin.qq.com/connect/qrconnect";
const QQ_WX_QR_CHECK_API = "https://lp.open.weixin.qq.com/connect/l/qrconnect";
const QQ_WX_REDIRECT_URI = "https://y.qq.com/portal/wx_redirect.html?login_type=2&surl=https://y.qq.com/";
const QQ_WX_APP_ID = "wx48db31d50e334801";

const QQ_FAVORITE_SONGS_PLAYLIST_ID = "profile:favorites";
const QQ_PROFILE_DIR_PLAYLIST_PREFIX = "profile:dir:";

/** 对齐 Go New(cookie)：每次请求取当前 cookie */
function currentCookie(): string {
  return getCookie("qq");
}

// ---------------------------------------------------------------------------
// 通用辅助
// ---------------------------------------------------------------------------

function joinQQNames(names: string[]): string {
  return names.join(", ");
}

function atoi(value: string): number {
  // 对齐 strconv.Atoi 忽略错误 → 0
  if (!/^[+-]?\d+$/.test(value.trim())) return 0;
  const n = Number(value.trim());
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function qqCover(albumMid: string): string {
  if (albumMid === "") return "";
  return `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`;
}

/** 128/320/Flac → (size, bitrate)，对齐 Go 各处重复的取质逻辑 */
function pickQuality(size128: number, size320: number, sizeFlac: number, interval: number): { size: number; bitrate: number } {
  let fileSize = size128;
  let bitrate = 128;
  if (sizeFlac > 0) {
    fileSize = sizeFlac;
    if (interval > 0) {
      bitrate = Math.trunc((fileSize * 8) / 1000 / interval);
    } else {
      bitrate = 800;
    }
  } else if (size320 > 0) {
    fileSize = size320;
    bitrate = 320;
  }
  return { size: fileSize, bitrate };
}

function qqCookieValue(cookie: string, key: string): string {
  for (const part of cookie.split(";")) {
    const kv = part.trim().split("=");
    if (kv.length >= 2 && kv[0].trim() === key) {
      return kv.slice(1).join("=").trim();
    }
  }
  return "";
}

function normalizeQQUIN(cookie: string): string {
  let uin = firstNonEmpty(
    qqCookieValue(cookie, "wxuin"),
    qqCookieValue(cookie, "uin"),
    qqCookieValue(cookie, "ptui_loginuin"),
    qqCookieValue(cookie, "luin"),
    qqCookieValue(cookie, "pt2gguin"),
    qqCookieValue(cookie, "superuin"),
    qqCookieValue(cookie, "p_uin"),
    qqCookieValue(cookie, "musicid"),
    qqCookieValue(cookie, "userid"),
  );
  uin = uin.replace(/^o/, "").replace(/^0+/, "");
  return uin.trim();
}

function normalizeQQCover(cover: string): string {
  cover = cover.trim();
  if (cover.startsWith("//")) return "https:" + cover;
  if (cover.startsWith("http://")) return cover.replace("http://", "https://");
  return cover;
}

function joinCookieMap(cookies: Record<string, string>): string {
  return Object.keys(cookies)
    .filter((key) => key.trim() !== "")
    .sort()
    .map((key) => `${key}=${cookies[key]}`)
    .join("; ");
}

function stripQQJSONPBody(body: string): string {
  const s = body.trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end >= start) {
    return s.slice(start, end + 1);
  }
  return body;
}

function qqJSONCodeOK(code: unknown): boolean {
  if (code === null || code === undefined) return true;
  if (typeof code === "number") return Math.trunc(code) === 0;
  if (typeof code === "string") {
    const v = code.trim();
    return v === "" || v === "0";
  }
  return false;
}

function qqMapString(item: Record<string, unknown>, key: string): string {
  const v = item[key];
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") {
    if (Number.isInteger(v)) return String(v);
    return String(v).trim();
  }
  return "";
}

function qqMapInt(item: Record<string, unknown>, key: string): number {
  return qqParseInt64(qqMapString(item, key));
}

function qqParseInt64(value: string): number {
  value = value.trim();
  if (!/^[+-]?\d+$/.test(value)) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

// ---------------------------------------------------------------------------
// account.go — VIP 探测（结果按 cookie 缓存，cookie 变化即失效）
// ---------------------------------------------------------------------------

let vipCache: { cookie: string; isVip: boolean } | null = null;

async function isVipAccount(): Promise<boolean> {
  const cookie = currentCookie();
  if (vipCache && vipCache.cookie === cookie) {
    return vipCache.isVip;
  }

  if (cookie === "") {
    vipCache = { cookie, isVip: false };
    return false;
  }

  const guid = String(Math.floor(Math.random() * 9000000000) + 1000000000);
  const songMID = "004YZbkL2MNHoY";
  const filename = `M500${songMID}${songMID}.mp3`;

  const reqData = {
    comm: {
      cv: 4747474,
      ct: 24,
      format: "json",
      inCharset: "utf-8",
      outCharset: "utf-8",
      notice: 0,
      platform: "yqq.json",
      needNewCode: 1,
      uin: 0,
    },
    req_1: {
      module: "music.vkey.GetVkey",
      method: "UrlGetVkey",
      param: {
        guid,
        songmid: [songMID],
        songtype: [0],
        uin: "0",
        loginflag: 1,
        platform: "20",
        filename: [filename],
      },
    },
  };

  const result = await httpPostJSON<{
    req_1?: { code?: number; data?: { midurlinfo?: { purl?: string }[] } };
  }>("https://u.y.qq.com/cgi-bin/musicu.fcg", reqData, {
    headers: {
      "User-Agent": USER_AGENT,
      Referer: DOWNLOAD_REFERER,
      "Content-Type": "application/json",
      Cookie: cookie,
    },
  });

  let isVip = false;
  const infos = result.req_1?.data?.midurlinfo ?? [];
  if (infos.length > 0 && infos[0].purl !== "") {
    isVip = true;
  } else if (result.req_1?.code !== 0) {
    throw new Error(`api returned error code: ${result.req_1?.code ?? 0}`);
  }

  vipCache = { cookie, isVip };
  return isVip;
}

// ---------------------------------------------------------------------------
// qq.go — 单曲详情
// ---------------------------------------------------------------------------

interface QQSingleSongItem {
  id?: number;
  name?: string;
  mid?: string;
  album?: { name?: string; mid?: string };
  singer?: { name?: string }[];
  interval?: number;
}

async function fetchSongDetailByParam(param: { key: "songmid" | "songid"; value: string }): Promise<Song> {
  const params = new URLSearchParams({ [param.key]: param.value, format: "json" });
  const apiURL = `https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg?${params.toString()}`;
  const body = await httpGetText(apiURL, {
    headers: {
      "User-Agent": USER_AGENT,
      Referer: SEARCH_REFERER,
      Cookie: currentCookie(),
    },
  });

  let resp: { data?: QQSingleSongItem[] };
  try {
    resp = JSON.parse(body) as { data?: QQSingleSongItem[] };
  } catch (e) {
    throw new Error(`qq detail json parse error: ${String(e)}`);
  }

  if (!resp.data || resp.data.length === 0) {
    throw new Error("song detail not found");
  }

  const item = resp.data[0];
  const artistNames = (item.singer ?? []).map((s) => s.name ?? "");
  const coverURL = item.album?.mid ? qqCover(item.album.mid) : "";

  return {
    source: "qq",
    id: item.mid ?? "",
    name: item.name ?? "",
    artist: artistNames.join("、"),
    album: item.album?.name ?? "",
    duration: item.interval ?? 0,
    size: 0,
    bitrate: 0,
    cover: coverURL,
    url: "",
    link: `https://y.qq.com/n/ryqq/songDetail/${item.mid ?? ""}`,
    extra: {
      songmid: item.mid ?? "",
      song_id: String(item.id ?? 0),
    },
  };
}

function fetchSongDetail(songMID: string): Promise<Song> {
  return fetchSongDetailByParam({ key: "songmid", value: songMID });
}

function fetchSongDetailByID(songID: string): Promise<Song> {
  return fetchSongDetailByParam({ key: "songid", value: songID });
}

// ---------------------------------------------------------------------------
// qq.go — 专辑详情（分页）
// ---------------------------------------------------------------------------

interface QQAlbumSongInfo {
  mid?: string;
  name?: string;
  interval?: number;
  singer?: { name?: string }[];
  album?: { id?: number; mid?: string; name?: string };
  file?: { size_128mp3?: number; size_320mp3?: number; size_flac?: number };
  pay?: { pay_play?: number };
}

async function fetchAlbumDetail(id: string): Promise<{ album: Playlist; songs: Song[] }> {
  let albumMID = id.trim();
  if (albumMID === "") {
    throw new Error("album id is empty");
  }

  const headers = {
    "User-Agent": UA_WIN,
    Referer: "https://y.qq.com/",
    "Content-Type": "application/json",
    Cookie: currentCookie(),
  };

  const detailReq = {
    comm: { ct: 24, cv: 0 },
    album: {
      module: "music.musichallAlbum.AlbumInfoServer",
      method: "GetAlbumDetail",
      param: { albumMid: albumMID },
    },
  };

  const detailResp = await httpPostJSON<{
    code?: number;
    album?: {
      code?: number;
      data?: {
        basicInfo?: { albumID?: number; albumMid?: string; albumName?: string; publishDate?: string; desc?: string };
        company?: { name?: string };
        singer?: { singerList?: { name?: string }[] };
      };
    };
  }>("https://u.y.qq.com/cgi-bin/musicu.fcg", detailReq, { headers });

  if ((detailResp.album?.code ?? 0) !== 0) {
    throw new Error(`qq album detail api error code: ${detailResp.album?.code ?? 0}`);
  }

  const data = detailResp.album?.data ?? {};
  const info = data.basicInfo ?? {};
  if ((info.albumMid ?? "") !== "") {
    albumMID = info.albumMid!;
  }
  if ((info.albumName ?? "") === "") {
    throw new Error("album not found");
  }

  const artistNames: string[] = [];
  for (const singer of data.singer?.singerList ?? []) {
    if ((singer.name ?? "") !== "") {
      artistNames.push(singer.name!);
    }
  }

  const batchSize = 100;
  let totalNum = 0;
  const songs: Song[] = [];

  for (let begin = 0; ; begin += batchSize) {
    const songReq = {
      comm: { ct: 24, cv: 0 },
      album: {
        module: "music.musichallAlbum.AlbumSongList",
        method: "GetAlbumSongList",
        param: { albumMid: albumMID, begin, num: batchSize, order: 2 },
      },
    };

    const songResp = await httpPostJSON<{
      code?: number;
      album?: { code?: number; data?: { totalNum?: number; songList?: { songInfo?: QQAlbumSongInfo }[] } };
    }>("https://u.y.qq.com/cgi-bin/musicu.fcg", songReq, { headers });

    if ((songResp.album?.code ?? 0) !== 0) {
      throw new Error(`qq album songs api error code: ${songResp.album?.code ?? 0}`);
    }

    if (totalNum === 0) {
      totalNum = songResp.album?.data?.totalNum ?? 0;
    }

    const pageSongs = songResp.album?.data?.songList ?? [];
    if (pageSongs.length === 0) break;

    for (const item of pageSongs) {
      const songInfo: QQAlbumSongInfo = item.songInfo ?? {};
      if ((songInfo.mid ?? "") === "") continue;

      const pageArtistNames: string[] = [];
      for (const singer of songInfo.singer ?? []) {
        if ((singer.name ?? "") !== "") {
          pageArtistNames.push(singer.name!);
        }
      }

      const file = songInfo.file ?? {};
      const { size, bitrate } = pickQuality(file.size_128mp3 ?? 0, file.size_320mp3 ?? 0, file.size_flac ?? 0, songInfo.interval ?? 0);

      songs.push({
        source: "qq",
        id: songInfo.mid ?? "",
        name: songInfo.name ?? "",
        artist: joinQQNames(pageArtistNames),
        album: songInfo.album?.name ?? "",
        album_id: songInfo.album?.mid ?? "",
        duration: songInfo.interval ?? 0,
        size,
        bitrate,
        cover: qqCover(songInfo.album?.mid ?? ""),
        url: "",
        link: `https://y.qq.com/n/ryqq/songDetail/${songInfo.mid ?? ""}`,
        extra: {
          songmid: songInfo.mid ?? "",
          album_mid: songInfo.album?.mid ?? "",
          album_id: String(songInfo.album?.id ?? 0),
        },
      });
    }

    if (pageSongs.length < batchSize) break;
    if (totalNum > 0 && begin + pageSongs.length >= totalNum) break;
  }

  let trackCount = totalNum;
  if (trackCount === 0) {
    trackCount = songs.length;
  }

  const album: Playlist = {
    source: "qq",
    id: albumMID,
    name: info.albumName ?? "",
    cover: qqCover(albumMID),
    track_count: trackCount,
    play_count: 0,
    creator: joinQQNames(artistNames),
    description: info.desc ?? "",
    link: `https://y.qq.com/n/ryqq/albumDetail/${albumMID}`,
    extra: {
      type: "album",
      album_id: String(info.albumID ?? 0),
      album_mid: albumMID,
      company: data.company?.name ?? "",
      publish_time: info.publishDate ?? "",
    },
  };

  return { album, songs };
}

// ---------------------------------------------------------------------------
// qq.go — 歌单详情（双端点回退 + JSONP 剥壳）
// ---------------------------------------------------------------------------

interface QQCdlistSongItem {
  songid?: number;
  songname?: string;
  songmid?: string;
  albumname?: string;
  albummid?: string;
  interval?: number;
  size128?: number;
  size320?: number;
  sizeflac?: number;
  pay?: { payplay?: number };
  singer?: { name?: string }[];
}

async function fetchPlaylistDetail(id: string): Promise<{ playlist: Playlist; songs: Song[] }> {
  const params = new URLSearchParams({
    type: "1",
    json: "1",
    utf8: "1",
    onlysong: "0",
    disstid: id,
    format: "json",
    g_tk: "5381",
    loginUin: "0",
    hostUin: "0",
    inCharset: "utf8",
    outCharset: "utf-8",
    notice: "0",
    platform: "yqq",
    needNewCode: "0",
  });

  interface CdlistResp {
    code?: number;
    subcode?: number;
    msg?: string;
    cdlist?: {
      dissname?: string;
      logo?: string;
      nickname?: string;
      desc?: string;
      visitnum?: number;
      songnum?: number;
      songlist?: QQCdlistSongItem[];
    }[];
  }

  const endpoints = [
    "https://i.y.qq.com/qzone-music/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg",
    "http://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg",
  ];
  let resp: CdlistResp | null = null;
  let lastErr: Error | null = null;
  for (const endpoint of endpoints) {
    const apiURL = `${endpoint}?${params.toString()}`;
    let body: string;
    try {
      body = await httpGetText(apiURL, {
        headers: {
          "User-Agent": UA_WIN,
          Referer: "https://y.qq.com/",
          Cookie: currentCookie(),
        },
      });
    } catch (e) {
      lastErr = e as Error;
      continue;
    }

    let text = body;
    const idx = text.indexOf("(");
    if (idx >= 0 && text.trim().endsWith(")")) {
      text = text.slice(idx + 1, text.length - 1);
    }
    try {
      resp = JSON.parse(text) as CdlistResp;
    } catch (e) {
      lastErr = new Error(`qq playlist detail json error: ${String(e)}`);
      continue;
    }
    if ((resp.cdlist?.length ?? 0) > 0 && resp.subcode === 0) {
      lastErr = null;
      break;
    }
    lastErr = new Error(`qq playlist detail api error: subcode=${resp.subcode} msg=${resp.msg}`);
  }

  if (!resp || (resp.cdlist?.length ?? 0) === 0) {
    if (lastErr) throw lastErr;
    throw new Error("playlist not found (empty cdlist)");
  }

  const info = resp.cdlist![0]!;

  const playlist: Playlist = {
    source: "qq",
    id,
    name: info.dissname ?? "",
    cover: info.logo ?? "",
    track_count: info.songnum ?? 0,
    play_count: info.visitnum ?? 0,
    creator: info.nickname ?? "",
    description: info.desc ?? "",
    link: `https://y.qq.com/n/ryqq/playlist/${id}`,
  };

  const songs: Song[] = [];
  for (const item of info.songlist ?? []) {
    const artistNames = (item.singer ?? []).map((s) => s.name ?? "");
    const coverURL = item.albummid ? qqCover(item.albummid) : "";
    const { size, bitrate } = pickQuality(item.size128 ?? 0, item.size320 ?? 0, item.sizeflac ?? 0, item.interval ?? 0);
    songs.push({
      source: "qq",
      id: item.songmid ?? "",
      name: item.songname ?? "",
      artist: artistNames.join("、"),
      album: item.albumname ?? "",
      duration: item.interval ?? 0,
      size,
      bitrate,
      cover: coverURL,
      url: "",
      link: `https://y.qq.com/n/ryqq/songDetail/${item.songmid ?? ""}`,
      extra: {
        songmid: item.songmid ?? "",
      },
    });
  }
  return { playlist, songs };
}

// ---------------------------------------------------------------------------
// provider 主体
// ---------------------------------------------------------------------------

export const qq: MusicProvider = {
  name: "qq",
  label: "QQ音乐",
  supportsFlac: true,

  // song.go — Search
  async search(keyword: string): Promise<Song[]> {
    const params = new URLSearchParams({ w: keyword, format: "json", p: "1", n: "10" });
    const apiURL = `http://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?${params.toString()}`;

    const body = await httpGetText(apiURL, {
      headers: {
        "User-Agent": USER_AGENT,
        Referer: SEARCH_REFERER,
        Cookie: currentCookie(),
      },
    });

    let resp: {
      data?: {
        song?: {
          list?: {
            songid?: number;
            songname?: string;
            songmid?: string;
            albumname?: string;
            albummid?: string;
            interval?: number;
            size128?: number;
            size320?: number;
            sizeflac?: number;
            singer?: { name?: string }[];
            pay?: { paydownload?: number; payplay?: number; paytrackprice?: number };
          }[];
        };
      };
    };
    try {
      resp = JSON.parse(body) as typeof resp;
    } catch (e) {
      throw new Error(`qq json parse error: ${String(e)}`);
    }

    const isVip = await isVipAccount().catch(() => false);

    const songs: Song[] = [];
    for (const item of resp.data?.song?.list ?? []) {
      // Hide VIP-only songs for non-VIP accounts.
      if (!isVip && item.pay?.payplay === 1) {
        continue;
      }

      const artistNames = (item.singer ?? []).map((s) => s.name ?? "");
      const coverURL = item.albummid ? qqCover(item.albummid) : "";
      const { size, bitrate } = pickQuality(item.size128 ?? 0, item.size320 ?? 0, item.sizeflac ?? 0, item.interval ?? 0);

      songs.push({
        source: "qq",
        id: item.songmid ?? "",
        name: item.songname ?? "",
        artist: artistNames.join("、"),
        album: item.albumname ?? "",
        duration: item.interval ?? 0,
        size,
        bitrate,
        cover: coverURL,
        url: "",
        link: `https://y.qq.com/n/ryqq/songDetail/${item.songmid ?? ""}`,
        extra: {
          songmid: item.songmid ?? "",
          song_id: String(item.songid ?? 0),
        },
      });
    }
    return songs;
  },

  // song.go — Parse
  async parse(link: string): Promise<Song> {
    let songMID = "";

    // Try songDetail/xxx format
    const m = link.match(/songDetail\/(\w+)/);
    if (m) {
      songMID = m[1] ?? "";
    }

    // Try playsong.html?songid=xxx or songmid query param
    if (songMID === "") {
      try {
        const u = new URL(link);
        const id = u.searchParams.get("songid") ?? "";
        if (id !== "") {
          // Numeric songid — fetch detail by ID
          const song = await fetchSongDetailByID(id);
          try {
            song.url = await qq.getStreamUrl(song);
          } catch {
            /* keep URL empty */
          }
          return song;
        }
        const mid = u.searchParams.get("songmid") ?? "";
        if (mid !== "") {
          songMID = mid;
        }
      } catch {
        /* url parse error — fallthrough */
      }
    }

    if (songMID === "") {
      throw new Error("invalid qq music link");
    }

    const song = await fetchSongDetail(songMID);
    try {
      song.url = await qq.getStreamUrl(song);
    } catch {
      /* keep URL empty */
    }
    return song;
  },

  // download.go — GetDownloadURL
  async getStreamUrl(song: Song): Promise<string> {
    if (song.source !== "qq") {
      throw new Error("source mismatch");
    }

    let songMID = song.id;
    if (song.extra && song.extra["songmid"] !== "") {
      songMID = song.extra["songmid"];
    }

    const guid = String(Math.floor(Math.random() * 9000000000) + 1000000000);

    // Request qualities from best to worst and use the first successful one.
    let prefixes: string[];
    let exts: string[];

    const isVip = await isVipAccount().catch(() => false);
    if (isVip) {
      prefixes = ["AI00", "Q001", "Q000", "F000", "O801", "M800", "M500"]; // Master, Atmos5.1, Atmos2.0, FLAC, 640k, 320k, 128k
      exts = ["flac", "flac", "flac", "flac", "ogg", "mp3", "mp3"];
    } else {
      prefixes = ["M800", "M500"]; // Non-VIPs typically only reach 128kbps natively unless the track is free 320k
      exts = ["mp3", "mp3"];
    }

    const filenames: string[] = [];
    const songmids: string[] = [];
    const songtypes: number[] = [];
    for (let i = 0; i < prefixes.length; i++) {
      filenames.push(`${prefixes[i]}${songMID}${songMID}.${exts[i]}`);
      songmids.push(songMID);
      songtypes.push(0);
    }

    const reqData = {
      comm: {
        cv: 4747474,
        ct: 24,
        format: "json",
        inCharset: "utf-8",
        outCharset: "utf-8",
        notice: 0,
        platform: "yqq.json",
        needNewCode: 1,
        uin: 0,
      },
      req_1: {
        module: "music.vkey.GetVkey",
        method: "UrlGetVkey",
        param: {
          guid,
          songmid: songmids,
          songtype: songtypes,
          uin: "0",
          loginflag: 1,
          platform: "20",
          filename: filenames,
        },
      },
    };

    const result = await httpPostJSON<{
      req_1?: { data?: { midurlinfo?: { filename?: string; purl?: string }[] } };
    }>("https://u.y.qq.com/cgi-bin/musicu.fcg", reqData, {
      headers: {
        "User-Agent": USER_AGENT,
        Referer: DOWNLOAD_REFERER,
        "Content-Type": "application/json",
        Cookie: currentCookie(),
      },
    });

    // We iterate the initial array order we asked for and grab the first `filename` that got a `purl`.
    for (const expectedFilename of filenames) {
      for (const info of result.req_1?.data?.midurlinfo ?? []) {
        if (info.filename === expectedFilename && info.purl !== "") {
          return `https://ws.stream.qqmusic.qq.com/${info.purl}`;
        }
      }
    }

    throw new Error("no valid download url found or vip required");
  },

  // lyric.go — GetLyrics
  async getLyric(song: Song): Promise<string> {
    if (song.source !== "qq") {
      throw new Error("source mismatch");
    }

    let songMID = song.id;
    if (song.extra && song.extra["songmid"] !== "") {
      songMID = song.extra["songmid"];
    }

    let songID = atoi(song.id);
    if (song.extra && song.extra["song_id"] !== "") {
      songID = atoi(song.extra["song_id"]);
    }
    if (songID === 0) {
      try {
        const parsed = await fetchSongDetail(songMID);
        if (parsed && parsed.extra && parsed.extra["song_id"] !== "") {
          songID = atoi(parsed.extra["song_id"]);
        }
        if (song.name === "") song.name = parsed.name;
        if (song.artist === "") song.artist = parsed.artist;
        if (song.album === "") song.album = parsed.album;
        if (song.duration === 0) song.duration = parsed.duration;
      } catch {
        /* keep songID 0 */
      }
    }
    if (songID === 0) {
      throw new Error("qq song id not found");
    }

    const reqData = {
      comm: {
        ct: 11,
        cv: "1003006",
        v: "1003006",
        os_ver: "15",
        phonetype: "24122RKC7C",
        rom: "Redmi/miro/miro:15/AE3A.240806.005/OS2.0.105.0.VOMCNXM:user/release-keys",
        tmeAppID: "qqmusiclight",
        nettype: "NETWORK_WIFI",
        udid: "0",
        uid: "0",
        sid: "",
        loginUin: "0",
        platform: "yqq.json",
        needNewCode: 0,
      },
      request: {
        method: "GetPlayLyricInfo",
        module: "music.musichallSong.PlayLyricInfo",
        param: {
          albumName: Buffer.from(song.album, "utf8").toString("base64"),
          crypt: 1,
          ct: 19,
          cv: 2111,
          interval: song.duration,
          lrc_t: 0,
          qrc: 1,
          qrc_t: 0,
          roma: 1,
          roma_t: 0,
          singerName: Buffer.from(song.artist, "utf8").toString("base64"),
          songID,
          songName: Buffer.from(song.name, "utf8").toString("base64"),
          trans: 1,
          trans_t: 0,
          type: 0,
        },
      },
    };

    const resp = await httpPostJSON<{
      code?: number;
      request?: {
        code?: number;
        data?: { lyric?: string; trans?: string; roma?: string };
      };
    }>("https://u.y.qq.com/cgi-bin/musicu.fcg", reqData, {
      headers: {
        Referer: LYRIC_REFERER,
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
        Cookie: currentCookie(),
      },
    });

    if ((resp.code ?? 0) !== 0 || (resp.request?.code ?? 0) !== 0) {
      throw new Error(`qq lyric api error code: ${resp.code ?? 0}/${resp.request?.code ?? 0}`);
    }
    if ((resp.request?.data?.lyric ?? "") === "") {
      throw new Error("lyric is empty or not found");
    }

    const tags: Record<string, string> = { ti: song.name, ar: song.artist, al: song.album };
    const data: QrcMultiData = {};
    for (const item of [
      { key: "orig", raw: resp.request?.data?.lyric ?? "" },
      { key: "ts", raw: resp.request?.data?.trans ?? "" },
      { key: "roma", raw: resp.request?.data?.roma ?? "" },
    ]) {
      if (item.raw.trim() === "") continue;
      let decrypted: string;
      try {
        decrypted = decryptQRCHex(item.raw);
      } catch {
        continue;
      }
      const [qrcTags, qrcData] = parseQRC(decrypted);
      if (item.key === "orig") {
        for (const [k, v] of Object.entries(qrcTags)) {
          if ((tags[k] ?? "").trim() === "") {
            tags[k] = v;
          }
        }
      }
      data[item.key] = qrcData;
    }
    if (!data["orig"] || data["orig"].length === 0) {
      throw new Error("lyric is empty or qrc decrypt failed");
    }
    return convertVerbatimLRC(tags, data, defaultDisplayOrder());
  },

  // album.go — SearchAlbum
  async searchAlbum(keyword: string): Promise<Playlist[]> {
    const params = new URLSearchParams({ format: "json", p: "1", n: "10", w: keyword, t: "8" });
    const apiURL = `http://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?${params.toString()}`;

    const body = await httpGetText(apiURL, {
      headers: {
        "User-Agent": UA_WIN,
        Referer: "https://y.qq.com/portal/search.html",
        Cookie: currentCookie(),
      },
    });

    let resp: {
      data?: {
        album?: {
          list?: { albumID?: number; albumMID?: string; albumName?: string; publicTime?: string; singerName?: string }[];
        };
      };
    };
    try {
      resp = JSON.parse(body) as typeof resp;
    } catch (e) {
      throw new Error(`qq album json parse error: ${String(e)}`);
    }

    const albums: Playlist[] = [];
    for (const item of resp.data?.album?.list ?? []) {
      if ((item.albumMID ?? "") === "") continue;
      albums.push({
        source: "qq",
        id: item.albumMID ?? "",
        name: item.albumName ?? "",
        cover: qqCover(item.albumMID ?? ""),
        track_count: 0,
        play_count: 0,
        creator: item.singerName ?? "",
        description: "",
        link: `https://y.qq.com/n/ryqq/albumDetail/${item.albumMID ?? ""}`,
        extra: {
          type: "album",
          album_id: String(item.albumID ?? 0),
          album_mid: item.albumMID ?? "",
          publish_time: item.publicTime ?? "",
        },
      });
    }

    if (albums.length === 0) {
      throw new Error("no albums found");
    }
    return albums;
  },

  // album.go — GetAlbumSongs
  async getAlbumSongs(id: string): Promise<Song[]> {
    const { songs } = await fetchAlbumDetail(id);
    return songs;
  },

  // album.go — ParseAlbum
  async parseAlbum(link: string): Promise<PlaylistDetail> {
    const patterns = [/albumDetail\/([A-Za-z0-9]+)/, /album\/([A-Za-z0-9]+)/, /albummid=([A-Za-z0-9]+)/];
    for (const pattern of patterns) {
      const m = pattern.exec(link);
      if (m && m.length >= 2) {
        const { album, songs } = await fetchAlbumDetail(m[1]!);
        return { playlist: album, songs };
      }
    }
    throw new Error("invalid qq album link");
  },

  // playlist.go — SearchPlaylist
  async searchPlaylist(keyword: string): Promise<Playlist[]> {
    const params = new URLSearchParams({
      query: keyword,
      page_no: "0",
      num_per_page: "20",
      format: "json",
      remoteplace: "txt.yqq.playlist",
      flag_qc: "0",
    });
    const apiURL = `http://c.y.qq.com/soso/fcgi-bin/client_music_search_songlist?${params.toString()}`;

    const raw = await httpGetText(apiURL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        Referer: "https://y.qq.com/portal/search.html",
        Cookie: currentCookie(),
      },
    });

    let text = raw;
    const idx = text.indexOf("(");
    if (idx >= 0) {
      const idx2 = text.lastIndexOf(")");
      if (idx2 >= 0) {
        text = text.slice(idx + 1, idx2);
      }
    }

    let resp: {
      code?: number;
      data?: {
        list?: { dissid?: string; dissname?: string; imgurl?: string; song_count?: number; listennum?: number; creator?: { name?: string } }[];
      };
      message?: string;
    };
    try {
      resp = JSON.parse(text) as typeof resp;
    } catch (e) {
      throw new Error(`qq playlist json parse error: ${String(e)}`);
    }

    const playlists: Playlist[] = [];
    for (const item of resp.data?.list ?? []) {
      let cover = item.imgurl ?? "";
      if (cover !== "" && cover.startsWith("http://")) {
        cover = cover.replace("http://", "https://");
      }
      playlists.push({
        source: "qq",
        id: item.dissid ?? "",
        name: item.dissname ?? "",
        cover,
        track_count: item.song_count ?? 0,
        play_count: item.listennum ?? 0,
        creator: item.creator?.name ?? "",
        description: "",
        link: `https://y.qq.com/n/ryqq/playlist/${item.dissid ?? ""}`,
      });
    }

    if (playlists.length === 0) {
      throw new Error("no playlists found");
    }
    return playlists;
  },

  // playlist.go — GetPlaylistSongs
  async getPlaylistSongs(id: string): Promise<Song[]> {
    const tid = id.trim();
    if (tid === QQ_FAVORITE_SONGS_PLAYLIST_ID) {
      const uin = normalizeQQUIN(currentCookie());
      if (uin === "") {
        throw new Error("qq favorite songs require uin cookie");
      }
      const { songs } = await fetchProfileOrderSongs(uin, 1, 300);
      return songs;
    }
    if (tid.startsWith(QQ_PROFILE_DIR_PLAYLIST_PREFIX)) {
      return fetchProfileDirPlaylistSongs(tid.slice(QQ_PROFILE_DIR_PLAYLIST_PREFIX.length));
    }
    const { songs } = await fetchPlaylistDetail(tid);
    return songs;
  },

  // playlist.go — ParsePlaylist
  async parsePlaylist(link: string): Promise<PlaylistDetail> {
    const dissid = extractQQPlaylistID(link);
    if (dissid === "") {
      throw new Error("invalid qq playlist link");
    }
    const { playlist, songs } = await fetchPlaylistDetail(dissid);
    return { playlist, songs };
  },

  // playlist.go — GetRecommendedPlaylists
  async getRecommendedPlaylists(): Promise<Playlist[]> {
    const reqData = {
      comm: { ct: 24 },
      recomPlaylist: {
        method: "get_hot_recommend",
        module: "playlist.HotRecommendServer",
        param: { async: 1, cmd: 2 },
      },
    };

    const resp = await httpPostJSON<{
      code?: number;
      recomPlaylist?: {
        data?: {
          v_hot?: {
            content_id?: number;
            title?: string;
            cover?: string;
            listen_num?: number;
            song_cnt?: number;
            song_count?: number;
            username?: string;
          }[];
        };
      };
    }>("https://u.y.qq.com/cgi-bin/musicu.fcg", reqData, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        Referer: "https://y.qq.com/",
        "Content-Type": "application/json",
        Cookie: currentCookie(),
      },
    });

    if ((resp.code ?? 0) !== 0) {
      throw new Error(`qq api error code: ${resp.code ?? 0}`);
    }

    const playlists: Playlist[] = [];
    for (const item of resp.recomPlaylist?.data?.v_hot ?? []) {
      let cover = item.cover ?? "";
      if (cover !== "" && cover.startsWith("http://")) {
        cover = cover.replace("http://", "https://");
      }
      const playlistID = String(item.content_id ?? 0);
      let trackCount = item.song_cnt ?? 0;
      if (trackCount === 0) {
        trackCount = item.song_count ?? 0;
      }
      playlists.push({
        source: "qq",
        id: playlistID,
        name: item.title ?? "",
        cover,
        play_count: item.listen_num ?? 0,
        track_count: trackCount,
        creator: item.username ?? "",
        description: "",
        link: `https://y.qq.com/n/ryqq/playlist/${playlistID}`,
      });
    }

    if (playlists.length === 0) {
      throw new Error("no recommended playlists found");
    }
    return playlists;
  },

  // playlist.go — GetPlaylistCategories
  async getPlaylistCategories(): Promise<PlaylistCategory[]> {
    const params = new URLSearchParams({ format: "json", inCharset: "utf8", outCharset: "utf-8" });
    const apiURL = `https://c.y.qq.com/splcloud/fcgi-bin/fcg_get_diss_tag_conf.fcg?${params.toString()}`;

    const body = await httpGetText(apiURL, {
      headers: {
        "User-Agent": UA_WIN,
        Referer: "https://y.qq.com/",
        Cookie: currentCookie(),
      },
    });

    let resp: {
      code?: number;
      data?: {
        categories?: {
          categoryGroupName?: string;
          items?: { categoryId?: number; categoryName?: string; usable?: number }[];
        }[];
      };
      message?: string;
    };
    try {
      resp = JSON.parse(body) as typeof resp;
    } catch (e) {
      throw new Error(`qq playlist category json parse error: ${String(e)}`);
    }
    if ((resp.code ?? 0) !== 0) {
      throw new Error(`qq playlist category api error: ${resp.message ?? ""} (code ${resp.code ?? 0})`);
    }

    const categories: PlaylistCategory[] = [
      { source: "qq", id: "", name: "全部", group: "全部", count: 0 },
    ];
    for (const group of resp.data?.categories ?? []) {
      const groupName = (group.categoryGroupName ?? "").trim();
      for (const item of group.items ?? []) {
        if (item.usable === 0 || item.categoryId === 0 || item.categoryId === 10000000) {
          continue;
        }
        const name = (item.categoryName ?? "").trim();
        if (name === "") continue;
        const categoryID = String(item.categoryId ?? 0);
        categories.push({
          source: "qq",
          id: categoryID,
          name,
          group: groupName,
          count: 0,
          extra: { category_id: categoryID },
        });
      }
    }
    return categories;
  },

  // playlist.go — GetCategoryPlaylists
  async getCategoryPlaylists(categoryID: string, page: number, limit: number): Promise<Playlist[]> {
    categoryID = categoryID.trim();
    if (categoryID === "") {
      categoryID = "10000000";
    }
    if (page < 1) page = 1;
    if (limit < 1) limit = 20;
    const offset = (page - 1) * limit;

    const params = new URLSearchParams({
      picmid: "1",
      rnd: "0.1",
      g_tk: "5381",
      loginUin: "0",
      hostUin: "0",
      format: "json",
      inCharset: "utf8",
      outCharset: "utf-8",
      notice: "0",
      platform: "yqq.json",
      needNewCode: "0",
      categoryId: categoryID,
      sortId: "5",
      sin: String(offset),
      ein: String(offset + limit - 1),
    });
    const apiURL = `https://c.y.qq.com/splcloud/fcgi-bin/fcg_get_diss_by_tag.fcg?${params.toString()}`;

    const body = await httpGetText(apiURL, {
      headers: {
        "User-Agent": UA_WIN,
        Referer: "https://y.qq.com/",
        Cookie: currentCookie(),
      },
    });

    let resp: {
      code?: number;
      data?: {
        list?: {
          dissid?: string;
          dissname?: string;
          imgurl?: string;
          introduction?: string;
          listennum?: number;
          song_count?: number;
          song_num?: number;
          creator?: { name?: string };
        }[];
      };
      message?: string;
    };
    try {
      resp = JSON.parse(body) as typeof resp;
    } catch (e) {
      throw new Error(`qq category playlist json parse error: ${String(e)}`);
    }
    if ((resp.code ?? 0) !== 0) {
      throw new Error(`qq category playlist api error: ${resp.message ?? ""} (code ${resp.code ?? 0})`);
    }

    const playlists: Playlist[] = [];
    for (const item of resp.data?.list ?? []) {
      const playlistID = (item.dissid ?? "").trim();
      const name = (item.dissname ?? "").trim();
      if (playlistID === "" || name === "") continue;
      let cover = item.imgurl ?? "";
      if (cover.startsWith("http://")) {
        cover = cover.replace("http://", "https://");
      }
      let trackCount = item.song_count ?? 0;
      if (trackCount === 0) {
        trackCount = item.song_num ?? 0;
      }
      playlists.push({
        source: "qq",
        id: playlistID,
        name,
        cover,
        track_count: trackCount,
        play_count: item.listennum ?? 0,
        creator: item.creator?.name ?? "",
        description: item.introduction ?? "",
        link: `https://y.qq.com/n/ryqq/playlist/${playlistID}`,
        extra: { category_id: categoryID },
      });
    }
    if (playlists.length === 0) {
      throw new Error("no category playlists found");
    }
    return playlists;
  },

  // user_playlist.go — GetUserPlaylists
  async getUserPlaylists(page: number, limit: number): Promise<Playlist[]> {
    const cookie = currentCookie();
    if (cookie.trim() === "") {
      throw new Error("qq user playlists require cookie");
    }
    if (page < 1) page = 1;
    if (limit <= 0) limit = 30;
    if (limit > 100) limit = 100;
    const uin = normalizeQQUIN(cookie);
    if (uin === "") {
      throw new Error("qq user playlists require uin cookie");
    }
    const playlists: Playlist[] = [];
    const seen = new Set<string>();
    const addPlaylist = (playlist: Playlist) => {
      playlist.id = playlist.id.trim();
      playlist.name = playlist.name.trim();
      if (playlist.id === "" || playlist.name === "" || seen.has(playlist.id)) {
        return;
      }
      seen.add(playlist.id);
      playlists.push(playlist);
    };

    try {
      const favorite = await fetchFavoriteSongsPlaylistSummary(uin);
      if (favorite.track_count > 0) {
        addPlaylist(favorite);
      }
    } catch {
      /* ignore favorite summary error */
    }

    const params = new URLSearchParams({
      hostuin: uin,
      sin: String((page - 1) * limit),
      size: String(limit),
      format: "json",
      inCharset: "utf8",
      outCharset: "utf-8",
    });
    const apiURL = `https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss?${params.toString()}`;
    const body = await httpGetText(apiURL, {
      headers: {
        "User-Agent": UA_WIN,
        Referer: "https://y.qq.com/",
        Cookie: cookie,
      },
    });

    let resp: {
      code?: number;
      data?: {
        disslist?: {
          dirid?: number;
          dissid?: number;
          tid?: number;
          diss_name?: string;
          title?: string;
          diss_cover?: string;
          cover?: string;
          song_cnt?: number;
          song_num?: number;
          song_count?: number;
          listen_num?: number;
          visitnum?: number;
          diss_desc?: string;
          desc?: string;
          commit_time?: string;
        }[];
        list?: {
          dissid?: string;
          dissname?: string;
          imgurl?: string;
          song_count?: number;
          song_num?: number;
          listennum?: number;
          introduction?: string;
        }[];
      };
      message?: string;
    };
    try {
      resp = JSON.parse(body) as typeof resp;
    } catch (e) {
      throw new Error(`qq user playlist json parse error: ${String(e)}`);
    }
    if ((resp.code ?? 0) !== 0) {
      throw new Error(`qq user playlist api error: ${resp.message ?? ""} (code ${resp.code ?? 0})`);
    }

    for (const item of resp.data?.disslist ?? []) {
      let playlistID = "";
      if ((item.dissid ?? 0) > 0) {
        playlistID = String(item.dissid ?? 0);
      } else if ((item.tid ?? 0) > 0) {
        playlistID = String(item.tid ?? 0);
      } else if ((item.dirid ?? 0) > 0) {
        playlistID = QQ_PROFILE_DIR_PLAYLIST_PREFIX + String(item.dirid ?? 0);
      }
      if (playlistID === "") continue;
      const name = firstNonEmpty(item.diss_name, item.title);
      if (playlistID === "" || name === "") continue;
      let trackCount = item.song_count ?? 0;
      if (trackCount === 0) trackCount = item.song_num ?? 0;
      if (trackCount === 0) trackCount = item.song_cnt ?? 0;
      let dirID = "";
      if ((item.dirid ?? 0) > 0) {
        dirID = String(item.dirid ?? 0);
      }
      let playCount = item.listen_num ?? 0;
      if (playCount === 0) playCount = item.visitnum ?? 0;
      addPlaylist({
        source: "qq",
        id: playlistID,
        name,
        cover: normalizeQQCover(firstNonEmpty(item.diss_cover, item.cover)),
        track_count: trackCount,
        play_count: playCount,
        creator: uin,
        description: firstNonEmpty(item.diss_desc, item.desc),
        link: qqPlaylistLink(playlistID, firstNonEmpty(qqCookieValue(cookie, "euin"), uin), dirID),
        extra: {
          uin,
          dirid: dirID,
          commit_time: item.commit_time ?? "",
        },
      });
    }
    for (const item of resp.data?.list ?? []) {
      const playlistID = (item.dissid ?? "").trim();
      const name = (item.dissname ?? "").trim();
      if (playlistID === "" || name === "") continue;
      let trackCount = item.song_count ?? 0;
      if (trackCount === 0) trackCount = item.song_num ?? 0;
      addPlaylist({
        source: "qq",
        id: playlistID,
        name,
        cover: normalizeQQCover(item.imgurl ?? ""),
        track_count: trackCount,
        play_count: item.listennum ?? 0,
        creator: uin,
        description: item.introduction ?? "",
        link: `https://y.qq.com/n/ryqq/playlist/${playlistID}`,
        extra: { uin },
      });
    }
    try {
      const collected = await fetchProfileOrderPlaylists(uin, page, limit);
      for (const playlist of collected) {
        addPlaylist(playlist);
      }
    } catch {
      /* ignore collected playlists error */
    }
    return playlists;
  },

  // login.go — CreateQRLogin（默认 QQ 扫码通道；微信通道见文件底部导出函数）
  async createQRLogin(): Promise<QRLoginSession> {
    const params = new URLSearchParams({
      appid: "716027609",
      e: "2",
      l: "M",
      s: "3",
      d: "72",
      v: "4",
      t: (Date.now() * 1e6 / 1e18).toFixed(17),
      daid: "383",
      pt_3rd_aid: "100497308",
    });

    const resp = await httpRequest(`${QQ_QR_SHOW_API}?${params.toString()}`, {
      headers: {
        "User-Agent": UA_WIN,
        Referer: "https://y.qq.com/",
      },
    });
    if (!resp.ok) {
      throw new Error(`qq qr show http status ${resp.status}`);
    }
    const image = Buffer.from(await resp.arrayBuffer());
    const cookies = responseCookies(resp);
    const qrsig = (cookies["qrsig"] ?? "").trim();
    if (qrsig === "") {
      throw new Error("qq qr show missing qrsig");
    }

    const key = new URLSearchParams({ qrsig }).toString();
    return {
      source: "qq",
      key,
      url: "",
      image_url: `data:image/png;base64,${image.toString("base64")}`,
      expires_at: Math.floor(Date.now() / 1000) + 2 * 60,
      extra: { qrsig },
    };
  },

  // login.go — CheckQRLogin
  async checkQRLogin(key: string): Promise<QRLoginResult> {
    const qrsig = (new URLSearchParams(key).get("qrsig") ?? "").trim();
    if (qrsig === "") {
      throw new Error("qq qr login key missing qrsig");
    }

    const params = new URLSearchParams({
      u1: "https://graph.qq.com/oauth2.0/login_jump",
      ptqrtoken: String(hash33(qrsig)),
      ptredirect: "100",
      h: "1",
      t: "1",
      g: "1",
      from_ui: "1",
      ptlang: "2052",
      action: `0-0-${Date.now()}`,
      js_ver: "21072115",
      js_type: "1",
      login_sig: "",
      pt_uistyle: "40",
      aid: "716027609",
      daid: "383",
      pt_3rd_aid: "100497308",
      has_onekey: "1",
      pttype: "1",
      service: "ptqrlogin",
      nodirect: "0",
    });

    const resp = await httpRequest(`${QQ_QR_CHECK_API}?${params.toString()}`, {
      headers: {
        "User-Agent": UA_WIN,
        Referer: "https://xui.ptlogin2.qq.com/",
        Cookie: `qrsig=${qrsig}`,
      },
    });
    const raw = await resp.text();
    const { code, message, redirectURL } = parseQQQRCheck(raw);
    const result: QRLoginResult = {
      source: "qq",
      key,
      status: mapQQQRStatus(code),
      message,
      extra: { code },
    };
    if (result.status !== "success") {
      return result;
    }

    let cookies = responseCookies(resp);
    if (redirectURL !== "") {
      try {
        const redirectCookies = await fetchQQRedirectCookies(redirectURL, cookies);
        cookies = { ...cookies, ...redirectCookies };
      } catch (e) {
        result.extra!["redirect_error"] = String(e);
      }
    }
    result.cookies = normalizeQQMusicCookies(cookies);
    result.cookie = joinCookieMap(result.cookies);
    setCookie("qq", result.cookie);
    vipCache = null; // 对齐 Go: q.isVipCache = nil
    return result;
  },
};

// ---------------------------------------------------------------------------
// playlist.go — 链接解析辅助
// ---------------------------------------------------------------------------

function extractQQPlaylistID(link: string): string {
  link = link.trim();
  if (link === "") return "";

  try {
    const parsed = new URL(link);
    const pathValue = parsed.pathname.toLowerCase();
    if (pathValue.includes("playlist")) {
      for (const key of ["id", "disstid", "dissid"]) {
        const id = normalizeQQPlaylistID(parsed.searchParams.get(key) ?? "");
        if (id !== "") return id;
      }
    }

    const parts = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/");
    for (let i = 0; i < parts.length; i++) {
      if (parts[i]!.toLowerCase() === "playlist" && i + 1 < parts.length) {
        const id = normalizeQQPlaylistID(parts[i + 1]!);
        if (id !== "") return id;
      }
    }
  } catch {
    /* fallthrough to regex */
  }

  const m = link.match(/(?:^|\/)playlist\/(\d+)(?:[\/?#]|$)/);
  if (m && m.length >= 2) {
    return m[1]!;
  }

  return "";
}

function normalizeQQPlaylistID(value: string): string {
  value = value.trim();
  if (value === "") return "";
  if (!/^\d+$/.test(value)) return "";
  return value;
}

// ---------------------------------------------------------------------------
// user_playlist.go — 收藏歌曲 / 收藏歌单 / 目录歌单
// ---------------------------------------------------------------------------

function profileOrderAssetParams(uin: string, reqtype: string, page: number, limit: number): URLSearchParams {
  if (page < 1) page = 1;
  if (limit < 1) limit = 50;
  const offset = (page - 1) * limit;
  return new URLSearchParams({
    format: "json",
    inCharset: "utf8",
    outCharset: "utf-8",
    platform: "yqq.json",
    needNewCode: "0",
    loginUin: uin,
    hostUin: "0",
    notice: "0",
    g_tk: "5381",
    ct: "20",
    cid: "205360956",
    userid: uin,
    reqtype,
    sin: String(offset),
    ein: String(offset + limit - 1),
  });
}

async function fetchFavoriteSongsPlaylistSummary(uin: string): Promise<Playlist> {
  const { total, songs } = await fetchProfileOrderSongs(uin, 1, 1);
  let cover = "";
  if (songs.length > 0) {
    cover = songs[0]!.cover;
  }
  return {
    source: "qq",
    id: QQ_FAVORITE_SONGS_PLAYLIST_ID,
    name: "我喜欢的歌曲",
    cover,
    track_count: total,
    play_count: 0,
    creator: uin,
    description: "QQ音乐我喜欢的歌曲",
    link: "https://y.qq.com/n/ryqq/profile",
    extra: {
      uin,
      virtual: "favorite_songs",
    },
  };
}

async function fetchProfileOrderPlaylists(uin: string, page: number, limit: number): Promise<Playlist[]> {
  const params = profileOrderAssetParams(uin, "3", page, limit);
  const apiURL = `https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg?${params.toString()}`;
  const body = await httpGetText(apiURL, {
    headers: {
      "User-Agent": UA_WIN,
      Referer: "https://y.qq.com/",
      Cookie: currentCookie(),
    },
  });

  let resp: {
    code?: number;
    msg?: string;
    data?: {
      cdlist?: { dissid?: number; dissname?: string; songnum?: number; listennum?: number; logo?: string; nickname?: string; uin?: number }[];
    };
  };
  try {
    resp = JSON.parse(body) as typeof resp;
  } catch (e) {
    throw new Error(`qq profile playlist json parse error: ${String(e)}`);
  }
  if ((resp.code ?? 0) !== 0) {
    throw new Error(`qq profile playlist api error: ${resp.msg ?? ""} (code ${resp.code ?? 0})`);
  }

  const playlists: Playlist[] = [];
  for (const item of resp.data?.cdlist ?? []) {
    if ((item.dissid ?? 0) <= 0 || (item.dissname ?? "").trim() === "") {
      continue;
    }
    const playlistID = String(item.dissid ?? 0);
    let creator = (item.nickname ?? "").trim();
    if (creator === "" && (item.uin ?? 0) > 0) {
      creator = String(item.uin ?? 0);
    }
    playlists.push({
      source: "qq",
      id: playlistID,
      name: item.dissname ?? "",
      cover: normalizeQQCover(item.logo ?? ""),
      track_count: item.songnum ?? 0,
      play_count: item.listennum ?? 0,
      creator,
      description: "",
      link: `https://y.qq.com/n/ryqq/playlist/${playlistID}`,
      extra: {
        uin,
        collected: "true",
      },
    });
  }
  return playlists;
}

async function fetchProfileOrderSongs(uin: string, page: number, limit: number): Promise<{ total: number; songs: Song[] }> {
  const params = profileOrderAssetParams(uin, "1", page, limit);
  const apiURL = `https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg?${params.toString()}`;
  const body = await httpGetText(apiURL, {
    headers: {
      "User-Agent": UA_WIN,
      Referer: "https://y.qq.com/",
      Cookie: currentCookie(),
    },
  });

  let resp: {
    code?: number;
    msg?: string;
    data?: {
      totalsong?: number;
      songlist?: {
        data?: {
          songid?: number;
          songname?: string;
          songmid?: string;
          albumname?: string;
          albummid?: string;
          interval?: number;
          size128?: number;
          size320?: number;
          sizeflac?: number;
          singer?: { name?: string }[];
        };
      }[];
    };
  };
  try {
    resp = JSON.parse(body) as typeof resp;
  } catch (e) {
    throw new Error(`qq profile songs json parse error: ${String(e)}`);
  }
  if ((resp.code ?? 0) !== 0) {
    throw new Error(`qq profile songs api error: ${resp.msg ?? ""} (code ${resp.code ?? 0})`);
  }

  const songs: Song[] = [];
  for (const item of resp.data?.songlist ?? []) {
    const d = item.data ?? {};
    const song = qqProfileSongToModel(
      d.songid ?? 0,
      d.songname ?? "",
      d.songmid ?? "",
      d.albumname ?? "",
      d.albummid ?? "",
      d.interval ?? 0,
      d.size128 ?? 0,
      d.size320 ?? 0,
      d.sizeflac ?? 0,
      d.singer ?? [],
    );
    if (song.id !== "" && song.name !== "") {
      songs.push(song);
    }
  }
  return { total: resp.data?.totalsong ?? 0, songs };
}

async function fetchProfileDirPlaylistSongs(dirID: string): Promise<Song[]> {
  dirID = dirID.trim();
  if (dirID === "") {
    throw new Error("qq profile dir playlist require dirid");
  }
  const cookie = currentCookie();
  const uin = firstNonEmpty(qqCookieValue(cookie, "euin"), qqCookieValue(cookie, "wxuin"), normalizeQQUIN(cookie));
  if (uin === "") {
    throw new Error("qq profile dir playlist require uin cookie");
  }

  const params = new URLSearchParams({
    uin,
    dirid: dirID,
    new: "0",
    dirinfo: "1",
    miniportal: "1",
    fromDir2Diss: "1",
    mobile: "1",
    from: "0",
    to: "500",
    format: "json",
    g_tk: "5381",
  });
  const apiURL = `http://s.plcloud.music.qq.com/fcgi-bin/fcg_musiclist_getinfo.fcg?${params.toString()}`;
  const body = await httpGetText(apiURL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
      Referer: "https://y.qq.com/w/myalbum.html",
      Cookie: cookie,
    },
  });

  const resp = JSON.parse(stripQQJSONPBody(body)) as {
    code?: unknown;
    msg?: string;
    SongList?: Record<string, unknown>[];
  };
  if (!qqJSONCodeOK(resp.code)) {
    throw new Error(`qq profile dir playlist api error: ${resp.msg ?? ""} (code ${String(resp.code)})`);
  }

  const songs: Song[] = [];
  for (const item of resp.SongList ?? []) {
    const song = qqProfileDirSongToModel(item);
    if (song.id !== "" && song.name !== "") {
      songs.push(song);
    }
  }
  return songs;
}

function qqProfileSongToModel(
  songID: number,
  name: string,
  songMID: string,
  albumName: string,
  albumMID: string,
  interval: number,
  size128: number,
  size320: number,
  sizeFlac: number,
  singers: { name?: string }[],
): Song {
  const artistNames: string[] = [];
  for (const singer of singers) {
    if ((singer.name ?? "").trim() !== "") {
      artistNames.push((singer.name ?? "").trim());
    }
  }
  const { size, bitrate } = pickQuality(size128, size320, sizeFlac, interval);
  if (songMID === "" && songID > 0) {
    songMID = String(songID);
  }
  return {
    source: "qq",
    id: songMID,
    name,
    artist: artistNames.join("、"),
    album: albumName,
    duration: interval,
    size,
    bitrate,
    cover: qqCover(albumMID),
    url: "",
    link: `https://y.qq.com/n/ryqq/songDetail/${songMID}`,
    extra: { songmid: songMID },
  };
}

function qqProfileDirSongToModel(item: Record<string, unknown>): Song {
  const songType = qqMapInt(item, "type");
  const data = qqMapString(item, "data");
  if (data !== "" && songType % 10 >= 2 && songType % 10 <= 4) {
    const parts = data.split("|");
    const value = (index: number): string => {
      if (index >= 0 && index < parts.length) {
        return (parts[index] ?? "").trim();
      }
      return "";
    };
    const songMID = value(0);
    const name = value(1);
    const albumMID = value(4);
    const albumName = value(5);
    const interval = qqParseInt64(value(7));
    const size320 = qqParseInt64(value(11));
    const size128 = qqParseInt64(value(12));
    const sizeFlac = qqParseInt64(value(16));
    const { size, bitrate } = pickQuality(size128, size320, sizeFlac, interval);
    return {
      source: "qq",
      id: songMID,
      name,
      artist: value(3),
      album: albumName,
      duration: interval,
      size,
      bitrate,
      cover: qqCover(albumMID),
      url: "",
      link: `https://y.qq.com/n/ryqq/songDetail/${songMID}`,
      extra: { songmid: songMID },
    };
  }

  const songMID = firstNonEmpty(qqMapString(item, "songmid"), qqMapString(item, "mid"), qqMapString(item, "id"));
  const name = firstNonEmpty(qqMapString(item, "songname"), qqMapString(item, "name"));
  const albumMID = firstNonEmpty(qqMapString(item, "albummid"), qqMapString(item, "diskid"));
  return {
    source: "qq",
    id: songMID,
    name,
    artist: firstNonEmpty(qqMapString(item, "singername"), qqMapString(item, "singer")),
    album: firstNonEmpty(qqMapString(item, "albumname"), qqMapString(item, "diskname")),
    duration: qqMapInt(item, "playtime"),
    size: 0,
    bitrate: 0,
    cover: qqCover(albumMID),
    url: "",
    link: `https://y.qq.com/n/ryqq/songDetail/${songMID}`,
    extra: { songmid: songMID },
  };
}

function qqPlaylistLink(playlistID: string, uin: string, dirID: string): string {
  playlistID = playlistID.trim();
  if (playlistID.startsWith(QQ_PROFILE_DIR_PLAYLIST_PREFIX) && dirID.trim() !== "") {
    const params = new URLSearchParams({ dirid: dirID.trim() });
    if (uin.trim() !== "") {
      // 对齐 Go fmt.Sprintf("%X", []byte(uin))：uin 字节的大写 hex
      params.set("bu", Buffer.from(uin.trim(), "utf8").toString("hex").toUpperCase());
    }
    return `https://y.qq.com/w/myalbum.html?${params.toString()}`;
  }
  return `https://y.qq.com/n/ryqq/playlist/${playlistID}`;
}

// ---------------------------------------------------------------------------
// login.go — QQ 扫码登录辅助
// ---------------------------------------------------------------------------

function hash33(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h + (h << 5) + s.charCodeAt(i)) | 0;
  }
  return h & 0x7fffffff;
}

function mapQQQRStatus(code: string): QRLoginResult["status"] {
  switch (code) {
    case "0":
      return "success";
    case "65":
      return "expired";
    case "66":
      return "waiting";
    case "67":
      return "scanned";
    default:
      return "failed";
  }
}

function parseQQQRCheck(raw: string): { code: string; message: string; redirectURL: string } {
  const matches = [...raw.matchAll(/'([^']*)'/g)];
  if (matches.length >= 5) {
    return {
      code: matches[0]![1] ?? "",
      message: matches[4]![1] ?? "",
      redirectURL: matches[2]![1] ?? "",
    };
  }
  return { code: "", message: raw, redirectURL: "" };
}

async function fetchQQRedirectCookies(redirectURL: string, cookies: Record<string, string>): Promise<Record<string, string>> {
  let currentURL = redirectURL.trim();
  const collected: Record<string, string> = { ...cookies };
  let referer = "https://y.qq.com/";

  for (let i = 0; i < 8 && currentURL !== ""; i++) {
    const resp = await httpGetNoRedirect(currentURL, {
      headers: {
        "User-Agent": UA_WIN,
        Referer: referer,
        Cookie: joinCookieMap(collected),
      },
    });

    Object.assign(collected, responseCookies(resp));

    const location = (resp.headers.get("Location") ?? "").trim();
    try {
      await resp.body?.cancel();
    } catch {
      /* ignore */
    }
    if (location === "" || resp.status < 300 || resp.status >= 400) {
      break;
    }
    const nextURL = new URL(location, currentURL);
    referer = currentURL;
    currentURL = nextURL.toString();
  }

  return collected;
}

function normalizeQQMusicCookies(cookies: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = { ...cookies };
  if (result["uin"] === undefined || result["uin"] === "") {
    result["uin"] = firstNonEmpty(
      result["ptui_loginuin"],
      result["luin"],
      result["pt2gguin"],
      result["superuin"],
      result["p_uin"],
      result["musicid"],
      result["userid"],
      result["wxuin"],
    );
  }
  if (result["qqmusic_key"] === undefined || result["qqmusic_key"] === "") {
    result["qqmusic_key"] = firstNonEmpty(result["p_skey"], result["skey"], result["musickey"]);
  }
  if (result["qm_keyst"] === undefined || result["qm_keyst"] === "") {
    result["qm_keyst"] = result["qqmusic_key"] ?? "";
  }
  return result;
}

// ---------------------------------------------------------------------------
// login.go — 微信扫码通道（Go CreateWXQRLogin / CheckWXQRLogin；契约 createQRLogin 无
// loginType 参数故默认走 QQ 通道，此两组函数以独立导出形式保留完整行为）
// ---------------------------------------------------------------------------

export async function createWXQRLogin(): Promise<QRLoginSession> {
  const state = `music-lib-${Date.now() * 1e6}`;
  const params = new URLSearchParams({
    appid: QQ_WX_APP_ID,
    redirect_uri: QQ_WX_REDIRECT_URI,
    response_type: "code",
    scope: "snsapi_login",
    state,
    href: "https://y.qq.com/mediastyle/music_v17/src/css/popup_wechat.css#wechat_redirect",
  });
  const loginURL = `${QQ_WX_QR_CONNECT_API}?${params.toString()}`;

  const resp = await httpRequest(loginURL, {
    headers: {
      "User-Agent": UA_WIN,
      Referer: "https://y.qq.com/",
    },
  });
  if (!resp.ok) {
    throw new Error(`qq wx qr connect http status ${resp.status}`);
  }
  const body = await resp.text();
  const uuid = parseQQWXQRUUID(body);
  if (uuid === "") {
    throw new Error("qq wx qr connect missing uuid");
  }

  const key = new URLSearchParams({ type: "wx", uuid, state }).toString();
  return {
    source: "qq",
    key,
    url: loginURL,
    image_url: `https://open.weixin.qq.com/connect/qrcode/${encodeURIComponent(uuid)}`,
    expires_at: Math.floor(Date.now() / 1000) + 5 * 60,
    extra: {
      login_type: "wx",
      uuid,
    },
  };
}

export async function checkWXQRLogin(key: string): Promise<QRLoginResult> {
  const values = new URLSearchParams(key);
  let uuid = (values.get("uuid") ?? "").trim();
  let state = (values.get("state") ?? "").trim();
  if (uuid === "") {
    throw new Error("qq wx qr login key missing uuid");
  }
  if (state === "") {
    state = "STATE";
  }

  const params = new URLSearchParams({ uuid, _: String(Date.now()) });
  const resp = await httpRequest(`${QQ_WX_QR_CHECK_API}?${params.toString()}`, {
    headers: {
      "User-Agent": UA_WIN,
      Referer: QQ_WX_QR_CONNECT_API,
    },
  });
  const raw = await resp.text();
  const { code, wxCode } = parseQQWXQRCheck(raw);
  const result: QRLoginResult = {
    source: "qq",
    key,
    status: mapQQWXQRStatus(code),
    message: qqWXQRMessage(code, raw),
    extra: {
      code,
      login_type: "wx",
    },
  };
  if (result.status !== "success") {
    return result;
  }
  if (wxCode === "") {
    result.status = "failed";
    result.message = "wechat auth code missing";
    return result;
  }

  try {
    const { cookies, extra } = await fetchQQWXLoginCookies(wxCode);
    Object.assign(result.extra!, extra);
    result.extra!["state"] = state;
    result.cookies = normalizeQQMusicCookies(cookies);
    result.cookie = joinCookieMap(result.cookies);
    setCookie("qq", result.cookie);
    vipCache = null;
  } catch (e) {
    result.status = "failed";
    result.message = String(e);
  }
  return result;
}

function mapQQWXQRStatus(code: string): QRLoginResult["status"] {
  switch (code) {
    case "405":
      return "success";
    case "402":
      return "expired";
    case "404":
      return "scanned";
    case "408":
      return "waiting";
    default:
      return "failed";
  }
}

function qqWXQRMessage(code: string, raw: string): string {
  switch (code) {
    case "405":
      return "登录成功";
    case "402":
      return "二维码已过期";
    case "404":
      return "已扫码，请在微信中确认";
    case "408":
      return "等待扫码中";
    default:
      return raw.trim();
  }
}

function parseQQWXQRUUID(raw: string): string {
  const patterns = [
    /connect\/l\/qrconnect\?uuid=([A-Za-z0-9_-]+)/,
    /window\.QRLogin\.uuid\s*=\s*"([^"]+)"/,
    /\/connect\/qrcode\/([A-Za-z0-9_-]+)/,
  ];
  for (const pattern of patterns) {
    const m = pattern.exec(raw);
    if (m && m.length > 1 && (m[1] ?? "").trim() !== "") {
      return (m[1] ?? "").trim();
    }
  }
  return "";
}

function parseQQWXQRCheck(raw: string): { code: string; wxCode: string } {
  let code = "";
  let wxCode = "";
  let m = /wx_errcode\s*=\s*'?([0-9]+)'?/.exec(raw);
  if (m && m.length > 1) {
    code = (m[1] ?? "").trim();
  }
  m = /wx_code\s*=\s*["']([^"']*)["']/.exec(raw);
  if (m && m.length > 1) {
    wxCode = (m[1] ?? "").trim();
  }
  return { code, wxCode };
}

async function fetchQQWXLoginCookies(wxCode: string): Promise<{ cookies: Record<string, string>; extra: Record<string, string> }> {
  const payload = JSON.stringify({
    comm: {
      tmeAppID: "qqmusic",
      tmeLoginType: "1",
      g_tk: 5381,
      platform: "yqq",
      ct: 24,
      cv: 0,
    },
    req: {
      module: "music.login.LoginServer",
      method: "Login",
      param: {
        strAppid: QQ_WX_APP_ID,
        code: wxCode,
      },
    },
  });

  const endpoints = [
    "https://u.y.qq.com/cgi-bin/musicu.fcg",
    "https://szu.y.qq.com/cgi-bin/musicu.fcg",
    "https://shu.y.qq.com/cgi-bin/musicu.fcg",
  ];
  let lastErr: Error | null = null;
  for (const apiURL of endpoints) {
    let resp: Response;
    try {
      resp = await httpPostRawBodyText(apiURL, payload, "application/x-www-form-urlencoded", {
        headers: {
          "User-Agent": UA_WIN,
          Referer: QQ_WX_REDIRECT_URI,
          Origin: "https://y.qq.com",
          Accept: "*/*",
          Cookie: "login_type=2",
        },
      });
    } catch (e) {
      lastErr = e as Error;
      continue;
    }
    const cookies = responseCookies(resp);
    let body: string;
    try {
      body = await resp.text();
    } catch (e) {
      lastErr = e as Error;
      continue;
    }
    if (!resp.ok) {
      lastErr = new Error(`qq wx login http status ${resp.status}`);
      continue;
    }

    let parsed: {
      code?: number;
      message?: string;
      msg?: string;
      req?: { code?: number; message?: string; msg?: string; data?: Record<string, unknown> };
    };
    try {
      parsed = JSON.parse(body) as typeof parsed;
    } catch (e) {
      lastErr = new Error(`qq wx login json parse error: ${String(e)}`);
      continue;
    }
    if ((parsed.code ?? 0) !== 0 || (parsed.req?.code ?? 0) !== 0) {
      const msg = firstNonEmpty(parsed.req?.message, parsed.req?.msg, parsed.message, parsed.msg);
      lastErr = new Error(`qq wx login api error: ${msg} (code ${parsed.code ?? 0}, req code ${parsed.req?.code ?? 0})`);
      continue;
    }

    const merged = { ...cookies };
    for (const [k, v] of Object.entries(qqWXLoginDataCookies(parsed.req?.data ?? {}))) {
      if (merged[k] === undefined || merged[k] === "") {
        merged[k] = v;
      }
    }
    return {
      cookies: merged,
      extra: { endpoint: apiURL },
    };
  }
  throw lastErr ?? new Error("qq wx login failed");
}

function qqWXLoginDataCookies(data: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  const value = (...keys: string[]): string => {
    for (const key of keys) {
      const v = data[key];
      if (typeof v === "string") {
        if (v.trim() !== "") return v.trim();
      } else if (typeof v === "number") {
        if (v > 0) return String(Math.trunc(v));
      }
    }
    return "";
  };

  const musicID = value("musicid", "musicId", "userid", "user_id", "uin");
  if (musicID !== "") {
    result["musicid"] = musicID;
  }
  const musicKey = value("musickey", "music_key", "qqmusic_key", "qm_keyst", "strMusicKey");
  if (musicKey !== "") {
    result["musickey"] = musicKey;
    result["qqmusic_key"] = musicKey;
    result["qm_keyst"] = musicKey;
  }
  const refreshKey = value("refresh_key", "refreshKey");
  if (refreshKey !== "") {
    result["refresh_key"] = refreshKey;
  }
  const refreshToken = value("refresh_token", "refreshToken");
  if (refreshToken !== "") {
    result["refresh_token"] = refreshToken;
  }
  const openID = value("openid", "openId", "wxopenid", "strOpenid");
  if (openID !== "") {
    result["openid"] = openID;
    result["wxopenid"] = openID;
  }
  const unionID = value("unionid", "unionId", "wxunionid", "strUnionid");
  if (unionID !== "") {
    result["unionid"] = unionID;
    result["wxunionid"] = unionID;
  }
  const accessToken = value("access_token", "accessToken", "wxaccess_token");
  if (accessToken !== "") {
    result["wxaccess_token"] = accessToken;
  }
  return result;
}
