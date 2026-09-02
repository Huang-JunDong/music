/**
 * 酷狗音乐 Provider — 移植自 music-lib/kugou
 * 覆盖 Go 版全部能力：song parse / album / playlist(含 songlist&cloudlist) / 推荐 / 分类 / 用户歌单 / QR 登录
 */
import crypto from "node:crypto";
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
import { httpGetJSON, httpGetText, httpPostJSON, httpPostJSONText, firstNonEmpty } from "../http";
import { md5hex } from "../crypto";
import { decodeKRC, parseKrcVerbatim, parseLrcVerbatim, convertVerbatimLRC } from "../lyrics";
import { getCookie } from "../cookies";

const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1";
const UA_PC =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";
const UA_ANDROID_KG = "Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi";
const MOBILE_REFERER = "http://m.kugou.com";
const VIP_INFO_API = "https://vip.kugou.com/recharge/roleinfo";
const KUGOU_SIGN_KEY = "NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt";
const KUGOU_LITE_SIGN = "LnT6xpN3khm36zse0QzvmgTZ3waWdRSA";
const KUGOU_LITE_APPID = "3116";
const KUGOU_LITE_VER = "11440";
const KUGOU_LITE_KEY = "185672dd44712f60bb1736df5a377e82";
const KUGOU_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDECi0Np2UR87scwrvTr72L6oO01rBbbBPriSDFPxr3Z5syug0O24QyQO8bg27+0+4kBzTBTBOZ/WWU0WryL1JSXRTXLgFVxtzIY41Pe7lPOgsfTCn5kZcvKhYKJesKnnJDNr5/abvTGf+rHG3YRwsCHcQ08/q6ifSioBszvb3QiwIDAQAB
-----END PUBLIC KEY-----`;

interface KugouSearchItem {
  SongName?: string;
  SingerName?: string;
  AlbumName?: string;
  AlbumID?: string;
  Duration?: number;
  FileHash?: string;
  SQFileHash?: string;
  HQFileHash?: string;
  ResFileHash?: string;
  Image?: string;
  FileSize?: number | string;
  SQFileSize?: number;
  HQFileSize?: number;
  ResFileSize?: number;
  MixSongID?: number | string;
  ID?: number | string;
  Audioid?: number | string;
  Privilege?: number;
  trans_param?: {
    ogg_320_hash?: string;
    ogg_128_hash?: string;
    ogg_320_filesize?: number;
    ogg_128_filesize?: number;
  };
}

/** 常用 HTML 命名实体表（对齐 Go html.UnescapeString 的常用子集） */
const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  middot: "·",
  times: "×",
  divide: "÷",
  deg: "°",
  plusmn: "±",
  para: "¶",
  sect: "§",
  laquo: "«",
  raquo: "»",
  bull: "•",
  dagger: "†",
  prime: "′",
};

function cleanText(value: string | undefined): string {
  if (!value) return "";
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:[a-zA-Z][a-zA-Z0-9]*|#\d{1,5}|#x[0-9a-fA-F]{1,4});/g, (ent) => {
      const body = ent.slice(1, -1);
      if (body.startsWith("#x") || body.startsWith("#X")) {
        const code = parseInt(body.slice(2), 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : ent;
      }
      if (body.startsWith("#")) {
        const code = parseInt(body.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : ent;
      }
      return HTML_ENTITIES[body] ?? ent;
    })
    .trim();
}

function num(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v));
  if (typeof v === "string") return v.trim();
  if (typeof v === "bigint") return v.toString();
  return String(v);
}

/** cookie 注入（对齐 Go Kugou.cookie） */
function kgCookie(): string {
  return getCookie("kugou");
}

function cookieHeaders(): Record<string, string> {
  const cookie = kgCookie();
  return cookie ? { Cookie: cookie } : {};
}

function isValidHash(h: string | undefined): boolean {
  return !!h && h !== "00000000000000000000000000000000";
}

function parseCookieMap(cookie: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of cookie.split(";")) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    result[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return result;
}

function joinCookieMap(cookies: Record<string, string>): string {
  return Object.keys(cookies)
    .filter((k) => k.trim())
    .sort()
    .map((k) => `${k}=${cookies[k]}`)
    .join("; ");
}

/** 签名 — 对齐 Go signKugouSonginfoParams：MD5(key + sorted(k=v) + key) */
function signSonginfoParams(params: Record<string, string>): string {
  const pairs = Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .sort();
  return md5hex(KUGOU_SIGN_KEY + pairs.join("") + KUGOU_SIGN_KEY);
}

/** 签名 — 对齐 Go signKugouAndroidParams：MD5(sign + sorted(k=v) + data + sign) */
function signAndroidParams(params: Record<string, string>, data: string): string {
  const pairs = Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .sort();
  return md5hex(KUGOU_LITE_SIGN + pairs.join("") + data + KUGOU_LITE_SIGN);
}

function buildAndroidURL(baseURL: string, params: Record<string, string>, data: string): string {
  const query = new URLSearchParams(params);
  query.set("signature", signAndroidParams(params, data));
  return `${baseURL}?${query.toString()}`;
}

function normalizeKugouDuration(v: number): number {
  return v > 1000 ? Math.floor(v / 1000) : v;
}

function androidGatewayHeaders(dfid: string, clienttime: string, mid: string): Record<string, string> {
  return {
    "User-Agent": UA_ANDROID_KG,
    dfid,
    clienttime,
    mid,
    "kg-rc": "1",
    "kg-thash": "5d816a0",
    "kg-rec": "1",
    "kg-rf": "B9EDA08A64250DEFFBCADDEE00F8F25F",
    ...cookieHeaders(),
  };
}

// ---------------------------------------------------------------------------
// VIP 状态（对齐 kugou/account.go，10 分钟缓存）
// ---------------------------------------------------------------------------

const vipStatusCache = new Map<string, { isVip: boolean; expiresAt: number }>();

async function isKugouVipAccount(): Promise<boolean> {
  const cookie = kgCookie();
  if (!cookie.trim()) return false;

  const key = md5hex(cookie);
  const cached = vipStatusCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.isVip;

  try {
    const resp = await httpGetJSON<{
      errno?: number;
      error_code?: number;
      role?: number;
      vipRemains?: number;
      isExpiredMember?: number;
    }>(VIP_INFO_API, { headers: { "User-Agent": UA_PC, ...cookieHeaders() } });

    const isVip =
      (resp.errno ?? -1) === 0 &&
      (resp.error_code ?? -1) === 0 &&
      (resp.vipRemains ?? 0) > 0 &&
      (resp.isExpiredMember ?? 1) === 0 &&
      (resp.role ?? 0) !== 0;
    vipStatusCache.set(key, { isVip, expiresAt: Date.now() + 10 * 60 * 1000 });
    return isVip;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// VIP 高音质下载链（对齐 Go kugou/download.go + fetchVIPSongInfo/URLV5/PrivURLV6/songinfoV2）
// ---------------------------------------------------------------------------

/** 对齐 Go collectCandidateHashes：hash → sq → hq → res → ogg320 → file → ogg128 → id，去重过滤全零 */
function collectCandidateHashes(song: Song): string[] {
  const raw = [
    song.extra?.["hash"],
    song.extra?.["sq_hash"],
    song.extra?.["hq_hash"],
    song.extra?.["res_hash"],
    song.extra?.["ogg_320_hash"],
    song.extra?.["file_hash"],
    song.extra?.["ogg_128_hash"],
    song.id,
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of raw) {
    const hash = (h ?? "").trim().toLowerCase();
    if (!isValidHash(hash) || seen.has(hash)) continue;
    seen.add(hash);
    out.push(hash);
  }
  return out;
}

function getKugouPrivilege(song: Song): number {
  const v = (song.extra?.["privilege"] ?? "").trim();
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : -1;
}

/** 对齐 Go kugouHasAppCookie（复用文件尾部既有实现，见用户歌单一节） */

/** 对齐 Go shouldTryKugouHighQualityDownload */
function shouldTryKugouHighQualityDownload(cookie: string, privilege: number): boolean {
  if (privilege === 10 || privilege === 8) return true;
  return kugouHasAppCookie(parseCookieMap(cookie));
}

function looksLossless(ext: string, bitrate: number, size: number): boolean {
  const e = ext.trim().toLowerCase();
  if (e === "flac" || e === "ape" || e === "wav") return true;
  return bitrate >= 700 || size >= 20 * 1024 * 1024;
}

function normalizeKugouBitrate(v: number): number {
  return v > 1000 ? Math.floor(v / 1000) : v;
}

function normalizeKugouExt(extName: string | undefined, downloadURL: string): string {
  const ext = (extName ?? "").trim().toLowerCase();
  if (ext) return ext;
  try {
    const path = new URL(downloadURL).pathname.toLowerCase();
    if (path.endsWith(".flac")) return "flac";
    if (path.endsWith(".ape")) return "ape";
    if (path.endsWith(".mp3")) return "mp3";
  } catch {
    /* ignore */
  }
  return "";
}

function pickKugouResponseURL(resp: Record<string, unknown>): string {
  const unescape = (u: string) => u.replaceAll("\\/", "/");
  const direct = pickUrl(resp["url"] as string | string[] | undefined);
  if (direct) return unescape(direct);
  const backup = pickUrl(resp["backup_url"] as string | string[] | undefined);
  if (backup) return unescape(backup);
  const data = resp["data"];
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    const du = pickUrl(d["url"] as string | string[] | undefined);
    if (du) return unescape(du);
    const db = pickUrl(d["backup_url"] as string | string[] | undefined);
    if (db) return unescape(db);
    for (const key of ["flac", "high", "320", "128", "super"]) {
      const item = d[key];
      if (!item || typeof item !== "object") continue;
      const it = item as Record<string, unknown>;
      const u = pickUrl(it["url"] as string | string[] | undefined);
      if (u) return unescape(u);
      const b = pickUrl(it["backup_url"] as string | string[] | undefined);
      if (b) return unescape(b);
    }
  }
  return "";
}

function findKugouString(resp: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = resp[key];
    if (value !== undefined && value !== null) {
      const s = num(value).trim();
      if (s) return s;
    }
  }
  const data = resp["data"];
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return findKugouString(data as Record<string, unknown>, keys);
  }
  return "";
}

function findKugouInt(resp: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = resp[key];
    if (typeof value === "number") return Math.round(value);
    if (typeof value === "string") {
      const n = parseInt(value.trim(), 10);
      if (Number.isFinite(n)) return n;
    }
  }
  const data = resp["data"];
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return findKugouInt(data as Record<string, unknown>, keys);
  }
  return 0;
}

function randomKugouDFID(): string {
  const value = md5hex(String(process.hrtime.bigint())).toUpperCase();
  return value.length > 24 ? value.slice(0, 24) : value;
}

/** 对齐 Go buildKugouSonginfoURL */
function buildSonginfoURL(params: Record<string, string>): string {
  const query = new URLSearchParams(params);
  query.set("signature", signSonginfoParams(params));
  return `https://wwwapi.kugou.com/play/songinfo?${query.toString()}`;
}

/** 对齐 Go fetchSonginfoV2：两步请求（hash → encode_album_audio_id → play url） */
async function fetchSonginfoV2(hash: string): Promise<Song> {
  const cookieMap = parseCookieMap(kgCookie());
  if (!(cookieMap["t"] ?? "").trim() || !(cookieMap["KugooID"] ?? "").trim()) {
    throw new Error("kugou songinfo v2 requires cookie t and KugooID");
  }

  const baseParams: Record<string, string> = {
    srcappid: "2919",
    clientver: "20000",
    clienttime: String(Date.now()),
    mid: firstNonEmpty(cookieMap["mid"], cookieMap["kg_mid"]),
    uuid: firstNonEmpty(cookieMap["uuid"], cookieMap["mid"], cookieMap["kg_mid"]),
    dfid: firstNonEmpty(cookieMap["dfid"], cookieMap["kg_dfid"]),
    appid: "1014",
    platid: "4",
    token: cookieMap["t"],
    userid: cookieMap["KugooID"],
  };

  const songinfoHeaders = () => ({
    "User-Agent": UA_PC,
    Referer: "https://www.kugou.com/",
    Accept: "application/json, text/plain, */*",
    ...cookieHeaders(),
  });

  const step1Params = { ...baseParams, hash };
  const step1Resp = await httpGetJSON<{
    status?: number;
    data?: {
      hash?: string;
      song_name?: string;
      author_name?: string;
      img?: string;
      album_name?: string;
      encode_album_audio_id?: string;
      album_audio_id?: unknown;
    };
  }>(buildSonginfoURL(step1Params), { headers: songinfoHeaders() });
  const encodeAlbumAudioID = (step1Resp.data?.encode_album_audio_id ?? "").trim();
  if (!encodeAlbumAudioID) throw new Error("kugou songinfo v2 missing encode_album_audio_id");

  const step2Params = { ...baseParams, encode_album_audio_id: encodeAlbumAudioID };
  const step2Resp = await httpGetJSON<{
    status?: number;
    data?: {
      play_url?: string;
      play_backup_url?: string;
      filesize?: number;
      bitrate?: number;
      file_name?: string;
      song_name?: string;
      author_name?: string;
      img?: string;
      timelength?: number;
      extname?: string;
    };
  }>(buildSonginfoURL(step2Params), { headers: songinfoHeaders() });

  const downloadURL = firstNonEmpty(step2Resp.data?.play_url, step2Resp.data?.play_backup_url);
  if (!downloadURL) throw new Error("kugou songinfo v2 missing play url");

  return {
    source: "kugou",
    id: hash,
    name: firstNonEmpty(step2Resp.data?.song_name, step1Resp.data?.song_name),
    artist: firstNonEmpty(step2Resp.data?.author_name, step1Resp.data?.author_name),
    album: step1Resp.data?.album_name ?? "",
    duration: normalizeKugouDuration(step2Resp.data?.timelength ?? 0),
    size: step2Resp.data?.filesize ?? 0,
    bitrate: normalizeKugouBitrate(step2Resp.data?.bitrate ?? 0),
    ext: normalizeKugouExt(step2Resp.data?.extname, downloadURL),
    cover: firstNonEmpty(step2Resp.data?.img, step1Resp.data?.img).replace("{size}", "240"),
    url: downloadURL,
    link: `https://www.kugou.com/song/#hash=${hash}`,
    extra: {
      hash,
      encode_album_audio_id: encodeAlbumAudioID,
      album_audio_id: num(step1Resp.data?.album_audio_id),
    },
  };
}

/** 对齐 Go fetchURLV5：gateway.kugou.com/v5/url（App token 签名 + quality=flac） */
async function fetchURLV5(song: Song | null, hash: string): Promise<Song> {
  hash = hash.trim().toLowerCase();
  if (!isValidHash(hash)) throw new Error("invalid kugou hash");

  const cookie = parseCookieMap(kgCookie());
  const token = (cookie["token"] ?? "").trim();
  const userID = (cookie["userid"] ?? "").trim();
  const mid = (cookie["KUGOU_API_MID"] ?? "").trim();
  if (!token || !userID || userID === "0" || !mid) {
    throw new Error("kugou v5 url requires app token, userid and KUGOU_API_MID");
  }

  let albumAudioID = "0";
  let albumID = "0";
  let name = "";
  let artist = "";
  let album = "";
  if (song) {
    name = song.name;
    artist = song.artist;
    album = song.album;
    albumID = firstNonEmpty(song.album_id, albumID);
    albumAudioID = firstNonEmpty(song.extra?.["album_audio_id"], song.extra?.["audio_id"], albumAudioID);
    albumID = firstNonEmpty(song.extra?.["album_id"], albumID);
  }

  const clienttime = String(Math.floor(Date.now() / 1000));
  const dfid = firstNonEmpty(cookie["dfid"], randomKugouDFID());
  const params: Record<string, string> = {
    dfid,
    mid,
    uuid: "-",
    appid: KUGOU_LITE_APPID,
    clientver: KUGOU_LITE_VER,
    clienttime,
    token,
    userid: userID,
    album_id: albumID,
    area_code: "1",
    hash,
    ssa_flag: "is_fromtrack",
    version: "11436",
    page_id: "967177915",
    quality: "flac",
    album_audio_id: albumAudioID,
    behavior: "play",
    pid: "411",
    cmd: "26",
    pidversion: "3001",
    IsFreePart: "0",
    ppage_id: "356753938,823673182,967485191",
    cdnBackup: "1",
    kcard: "0",
    module: "",
  };
  params.key = md5hex(hash + KUGOU_LITE_KEY + KUGOU_LITE_APPID + mid + userID);
  const apiURL = buildAndroidURL("https://gateway.kugou.com/v5/url", params, "");

  const resp = await httpGetJSON<Record<string, unknown>>(apiURL, {
    headers: {
      "User-Agent": UA_ANDROID_KG,
      "x-router": "trackercdn.kugou.com",
      dfid,
      clienttime,
      mid,
      "kg-rc": "1",
      "kg-thash": "5d816a0",
      "kg-rec": "1",
      "kg-rf": "B9EDA08A64250DEFFBCADDEE00F8F25F",
      ...cookieHeaders(),
    },
  });

  const downloadURL = pickKugouResponseURL(resp);
  if (!downloadURL) {
    throw new Error(
      `kugou v5 url unavailable, status=${findKugouInt(resp, ["status"])} error_code=${findKugouInt(resp, ["error_code", "errcode"])}`,
    );
  }

  const ext = normalizeKugouExt(findKugouString(resp, ["fileType", "extName", "extname"]), downloadURL) || "flac";
  return {
    source: "kugou",
    id: hash,
    name: firstNonEmpty(findKugouString(resp, ["songName", "song_name", "audio_name"]), name),
    artist: firstNonEmpty(findKugouString(resp, ["authorName", "author_name", "singerName"]), artist),
    album,
    album_id: albumID,
    duration: 0,
    cover: "",
    size: findKugouInt(resp, ["fileSize", "filesize"]),
    bitrate: normalizeKugouBitrate(findKugouInt(resp, ["bitRate", "bitrate"])),
    ext,
    url: downloadURL,
    link: `https://www.kugou.com/song/#hash=${hash}`,
    extra: { hash, album_audio_id: albumAudioID, album_id: albumID },
  };
}

/** 对齐 Go fetchPrivURLV6：tracker.kugou.com/v6/priv_url（多音质 qualities + tracker_param） */
async function fetchPrivURLV6(song: Song | null, hash: string): Promise<Song> {
  hash = hash.trim().toLowerCase();
  if (!isValidHash(hash)) throw new Error("invalid kugou hash");

  const cookie = parseCookieMap(kgCookie());
  const token = (cookie["token"] ?? "").trim();
  const userID = (cookie["userid"] ?? "").trim();
  const mid = (cookie["KUGOU_API_MID"] ?? "").trim();
  if (!token || !userID || userID === "0" || !mid) {
    throw new Error("kugou priv_url v6 requires app token, userid and KUGOU_API_MID");
  }

  let albumAudioID = "";
  if (song) {
    albumAudioID = firstNonEmpty(song.extra?.["album_audio_id"], song.extra?.["audio_id"]);
  }
  if (!albumAudioID) {
    try {
      const info = await fetchSonginfoV2(hash);
      albumAudioID = firstNonEmpty(info.extra?.["album_audio_id"], info.extra?.["audio_id"]);
    } catch {
      /* ignore */
    }
  }
  if (!albumAudioID) albumAudioID = "0";

  const dfid = firstNonEmpty(cookie["dfid"], randomKugouDFID());
  const vipToken = firstNonEmpty(cookie["vip_token"], cookie["viptoken"]);
  const vipType = firstNonEmpty(cookie["vip_type"], cookie["vipType"], "6");
  const clienttimeMS = Date.now();

  const jsonData = {
    area_code: "1",
    behavior: "play",
    qualities: ["128", "320", "flac", "high", "multitrack", "viper_atmos", "viper_tape", "viper_clear", "super"],
    resource: {
      album_audio_id: albumAudioID,
      collect_list_id: "3",
      collect_time: clienttimeMS,
      hash,
      id: 0,
      page_id: 1,
      type: "audio",
    },
    token,
    tracker_param: {
      all_m: 1,
      auth: "",
      is_free_part: 0,
      key: md5hex(hash + KUGOU_LITE_KEY + KUGOU_LITE_APPID + mid + userID),
      module_id: 0,
      need_climax: 1,
      need_xcdn: 1,
      open_time: "",
      pid: "411",
      pidversion: "3001",
      priv_vip_type: "6",
      viptoken: vipToken,
    },
    userid: userID,
    vip: vipType,
  };
  const jsonBody = JSON.stringify(jsonData);

  const clienttime = String(Math.floor(Date.now() / 1000));
  const params: Record<string, string> = {
    dfid,
    mid,
    uuid: "-",
    appid: KUGOU_LITE_APPID,
    clientver: KUGOU_LITE_VER,
    clienttime,
    token,
    userid: userID,
  };
  const apiURL = buildAndroidURL("http://tracker.kugou.com/v6/priv_url", params, jsonBody);

  const resp = await httpPostJSONText(apiURL, jsonBody, {
    headers: {
      "User-Agent": UA_ANDROID_KG,
      "Content-Type": "application/json",
      dfid,
      clienttime,
      mid,
      "kg-rc": "1",
      "kg-thash": "5d816a0",
      "kg-rec": "1",
      "kg-rf": "B9EDA08A64250DEFFBCADDEE00F8F25F",
      ...cookieHeaders(),
    },
  }).then((text) => JSON.parse(text) as Record<string, unknown>);

  const downloadURL = pickKugouResponseURL(resp);
  if (!downloadURL) {
    throw new Error(
      `kugou priv_url v6 unavailable, status=${findKugouInt(resp, ["status"])} error_code=${findKugouInt(resp, ["error_code", "errcode"])}`,
    );
  }

  let name = "";
  let artist = "";
  let album = "";
  let albumID = "";
  if (song) {
    name = song.name;
    artist = song.artist;
    album = song.album;
    albumID = song.album_id ?? "";
  }

  return {
    source: "kugou",
    id: hash,
    name: firstNonEmpty(findKugouString(resp, ["songName", "song_name", "audio_name"]), name),
    artist: firstNonEmpty(findKugouString(resp, ["authorName", "author_name", "singerName"]), artist),
    album,
    album_id: albumID,
    duration: 0,
    cover: "",
    size: findKugouInt(resp, ["fileSize", "filesize"]),
    bitrate: normalizeKugouBitrate(findKugouInt(resp, ["bitRate", "bitrate"])),
    ext: normalizeKugouExt(findKugouString(resp, ["fileType", "extName", "extname"]), downloadURL),
    url: downloadURL,
    link: `https://www.kugou.com/song/#hash=${hash}`,
    extra: { hash, album_audio_id: albumAudioID },
  };
}

/** 对齐 Go fetchTrackerSongInfo：三级 tracker 降级链（提取为独立函数供 VIP 链复用） */
async function fetchTrackerSongInfo(hash: string): Promise<Song> {
  hash = hash.trim().toLowerCase();
  if (!isValidHash(hash)) throw new Error("invalid kugou hash");

  const apiURLs = [
    `https://trackercdn.kugou.com/i/v2/?cdnBackup=1&behavior=download&pid=1&cmd=21&appid=1001&hash=${hash}&key=${md5hex(hash + "kgcloudv2")}`,
    `http://trackercdnbj.kugou.com/i/v2/?cmd=23&pid=1&behavior=download&hash=${hash}&key=${md5hex(hash + "kgcloudv2")}`,
    `http://trackercdn.kugou.com/i/?cmd=4&pid=1&forceDown=0&vip=1&hash=${hash}&key=${md5hex(hash + "kgcloud")}`,
  ];

  for (const apiURL of apiURLs) {
    try {
      const resp = await httpGetJSON<{
        status?: number;
        errcode?: number;
        url?: string | string[];
        backup_url?: string | string[];
        bitRate?: number;
        extName?: string;
        album_img?: string;
        songName?: string;
        author_name?: string;
        fileSize?: number;
        timeLength?: number;
      }>(apiURL, {
        headers: { "User-Agent": UA_PC, Referer: "https://www.kugou.com/", ...cookieHeaders() },
      });

      const downloadURL = pickUrl(resp.url) || pickUrl(resp.backup_url);
      if (!downloadURL || (resp.errcode ?? 0) !== 0) continue;

      return {
        source: "kugou",
        id: hash,
        name: resp.songName ?? "",
        artist: resp.author_name ?? "",
        album: "",
        duration: normalizeKugouDuration(resp.timeLength ?? 0),
        size: resp.fileSize ?? 0,
        bitrate: normalizeKugouBitrate(resp.bitRate ?? 0),
        ext: normalizeKugouExt(resp.extName, downloadURL),
        cover: (resp.album_img ?? "").replace("{size}", "240"),
        url: downloadURL,
        link: `https://www.kugou.com/song/#hash=${hash}`,
        extra: { hash },
      };
    } catch {
      /* try next */
    }
  }
  throw new Error("tracker kugou download url not found");
}

/** VIP 音质状态回写（对齐 Go k.isVipCache，10 分钟） */
function setKugouVipHint(isVip: boolean): void {
  vipStatusCache.set(md5hex(kgCookie()), { isVip, expiresAt: Date.now() + 10 * 60 * 1000 });
}

/** 对齐 Go fetchVIPSongInfo：候选 hash × [URLV5 → PrivURLV6 → songinfoV2 → tracker]，lossless 优先、fallback 兜底 */
async function fetchVIPSongInfo(song: Song): Promise<Song> {
  if (!kgCookie().trim()) throw new Error("cookie required for kugou vip download");

  let fallback: Song | null = null;
  let lastErr: unknown = null;

  for (const hash of collectCandidateHashes(song)) {
    const attempts: Array<() => Promise<Song>> = [
      () => fetchURLV5(song, hash),
      () => fetchPrivURLV6(song, hash),
      () => fetchSonginfoV2(hash),
      () => fetchTrackerSongInfo(hash),
    ];
    for (const attempt of attempts) {
      try {
        const info = await attempt();
        if (info.url) {
          if (looksLossless(info.ext ?? "", info.bitrate, info.size)) {
            setKugouVipHint(true);
            return info;
          }
          if (!fallback) fallback = info;
        }
      } catch (err) {
        lastErr = err;
      }
    }
  }

  if (fallback) return fallback;
  setKugouVipHint(false);
  throw lastErr instanceof Error ? lastErr : new Error("kugou vip download url not found");
}

// ---------------------------------------------------------------------------
// 单曲解析（对齐 Go fetchSongInfo / Parse）
// ---------------------------------------------------------------------------

async function fetchSongInfoByHash(hash: string): Promise<Song> {
  const resp = await httpGetJSON<{
    url?: string;
    bitRate?: number;
    extName?: string;
    album_img?: string;
    songName?: string;
    author_name?: string;
    timeLength?: number;
    fileSize?: number;
    errcode?: number;
  }>(`http://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=${hash}`, {
    headers: { "User-Agent": UA_MOBILE, Referer: MOBILE_REFERER, ...cookieHeaders() },
  });

  // errcode 1002 代表操作太频繁（风控）
  if ((resp.errcode ?? 0) !== 0 || !resp.url) {
    throw new Error(`kugou song info unavailable, errcode=${resp.errcode ?? 0}`);
  }

  return {
    source: "kugou",
    id: hash,
    name: (resp.songName ?? "").trim(),
    artist: (resp.author_name ?? "").trim(),
    album: "",
    duration: resp.timeLength ?? 0,
    size: resp.fileSize ?? 0,
    bitrate: Math.floor((resp.bitRate ?? 0) / 1000),
    cover: (resp.album_img ?? "").replace("{size}", "240"),
    url: resp.url,
    ext: (resp.extName ?? "").trim(),
    link: `https://www.kugou.com/song/#hash=${hash}`,
    extra: { hash },
  };
}

// ---------------------------------------------------------------------------
// 专辑详情（对齐 Go fetchAlbumDetail）
// ---------------------------------------------------------------------------

interface KugouRelateGood {
  hash?: string;
  bitrate?: number;
  privilege?: number;
  size?: number;
}

interface KugouTransParam {
  union_cover?: string;
  ogg_320_hash?: string;
  ogg_128_hash?: string;
  ogg_320_filesize?: number;
  ogg_128_filesize?: number;
}

/** 对齐 Go pickSonglistHashes */
function pickSonglistHashes(
  defaultHash: string,
  defaultSize: number,
  defaultBitrate: number,
  goods: KugouRelateGood[],
): { fileHash: string; hqHash: string; sqHash: string; size: number; bitrate: number } {
  let fileHash = (defaultHash ?? "").trim();
  let hqHash = "";
  let sqHash = "";
  let size = defaultSize;
  let bitrate = defaultBitrate;

  for (const item of goods) {
    const hash = (item.hash ?? "").trim();
    if (!isValidHash(hash)) continue;

    if ((item.bitrate ?? 0) >= 700) {
      sqHash = hash;
      size = item.size ?? 0;
      bitrate = item.bitrate ?? 0;
    } else if ((item.bitrate ?? 0) >= 320) {
      if (!sqHash) {
        size = item.size ?? 0;
        bitrate = item.bitrate ?? 0;
      }
      hqHash = hash;
    } else if (!fileHash) {
      fileHash = hash;
    }
  }

  if (!fileHash) {
    if (hqHash) fileHash = hqHash;
    else if (sqHash) fileHash = sqHash;
  }
  return { fileHash, hqHash, sqHash, size, bitrate };
}

function joinSonglistArtists(artists: { name?: string }[] | undefined): string {
  return (artists ?? [])
    .map((a) => (a.name ?? "").trim())
    .filter(Boolean)
    .join("/");
}

function pickSonglistSongName(name: string): string {
  const idx = name.indexOf(" - ");
  if (idx >= 0 && name.slice(idx + 3).trim()) return name.slice(idx + 3).trim();
  return name.trim();
}

async function fetchAlbumDetail(id: string): Promise<PlaylistDetail> {
  const trimmedID = id.trim();
  if (!trimmedID) throw new Error("album id is empty");

  const infoResp = await httpGetJSON<{
    status?: number;
    errcode?: number;
    error?: string;
    data?: {
      albumid?: number;
      albumname?: string;
      singername?: string;
      intro?: string;
      imgurl?: string;
      publishtime?: string;
      play_count?: number;
      songcount?: number;
    };
  }>(`http://mobilecdn.kugou.com/api/v3/album/info?albumid=${trimmedID}&version=9108&area_code=1`, {
    headers: { "User-Agent": UA_MOBILE, ...cookieHeaders() },
  });

  if ((infoResp.errcode ?? 0) !== 0 || infoResp.status !== 1) {
    throw new Error(`kugou album info api error: status=${infoResp.status} errcode=${infoResp.errcode}`);
  }
  const info = infoResp.data ?? {};

  const pageSize = 300;
  let total = 0;
  const songs: Song[] = [];

  for (let page = 1; ; page++) {
    const resp = await httpGetJSON<{
      status?: number;
      errcode?: number;
      error?: string;
      data?: {
        total?: number;
        info?: {
          hash?: string;
          origin_hash?: string;
          sqhash?: string;
          "320hash"?: string;
          res_hash?: string;
          mvhash?: string;
          filename?: string;
          songname?: string;
          singername?: string;
          album_name?: string;
          album_id?: string;
          duration?: number;
          filesize?: number;
          sqfilesize?: number;
          "320filesize"?: number;
          audio_id?: number;
          privilege?: number;
          remark?: string;
          trans_param?: KugouTransParam;
        }[];
      };
    }>(`http://mobilecdn.kugou.com/api/v3/album/song?albumid=${trimmedID}&page=${page}&pagesize=${pageSize}&version=9108&area_code=1`, {
      headers: { "User-Agent": UA_MOBILE, ...cookieHeaders() },
    });

    if ((resp.errcode ?? 0) !== 0 || resp.status !== 1) {
      throw new Error(`kugou album songs api error: status=${resp.status} errcode=${resp.errcode}`);
    }

    const list = resp.data?.info ?? [];
    if (total === 0) total = resp.data?.total ?? 0;
    if (!list.length) break;

    for (const item of list) {
      const trans = item.trans_param ?? {};
      const finalHash = firstNonEmpty(
        item.hash,
        item.sqhash,
        item["320hash"],
        item.res_hash,
        trans.ogg_320_hash,
        item.origin_hash,
        trans.ogg_128_hash,
      );
      if (!isValidHash(finalHash)) continue;

      let name = (item.songname ?? "").trim();
      let artist = (item.singername ?? "").trim();
      if (!name || !artist) {
        const parts = (item.filename ?? "").split(" - ");
        if (parts.length >= 2) {
          artist = parts[0].trim();
          name = parts.slice(1).join(" - ").trim();
        } else if (!name) {
          name = (item.filename ?? "").trim();
        }
      }

      let albumName = (item.album_name ?? "").trim();
      if (!albumName) albumName = (info.albumname ?? "").trim();
      if (!albumName) albumName = (item.remark ?? "").trim();

      let size = item.filesize ?? 0;
      if (finalHash === item.sqhash && (item.sqfilesize ?? 0) > 0) size = item.sqfilesize!;
      else if (finalHash === item["320hash"] && (item["320filesize"] ?? 0) > 0) size = item["320filesize"]!;
      else if (finalHash === item.res_hash && (item.sqfilesize ?? 0) > 0) size = item.sqfilesize!;
      else if (finalHash === trans.ogg_320_hash && (trans.ogg_320_filesize ?? 0) > 0) size = trans.ogg_320_filesize!;
      else if (finalHash === trans.ogg_128_hash && (trans.ogg_128_filesize ?? 0) > 0) size = trans.ogg_128_filesize!;

      const duration = item.duration ?? 0;
      const bitrate = duration > 0 && size > 0 ? Math.round((size * 8) / 1000 / duration) : 0;

      const cover = firstNonEmpty(trans.union_cover, info.imgurl).replace("{size}", "240");
      const albumID = firstNonEmpty(item.album_id, trimmedID);

      songs.push({
        source: "kugou",
        id: finalHash,
        name,
        artist,
        album: albumName,
        album_id: albumID,
        duration,
        size,
        bitrate,
        cover,
        url: "",
        link: `https://www.kugou.com/song/#hash=${finalHash}`,
        extra: {
          hash: finalHash,
          ogg_320_hash: trans.ogg_320_hash ?? "",
          ogg_128_hash: trans.ogg_128_hash ?? "",
          sq_hash: item.sqhash ?? "",
          file_hash: item.origin_hash ?? "",
          res_hash: item.res_hash ?? "",
          mv_hash: item.mvhash ?? "",
          hq_hash: item["320hash"] ?? "",
          audio_id: String(item.audio_id ?? 0),
          album_id: albumID,
          privilege: String(item.privilege ?? 0),
        },
      });
    }

    if (list.length < pageSize) break;
    if (total > 0 && songs.length >= total) break;
  }

  let trackCount = total;
  if (trackCount === 0) trackCount = info.songcount ?? 0;
  if (trackCount === 0) trackCount = songs.length;

  const albumID = firstNonEmpty(String(info.albumid ?? ""), trimmedID);
  const playlist: Playlist = {
    source: "kugou",
    id: albumID,
    name: (info.albumname ?? "").trim(),
    cover: (info.imgurl ?? "").replace("{size}", "240"),
    track_count: trackCount,
    play_count: info.play_count ?? 0,
    creator: (info.singername ?? "").trim(),
    description: (info.intro ?? "").trim(),
    link: `https://www.kugou.com/album/${trimmedID}.html`,
    extra: {
      type: "album",
      album_id: albumID,
      publish_time: info.publishtime ?? "",
    },
  };

  return { playlist, songs };
}

// ---------------------------------------------------------------------------
// 歌单详情（对齐 Go fetchPlaylistDetail / fetchSonglistDetail / fetchCloudlistDetail）
// ---------------------------------------------------------------------------

async function fetchPlaylistDetail(id: string): Promise<PlaylistDetail> {
  if (id.trim().toLowerCase().startsWith("gcid_")) {
    return fetchSonglistDetail(id);
  }

  const resp = await httpGetJSON<{
    data?: {
      info?: {
        hash?: string;
        FileHash?: string;
        SQFileHash?: string;
        HQFileHash?: string;
        ResFileHash?: string;
        MvHash?: string;
        filename?: string;
        duration?: number;
        filesize?: number;
        SQFileSize?: number;
        HQFileSize?: number;
        ResFileSize?: number;
        album_name?: string;
        AlbumID?: string;
        remark?: string;
        singername?: string;
        songname?: string;
        Audioid?: unknown;
        Privilege?: number;
        trans_param?: KugouTransParam;
      }[];
    };
  }>(`http://mobilecdn.kugou.com/api/v3/special/song?specialid=${id}&page=1&pagesize=300&version=9108&area_code=1`, {
    headers: { "User-Agent": UA_MOBILE, ...cookieHeaders() },
  });

  const playlist: Playlist = {
    source: "kugou",
    id,
    name: "",
    cover: "",
    track_count: 0,
    play_count: 0,
    creator: "",
    description: "",
    link: `https://www.kugou.com/yy/special/single/${id}.html`,
  };

  const songs: Song[] = [];
  for (const item of resp.data?.info ?? []) {
    const trans = item.trans_param ?? {};
    const finalHash = firstNonEmpty(
      item.hash,
      item.SQFileHash,
      item.HQFileHash,
      item.ResFileHash,
      trans.ogg_320_hash,
      item.FileHash,
      trans.ogg_128_hash,
    );
    if (!isValidHash(finalHash)) continue;

    let name = (item.songname ?? "").trim();
    let artist = (item.singername ?? "").trim();
    if (!name || !artist) {
      const parts = (item.filename ?? "").split(" - ");
      if (parts.length >= 2) {
        artist = parts[0].trim();
        name = parts.slice(1).join(" - ").trim();
      } else {
        name = (item.filename ?? "").trim();
      }
    }

    const cover = trans.union_cover ? trans.union_cover.replace("{size}", "240") : "";
    const albumName = (item.album_name ?? "").trim() || (item.remark ?? "").trim();

    let size = item.filesize ?? 0;
    if (finalHash === item.SQFileHash && (item.SQFileSize ?? 0) > 0) size = item.SQFileSize!;
    else if (finalHash === item.HQFileHash && (item.HQFileSize ?? 0) > 0) size = item.HQFileSize!;
    else if (finalHash === item.ResFileHash && (item.ResFileSize ?? 0) > 0) size = item.ResFileSize!;
    else if (finalHash === trans.ogg_320_hash && (trans.ogg_320_filesize ?? 0) > 0) size = trans.ogg_320_filesize!;
    else if (finalHash === trans.ogg_128_hash && (trans.ogg_128_filesize ?? 0) > 0) size = trans.ogg_128_filesize!;

    songs.push({
      source: "kugou",
      id: finalHash,
      name,
      artist,
      album: albumName,
      album_id: item.AlbumID ?? "",
      duration: item.duration ?? 0,
      size,
      bitrate: 0,
      cover,
      url: "",
      link: `https://www.kugou.com/song/#hash=${finalHash}`,
      extra: {
        hash: finalHash,
        ogg_320_hash: trans.ogg_320_hash ?? "",
        ogg_128_hash: trans.ogg_128_hash ?? "",
        sq_hash: item.SQFileHash ?? "",
        file_hash: item.FileHash ?? "",
        res_hash: item.ResFileHash ?? "",
        mv_hash: item.MvHash ?? "",
        hq_hash: item.HQFileHash ?? "",
        audio_id: num(item.Audioid),
        album_id: item.AlbumID ?? "",
        privilege: String(item.Privilege ?? 0),
      },
    });
  }

  playlist.track_count = songs.length;
  return { playlist, songs };
}

/** 网页歌单（gcid_ 链接，对齐 Go fetchSonglistDetail） */
async function fetchSonglistDetail(id: string): Promise<PlaylistDetail> {
  const trimmedID = id.trim();
  const html = await httpGetText(`https://www.kugou.com/songlist/${trimmedID}/`, {
    headers: { "User-Agent": UA_MOBILE, Referer: MOBILE_REFERER, ...cookieHeaders() },
  });

  const match = html.match(/window\.\$output\s*=\s*(\{[\s\S]*?\})\s*;\s*<\/script>/);
  if (!match) throw new Error("kugou songlist payload not found");

  const resp = JSON.parse(match[1]) as {
    encode_gic?: string;
    info?: {
      listinfo?: {
        name?: string;
        pic?: string;
        intro?: string;
        list_create_username?: string;
        count?: number;
        heat?: number;
      };
      songs?: {
        hash?: string;
        FileHash?: string;
        SQFileHash?: string;
        HQFileHash?: string;
        ResFileHash?: string;
        MvHash?: string;
        name?: string;
        bitrate?: number;
        size?: number;
        timelen?: number;
        cover?: string;
        privilege?: number;
        AlbumID?: string;
        Audioid?: unknown;
        relate_goods?: KugouRelateGood[];
        singerinfo?: { name?: string }[];
        albuminfo?: { name?: string };
        trans_param?: KugouTransParam;
      }[];
    };
  };

  const listInfo = resp.info?.listinfo ?? {};
  const playlistID = (resp.encode_gic ?? "").trim() || trimmedID;
  const playlist: Playlist = {
    source: "kugou",
    id: playlistID,
    name: (listInfo.name ?? "").trim(),
    cover: (listInfo.pic ?? "").replace("{size}", "240"),
    track_count: listInfo.count ?? 0,
    play_count: listInfo.heat ?? 0,
    creator: (listInfo.list_create_username ?? "").trim(),
    description: (listInfo.intro ?? "").trim(),
    link: `https://www.kugou.com/songlist/${playlistID}/`,
  };

  const isVip = await isKugouVipAccount();
  const songs: Song[] = [];
  for (const item of resp.info?.songs ?? []) {
    if (!isVip && item.privilege === 10) continue;

    const trans = item.trans_param ?? {};
    const picked = pickSonglistHashes(item.hash ?? "", item.size ?? 0, item.bitrate ?? 0, item.relate_goods ?? []);
    let { fileHash, hqHash, sqHash, size, bitrate } = picked;
    if (isValidHash(item.FileHash)) fileHash = item.FileHash!;
    if (isValidHash(item.HQFileHash)) hqHash = item.HQFileHash!;
    if (isValidHash(item.SQFileHash)) sqHash = item.SQFileHash!;

    const finalHash = firstNonEmpty(
      item.hash,
      sqHash,
      hqHash,
      item.ResFileHash,
      trans.ogg_320_hash,
      fileHash,
      trans.ogg_128_hash,
    );
    if (!isValidHash(finalHash)) continue;

    // 对齐 Go switch：sq/hq 分支命中时不覆盖 size
    if (finalHash === sqHash || finalHash === hqHash) {
      /* 保持 pickSonglistHashes 的默认 size */
    } else if (finalHash === item.ResFileHash && (item.size ?? 0) > 0) size = item.size!;
    else if (finalHash === trans.ogg_320_hash && (trans.ogg_320_filesize ?? 0) > 0) size = trans.ogg_320_filesize!;
    else if (finalHash === trans.ogg_128_hash && (trans.ogg_128_filesize ?? 0) > 0) size = trans.ogg_128_filesize!;
    else if ((finalHash === fileHash || finalHash === item.hash) && (item.size ?? 0) > 0) size = item.size!;

    const duration = normalizeKugouDuration(item.timelen ?? 0);
    if (duration > 0 && size > 0) bitrate = Math.round((size * 8) / 1000 / duration);

    let coverURL = item.cover ?? "";
    if (trans.union_cover) coverURL = trans.union_cover;
    coverURL = coverURL.replace("{size}", "240");

    songs.push({
      source: "kugou",
      id: finalHash,
      name: pickSonglistSongName(item.name ?? ""),
      artist: joinSonglistArtists(item.singerinfo),
      album: (item.albuminfo?.name ?? "").trim(),
      album_id: item.AlbumID ?? "",
      duration,
      size,
      bitrate,
      cover: coverURL,
      url: "",
      link: `https://www.kugou.com/song/#hash=${finalHash}`,
      extra: {
        hash: finalHash,
        ogg_320_hash: trans.ogg_320_hash ?? "",
        ogg_128_hash: trans.ogg_128_hash ?? "",
        sq_hash: sqHash,
        file_hash: fileHash,
        res_hash: item.ResFileHash ?? "",
        mv_hash: item.MvHash ?? "",
        hq_hash: hqHash,
        audio_id: num(item.Audioid),
        album_id: item.AlbumID ?? "",
        privilege: String(item.privilege ?? 0),
      },
    });
  }

  if (playlist.track_count === 0) playlist.track_count = songs.length;
  return { playlist, songs };
}

// ---------------------------------------------------------------------------
// 云歌单 cloudlist（对齐 Go cloudlist.go）
// ---------------------------------------------------------------------------

function kugouCloudlistID(listID: string): string {
  const trimmed = listID.trim();
  if (!trimmed || trimmed.startsWith("cloudlist:")) return trimmed;
  return `cloudlist:${trimmed}`;
}

function parseKugouCloudlistID(id: string): string | null {
  const trimmed = id.trim();
  if (!trimmed.startsWith("cloudlist:")) return null;
  const listID = trimmed.slice("cloudlist:".length).trim();
  return listID || null;
}

function kgIntFromValue(value: unknown): number {
  const text = num(value);
  if (!text) return 0;
  const n = parseInt(text, 10);
  return isNaN(n) ? 0 : n;
}

async function fetchCloudlistDetail(listID: string): Promise<PlaylistDetail> {
  const cookieMap = parseCookieMap(kgCookie());
  const userID = (cookieMap.userid ?? "").trim();
  const token = (cookieMap.token ?? "").trim();
  const mid = (cookieMap.KUGOU_API_MID ?? "").trim();
  if (!listID || !userID || userID === "0" || !token || !mid) {
    throw new Error("kugou cloudlist detail requires listid, userid, token and KUGOU_API_MID");
  }

  const dfid = firstNonEmpty(cookieMap.dfid, "-");
  const clienttime = String(Math.floor(Date.now() / 1000));
  const jsonData = JSON.stringify({
    listid: listID,
    userid: userID,
    area_code: 1,
    show_relate_goods: 1,
    pagesize: 300,
    allplatform: 1,
    show_cover: 1,
    type: 0,
    token,
    page: 1,
  });

  const params: Record<string, string> = {
    dfid,
    mid,
    uuid: "-",
    appid: KUGOU_LITE_APPID,
    clientver: KUGOU_LITE_VER,
    clienttime,
    token,
    userid: userID,
  };
  const apiURL = buildAndroidURL("https://gateway.kugou.com/v4/get_list_all_file", params, jsonData);

  const resp = await httpPostJSON<{
    status?: number;
    error_code?: number;
    errcode?: number;
    error?: string;
    data?: {
      count?: unknown;
      info?: {
        ID?: unknown;
        hash?: string;
        FileHash?: string;
        SQFileHash?: string;
        HQFileHash?: string;
        ResFileHash?: string;
        name?: string;
        filename?: string;
        timelen?: number;
        size?: number;
        filesize?: number;
        SQFileSize?: number;
        HQFileSize?: number;
        ResFileSize?: number;
        bitrate?: number;
        album_id?: unknown;
        AlbumID?: unknown;
        album_audio_id?: unknown;
        MixSongID?: unknown;
        audio_id?: unknown;
        Audioid?: unknown;
        cover?: string;
        mvhash?: string;
        privilege?: number;
        relate_goods?: KugouRelateGood[];
        albuminfo?: { id?: unknown; name?: string };
        singerinfo?: { name?: string }[];
        trans_param?: KugouTransParam;
      }[];
    };
  }>(apiURL, jsonData, {
    headers: {
      ...androidGatewayHeaders(dfid, clienttime, mid),
      "x-router": "cloudlist.service.kugou.com",
      "Content-Type": "application/json",
    },
  });

  if (resp.status !== 1 || (resp.error_code ?? 0) !== 0 || (resp.errcode ?? 0) !== 0) {
    throw new Error(`kugou cloudlist detail api error: status=${resp.status} error_code=${resp.error_code} errcode=${resp.errcode}`);
  }

  const playlist: Playlist = {
    source: "kugou",
    id: kugouCloudlistID(listID),
    name: "",
    cover: "",
    track_count: kgIntFromValue(resp.data?.count),
    play_count: 0,
    creator: "",
    description: "",
    link: "",
  };

  const songs: Song[] = [];
  for (const item of resp.data?.info ?? []) {
    const trans = item.trans_param ?? {};
    let baseSize = item.size ?? 0;
    if (baseSize === 0) baseSize = item.filesize ?? 0;
    const picked = pickSonglistHashes(item.hash ?? "", baseSize, item.bitrate ?? 0, item.relate_goods ?? []);
    let { fileHash, hqHash, sqHash, size, bitrate } = picked;
    if (isValidHash(item.FileHash)) fileHash = item.FileHash!;
    if (isValidHash(item.HQFileHash)) hqHash = item.HQFileHash!;
    if (isValidHash(item.SQFileHash)) sqHash = item.SQFileHash!;

    const finalHash = firstNonEmpty(sqHash, hqHash, item.ResFileHash, trans.ogg_320_hash, item.hash, fileHash, trans.ogg_128_hash);
    if (!isValidHash(finalHash)) continue;

    if (finalHash === sqHash && (item.SQFileSize ?? 0) > 0) size = item.SQFileSize!;
    else if (finalHash === hqHash && (item.HQFileSize ?? 0) > 0) size = item.HQFileSize!;
    else if (finalHash === item.ResFileHash && (item.ResFileSize ?? 0) > 0) size = item.ResFileSize!;
    else if (finalHash === trans.ogg_320_hash && (trans.ogg_320_filesize ?? 0) > 0) size = trans.ogg_320_filesize!;
    else if (finalHash === trans.ogg_128_hash && (trans.ogg_128_filesize ?? 0) > 0) size = trans.ogg_128_filesize!;
    else if ((finalHash === item.hash || finalHash === fileHash) && baseSize > 0) size = baseSize;

    const duration = normalizeKugouDuration(item.timelen ?? 0);
    if (duration > 0 && size > 0) bitrate = Math.round((size * 8) / 1000 / duration);

    const albumID = firstNonEmpty(num(item.album_id), num(item.AlbumID), num(item.albuminfo?.id));
    const audioID = firstNonEmpty(num(item.audio_id), num(item.Audioid));
    const albumAudioID = firstNonEmpty(num(item.album_audio_id), num(item.MixSongID), num(item.ID), audioID);
    const cover = firstNonEmpty(item.cover, trans.union_cover).replace("{size}", "240");

    songs.push({
      source: "kugou",
      id: finalHash,
      name: pickSonglistSongName(firstNonEmpty(item.name, item.filename)),
      artist: joinSonglistArtists(item.singerinfo),
      album: (item.albuminfo?.name ?? "").trim(),
      album_id: albumID,
      duration,
      size,
      bitrate,
      cover,
      url: "",
      link: `https://www.kugou.com/song/#hash=${finalHash}`,
      extra: {
        hash: finalHash,
        ogg_320_hash: trans.ogg_320_hash ?? "",
        ogg_128_hash: trans.ogg_128_hash ?? "",
        sq_hash: sqHash,
        file_hash: fileHash,
        res_hash: item.ResFileHash ?? "",
        mv_hash: item.mvhash ?? "",
        hq_hash: hqHash,
        audio_id: audioID,
        album_audio_id: albumAudioID,
        album_id: albumID,
        cloud_listid: listID,
        privilege: String(item.privilege ?? 0),
      },
    });
  }

  playlist.track_count = songs.length;
  return { playlist, songs };
}

// ---------------------------------------------------------------------------
// 用户歌单（对齐 Go user_playlist.go）
// ---------------------------------------------------------------------------

function kugouHasAppCookie(cookieMap: Record<string, string>): boolean {
  return (
    !!(cookieMap.token ?? "").trim() &&
    !!(cookieMap.userid ?? "").trim() &&
    cookieMap.userid.trim() !== "0" &&
    !!(cookieMap.KUGOU_API_MID ?? "").trim()
  );
}

async function getUserPlaylistsGateway(cookieMap: Record<string, string>, page: number, limit: number): Promise<Playlist[]> {
  const userID = firstNonEmpty(cookieMap.userid, cookieMap.KugooID);
  const mid = firstNonEmpty(cookieMap.KUGOU_API_MID, "-");
  const dfid = firstNonEmpty(cookieMap.dfid, "-");
  const clienttime = String(Math.floor(Date.now() / 1000));
  const jsonData = JSON.stringify({
    userid: userID,
    token: cookieMap.token ?? "",
    total_ver: 979,
    type: 2,
    page,
    pagesize: limit,
  });

  const params: Record<string, string> = {
    dfid,
    mid,
    uuid: "-",
    appid: KUGOU_LITE_APPID,
    clientver: KUGOU_LITE_VER,
    clienttime,
    token: cookieMap.token ?? "",
    userid: userID,
    plat: "1",
  };
  const apiURL = buildAndroidURL("https://gateway.kugou.com/v7/get_all_list", params, jsonData);

  const body = await httpPostJSONText(apiURL, jsonData, {
    headers: {
      ...androidGatewayHeaders(dfid, clienttime, mid),
      "x-router": "cloudlist.service.kugou.com",
      "Content-Type": "application/json",
    },
  });
  return parseKugouUserPlaylists(body, userID);
}

interface KugouUserPlaylistInfo {
  listid?: unknown;
  specialid?: number;
  global_specialid?: string;
  global_collection_id?: string;
  specialname?: string;
  name?: string;
  imgurl?: string;
  pic?: string;
  intro?: string;
  playcount?: number;
  songcount?: number;
  count?: unknown;
  collectcount?: number;
  username?: string;
  nickname?: string;
  list_create_username?: string;
  list_create_userid?: unknown;
  list_create_listid?: unknown;
  list_create_gid?: string;
  publishtime?: string;
  update_time?: unknown;
}

async function parseKugouUserPlaylists(bodyText: string, userID: string): Promise<Playlist[]> {
  const resp = JSON.parse(bodyText) as {
    status?: number;
    errcode?: number;
    error?: string;
    data?: {
      info?: KugouUserPlaylistInfo[];
      list?: {
        specialid?: number;
        specialname?: string;
        imgurl?: string;
        intro?: string;
        playcount?: number;
        songcount?: number;
        nickname?: string;
      }[];
    };
    plist?: {
      list?: {
        info?: {
          specialid?: number;
          specialname?: string;
          imgurl?: string;
          intro?: string;
          playcount?: number;
          songcount?: number;
          collectcount?: number;
          nickname?: string;
          publishtime?: string;
        }[];
      };
    };
  };

  if ((resp.status ?? 0) !== 0 && resp.status !== 1) {
    throw new Error(`kugou user playlist api error: status=${resp.status} errcode=${resp.errcode} error=${resp.error ?? ""}`);
  }

  const playlists: Playlist[] = [];

  for (const item of resp.plist?.list?.info ?? []) {
    if (!item.specialid || !(item.specialname ?? "").trim()) continue;
    const playlistID = String(item.specialid);
    playlists.push({
      source: "kugou",
      id: playlistID,
      name: (item.specialname ?? "").trim(),
      cover: (item.imgurl ?? "").replace("{size}", "240"),
      track_count: item.songcount ?? 0,
      play_count: item.playcount ?? 0,
      creator: firstNonEmpty(item.nickname, userID),
      description: (item.intro ?? "").trim(),
      link: `https://www.kugou.com/yy/special/single/${playlistID}.html`,
      extra: {
        user_id: userID,
        collect_count: String(item.collectcount ?? 0),
        publish_time: item.publishtime ?? "",
      },
    });
  }

  for (const item of resp.data?.info ?? []) {
    const listID = num(item.listid);
    if (listID && listID !== "0") {
      const name = firstNonEmpty(item.name, item.specialname);
      if (!name) continue;
      let trackCount = kgIntFromValue(item.count);
      if (trackCount === 0) trackCount = item.songcount ?? 0;

      const playlistID = kugouCloudlistID(listID);
      const globalCollectionID = (item.global_collection_id ?? "").trim();
      const link = globalCollectionID ? `https://www.kugou.com/songlist/${globalCollectionID}/` : "";
      playlists.push({
        source: "kugou",
        id: playlistID,
        name,
        cover: firstNonEmpty(item.pic, item.imgurl).replace("{size}", "240"),
        track_count: trackCount,
        play_count: item.playcount ?? 0,
        creator: firstNonEmpty(item.list_create_username, item.username, item.nickname, userID),
        description: (item.intro ?? "").trim(),
        link,
        extra: {
          user_id: userID,
          cloud_listid: listID,
          global_collection_id: globalCollectionID,
          list_create_userid: num(item.list_create_userid),
          list_create_listid: num(item.list_create_listid),
          list_create_gid: item.list_create_gid ?? "",
          update_time: num(item.update_time),
        },
      });
      continue;
    }

    let playlistID = "";
    if ((item.specialid ?? 0) > 0) playlistID = String(item.specialid);
    else playlistID = (item.global_specialid ?? "").trim();
    const name = firstNonEmpty(item.specialname, item.name);
    if (!playlistID || !name) continue;

    playlists.push({
      source: "kugou",
      id: playlistID,
      name,
      cover: firstNonEmpty(item.imgurl, item.pic).replace("{size}", "240"),
      track_count: item.songcount ?? 0,
      play_count: item.playcount ?? 0,
      creator: firstNonEmpty(item.username, item.nickname, userID),
      description: (item.intro ?? "").trim(),
      link: `https://www.kugou.com/yy/special/single/${playlistID}.html`,
      extra: {
        user_id: userID,
        global_specialid: item.global_specialid ?? "",
        collect_count: String(item.collectcount ?? 0),
        publish_time: item.publishtime ?? "",
      },
    });
  }

  for (const item of resp.data?.list ?? []) {
    if (!item.specialid || !(item.specialname ?? "").trim()) continue;
    const playlistID = String(item.specialid);
    playlists.push({
      source: "kugou",
      id: playlistID,
      name: (item.specialname ?? "").trim(),
      cover: (item.imgurl ?? "").replace("{size}", "240"),
      track_count: item.songcount ?? 0,
      play_count: item.playcount ?? 0,
      creator: firstNonEmpty(item.nickname, userID),
      description: (item.intro ?? "").trim(),
      link: `https://www.kugou.com/yy/special/single/${playlistID}.html`,
      extra: { user_id: userID },
    });
  }

  return playlists;
}

// ---------------------------------------------------------------------------
// QR 登录（对齐 Go login.go）
// ---------------------------------------------------------------------------

function randomKugouString(length: number): string {
  const chars = "1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const bytes = crypto.randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) result += chars[bytes[i] % chars.length];
  return result;
}

function randomKugouGUID(): string {
  const buf = crypto.randomBytes(16);
  buf[6] = (buf[6] & 0x0f) | 0x40;
  buf[8] = (buf[8] & 0x3f) | 0x80;
  const hex = buf.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function calculateKugouMID(seed: string): string {
  return BigInt(`0x${md5hex(seed)}`).toString(10);
}

function initKugouLoginDevice(cookies: Record<string, string>): Record<string, string> {
  const guid = randomKugouGUID();
  cookies.KUGOU_API_GUID = guid;
  cookies.KUGOU_API_MID = calculateKugouMID(guid);
  cookies.KUGOU_API_MAC = randomKugouString(12);
  cookies.KUGOU_API_DEV = randomKugouString(16);
  return cookies;
}

function rsaPKCS1Hex(data: unknown): string {
  const payload = Buffer.from(JSON.stringify(data), "utf8");
  const enc = crypto.publicEncrypt(
    { key: KUGOU_PUBLIC_KEY, padding: crypto.constants.RSA_PKCS1_PADDING },
    payload,
  );
  return enc.toString("hex").toUpperCase();
}

function aesCBCEncrypt(data: Buffer, key: Buffer, iv: Buffer): Buffer {
  const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

function aesCBCDecrypt(data: Buffer, key: Buffer, iv: Buffer): Buffer {
  const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

async function kugouLoginWebGet(apiURL: string, params: Record<string, string>, cookies: Record<string, string>): Promise<string> {
  const clienttime = String(Math.floor(Date.now() / 1000));
  const finalParams: Record<string, string> = {
    dfid: firstNonEmpty(cookies.dfid, "-"),
    mid: firstNonEmpty(cookies.KUGOU_API_MID, "-"),
    uuid: "-",
    appid: KUGOU_LITE_APPID,
    clientver: KUGOU_LITE_VER,
    clienttime,
    ...params,
  };
  const query = new URLSearchParams(finalParams);
  query.set("signature", signSonginfoParams(finalParams));

  return httpGetText(`${apiURL}?${query.toString()}`, {
    headers: {
      "User-Agent": UA_ANDROID_KG,
      dfid: finalParams.dfid,
      clienttime,
      mid: finalParams.mid,
      "kg-rc": "1",
      "kg-thash": "5d816a0",
      "kg-rec": "1",
      "kg-rf": "B9EDA08A64250DEFFBCADDEE00F8F25F",
      Cookie: joinCookieMap(cookies),
    },
  });
}

async function registerKugouLoginDevice(cookies: Record<string, string>): Promise<void> {
  const aesSeed = randomKugouString(6).toLowerCase();
  const digest = md5hex(aesSeed);
  const aesKey = Buffer.from(digest.slice(0, 16), "ascii");
  const aesIV = Buffer.from(digest.slice(16, 32), "ascii");

  const guid = cookies.KUGOU_API_GUID ?? "";
  const deviceData: Record<string, unknown> = {
    // 与 Go map 序列化（按 key 字典序）保持一致的明文
    accelerometer: false,
    accelerometerValue: "",
    availableRamSize: 4983533568,
    availableRomSize: 48114719,
    availableSDSize: 48114717,
    basebandVer: "",
    batteryLevel: 100,
    batteryStatus: 3,
    brand: "Redmi",
    buildSerial: "unknown",
    device: "marble",
    gravity: false,
    gravityValue: "",
    gyroscope: false,
    gyroscopeValue: "",
    imei: guid,
    imsi: "",
    light: false,
    lightValue: "",
    magnetic: false,
    magneticValue: "",
    manufacturer: "Xiaomi",
    orientation: false,
    orientationValue: "",
    pressure: false,
    pressureValue: "",
    step_counter: false,
    step_counterValue: "",
    temperature: false,
    temperatureValue: "",
    uuid: guid,
  };
  const encBody = aesCBCEncrypt(Buffer.from(JSON.stringify(deviceData), "utf8"), aesKey, aesIV);
  const p = rsaPKCS1Hex({ aes: aesSeed, token: cookies.token ?? "", uid: cookies.userid ?? "" });

  const data = encBody.toString("base64");
  const clienttime = String(Math.floor(Date.now() / 1000));
  const params: Record<string, string> = {
    dfid: firstNonEmpty(cookies.dfid, "-"),
    mid: firstNonEmpty(cookies.KUGOU_API_MID, "-"),
    uuid: "-",
    appid: KUGOU_LITE_APPID,
    clientver: KUGOU_LITE_VER,
    clienttime,
    token: cookies.token ?? "",
    userid: cookies.userid ?? "",
    part: "1",
    platid: "1",
    p,
  };
  const apiURL = buildAndroidURL("https://userservice.kugou.com/risk/v2/r_register_dev", params, data);

  const bodyText = await httpPostJSONText(apiURL, data, {
    headers: {
      ...androidGatewayHeaders(params.dfid, clienttime, params.mid),
      "Content-Type": "text/plain; charset=utf-8",
      Cookie: joinCookieMap(cookies),
    },
  });

  let parseTarget = bodyText.trim();
  if (!parseTarget.startsWith("{")) {
    try {
      parseTarget = aesCBCDecrypt(Buffer.from(parseTarget, "base64"), aesKey, aesIV).toString("utf8");
    } catch {
      /* 保持原文，交给 JSON 解析报错 */
    }
  }

  const resp = JSON.parse(parseTarget) as {
    status?: number;
    data?: { dfid?: string };
    error_code?: number;
    error?: string;
  };
  if (resp.status !== 1) {
    throw new Error(`kugou register device api error: status=${resp.status} error_code=${resp.error_code} error=${resp.error ?? ""}`);
  }
  if ((resp.data?.dfid ?? "").trim()) {
    cookies.dfid = resp.data!.dfid!;
  }
}

function mapKugouQRStatus(status: number): QRLoginStatus {
  switch (status) {
    case 4:
      return "success";
    case 2:
    case 3:
      return "scanned";
    case -1:
    case 5:
    case 6:
      return "expired";
    case 0:
    case 1:
      return "waiting";
    default:
      return "failed";
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export const kugou: MusicProvider = {
  name: "kugou",
  label: "酷狗音乐",

  async search(keyword: string): Promise<Song[]> {
    const params = new URLSearchParams({
      keyword,
      platform: "WebFilter",
      format: "json",
      page: "1",
      pagesize: "10",
      userid: "-1",
      clientver: "",
      tag: "em",
      filter: "2",
      iscorrection: "1",
      privilege_filter: "0",
      _: String(Date.now()),
    });
    const searchUA =
      "Mozilla/5.0 (Linux; Android 10; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.162 Mobile Safari/537.36";
    const apiURL = `http://songsearch.kugou.com/song_search_v2?${params}`;

    const fetchSearch = async (withCookie: boolean) =>
      httpGetJSON<{ data?: { lists?: KugouSearchItem[] } }>(apiURL, {
        headers: withCookie && kgCookie().trim() ? { "User-Agent": searchUA, ...cookieHeaders() } : { "User-Agent": searchUA },
      });

    let resp = await fetchSearch(true);
    // 对齐 Go：带 cookie 空结果时去除 cookie 重试（规避风控）
    if (!(resp.data?.lists ?? []).length && kgCookie().trim()) {
      try {
        const retry = await fetchSearch(false);
        if ((retry.data?.lists ?? []).length) resp = retry;
      } catch {
        /* keep original */
      }
    }

    const lists = resp.data?.lists ?? [];
    const isVip = await isKugouVipAccount();
    const songs: Song[] = [];
    for (const item of lists) {
      // 对齐 Go：VIP 账号且非 privilege=10 时优先 SQ 无损 hash
      let finalHash = item.FileHash ?? "";
      if (item.Privilege !== 10 && isVip) finalHash = item.SQFileHash ?? "";
      if (!finalHash.trim()) {
        finalHash = firstNonEmpty(
          item.SQFileHash,
          item.HQFileHash,
          item.ResFileHash,
          item.trans_param?.ogg_320_hash,
          item.FileHash,
          item.trans_param?.ogg_128_hash,
        );
      }
      if (!finalHash) continue;

      let size = 0;
      if (typeof item.FileSize === "number") size = item.FileSize;
      else if (typeof item.FileSize === "string") size = parseInt(item.FileSize, 10) || 0;
      if (finalHash === item.SQFileHash && item.SQFileSize) size = item.SQFileSize;
      if (finalHash === item.HQFileHash && item.HQFileSize) size = item.HQFileSize;
      if (finalHash === item.ResFileHash && item.ResFileSize) size = item.ResFileSize;
      if (finalHash === item.trans_param?.ogg_320_hash && item.trans_param?.ogg_320_filesize) {
        size = item.trans_param.ogg_320_filesize;
      }

      const duration = item.Duration ?? 0;
      const bitrate = duration > 0 && size > 0 ? Math.round((size * 8) / 1000 / duration) : 0;

      songs.push({
        source: "kugou",
        id: finalHash,
        name: cleanText(item.SongName),
        artist: cleanText(item.SingerName),
        album: cleanText(item.AlbumName),
        album_id: item.AlbumID ?? "",
        duration,
        size,
        bitrate,
        cover: (item.Image ?? "").replace("{size}", "240"),
        link: `https://www.kugou.com/song/#hash=${finalHash}`,
        extra: {
          hash: finalHash,
          sq_hash: item.SQFileHash ?? "",
          hq_hash: item.HQFileHash ?? "",
          res_hash: item.ResFileHash ?? "",
          ogg_320_hash: item.trans_param?.ogg_320_hash ?? "",
          ogg_128_hash: item.trans_param?.ogg_128_hash ?? "",
          file_hash: item.FileHash ?? "",
          album_audio_id: firstNonEmpty(num(item.MixSongID), num(item.ID)),
          audio_id: num(item.Audioid),
          privilege: String(item.Privilege ?? 0),
        },
      });
    }
    return songs;
  },

  async parse(link: string): Promise<Song> {
    const match = link.match(/hash=([a-f0-9]{32})/i);
    if (!match) throw new Error("invalid kugou link or hash not found");
    return fetchSongInfoByHash(match[1]);
  },

  async getStreamUrl(song: Song): Promise<string> {
    // 对齐 Go GetDownloadURL：已带直链的 Song 直接返回
    const directURL = (song.url ?? "").trim();
    if (directURL) return directURL;
    const hash = song.extra?.hash || song.id;
    const cookie = kgCookie();
    const privilege = getKugouPrivilege(song);

    // VIP 高音质链（对齐 Go shouldTryKugouHighQualityDownload → fetchVIPSongInfo）
    if (shouldTryKugouHighQualityDownload(cookie, privilege)) {
      try {
        const info = await fetchVIPSongInfo(song);
        if (info.url) return info.url;
      } catch {
        /* fallthrough */
      }
    }

    // VIP 账号 tracker 链
    try {
      if (await isKugouVipAccount()) {
        const info = await fetchTrackerSongInfo(hash);
        if (info.url) return info.url;
      }
    } catch {
      /* fallthrough */
    }

    // 主接口 playInfo
    try {
      const resp = await httpGetJSON<{ url?: string; errcode?: number }>(
        `http://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=${hash}`,
        { headers: { "User-Agent": UA_MOBILE, Referer: "http://m.kugou.com" }, timeoutMs: 10_000 },
      );
      if (resp.url) return resp.url;
    } catch {
      /* fallback */
    }

    // 备用 tracker 接口（key = md5(hash + "kgcloudv2")）
    const info = await fetchTrackerSongInfo(hash);
    if (info.url) return info.url;
    throw new Error("kugou: 未获取到播放链接（可能是付费歌曲）");
  },

  async getLyric(song: Song): Promise<string> {
    const hash = song.extra?.hash || song.id;
    const searchResp = await httpGetJSON<{
      status?: number;
      candidates?: { id?: number | string; accesskey?: string }[];
    }>(
      `http://krcs.kugou.com/search?ver=1&client=mobi&duration=${song.duration * 1000}&hash=${hash}&album_audio_id=`,
      { headers: { "User-Agent": UA_MOBILE, Referer: "http://m.kugou.com" } },
    );
    const candidate = searchResp.candidates?.[0];
    if (!candidate?.accesskey) throw new Error("kugou: 歌词未找到");

    const dlResp = await httpGetJSON<{ status?: number; content?: string; fmt?: string; contenttype?: number }>(
      `http://lyrics.kugou.com/download?ver=1&client=pc&id=${candidate.id}&accesskey=${candidate.accesskey}&fmt=krc&charset=utf8`,
      { headers: { "User-Agent": UA_MOBILE, Referer: "http://m.kugou.com" } },
    );
    if (!dlResp.content) throw new Error("kugou: 歌词内容为空");

    if (dlResp.contenttype === 2 || dlResp.fmt === "lrc") {
      const lrc = Buffer.from(dlResp.content, "base64").toString("utf8");
      // 对齐 Go：LRC 走 ParseLRC + ConvertVerbatimLRC（保留 tags 与词级）
      const parsed = parseLrcVerbatim(lrc);
      if (!parsed.data.length) throw new Error("kugou: 歌词内容为空");
      return convertVerbatimLRC(parsed.tags, { orig: parsed.data });
    }
    // 对齐 Go：KRC 完整解析（含 language tag → roma/ts 多语言）+ ConvertVerbatimLRC
    const krc = decodeKRC(dlResp.content);
    const parsed = parseKrcVerbatim(krc);
    if (!parsed.data.orig?.length) throw new Error("kugou: 歌词内容为空");
    return convertVerbatimLRC(parsed.tags, parsed.data);
  },

  // ---- AlbumProvider ----

  async searchAlbum(keyword: string): Promise<Playlist[]> {
    const params = new URLSearchParams({
      keyword,
      format: "json",
      page: "1",
      pagesize: "10",
    });
    const resp = await httpGetJSON<{
      status?: number;
      errcode?: number;
      error?: string;
      data?: {
        info?: {
          albumid?: number;
          albumname?: string;
          singername?: string;
          publishtime?: string;
          imgurl?: string;
          intro?: string;
          songcount?: number;
        }[];
      };
    }>(`http://mobilecdn.kugou.com/api/v3/search/album?${params}`, {
      headers: { "User-Agent": UA_MOBILE, ...cookieHeaders() },
    });

    if ((resp.errcode ?? 0) !== 0 || resp.status !== 1) {
      throw new Error(`kugou album search api error: status=${resp.status} errcode=${resp.errcode}`);
    }

    const albums = (resp.data?.info ?? [])
      .filter((item) => (item.albumid ?? 0) !== 0)
      .map((item) => ({
        source: "kugou",
        id: String(item.albumid),
        name: (item.albumname ?? "").trim(),
        cover: (item.imgurl ?? "").replace("{size}", "240"),
        track_count: item.songcount ?? 0,
        play_count: 0,
        creator: (item.singername ?? "").trim(),
        description: (item.intro ?? "").trim(),
        link: `https://www.kugou.com/album/${item.albumid}.html`,
        extra: {
          type: "album",
          album_id: String(item.albumid),
          publish_time: item.publishtime ?? "",
        },
      }));

    if (!albums.length) throw new Error("no albums found");
    return albums;
  },

  async getAlbumSongs(id: string): Promise<Song[]> {
    return (await fetchAlbumDetail(id)).songs;
  },

  async parseAlbum(link: string): Promise<PlaylistDetail> {
    const patterns = [
      /album\/single\/(\d+)\.html/,
      /yy\/album\/single\/(\d+)\.html/,
      /album\/(\d+)\.html/,
      /albumid=(\d+)/,
    ];
    for (const pattern of patterns) {
      const match = link.match(pattern);
      if (match) return fetchAlbumDetail(match[1]);
    }
    throw new Error("invalid kugou album link");
  },

  // ---- PlaylistProvider ----

  async searchPlaylist(keyword: string): Promise<Playlist[]> {
    const params = new URLSearchParams({
      keyword,
      platform: "WebFilter",
      format: "json",
      page: "1",
      pagesize: "10",
      filter: "0",
    });
    const resp = await httpGetJSON<{
      data?: {
        info?: {
          specialid?: number;
          specialname?: string;
          intro?: string;
          imgurl?: string;
          songcount?: number;
          playcount?: number;
          nickname?: string;
          publishtime?: string;
        }[];
      };
    }>(`http://mobilecdn.kugou.com/api/v3/search/special?${params}`, {
      headers: { "User-Agent": UA_MOBILE, ...cookieHeaders() },
    });

    return (resp.data?.info ?? []).map((item) => ({
      source: "kugou",
      id: String(item.specialid ?? 0),
      name: (item.specialname ?? "").trim(),
      cover: (item.imgurl ?? "").replace("{size}", "240"),
      track_count: item.songcount ?? 0,
      play_count: item.playcount ?? 0,
      creator: (item.nickname ?? "").trim(),
      description: (item.intro ?? "").trim(),
      link: `https://www.kugou.com/yy/special/single/${item.specialid}.html`,
    }));
  },

  async getPlaylistSongs(id: string): Promise<Song[]> {
    const cloudlistID = parseKugouCloudlistID(id);
    if (cloudlistID) {
      return (await fetchCloudlistDetail(cloudlistID)).songs;
    }
    return (await fetchPlaylistDetail(id)).songs;
  },

  async parsePlaylist(link: string): Promise<PlaylistDetail> {
    if (link.includes("/yy/special/single/")) {
      const match = link.match(/special\/single\/(\d+)\.html/);
      if (!match) throw new Error("invalid kugou playlist link");
      return fetchPlaylistDetail(match[1]);
    }
    if (link.includes("/songlist/")) {
      const match = link.match(/songlist\/(gcid_[a-zA-Z0-9]+)/);
      if (!match) throw new Error("invalid kugou songlist link");
      return fetchPlaylistDetail(match[1]);
    }
    throw new Error("invalid kugou playlist link");
  },

  // ---- RecommendedPlaylistProvider ----

  async getRecommendedPlaylists(): Promise<Playlist[]> {
    // m.kugou.com 的 plist 接口对 Mobile UA 友好，json=true 返回 JSON
    const body = await httpGetText("http://m.kugou.com/plist/index&json=true", {
      headers: { "User-Agent": UA_MOBILE, Referer: MOBILE_REFERER, ...cookieHeaders() },
    });

    if (!body.trimStart().startsWith("{")) {
      throw new Error("kugou api returned invalid json");
    }

    const resp = JSON.parse(body) as {
      plist?: {
        list?: {
          info?: {
            specialid?: number;
            specialname?: string;
            imgurl?: string;
            playcount?: number;
            songcount?: number;
            username?: string;
            intro?: string;
          }[];
        };
      };
    };

    const playlists = (resp.plist?.list?.info ?? []).map((item) => ({
      source: "kugou",
      id: String(item.specialid ?? 0),
      name: (item.specialname ?? "").trim(),
      cover: (item.imgurl ?? "").replace("{size}", "240"),
      track_count: item.songcount ?? 0,
      play_count: item.playcount ?? 0,
      creator: (item.username ?? "").trim(),
      description: (item.intro ?? "").trim(),
      link: `https://www.kugou.com/yy/special/single/${item.specialid}.html`,
    }));

    if (!playlists.length) throw new Error("no recommended playlists found");
    return playlists;
  },

  // ---- PlaylistCategoryProvider ----

  async getPlaylistCategories(): Promise<PlaylistCategory[]> {
    const resp = await httpGetJSON<{
      status?: number;
      errcode?: number;
      error?: string;
      data?: {
        info?: {
          id?: number;
          name?: string;
          children?: { id?: number; name?: string; special_tag_id?: number; is_hot?: number }[];
        }[];
      };
    }>("http://mobilecdnbj.kugou.com/api/v3/tag/list?pid=0&apiver=2&plat=0", {
      headers: { "User-Agent": UA_MOBILE, Referer: MOBILE_REFERER, ...cookieHeaders() },
    });

    if (resp.status !== 1 || (resp.errcode ?? 0) !== 0) {
      throw new Error(`kugou playlist category api error: ${resp.error ?? ""} (status ${resp.status} errcode ${resp.errcode})`);
    }

    const categories: PlaylistCategory[] = [
      { source: "kugou", id: "", name: "全部", group: "全部", count: 0 },
    ];
    for (const group of resp.data?.info ?? []) {
      const groupName = (group.name ?? "").trim();
      if ((group.id ?? 0) > 0 && groupName) {
        categories.push({
          source: "kugou",
          id: `${group.id}:0`,
          name: groupName,
          group: groupName,
          count: 0,
          extra: { id: String(group.id), tag_id: "0" },
        });
      }
      for (const child of group.children ?? []) {
        const name = (child.name ?? "").trim();
        if (!(child.id ?? 0) || !name) continue;
        categories.push({
          source: "kugou",
          id: `${child.id}:${child.special_tag_id ?? 0}`,
          name,
          group: groupName,
          count: 0,
          hot: child.is_hot === 1,
          extra: { id: String(child.id), tag_id: String(child.special_tag_id ?? 0) },
        });
      }
    }
    return categories;
  },

  async getCategoryPlaylists(categoryId: string, page: number, limit: number): Promise<Playlist[]> {
    let categoryID = categoryId.trim();
    if (page < 1) page = 1;
    if (limit < 1) limit = 20;

    if (!categoryID) {
      const categories = await kugou.getPlaylistCategories!();
      categoryID = categories.find((c) => c.id.trim())?.id ?? "";
      if (!categoryID) throw new Error("no playlist categories found");
    }

    const [id, tagID = "0"] = categoryID.split(":");
    if (!id?.trim()) throw new Error("invalid kugou playlist category id");

    const params = new URLSearchParams({
      plat: "0",
      page: String(page),
      tagid: tagID.trim() || "0",
      pagesize: String(limit),
      ugc: "1",
      id: id.trim(),
      sort: "2",
    });
    const resp = await httpGetJSON<{
      status?: number;
      errcode?: number;
      error?: string;
      data?: {
        info?: {
          specialid?: number;
          global_specialid?: string;
          specialname?: string;
          imgurl?: string;
          intro?: string;
          playcount?: number;
          songcount?: number;
          username?: string;
          singername?: string;
          publishtime?: string;
        }[];
      };
    }>(`http://mobilecdnbj.kugou.com/api/v3/tag/specialList?${params}`, {
      headers: { "User-Agent": UA_MOBILE, Referer: MOBILE_REFERER, ...cookieHeaders() },
    });

    if (resp.status !== 1 || (resp.errcode ?? 0) !== 0) {
      throw new Error(`kugou category playlist api error: ${resp.error ?? ""} (status ${resp.status} errcode ${resp.errcode})`);
    }

    const playlists: Playlist[] = [];
    for (const item of resp.data?.info ?? []) {
      const playlistID = (item.specialid ?? 0) > 0 ? String(item.specialid) : (item.global_specialid ?? "").trim();
      const name = (item.specialname ?? "").trim();
      if (!playlistID || !name) continue;

      playlists.push({
        source: "kugou",
        id: playlistID,
        name,
        cover: (item.imgurl ?? "").replace("{size}", "240"),
        track_count: item.songcount ?? 0,
        play_count: item.playcount ?? 0,
        creator: (item.username ?? "").trim() || (item.singername ?? "").trim(),
        description: (item.intro ?? "").trim(),
        link: `https://www.kugou.com/yy/special/single/${playlistID}.html`,
        extra: {
          category_id: categoryID,
          id: id.trim(),
          tag_id: tagID.trim() || "0",
          global_specialid: item.global_specialid ?? "",
          publish_time: item.publishtime ?? "",
        },
      });
    }
    if (!playlists.length) throw new Error("no category playlists found");
    return playlists;
  },

  // ---- UserPlaylistProvider ----

  async getUserPlaylists(page: number, limit: number): Promise<Playlist[]> {
    const cookieMap = parseCookieMap(kgCookie());
    const userID = firstNonEmpty(cookieMap.userid, cookieMap.KugooID);
    if (!userID || userID === "0") {
      throw new Error("kugou user playlists require userid cookie");
    }
    if (page < 1) page = 1;
    if (limit <= 0) limit = 30;
    if (limit > 100) limit = 100;

    if (kugouHasAppCookie(cookieMap)) {
      return getUserPlaylistsGateway(cookieMap, page, limit);
    }

    const params = new URLSearchParams({
      json: "true",
      page: String(page),
      pagesize: String(limit),
    });

    let body: string;
    try {
      body = await httpGetText(
        `http://m.kugou.com/plist/index/${encodeURIComponent(userID)}?${params}`,
        { headers: { "User-Agent": UA_MOBILE, Referer: MOBILE_REFERER, ...cookieHeaders() } },
      );
    } catch (fetchErr) {
      if (!(cookieMap.token ?? "").trim() || !(cookieMap.KUGOU_API_MID ?? "").trim()) throw fetchErr;
      return getUserPlaylistsGateway(cookieMap, page, limit);
    }

    try {
      return await parseKugouUserPlaylists(body, userID);
    } catch (parseErr) {
      if (!(cookieMap.token ?? "").trim() || !(cookieMap.KUGOU_API_MID ?? "").trim()) throw parseErr;
      return getUserPlaylistsGateway(cookieMap, page, limit);
    }
  },

  // ---- QRLoginProvider ----

  async createQRLogin(): Promise<QRLoginSession> {
    const cookies = initKugouLoginDevice({});
    const params: Record<string, string> = {
      appid: "1001",
      type: "1",
      plat: "4",
      qrcode_txt: `https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=${KUGOU_LITE_APPID}&`,
      srcappid: "2919",
    };
    const body = await kugouLoginWebGet("https://login-user.kugou.com/v2/qrcode", params, cookies);

    const resp = JSON.parse(body) as {
      status?: number;
      data?: { qrcode?: string };
      error_code?: number;
      error?: string;
    };
    const key = (resp.data?.qrcode ?? "").trim();
    if (!key) {
      throw new Error(`kugou qr key api error: status=${resp.status} error_code=${resp.error_code} error=${resp.error ?? ""}`);
    }

    return {
      source: "kugou",
      key,
      url: `https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=${encodeURIComponent(key)}`,
      expires_at: Math.floor(Date.now() / 1000) + 5 * 60,
    };
  },

  async checkQRLogin(key: string): Promise<QRLoginResult> {
    const trimmed = key.trim();
    if (!trimmed) throw new Error("kugou qr login key is empty");

    const cookies = initKugouLoginDevice({});
    const params: Record<string, string> = {
      plat: "4",
      appid: KUGOU_LITE_APPID,
      srcappid: "2919",
      qrcode: trimmed,
    };
    const body = await kugouLoginWebGet("https://login-user.kugou.com/v2/get_userinfo_qrcode", params, cookies);

    const resp = JSON.parse(body) as {
      status?: number;
      data?: { status?: number; token?: string; userid?: unknown };
      error_code?: number;
      error?: string;
    };

    const dataStatus = resp.data?.status ?? 0;
    const status = mapKugouQRStatus(dataStatus);
    const result: QRLoginResult = {
      source: "kugou",
      key: trimmed,
      status,
      message: firstNonEmpty(resp.error, `status=${dataStatus}`),
      extra: {
        status: String(dataStatus),
        error_code: String(resp.error_code ?? 0),
      },
    };
    if (status !== "success") return result;

    const token = (resp.data?.token ?? "").trim();
    const userID = num(resp.data?.userid);
    if (!token || !userID || userID === "0") {
      result.status = "failed";
      result.message = "kugou qr login succeeded but token or userid is empty";
      return result;
    }

    cookies.token = token;
    cookies.userid = userID;
    try {
      await registerKugouLoginDevice(cookies);
    } catch (err) {
      result.extra = { ...result.extra, register_error: err instanceof Error ? err.message : String(err) };
    }
    result.cookies = cookies;
    result.cookie = joinCookieMap(cookies);
    return result;
  },
};

function pickUrl(v: string | string[] | undefined): string {
  if (!v) return "";
  if (typeof v === "string") return v.trim() ? v : "";
  for (const s of v) {
    if (s && s.trim()) return s;
  }
  return "";
}
