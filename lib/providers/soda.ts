/**
 * 汽水音乐 Provider — 逐行移植自 music-lib/soda（soda.go / search.go / song.go / download.go /
 * lyric.go / playlist.go / album.go / user_playlist.go / login.go / account.go）。
 * 音频解密见 lib/soda-crypto.ts（node:crypto 翻译 crypto.go）。
 */
import fs from "node:fs";
import path from "node:path";
import type {
  MusicProvider,
  Playlist,
  PlaylistDetail,
  QRLoginResult,
  QRLoginSession,
  QRLoginStatus,
  Song,
} from "../types";
import { httpGetJSON, httpGetText, httpRequest, httpPostRawBodyText, responseCookies } from "../http";
import { getCookie } from "../cookies";
import { decryptAudio } from "../soda-crypto";
import { sodaQrCaptureFile, sodaQrUseCaptureParams, sodaQrUseCaptureSignature } from "../env";

// ---------- 常量（对齐 soda.go / search.go / login.go） ----------

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";
const PC_APP_UA = "LunaPC/3.3.0(359450208)";
const VIP_PROBE_TRACK_ID = "7304719759323564095";
const VIP_PROBE_TRACK_URL = "https://qishui.douyin.com/s/iQeFw9cE/";
const SODA_SEO_BASE = "https://beta-luna.douyin.com/luna/h5/seo_track";

const ANDROID_API_BASE = "https://api.qishui.com/luna";
const ANDROID_SEARCH_UA =
  "com.luna.music/100198030 (Linux; U; Android 15; zh_CN_#Hans; ABR-AL80; Build/V417IR;tt-ok/3.12.13.19)";
const ANDROID_SEARCH_PAGE_SIZE = 20;
const DOUYIN_IMAGE_BASE = "https://p3-luna.douyinpic.com/img/";

const QR_CREATE_API = "https://api.qishui.com/passport/web/get_qrcode/";
const QR_CHECK_API = "https://api.qishui.com/passport/web/check_qrconnect/";
const SEND_CODE_API = "https://api.qishui.com/passport/web/send_code/";
const VALIDATE_API = "https://api.qishui.com/passport/web/validate_code/";
const UP_SMS_VERIFY_API = "https://api.qishui.com/passport/upsms/verify/";
const PASSPORT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) SodaMusic/3.1.0 Chrome/136.0.7103.59 Electron/36.4.0-rs.22.release.main.1 TTElectron/36.4.0-rs.22.release.main.1 Safari/537.36";
const PASSPORT_JS_VER = "2.4.13";
const PASSPORT_AID = "386088";
const SODA_VERSION_CODE = "3.3.0";
const SODA_PZT = "3.3.5";
const SODA_PVER = "1.0.29";
const SODA_PBD = "1.0.0.41";

/** IsVipAccount 缓存（对齐 Soda.isVipCache 实例语义：cookie 变化即失效） */
let isVipCache: boolean | null = null;
let isVipCacheCookie = "";

function setVipCache(value: boolean | null): void {
  isVipCache = value;
  isVipCacheCookie = value === null ? "" : cookie();
}

function getVipCache(): boolean | null {
  if (isVipCache === null) return null;
  if (isVipCacheCookie !== cookie()) {
    isVipCache = null;
    isVipCacheCookie = "";
    return null;
  }
  return isVipCache;
}

function cookie(): string {
  return getCookie("soda").trim();
}

/** 对齐 Go url.QueryEscape：空格 → +，转义 !'()* */
function queryEscape(s: string): string {
  return encodeURIComponent(s)
    .replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"))
    .replace(/%20/g, "+");
}

function trim(v: string | undefined | null): string {
  return (v ?? "").trim();
}

// ---------- 类型 ----------

interface SodaArtist {
  name?: string;
}

interface SodaImage {
  urls?: string[];
  uri?: string;
  template_prefix?: string;
}

interface SodaBitRate {
  br?: number;
  quality?: string;
  size?: number;
}

interface SodaTrackPlayInfo {
  main_play_url?: string;
  backup_play_url?: string;
  play_auth?: string;
  size?: number;
  format?: string;
  bitrate?: number;
  quality?: string;
  duration?: number;
}

interface SodaQualityBenefit {
  condition?: string;
  need_vip?: boolean;
  need_purchase?: boolean;
}

interface SodaLabelInfo {
  only_vip_download?: boolean;
  only_vip_playable?: boolean;
  quality_only_vip_can_download?: string[];
  quality_only_vip_can_play?: string[];
  quality_map?: Record<string, { play_detail?: SodaQualityBenefit; download_detail?: SodaQualityBenefit }>;
}

interface SodaTrack {
  id?: string;
  name?: string;
  duration?: number;
  vid?: string;
  artists?: SodaArtist[];
  album?: { id?: string; name?: string; url_cover?: SodaImage };
  bit_rates?: SodaBitRate[];
  preview?: { vid?: string; start?: number; duration?: number; bit_rates?: SodaBitRate[] };
  label_info?: SodaLabelInfo;
  audio_info?: { play_info_list?: SodaTrackPlayInfo[] };
}

interface SodaUserPlaylistItem {
  id?: string;
  title?: string;
  public_title?: string;
  desc?: string;
  url_cover?: SodaImage;
  count_tracks?: number;
  play_count?: number;
  owner?: { id?: string; nickname?: string; public_name?: string };
  review_status?: string;
  type?: number;
  resource_cnt?: { track_cnt?: number };
  stats?: { count_played?: number; count_collected?: number };
}

interface SodaStatusInfo {
  status_msg?: string;
}

interface SodaTrackPlayer {
  media_id?: string;
  url_player_info?: string;
  video_model?: unknown;
}

interface SodaTrackV2Response {
  status_code?: number;
  status_info?: SodaStatusInfo;
  track?: SodaTrack;
  track_info?: SodaTrack;
  track_player?: SodaTrackPlayer;
  lyric?: { content?: string };
}

interface DownloadInfo {
  url: string;
  playAuth: string;
  format: string;
  size: number;
  duration: number;
  bitrate: number;
  quality: string;
}

interface SodaPlayerInfo {
  MainPlayUrl?: string;
  BackupPlayUrl?: string;
  PlayAuth?: string;
  Size?: number;
  Bitrate?: number;
  Format?: string;
  Duration?: number;
  Quality?: string;
}

// ---------- 基础工具（对齐 soda.go 辅助函数） ----------

function labelInfoIsVIP(l: SodaLabelInfo | undefined): boolean {
  if (!l) return false;
  if (l.only_vip_download || l.only_vip_playable) return true;
  if ((l.quality_only_vip_can_download ?? []).length > 0) return true;
  if ((l.quality_only_vip_can_play ?? []).length > 0) return true;
  for (const policy of Object.values(l.quality_map ?? {})) {
    if (policy?.play_detail?.need_vip) return true;
    if (policy?.download_detail?.need_vip) return true;
  }
  return false;
}

function sodaTrackExtra(
  trackID: string,
  label: SodaLabelInfo | undefined,
  values: Record<string, string>,
): Record<string, string> {
  const extra: Record<string, string> = {
    track_id: trackID,
    is_vip: String(labelInfoIsVIP(label)),
  };
  if (label?.only_vip_download) extra.only_vip_download = "true";
  if (label?.only_vip_playable) extra.only_vip_playable = "true";
  if ((label?.quality_only_vip_can_download ?? []).length > 0) {
    extra.vip_download_qualities = (label?.quality_only_vip_can_download ?? []).join(",");
  }
  if ((label?.quality_only_vip_can_play ?? []).length > 0) {
    extra.vip_play_qualities = (label?.quality_only_vip_can_play ?? []).join(",");
  }
  for (const [key, value] of Object.entries(values)) {
    if (trim(value) !== "") extra[key] = value;
  }
  return extra;
}

function primaryTrack(resp: SodaTrackV2Response): SodaTrack {
  if (resp.track?.id) return resp.track;
  return resp.track_info ?? {};
}

function joinArtists(artists: SodaArtist[] | undefined): string {
  const names: string[] = [];
  for (const artist of artists ?? []) {
    const name = trim(artist.name);
    if (name) names.push(name);
  }
  return names.join(" / ");
}

function buildImageURL(img: SodaImage | undefined, suffix: string): string {
  if (!img?.urls?.length) return "";

  let cover = trim(img.urls[0]);
  const uri = trim(img.uri);
  const templatePrefix = trim(img.template_prefix);
  if (uri && templatePrefix) {
    return DOUYIN_IMAGE_BASE.replace(/\/+$/, "") + "/" + uri + "~" + templatePrefix + "-resize:960:960.png";
  }
  if (uri && !cover.includes(uri)) cover += uri;
  if (!cover) return "";
  if (suffix && !cover.includes("~")) cover += suffix;
  return cover;
}

function maxBitRateSize(bitRates: SodaBitRate[] | undefined): number {
  let size = 0;
  for (const br of bitRates ?? []) {
    if ((br.size ?? 0) > size) size = br.size ?? 0;
  }
  return size;
}

function normalizeBitrate(bitrate: number): number {
  if (bitrate > 1000) return Math.floor(bitrate / 1000);
  return bitrate;
}

function normalizeDuration(duration: number): number {
  if (duration > 1000) return duration / 1000;
  return duration;
}

/** 音质等级评估（对齐 sodaQualityRank） */
function qualityRank(quality: string, format: string, bitrate: number): number {
  const q = trim(quality)
    .toLowerCase()
    .replace(/[-_ ]/g, "");
  const f = trim(format).toLowerCase();
  const br = normalizeBitrate(bitrate);
  const isLosslessFormat = f.includes("flac") || f.includes("alac") || f.includes("wav");
  const isLosslessLabel =
    q.includes("lossless") || q.includes("flac") || q.includes("sq") || q.includes("svip");
  const isHiResLabel = q.includes("hires") || q.includes("master");

  if (isHiResLabel && (isLosslessFormat || br >= 900)) return 110;
  if (isLosslessLabel || isLosslessFormat || br >= 900) return 100;
  if (isHiResLabel) return 90;
  if (q.includes("atmos") || q.includes("dolby") || q.includes("spatial")) return 88;
  if (q.includes("highest") || q.includes("excellent") || q.includes("superhigh") || q.includes("hq")) return 80;
  if (q.includes("higher") || q === "high" || q.includes("320")) return 70;
  if (q.includes("standard") || q.includes("medium") || q.includes("normal") || q.includes("128")) return 50;
  if (q.includes("low") || q.includes("preview")) return 10;

  if (br >= 900) return 100;
  if (br >= 320) return 70;
  if (br >= 256) return 65;
  if (br >= 192) return 55;
  if (br >= 128) return 50;
  if (br > 0) return 20;
  return 0;
}

interface StreamCandidate {
  duration: number;
  quality: string;
  format: string;
  bitrate: number;
  size: number;
}

function betterStreamCandidate(a: StreamCandidate, b: StreamCandidate): boolean {
  if (a.duration > 0 || b.duration > 0) {
    if (a.duration > b.duration + 1) return true;
    if (b.duration > a.duration + 1) return false;
  }
  const aRank = qualityRank(a.quality, a.format, a.bitrate);
  const bRank = qualityRank(b.quality, b.format, b.bitrate);
  if (aRank !== bRank) return aRank > bRank;
  const aBR = normalizeBitrate(a.bitrate);
  const bBR = normalizeBitrate(b.bitrate);
  if (aBR !== bBR) return aBR > bBR;
  if (a.size !== b.size) return a.size > b.size;
  return trim(a.quality) > trim(b.quality);
}

function bestTrackPlayInfo(list: SodaTrackPlayInfo[]): { best: SodaTrackPlayInfo; ok: boolean } {
  let best: SodaTrackPlayInfo = {};
  let ok = false;
  for (const info of list) {
    if (!trim(info.main_play_url) && !trim(info.backup_play_url)) continue;
    if (
      !ok ||
      betterStreamCandidate(
        {
          duration: info.duration ?? 0,
          quality: info.quality ?? "",
          format: info.format ?? "",
          bitrate: info.bitrate ?? 0,
          size: info.size ?? 0,
        },
        {
          duration: best.duration ?? 0,
          quality: best.quality ?? "",
          format: best.format ?? "",
          bitrate: best.bitrate ?? 0,
          size: best.size ?? 0,
        },
      )
    ) {
      best = info;
      ok = true;
    }
  }
  return { best, ok };
}

function trackDurationSeconds(track: SodaTrack): number {
  const d = track.duration ?? 0;
  if (d > 1000) return Math.floor(d / 1000);
  return d;
}

function sodaAlbumLink(id: string): string {
  return `https://www.qishui.com/share/album?album_id=${trim(id)}`;
}

function trackLink(id: string): string {
  return `https://www.qishui.com/track/${id}`;
}

function playlistLinkOf(id: string): string {
  return `https://www.qishui.com/playlist/${id}`;
}

function isDigits(value: string): boolean {
  if (!value) return false;
  return /^[0-9]+$/.test(value);
}

// ---------- video_model 递归提取（对齐 sodaBestFromVideoModel 一族） ----------

function jsonFloat(values: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = values[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const n = parseFloat(trim(value));
      if (!isNaN(n)) return n;
    }
  }
  return 0;
}

function jsonInt(values: Record<string, unknown>, keys: string[]): number {
  return Math.floor(jsonFloat(values, keys) + 0.5);
}

function anyString(value: unknown): string {
  if (typeof value === "string") return trim(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = anyString(item);
      if (text) return text;
    }
  }
  return "";
}

function jsonString(values: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    if (key in values) {
      const text = anyString(values[key]);
      if (text) return text;
    }
  }
  return "";
}

function jsonFirstString(values: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const raw = values[key];
    if (!Array.isArray(raw)) continue;
    for (const item of raw) {
      const text = anyString(item);
      if (text) return text;
    }
  }
  return "";
}

function videoModelPlayAuth(values: Record<string, unknown>): string {
  for (const key of ["encrypt_info", "EncryptInfo", "encryptInfo"]) {
    const child = values[key];
    if (!child || typeof child !== "object" || Array.isArray(child)) continue;
    const auth = jsonString(child as Record<string, unknown>, ["spade_a", "SpadeA", "spadeA", "play_auth", "PlayAuth"]);
    if (auth) return auth;
  }
  return "";
}

function videoModelQualityHint(key: string): string {
  const t = trim(key);
  if (!t) return "";
  const normalized = t.toLowerCase().replace(/[-_ ]/g, "");
  for (const token of ["hires", "lossless", "sq", "flac", "highest", "higher", "standard", "normal"]) {
    if (normalized.includes(token)) return token;
  }
  return "";
}

interface VideoModelEntry extends StreamCandidate {
  mainPlayURL: string;
  backupPlayURL: string;
  playAuth: string;
}

function videoModelEntryFromMap(
  values: Record<string, unknown>,
  keyHint: string,
  inheritedAuth: string,
  inheritedDuration: number,
): VideoModelEntry | null {
  const entry: VideoModelEntry = {
    mainPlayURL: jsonString(values, [
      "main_play_url", "MainPlayUrl", "main_url", "MainUrl", "url", "URL", "play_url", "PlayURL",
    ]),
    backupPlayURL: jsonString(values, [
      "backup_play_url", "BackupPlayUrl", "backup_url", "BackupUrl", "backup_url_1", "backup_url_2", "backup_url_3",
    ]),
    playAuth: jsonString(values, ["play_auth", "PlayAuth"]),
    size: jsonInt(values, ["size", "Size", "file_size", "FileSize", "data_size", "DataSize"]),
    format: jsonString(values, ["format", "Format", "vtype", "VType", "file_format", "FileFormat"]),
    bitrate: jsonInt(values, ["bitrate", "Bitrate", "br", "BR", "bit_rate", "BitRate"]),
    quality: jsonString(values, ["quality", "Quality", "definition", "Definition", "quality_type", "QualityType"]),
    duration: jsonFloat(values, ["duration", "Duration"]),
  };

  const meta = values["video_meta"];
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const metaMap = meta as Record<string, unknown>;
    if (entry.size === 0) entry.size = jsonInt(metaMap, ["size", "Size", "file_size", "FileSize"]);
    if (!entry.format) entry.format = jsonString(metaMap, ["format", "Format", "vtype", "VType", "codec_type", "CodecType"]);
    if (entry.bitrate === 0) entry.bitrate = jsonInt(metaMap, ["bitrate", "Bitrate", "real_bitrate", "RealBitrate", "bit_rate", "BitRate"]);
    if (!entry.quality) entry.quality = jsonString(metaMap, ["quality", "Quality", "definition", "Definition", "quality_type", "QualityType"]);
    if (entry.duration === 0) entry.duration = jsonFloat(metaMap, ["duration", "Duration"]);
  }
  if (!entry.backupPlayURL) {
    entry.backupPlayURL = jsonFirstString(values, ["backup_urls", "backupUrls", "url_list", "UrlList"]);
  }
  if (!entry.playAuth) entry.playAuth = videoModelPlayAuth(values);
  if (!entry.playAuth) entry.playAuth = trim(inheritedAuth);
  if (!entry.quality) entry.quality = videoModelQualityHint(jsonString(values, ["gear_des_key", "GearDesKey"]));
  if (!entry.quality) entry.quality = videoModelQualityHint(keyHint);
  if (entry.duration === 0) entry.duration = inheritedDuration;

  if (trim(entry.mainPlayURL) || trim(entry.backupPlayURL)) return entry;
  return null;
}

function collectVideoModelEntries(
  value: unknown,
  keyHint: string,
  inheritedAuth: string,
  inheritedDuration: number,
  entries: VideoModelEntry[],
): void {
  if (Array.isArray(value)) {
    for (const child of value) collectVideoModelEntries(child, keyHint, inheritedAuth, inheritedDuration, entries);
    return;
  }
  if (!value || typeof value !== "object") return;

  const v = value as Record<string, unknown>;
  let auth = trim(inheritedAuth);
  const ownAuth = videoModelPlayAuth(v);
  if (ownAuth) auth = ownAuth;
  let duration = inheritedDuration;
  const ownDuration = jsonFloat(v, ["video_duration", "duration", "Duration"]);
  if (ownDuration > 0) duration = normalizeDuration(ownDuration);

  const entry = videoModelEntryFromMap(v, keyHint, auth, duration);
  if (entry) entries.push(entry);

  for (const [key, child] of Object.entries(v)) {
    collectVideoModelEntries(child, key, auth, duration, entries);
  }
}

/** 对齐 sodaBestFromVideoModel：video_model 可能是对象 / JSON 字符串 / 双重编码字符串 */
function bestFromVideoModel(raw: unknown): DownloadInfo | null {
  let value: unknown = raw;
  for (let i = 0; i < 3 && typeof value === "string"; i++) {
    const t = value.trim();
    if (!t.startsWith('"')) break;
    try {
      value = JSON.parse(t);
    } catch {
      break;
    }
  }
  if (value === null || value === undefined) return null;

  const entries: VideoModelEntry[] = [];
  collectVideoModelEntries(value, "", "", 0, entries);

  let best: VideoModelEntry | null = null;
  for (const entry of entries) {
    if (!trim(entry.mainPlayURL) && !trim(entry.backupPlayURL)) continue;
    if (!best || betterStreamCandidate(entry, best)) best = entry;
  }
  if (!best) return null;

  let downloadURL = trim(best.mainPlayURL);
  if (!downloadURL) downloadURL = trim(best.backupPlayURL);
  if (!downloadURL) return null;

  return {
    url: downloadURL,
    playAuth: trim(best.playAuth),
    format: trim(best.format),
    size: best.size,
    duration: best.duration,
    bitrate: best.bitrate,
    quality: trim(best.quality),
  };
}

// ---------- 下载信息（对齐 download.go） ----------

function downloadInfoURL(info: DownloadInfo | null): string {
  if (!info) return "";
  if (!trim(info.playAuth)) return info.url;
  return info.url + "#auth=" + queryEscape(info.playAuth);
}

function downloadInfoIsPreview(info: DownloadInfo | null, fullDurationSeconds: number): boolean {
  if (!info || info.duration <= 0 || fullDurationSeconds <= 0) return false;
  return info.duration + 5 < fullDurationSeconds;
}

function downloadInfoIsLossless(info: DownloadInfo | null): boolean {
  if (!info) return false;
  return qualityRank(info.quality, info.format, info.bitrate) >= 100;
}

function applyDownloadInfo(song: Song, info: DownloadInfo): void {
  const url = downloadInfoURL(info);
  if (url) song.url = url;
  if (info.size > 0) song.size = info.size;
  if (info.format) song.ext = info.format;
  if (info.bitrate > 0) {
    song.bitrate = normalizeBitrate(info.bitrate);
  } else if (song.duration > 0 && info.size > 0) {
    song.bitrate = Math.floor((info.size * 8) / 1000 / song.duration);
  }
  if (info.duration > 0 && song.duration === 0) {
    song.duration = Math.floor(info.duration + 0.5);
  }
  if (trim(info.quality)) {
    song.extra = song.extra ?? {};
    song.extra.quality = trim(info.quality);
    song.extra.download_quality = trim(info.quality);
  }
}

function songTrackID(song: Song): string {
  if (trim(song.extra?.track_id)) return trim(song.extra?.track_id);
  return trim(song.id);
}

function cachedDownloadInfo(song: Song): DownloadInfo | null {
  const rawURL = song.url ?? "";
  if (!rawURL.includes("#auth=")) return null;
  const parts = rawURL.split("#auth=");
  if (parts.length !== 2) return null;
  let auth = parts[1];
  try {
    auth = decodeURIComponent(parts[1].replace(/\+/g, " "));
  } catch {
    // 保留原值
  }
  return {
    url: parts[0],
    playAuth: auth,
    format: song.ext ?? "",
    size: song.size,
    duration: song.duration,
    bitrate: song.bitrate,
    quality: trim(song.extra?.quality),
  };
}

// ---------- track_v2 / SEO / PC（对齐 soda.go 请求族） ----------

function webTrackV2URL(trackID: string): string {
  const params = new URLSearchParams({
    track_id: trackID,
    media_type: "track",
    aid: "386088",
    device_platform: "web",
    channel: "pc_web",
  });
  return `https://api.qishui.com/luna/pc/track_v2?${params}`;
}

function seoTrackURL(trackID: string): string {
  const params = new URLSearchParams({ track_id: trackID, device_platform: "web" });
  return `${SODA_SEO_BASE}?${params}`;
}

function pcAppParams(): URLSearchParams {
  const now = Date.now();
  const deviceID = String(now);
  const iid = String(now + 1);
  const params = new URLSearchParams({
    aid: "386088",
    app_name: "luna_pc",
    region: "cn",
    geo_region: "cn",
    os_region: "cn",
    sim_region: "",
    device_id: deviceID,
    cdid: "",
    iid,
    version_name: "3.3.0",
    version_code: "30030000",
    channel: "official",
    build_mode: "master",
    network_carrier: "",
    ac: "wifi",
    tz_name: "Asia/Shanghai",
    resolution: "",
    device_platform: "windows",
    device_type: "Windows",
    os_version: "Windows 11",
    fp: deviceID,
  });
  return params;
}

function pcTrackV2URL(): string {
  return `https://api.qishui.com/luna/pc/track_v2?${pcAppParams()}`;
}

function pcMeURL(): string {
  return `https://api.qishui.com/luna/pc/me?${pcAppParams()}`;
}

function pcUserPlaylistURL(userID: string, cursor: string, count: number): string {
  if (count <= 0) count = 50;
  const params = pcAppParams();
  params.set("user_id", userID.trim());
  params.set("cursor", cursor.trim());
  params.set("count", String(count));
  return `https://api.qishui.com/luna/pc/user/playlist?${params}`;
}

function pcPlaylistDetailURL(playlistID: string, cursor: string, count: number): string {
  if (count <= 0) count = 100;
  const params = pcAppParams();
  params.set("playlist_id", playlistID.trim());
  params.set("cursor", cursor.trim());
  params.set("count", String(count));
  return `https://api.qishui.com/luna/pc/playlist/detail?${params}`;
}

function pcHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": PC_APP_UA,
    "x-luna-background-type": "foreground",
    "x-luna-is-background-req": "0",
    "x-luna-is-local-user": "1",
  };
  if (cookie()) headers.Cookie = cookie();
  return headers;
}

function statusMsg(info: SodaStatusInfo | undefined): string {
  const msg = trim(info?.status_msg);
  return msg || "unknown error";
}

function parseTrackV2Response(text: string): SodaTrackV2Response {
  const resp = JSON.parse(text) as SodaTrackV2Response;
  if ((resp.status_code ?? 0) !== 0) {
    throw new Error(`soda track_v2 api error: status_code=${resp.status_code} status_msg=${statusMsg(resp.status_info)}`);
  }
  return resp;
}

/** 对齐 fetchSeoTrackData：SEO 兜底接口 */
async function fetchSeoTrackData(trackID: string): Promise<SodaTrackV2Response> {
  const resp = await httpGetJSON<{
    status_code?: number;
    status_info?: SodaStatusInfo;
    track_player?: SodaTrackPlayer;
    seo_track?: { track?: SodaTrack; lyric?: { content?: string } };
    lyric?: { content?: string };
  }>(seoTrackURL(trackID), { headers: { "User-Agent": UA, Cookie: cookie() } });

  if ((resp.status_code ?? 0) !== 0) {
    throw new Error(`soda seo_track api error: status_code=${resp.status_code} status_msg=${statusMsg(resp.status_info)}`);
  }

  const out: SodaTrackV2Response = {
    status_code: 0,
    track: resp.seo_track?.track ?? {},
    track_info: resp.seo_track?.track ?? {},
    track_player: resp.track_player ?? {},
  };
  if (trim(resp.seo_track?.lyric?.content)) {
    out.lyric = { content: resp.seo_track?.lyric?.content ?? "" };
  } else {
    out.lyric = { content: resp.lyric?.content ?? "" };
  }
  if (!trim(out.track?.id)) throw new Error("soda seo_track missing track id");
  return out;
}

/** 对齐 fetchWebTrackV2：web track_v2，失败/解析错误 → SEO 兜底 */
async function fetchWebTrackV2(trackID: string): Promise<SodaTrackV2Response> {
  let body: string;
  try {
    body = await httpGetText(webTrackV2URL(trackID), { headers: { "User-Agent": UA, Cookie: cookie() } });
  } catch (err) {
    try {
      return await fetchSeoTrackData(trackID);
    } catch (seoErr) {
      throw new Error(`soda track_v2 failed: ${(err as Error).message} (seo fallback: ${(seoErr as Error).message})`);
    }
  }
  try {
    return parseTrackV2Response(body);
  } catch (parseErr) {
    try {
      return await fetchSeoTrackData(trackID);
    } catch (seoErr) {
      throw new Error(`soda track_v2 parse failed: ${(parseErr as Error).message} (seo fallback: ${(seoErr as Error).message})`);
    }
  }
}

/** 对齐 fetchPCTrackV2：PC 客户端接口（需要 Cookie），POST JSON */
async function fetchPCTrackV2(trackID: string): Promise<SodaTrackV2Response> {
  if (!cookie()) throw new Error("soda pc track_v2 requires cookie");

  const body = await httpPostRawBodyText(
    pcTrackV2URL(),
    JSON.stringify({
      track_id: trackID,
      media_type: "track",
      queue_type: "favorite_track_playlist",
      scene_name: "library",
    }),
    "application/json; charset=utf-8",
    { headers: pcHeaders() },
  );
  if (!body.ok) throw new Error(`HTTP ${body.status} for api.qishui.com`);
  return parseTrackV2Response(await body.text());
}

/** 对齐 fetchPlayerInfo：url_player_info → PlayInfoList */
async function fetchPlayerInfo(playerInfoURL: string): Promise<DownloadInfo> {
  const resp = await httpGetJSON<{
    ResponseMetadata?: { Error?: { Message?: string; Code?: string } };
    Result?: { Data?: { PlayInfoList?: SodaPlayerInfo[] } };
  }>(playerInfoURL, { headers: { "User-Agent": UA, Cookie: cookie() } });

  const list = resp.Result?.Data?.PlayInfoList ?? [];
  if (list.length === 0) {
    const msg = resp.ResponseMetadata?.Error?.Message ?? "";
    throw new Error(msg || "no audio stream found");
  }

  let best: SodaPlayerInfo | null = null;
  for (const info of list) {
    if (!trim(info.MainPlayUrl) && !trim(info.BackupPlayUrl)) continue;
    if (
      !best ||
      betterStreamCandidate(
        {
          duration: info.Duration ?? 0,
          quality: info.Quality ?? "",
          format: info.Format ?? "",
          bitrate: info.Bitrate ?? 0,
          size: info.Size ?? 0,
        },
        {
          duration: best.Duration ?? 0,
          quality: best.Quality ?? "",
          format: best.Format ?? "",
          bitrate: best.Bitrate ?? 0,
          size: best.Size ?? 0,
        },
      )
    ) {
      best = info;
    }
  }
  if (!best) throw new Error("invalid download url");
  let downloadURL = best.MainPlayUrl ?? "";
  if (!downloadURL) downloadURL = best.BackupPlayUrl ?? "";
  if (!downloadURL) throw new Error("invalid download url");

  return {
    url: downloadURL,
    playAuth: best.PlayAuth ?? "",
    format: best.Format ?? "",
    size: best.Size ?? 0,
    duration: best.Duration ?? 0,
    bitrate: best.Bitrate ?? 0,
    quality: best.Quality ?? "",
  };
}

/** 对齐 resolveDownloadInfo：web video_model → player_info → PC track_v2 → 回退预览流 */
async function resolveDownloadInfo(trackID: string, webResp?: SodaTrackV2Response | null): Promise<DownloadInfo> {
  trackID = trackID.trim();
  if (!trackID) throw new Error("track id is empty");

  if (!webResp) webResp = await fetchWebTrackV2(trackID);

  const track = primaryTrack(webResp);
  let fullDuration = trackDurationSeconds(track);
  let isVIPTrack = labelInfoIsVIP(track.label_info);

  let lastErr: Error | null = null;
  let webInfo: DownloadInfo | null = bestFromVideoModel(webResp.track_player?.video_model);
  if ((webInfo === null || downloadInfoIsPreview(webInfo, fullDuration)) && trim(webResp.track_player?.url_player_info)) {
    try {
      webInfo = await fetchPlayerInfo(trim(webResp.track_player?.url_player_info) ?? "");
    } catch (err) {
      webInfo = null;
      lastErr = err as Error;
    }
  }

  const webIsPreview = downloadInfoIsPreview(webInfo, fullDuration);
  let shouldTryPC = cookie() !== "" && (isVIPTrack || webIsPreview || !downloadInfoIsLossless(webInfo));
  // PC track_v2 已下线；若 SEO 已返回完整、非 VIP 且音质足够，无需再浪费一次请求。
  if (webInfo && !isVIPTrack && !webIsPreview && qualityRank(webInfo.quality, webInfo.format, webInfo.bitrate) >= 60) {
    shouldTryPC = false;
  }
  if (shouldTryPC) {
    try {
      const pcResp = await fetchPCTrackV2(trackID);
      const pcTrack = primaryTrack(pcResp);
      if (fullDuration === 0) fullDuration = trackDurationSeconds(pcTrack);
      if (labelInfoIsVIP(pcTrack.label_info)) isVIPTrack = true;

      const videoInfo = bestFromVideoModel(pcResp.track_player?.video_model);
      if (videoInfo) {
        if (!downloadInfoIsPreview(videoInfo, fullDuration)) {
          if (isVIPTrack) setVipCache(true);
          return videoInfo;
        }
        lastErr = new Error("soda pc track_v2 returned preview stream");
      }

      if (trim(pcResp.track_player?.url_player_info)) {
        try {
          const pcInfo = await fetchPlayerInfo(trim(pcResp.track_player?.url_player_info) ?? "");
          if (!downloadInfoIsPreview(pcInfo, fullDuration)) {
            if (isVIPTrack) setVipCache(true);
            return pcInfo;
          }
          lastErr = new Error("soda pc track_v2 returned preview stream");
        } catch (infoErr) {
          lastErr = infoErr as Error;
        }
      } else {
        lastErr = new Error("soda pc track_v2 missing player info url");
      }
    } catch (pcErr) {
      lastErr = pcErr as Error;
    }
  }

  if (webInfo && webInfo.url) {
    if (isVIPTrack && webIsPreview && cookie()) {
      setVipCache(false);
    }
    // 完整流（需签名或 VIP 账号）拿不到时，回退到平台允许的预览流，保证能下载。
    return webInfo;
  }

  if (lastErr) throw lastErr;
  throw new Error("player info url not found");
}

/** 对齐 GetDownloadInfo */
async function getDownloadInfo(song: Song): Promise<DownloadInfo> {
  if (song.source && song.source !== "soda") throw new Error("source mismatch");

  const trackID = songTrackID(song);
  const cachedInfo = cachedDownloadInfo(song);
  if (trackID) {
    try {
      return await resolveDownloadInfo(trackID, null);
    } catch (err) {
      if (cachedInfo && cachedInfo.url) return cachedInfo;
      throw err;
    }
  }
  if (cachedInfo && cachedInfo.url) return cachedInfo;
  throw new Error("track id is empty");
}

// ---------- Song 构建 ----------

function buildSongFromTrack(track: SodaTrack): Song {
  let displaySize = maxBitRateSize(track.bit_rates);
  const previewSize = maxBitRateSize(track.preview?.bit_rates);
  if (previewSize > displaySize) displaySize = previewSize;

  const duration = trackDurationSeconds(track);
  const bitrate = duration > 0 && displaySize > 0 ? Math.floor((displaySize * 8) / 1000 / duration) : 0;

  const albumID = trim(track.album?.id);
  const artist = joinArtists(track.artists);

  const song: Song = {
    source: "soda",
    id: track.id ?? "",
    name: track.name ?? "",
    artist,
    album: track.album?.name ?? "",
    album_id: albumID,
    duration,
    size: displaySize,
    bitrate,
    url: "",
    cover: buildImageURL(track.album?.url_cover, "~c5_375x375.jpg"),
    link: trackLink(track.id ?? ""),
    extra: sodaTrackExtra(track.id ?? "", track.label_info, { album_id: albumID }),
    is_vip: labelInfoIsVIP(track.label_info),
  };

  const { best, ok } = bestTrackPlayInfo(track.audio_info?.play_info_list ?? []);
  if (ok) {
    let downloadURL = trim(best.main_play_url);
    if (!downloadURL) downloadURL = trim(best.backup_play_url);
    if (downloadURL) {
      song.url = downloadURL;
      if (trim(best.play_auth)) song.url += "#auth=" + queryEscape(best.play_auth ?? "");
      if ((best.size ?? 0) > song.size) song.size = best.size ?? 0;
      if (best.format) song.ext = best.format;
      if ((best.bitrate ?? 0) > 0) song.bitrate = normalizeBitrate(best.bitrate ?? 0);
      if (trim(best.quality)) song.extra!.quality = trim(best.quality);
    }
  }
  return song;
}

/** 对齐 fetchSongDetail */
async function fetchSongDetail(trackID: string): Promise<Song> {
  const v2Resp = await fetchWebTrackV2(trackID);
  const track = primaryTrack(v2Resp);
  if (!track.id) throw new Error("track info not found");

  const song = buildSongFromTrack(track);
  try {
    const info = await resolveDownloadInfo(track.id, v2Resp);
    applyDownloadInfo(song, info);
  } catch {
    // 对齐 Go：拿不到下载信息时仍返回歌曲
  }
  return song;
}

// ---------- 分享页 / ID 提取 ----------

/** 对齐 fetchSharePage：跟随跳转拿最终 URL + 页面内容 */
async function fetchSharePage(link: string): Promise<{ finalURL: string; body: string }> {
  const resp = await httpRequest(link, {
    headers: cookie() ? { "User-Agent": UA, Cookie: cookie() } : { "User-Agent": UA },
    timeoutMs: 30_000,
  });
  if (resp.status !== 200) throw new Error(`http request failed: status ${resp.status}`);
  return { finalURL: resp.url ?? "", body: await resp.text() };
}

function extractTrackIDFromText(text: string): string {
  text = text.trim();
  if (text.length > 10 && isDigits(text) && !text.includes("/")) return text;

  const candidates = [text];
  try {
    const decoded = decodeURIComponent(text.replace(/\+/g, " "));
    if (decoded !== text) candidates.push(decoded);
  } catch {
    // 忽略
  }

  const patterns = [
    /(?:^|[?&])track_id=(\d{10,})/,
    /"track_id"\s*:\s*"(\d{10,})"/,
    /(?:\/|%2F)(?:track|song)(?:\/|%2F)(\d{10,})/,
    /(?:track|song)\/(\d{10,})/,
  ];
  for (const candidate of candidates) {
    for (const pattern of patterns) {
      const m = candidate.match(pattern);
      if (m) return m[1];
    }
  }
  return "";
}

function extractPlaylistIDFromText(text: string): string {
  text = text.trim();
  if (text && isDigits(text) && !text.includes("/")) return text;

  const candidates = [text];
  try {
    const decoded = decodeURIComponent(text.replace(/\+/g, " "));
    if (decoded !== text) candidates.push(decoded);
  } catch {
    // 忽略
  }

  const patterns = [
    /(?:^|[?&])playlist_id=(\d+)/,
    /(?:^|[?&])playlistId=(\d+)/,
    /"playlist_id"\s*:\s*"?(\d+)"?/,
    /"playlistId"\s*:\s*"?(\d+)"?/,
    /(?:\/|%2f)playlist(?:\/|%2f)(\d+)/i,
    /playlist\/(\d+)/,
  ];
  for (const candidate of candidates) {
    for (const pattern of patterns) {
      const m = candidate.match(pattern);
      if (m) return m[1];
    }
  }
  return "";
}

async function extractTrackID(link: string): Promise<string> {
  const direct = extractTrackIDFromText(link);
  if (direct) return direct;

  const { finalURL, body } = await fetchSharePage(link);
  const fromURL = extractTrackIDFromText(finalURL);
  if (fromURL) return fromURL;
  const fromBody = extractTrackIDFromText(body);
  if (fromBody) return fromBody;
  throw new Error("soda track id not found");
}

async function extractPlaylistID(link: string): Promise<string> {
  const direct = extractPlaylistIDFromText(link);
  if (direct) return direct;

  const { finalURL, body } = await fetchSharePage(link);
  const fromURL = extractPlaylistIDFromText(finalURL);
  if (fromURL) return fromURL;
  const fromBody = extractPlaylistIDFromText(body);
  if (fromBody) return fromBody;
  throw new Error("soda playlist id not found");
}

function extractAlbumID(link: string): string {
  const patterns = [/album_id=(\d+)/, /(?:^|[?&])id=(\d+)/, /album\/(\d+)/];
  for (const pattern of patterns) {
    const m = link.match(pattern);
    if (m) return m[1];
  }
  const t = link.trim();
  if (t.length > 10 && !t.includes("/")) return t;
  return "";
}

// ---------- 专辑（分享页 _ROUTER_DATA） ----------

/** 对齐 extractSodaJSONBlock：从 marker 后提取首个配平的 JSON 对象 */
function extractJSONBlock(page: string, marker: string): string {
  const start = page.indexOf(marker);
  if (start < 0) throw new Error("soda router data not found");
  const from = start + marker.length;

  let depth = 0;
  let inString = false;
  let escaped = false;
  let started = false;

  for (let i = from; i < page.length; i++) {
    const ch = page[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
      started = true;
    } else if (ch === "}") {
      depth--;
      if (started && depth === 0) return page.slice(from, i + 1);
    }
  }
  throw new Error("soda router data is incomplete");
}

interface SodaShareAlbumPage {
  loaderData?: {
    album_page?: {
      albumInfo?: {
        id?: string;
        name?: string;
        artists?: SodaArtist[];
        company?: string;
        count_tracks?: number;
        url_cover?: SodaImage;
        release_date?: number;
        pclines?: string[];
      };
      trackList?: SodaTrack[];
    };
  };
}

function parseShareAlbumPage(body: string): SodaShareAlbumPage {
  return JSON.parse(extractJSONBlock(body, "_ROUTER_DATA = ")) as SodaShareAlbumPage;
}

/** 对齐 fetchAlbumDetail */
async function fetchAlbumDetail(id: string): Promise<PlaylistDetail> {
  const body = await httpGetText(sodaAlbumLink(id), { headers: { "User-Agent": UA, Cookie: cookie() } });
  const pageData = parseShareAlbumPage(body);

  const info = pageData.loaderData?.album_page?.albumInfo;
  if (!info?.id) throw new Error("album not found");

  let description = (info.pclines ?? []).join(" ").trim();
  if (!description) description = trim(info.company);

  const album: Playlist = {
    source: "soda",
    id: info.id,
    name: info.name ?? "",
    cover: buildImageURL(info.url_cover, "~c5_300x300.jpg"),
    track_count: info.count_tracks ?? 0,
    play_count: 0,
    creator: joinArtists(info.artists),
    description,
    link: sodaAlbumLink(info.id),
    extra: { album_id: info.id },
  };
  if ((info.release_date ?? 0) > 0) album.extra!.release_date = String(info.release_date);
  const trackList = pageData.loaderData?.album_page?.trackList ?? [];
  if (album.track_count === 0) album.track_count = trackList.length;

  const songs: Song[] = [];
  for (const track of trackList) {
    if (!track.id) continue;

    let displaySize = maxBitRateSize(track.bit_rates);
    const previewSize = maxBitRateSize(track.preview?.bit_rates);
    if (previewSize > displaySize) displaySize = previewSize;

    let artist = joinArtists(track.artists);
    if (!artist) artist = album.creator;

    let cover = buildImageURL(track.album?.url_cover, "~c5_375x375.jpg");
    if (!cover) cover = buildImageURL(info.url_cover, "~c5_375x375.jpg");

    let albumID = track.album?.id ?? "";
    if (!albumID) albumID = info.id;
    let albumName = trim(track.album?.name);
    if (!albumName) albumName = info.name ?? "";

    const duration = Math.floor((track.duration ?? 0) / 1000);
    const bitrate = duration > 0 && displaySize > 0 ? Math.floor((displaySize * 8) / 1000 / duration) : 0;

    songs.push({
      source: "soda",
      id: track.id,
      name: track.name ?? "",
      artist,
      album: albumName,
      album_id: albumID,
      duration,
      size: displaySize,
      bitrate,
      url: "",
      cover,
      link: trackLink(track.id),
      extra: sodaTrackExtra(track.id, track.label_info, { album_id: albumID }),
      is_vip: labelInfoIsVIP(track.label_info),
    });
  }

  if (songs.length === 0) throw new Error("album has no songs");
  return { playlist: album, songs };
}

// ---------- 歌单 ----------

/** 对齐 buildPlaylistFromUserItem */
function buildPlaylistFromUserItem(
  item: SodaUserPlaylistItem,
  currentUserID: string,
  currentNickname: string,
): Playlist {
  const playlistID = trim(item.id);
  if (!playlistID) {
    return {
      source: "soda",
      id: "",
      name: "",
      cover: "",
      track_count: 0,
      play_count: 0,
      creator: "",
      description: "",
      link: "",
    };
  }

  const firstNonEmpty = (...values: string[]): string => {
    for (const v of values) {
      if (trim(v)) return trim(v);
    }
    return "";
  };
  const name = firstNonEmpty(item.title ?? "", item.public_title ?? "", playlistID);
  const creator = firstNonEmpty(
    item.owner?.public_name ?? "",
    item.owner?.nickname ?? "",
    currentNickname,
    currentUserID,
  );
  let trackCount = item.count_tracks ?? 0;
  if (trackCount === 0) trackCount = item.resource_cnt?.track_cnt ?? 0;
  let playCount = item.play_count ?? 0;
  if (playCount === 0) playCount = item.stats?.count_played ?? 0;

  const extra: Record<string, string> = {
    user_id: currentUserID,
    type: String(item.type ?? 0),
  };
  const ownerID = trim(item.owner?.id);
  if (ownerID) extra.owner_id = ownerID;
  const publicTitle = trim(item.public_title);
  if (publicTitle) extra.public_title = publicTitle;
  const reviewStatus = trim(item.review_status);
  if (reviewStatus) extra.review_status = reviewStatus;
  if ((item.stats?.count_collected ?? 0) > 0) {
    extra.collect_count = String(item.stats?.count_collected);
  }

  return {
    source: "soda",
    id: playlistID,
    name,
    cover: buildImageURL(item.url_cover, "~c5_300x300.jpg"),
    track_count: trackCount,
    play_count: playCount,
    creator,
    description: trim(item.desc),
    link: playlistLinkOf(playlistID),
    extra,
  };
}

/** 对齐 fetchPlaylistDetailPage */
async function fetchPlaylistDetailPage(playlistID: string, cursor: string, count: number) {
  const resp = await httpGetJSON<{
    status_code?: number;
    status_info?: SodaStatusInfo;
    next_cursor?: string;
    has_more?: boolean;
    playlist?: SodaUserPlaylistItem;
    media_resources?: { type?: string; entity?: { track_wrapper?: { track?: SodaTrack } } }[];
  }>(pcPlaylistDetailURL(playlistID, cursor, count), { headers: pcHeaders() });

  if ((resp.status_code ?? 0) !== 0) {
    throw new Error(`soda playlist detail api error: status_code=${resp.status_code} status_msg=${statusMsg(resp.status_info)}`);
  }
  return resp;
}

/** 对齐 fetchPlaylistDetailWeb：web 端歌单详情兜底 */
async function fetchPlaylistDetailWeb(id: string): Promise<PlaylistDetail> {
  const params = new URLSearchParams({
    playlist_id: id,
    cursor: "0",
    cnt: "20",
    aid: "386088",
    device_platform: "web",
    channel: "pc_web",
  });
  const resp = await httpGetJSON<{
    playlist?: {
      id?: string;
      title?: string;
      desc?: string;
      owner?: { nickname?: string };
      count_tracks?: number;
      url_cover?: { urls?: string[]; uri?: string };
    };
    media_resources?: {
      type?: string;
      entity?: {
        track_wrapper?: {
          track?: {
            id?: string;
            name?: string;
            duration?: number;
            artists?: { name?: string }[];
            album?: { name?: string; url_cover?: { urls?: string[]; uri?: string } };
            bit_rates?: { size?: number; quality?: string }[];
            audio_info?: {
              play_info_list?: {
                main_play_url?: string;
                play_auth?: string;
                size?: number;
                format?: string;
                bitrate?: number;
              }[];
            };
          };
        };
      };
    }[];
  }>(`https://api.qishui.com/luna/pc/playlist/detail?${params}`, {
    headers: { "User-Agent": UA, Cookie: cookie() },
  });

  const pl: Playlist = {
    source: "soda",
    id,
    name: resp.playlist?.title ?? "",
    cover: "",
    track_count: resp.playlist?.count_tracks ?? 0,
    play_count: 0,
    creator: resp.playlist?.owner?.nickname ?? "",
    description: resp.playlist?.desc ?? "",
    link: playlistLinkOf(id),
  };
  const urlCover = resp.playlist?.url_cover;
  if ((urlCover?.urls ?? []).length > 0) {
    let cover = urlCover?.urls?.[0] ?? "";
    const uri = urlCover?.uri ?? "";
    if (uri && !cover.includes(uri)) cover += uri;
    if (!cover.includes("~")) cover += "~c5_300x300.jpg";
    pl.cover = cover;
  }

  const songs: Song[] = [];
  for (const item of resp.media_resources ?? []) {
    if (item.type !== "track") continue;
    const track = item.entity?.track_wrapper?.track;
    if (!track?.id) continue;

    let displaySize = 0;
    for (const br of track.bit_rates ?? []) {
      if ((br.size ?? 0) > displaySize) displaySize = br.size ?? 0;
    }
    for (const pi of track.audio_info?.play_info_list ?? []) {
      if ((pi.size ?? 0) > displaySize) displaySize = pi.size ?? 0;
    }

    const artistNames = (track.artists ?? []).map((ar) => ar.name ?? "");

    let cover = "";
    const albumCover = track.album?.url_cover;
    if ((albumCover?.urls ?? []).length > 0) {
      const domain = albumCover?.urls?.[0] ?? "";
      const uri = albumCover?.uri ?? "";
      if (domain && uri && !domain.includes(uri)) {
        cover = domain + uri + "~c5_375x375.jpg";
      } else if (domain) {
        cover = domain + "~c5_375x375.jpg";
      }
    }

    const seconds = Math.floor((track.duration ?? 0) / 1000);
    const bitrate = seconds > 0 && displaySize > 0 ? Math.floor((displaySize * 8) / 1000 / seconds) : 0;

    const song: Song = {
      source: "soda",
      id: track.id,
      name: track.name ?? "",
      artist: artistNames.join("、"),
      album: track.album?.name ?? "",
      duration: Math.floor((track.duration ?? 0) / 1000),
      size: displaySize,
      bitrate,
      url: "",
      cover,
      link: trackLink(track.id),
      extra: { track_id: track.id },
    };

    const playList = track.audio_info?.play_info_list ?? [];
    if (playList.length > 0) {
      let best = playList[0];
      for (const info of playList) {
        if ((info.size ?? 0) > (best.size ?? 0)) best = info;
      }
      if (best.main_play_url) {
        song.url = best.main_play_url + "#auth=" + queryEscape(best.play_auth ?? "");
        if (song.size === 0) song.size = best.size ?? 0;
        song.ext = best.format ?? "";
        song.bitrate = normalizeBitrate(best.bitrate ?? 0);
      }
    }
    songs.push(song);
  }
  return { playlist: pl, songs };
}

/** 对齐 fetchPlaylistDetailPaged：PC 分页歌单详情，首页失败回退 web */
async function fetchPlaylistDetailPaged(id: string): Promise<PlaylistDetail> {
  const playlistID = id.trim();
  if (!playlistID) throw new Error("playlist id is empty");

  const pageSize = 100;
  let cursor = "";
  const seenCursors = new Set<string>();
  const seenTracks = new Set<string>();
  let playlist: Playlist | null = null;
  const songs: Song[] = [];

  for (let page = 0; page < 20; page++) {
    let resp;
    try {
      resp = await fetchPlaylistDetailPage(playlistID, cursor, pageSize);
    } catch (err) {
      if (page === 0) return fetchPlaylistDetailWeb(playlistID);
      throw err;
    }
    if (playlist === null) {
      const pl = buildPlaylistFromUserItem(resp.playlist ?? {}, "", "");
      if (!pl.id) {
        pl.id = playlistID;
        pl.source = "soda";
        pl.link = playlistLinkOf(playlistID);
      }
      playlist = pl;
    }

    for (const item of resp.media_resources ?? []) {
      if (item.type !== "track") continue;
      const track = item.entity?.track_wrapper?.track;
      if (!track?.id || seenTracks.has(track.id)) continue;
      seenTracks.add(track.id);
      const song = buildSongFromTrack(track);
      if (!song.cover && playlist) song.cover = playlist.cover;
      songs.push(song);
    }

    const nextCursor = trim(resp.next_cursor);
    if (!nextCursor || nextCursor === cursor || seenCursors.has(nextCursor)) break;
    if (!resp.has_more && (resp.media_resources ?? []).length < pageSize) break;
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  if (playlist === null || !playlist.id) throw new Error("playlist not found");
  if (playlist.track_count === 0) playlist.track_count = songs.length;
  return { playlist, songs };
}

// ---------- Android 搜索（对齐 search.go） ----------

function androidSearchParams(): URLSearchParams {
  const values: Record<string, string> = {
    device_platform: "android",
    os: "android",
    ssmix: "a",
    cdid: "46556f98-1720-4248-83da-62b74b60b46a",
    channel: "xiaomi_8478_64",
    aid: "8478",
    app_name: "luna",
    version_code: "100198030",
    version_name: "19.8.0",
    manifest_version_code: "100198030",
    update_version_code: "100198030",
    resolution: "1080*1920",
    dpi: "480",
    device_type: "ABR-AL80",
    device_brand: "HUAWEI",
    language: "zh",
    os_api: "35",
    os_version: "15",
    ac: "wifi",
    device_model: "ABR-AL80",
    save_power: "0",
    font_size: "1.00",
    luna_first_launch_apk_type: "normal_apk",
    diversion_channel_name: "xiaomi_8478_64",
    is_car_play: "0",
    battery: "0.99",
    network_speed: "10156",
    hybrid_version_code: "100198030",
    tz_name: "Asia/Shanghai",
    tz_offset: "28800",
    luna_register_time: "1784311292",
    diversion_category_level_two: "Xiaomi%E5%95%86%E5%BA%97-%E8%87%AA%E7%84%B6",
    package: "com.luna.music",
    charge: "0",
    luna_apk_type: "normal_apk",
    output_device_type: "Phone",
    volume: "1.00",
    brightness: "0.08",
    need_personal_recommend: "1",
    is_teen_mode: "0",
    sim_region: "cn",
    diversion_category_level_one: "%E5%8E%82%E5%95%86%E5%95%86%E5%BA%97-%E8%87%AA%E7%84%B6",
    android_device_type: "default",
    iid: "2204957404569386",
    device_id: "2204957404565290",
    _rticket: String(Date.now()),
  };
  // 对齐 Go url.Values.Encode() 的 key 排序
  const params = new URLSearchParams();
  for (const key of Object.keys(values).sort()) {
    params.set(key, values[key]);
  }
  return params;
}

function androidSearchURL(searchType: string, keyword: string, page: number, pageSize: number): string {
  if (page < 1) page = 1;
  if (pageSize <= 0) pageSize = ANDROID_SEARCH_PAGE_SIZE;

  const params = androidSearchParams();
  params.set("q", keyword);
  params.set("cursor", String((page - 1) * pageSize));
  params.set("count", String(pageSize));
  params.set("aid", "386088");

  return `${ANDROID_API_BASE}/search/${searchType}?${params}`;
}

function androidSearchHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": ANDROID_SEARCH_UA,
    "content-type": "application/json; charset=UTF-8",
  };
  if (cookie()) headers.Cookie = cookie();
  return headers;
}

async function fetchAndroidSearch<T>(searchType: string, keyword: string, page: number, pageSize: number): Promise<T> {
  return httpGetJSON<T>(androidSearchURL(searchType, keyword, page, pageSize), {
    headers: androidSearchHeaders(),
  });
}

// ---------- 用户歌单（对齐 user_playlist.go） ----------

async function fetchPCMe(): Promise<{ status_code?: number; status_info?: SodaStatusInfo; my_info?: { id?: string; nickname?: string; public_name?: string; larger_avatar_url?: SodaImage } }> {
  const resp = await httpGetJSON<{
    status_code?: number;
    status_info?: SodaStatusInfo;
    my_info?: { id?: string; nickname?: string; public_name?: string; larger_avatar_url?: SodaImage };
  }>(pcMeURL(), { headers: pcHeaders() });
  if ((resp.status_code ?? 0) !== 0) {
    throw new Error(`soda me api error: status_code=${resp.status_code} status_msg=${statusMsg(resp.status_info)}`);
  }
  return resp;
}

async function fetchUserPlaylistPage(userID: string, cursor: string, count: number) {
  const resp = await httpGetJSON<{
    status_code?: number;
    status_info?: SodaStatusInfo;
    next_cursor?: string;
    has_more?: boolean;
    playlists?: SodaUserPlaylistItem[];
  }>(pcUserPlaylistURL(userID, cursor, count), { headers: pcHeaders() });
  if ((resp.status_code ?? 0) !== 0) {
    throw new Error(`soda user playlist api error: status_code=${resp.status_code} status_msg=${statusMsg(resp.status_info)}`);
  }
  return resp;
}

/** 对齐 GetUserPlaylists */
async function getUserPlaylists(page: number, limit: number): Promise<Playlist[]> {
  if (!cookie()) throw new Error("soda user playlists require cookie");
  if (page < 1) page = 1;
  if (limit <= 0) limit = 30;
  if (limit > 100) limit = 100;

  const me = await fetchPCMe();
  const userID = trim(me.my_info?.id);
  if (!userID) throw new Error("soda user playlists require logged-in user id");

  const targetCount = page * limit;
  let requestCount = targetCount;
  if (requestCount < 50) requestCount = 50;
  if (requestCount > 100) requestCount = 100;

  let cursor = "";
  const seenCursors = new Set<string>();
  const seenPlaylists = new Set<string>();
  const playlists: Playlist[] = [];
  for (let attempts = 0; attempts < 20 && playlists.length < targetCount; attempts++) {
    const resp = await fetchUserPlaylistPage(userID, cursor, requestCount);
    for (const item of resp.playlists ?? []) {
      const pl = buildPlaylistFromUserItem(item, userID, me.my_info?.nickname ?? "");
      if (!pl.id || seenPlaylists.has(pl.id)) continue;
      seenPlaylists.add(pl.id);
      playlists.push(pl);
    }

    const nextCursor = trim(resp.next_cursor);
    if (!nextCursor || nextCursor === cursor || seenCursors.has(nextCursor)) break;
    if (!resp.has_more && (resp.playlists ?? []).length < requestCount) break;
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  const start = (page - 1) * limit;
  if (start >= playlists.length) return [];
  const end = Math.min(start + limit, playlists.length);
  return playlists.slice(start, end);
}

// ---------- 歌词 ----------

/** 对齐 parseSodaLyric：[毫秒,时长] → [mm:ss.cc]，去掉 <逐字> 标记 */
function parseSodaLyric(raw: string): string {
  let out = "";
  const lineRegex = /^\[(\d+),(\d+)\](.*)$/;
  const wordRegex = /<[^>]+>/g;

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(lineRegex);
    if (m) {
      const startTime = parseInt(m[1], 10) || 0;
      const cleanContent = m[3].replace(wordRegex, "");
      const minutes = Math.floor(startTime / 60000);
      const seconds = Math.floor((startTime % 60000) / 1000);
      const millis = Math.floor((startTime % 1000) / 10);
      out += `[${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(2, "0")}]${cleanContent}\n`;
    }
  }
  return out;
}

// ---------- 扫码登录（对齐 login.go） ----------

interface QRLoginPendingState {
  cookies: Record<string, string>;
  encryptUid: string;
  verifyParams: string;
  mobile: string;
  upSmsMobile: string;
  upSmsContent: string;
  smsMode: string;
  canUpSms: boolean;
  status: QRLoginStatus | "";
  message: string;
  /** epoch 毫秒 */
  expiresAt: number;
}

function emptyPending(): QRLoginPendingState {
  return {
    cookies: {},
    encryptUid: "",
    verifyParams: "",
    mobile: "",
    upSmsMobile: "",
    upSmsContent: "",
    smsMode: "",
    canUpSms: false,
    status: "",
    message: "",
    expiresAt: 0,
  };
}

const qrLoginPending = new Map<string, QRLoginPendingState>();
const qrLastPoll = new Map<string, number>();

const POLL_MIN_INTERVAL_MS = 2_000;
const RATE_LIMIT_BACKOFF_MS = 60_000;

/** 轮询节流（对齐 sodaQRPollAllowed） */
function qrPollAllowed(token: string): boolean {
  token = token.trim();
  if (!token) return true;
  const now = Date.now();
  for (const [tok, last] of qrLastPoll) {
    if (now - last > 10 * 60_000) qrLastPoll.delete(tok);
  }
  const last = qrLastPoll.get(token);
  if (last !== undefined && now - last < POLL_MIN_INTERVAL_MS) return false;
  qrLastPoll.set(token, now);
  return true;
}

function qrPollForget(token: string): void {
  token = token.trim();
  if (!token) return;
  qrLastPoll.delete(token);
}

/** 限流回退：记录未来时间戳使后续轮询持续被节流（对齐 sodaQRPollBackoff） */
function qrPollBackoff(token: string, durationMs: number): void {
  token = token.trim();
  if (!token) return;
  qrLastPoll.set(token, Date.now() + durationMs - POLL_MIN_INTERVAL_MS);
}

function rememberPending(token: string, state: QRLoginPendingState): void {
  token = token.trim();
  if (!token) return;
  if (!state.expiresAt) state.expiresAt = Date.now() + 10 * 60_000;
  state.cookies = mergeCookies(state.cookies);
  cleanupPending();
  qrLoginPending.set(token, state);
}

function getPending(token: string): QRLoginPendingState | null {
  cleanupPending();
  const state = qrLoginPending.get(token.trim());
  if (!state) return null;
  if (state.expiresAt && Date.now() > state.expiresAt) return null;
  state.cookies = mergeCookies(state.cookies);
  return state;
}

function clearPending(token: string): void {
  qrLoginPending.delete(token.trim());
}

function cleanupPending(): void {
  const now = Date.now();
  for (const [token, state] of qrLoginPending) {
    if (state.expiresAt && now > state.expiresAt) qrLoginPending.delete(token);
  }
}

function mergeCookies(...cookieMaps: Record<string, string>[]): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const cookies of cookieMaps) {
    for (const [rawKey, rawValue] of Object.entries(cookies)) {
      const key = rawKey.trim();
      const value = rawValue.trim();
      if (key && value) merged[key] = value;
    }
  }
  return merged;
}

function joinCookies(cookies: Record<string, string>): string {
  const keys = Object.keys(cookies)
    .filter((k) => k !== "")
    .sort();
  const parts: string[] = [];
  for (const k of keys) {
    if (cookies[k]) parts.push(`${k}=${cookies[k]}`);
  }
  return parts.join("; ");
}

function cookieHeader(base: string, cookies: Record<string, string>): string {
  const c = joinCookies(cookies);
  const b = base.trim();
  if (!b) return c;
  if (!c) return b;
  return `${b}; ${c}`;
}

function cookiesHaveSession(cookies: Record<string, string>): boolean {
  for (const key of ["sessionid", "sessionid_ss", "sid_tt", "sid_guard"]) {
    if (trim(cookies[key])) return true;
  }
  return false;
}

// ---- passport 表单编码（保序，对齐 sodaEncodeOrderedForm 一族） ----

function encodeOrderedForm(form: Record<string, string>, order: string[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const key of order) {
    if (key in form) {
      seen.add(key);
      parts.push(`${queryEscape(key)}=${queryEscape(form[key])}`);
    }
  }
  const rest = Object.keys(form)
    .filter((k) => !seen.has(k))
    .sort();
  for (const key of rest) {
    parts.push(`${queryEscape(key)}=${queryEscape(form[key])}`);
  }
  return parts.join("&");
}

let stableDeviceID = "";
let stableInstallID = "";

function ensureStableIDs(): void {
  if (stableDeviceID) return;
  const now = Date.now();
  stableDeviceID = String(now);
  stableInstallID = String(now + 1);
}

let bizTraceID = "";

function passportBizTraceID(): string {
  if (bizTraceID) return bizTraceID;
  const nanos = BigInt(Date.now()) * 1000000n;
  bizTraceID = (nanos & 0xffffffffn).toString(16).padStart(8, "0");
  return bizTraceID;
}

function buildPassportBaseValues(jsVersion: string, jsType: string): Record<string, string> {
  ensureStableIDs();
  return {
    passport_jssdk_version: jsVersion,
    passport_jssdk_type: jsType,
    is_from_ttaccountsdk: "1",
    aid: PASSPORT_AID,
    language: "zh",
    is_new_login: "1",
    is_from_iesaccountsaas: "1",
    device_id: stableDeviceID,
    install_id: stableInstallID,
    did: stableDeviceID,
    iid: stableInstallID,
    device_platform: "PC",
    version_code: SODA_VERSION_CODE,
    biz_trace_id: passportBizTraceID(),
  };
}

// ---- 抓包参数文件（对齐 sodaLoadCapturedParams，SODA_QR_USE_CAPTURE_PARAMS=1 时启用） ----

let capturedQueries: Record<string, Record<string, string>> | null = null;
let capturedHeaders: Record<string, Record<string, string>> | null = null;
let capturedLoaded = false;

function captureFilePath(): string {
  const env = sodaQrCaptureFile();
  if (env) return env;
  let cwd = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(cwd, "汽水扫码20260516.txt");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(cwd);
    if (parent === cwd) break;
    cwd = parent;
  }
  return "汽水扫码20260516.txt";
}

function loadCapturedParams(): void {
  if (!sodaQrUseCaptureParams()) return;
  if (capturedLoaded) return;
  capturedLoaded = true;
  capturedQueries = {};
  capturedHeaders = {};
  let body: string;
  try {
    body = fs.readFileSync(captureFilePath(), "utf8");
  } catch {
    return;
  }
  let currentPath = "";
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("POST https://api.qishui.com/") || line.startsWith("GET https://api.qishui.com/")) {
      currentPath = "";
      const fields = line.split(/\s+/);
      if (fields.length >= 2) {
        try {
          const parsed = new URL(fields[1]);
          currentPath = parsed.pathname;
          if (currentPath) {
            if (!capturedQueries![currentPath]) {
              capturedQueries![currentPath] = Object.fromEntries(parsed.searchParams.entries());
            }
            if (!capturedHeaders![currentPath]) {
              capturedHeaders![currentPath] = {};
            }
          }
        } catch {
          // 忽略非法 URL
        }
      }
      continue;
    }
    if (!currentPath || !line.includes(":")) continue;
    const idx = line.indexOf(":");
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key && value) capturedHeaders![currentPath][key] = value;
  }
}

function capturedQuery(apiPath: string): Record<string, string> {
  loadCapturedParams();
  return { ...(capturedQueries?.[apiPath.trim()] ?? {}) };
}

function capturedHeader(apiPath: string): Record<string, string> {
  loadCapturedParams();
  return { ...(capturedHeaders?.[apiPath.trim()] ?? {}) };
}

function applyCapturedQueryParams(params: Record<string, string>, apiPath: string): void {
  const captured = capturedQuery(apiPath);
  if (Object.keys(captured).length === 0) return;
  for (const key of ["account_sdk_source_info", "biz_trace_id", "device_id", "install_id", "did", "iid"]) {
    const value = trim(captured[key]);
    if (value) params[key] = value;
  }
  if (sodaQrUseCaptureSignature()) {
    for (const key of ["msToken", "a_bogus"]) {
      const value = trim(captured[key]);
      if (value) params[key] = value;
    }
  }
}

function buildPassportNormalValues(): Record<string, string> {
  const params = buildPassportBaseValues(PASSPORT_JS_VER, "normal");
  params.account_sdk_source = "web";
  params.p_js_v = PASSPORT_JS_VER;
  params.p_js_t = "pro";
  params.p_zt = SODA_PZT;
  params.p_ver = SODA_PVER;
  params.request_host = "app%3A%2F%2Fresources"; // 与 Go 一致：预转义值会被再次编码
  params.p_bd = SODA_PBD;
  applyCapturedQueryParams(params, "/passport/web/check_qrconnect/");
  return params;
}

function passportNormalQueryOrder(): string[] {
  return [
    "passport_jssdk_version", "passport_jssdk_type", "is_from_ttaccountsdk", "aid", "language",
    "account_sdk_source", "account_sdk_source_info", "p_js_v", "p_js_t", "p_zt", "p_ver", "request_host",
    "p_bd", "biz_trace_id", "is_new_login", "is_from_iesaccountsaas", "device_id", "install_id", "did",
    "iid", "device_platform", "version_code", "msToken", "a_bogus",
  ];
}

function passportLiteQueryOrder(): string[] {
  return [
    "passport_jssdk_version", "passport_jssdk_type", "is_from_ttaccountsdk", "aid", "language",
    "account_app_language", "new_authn_sdk_version", "is_new_login", "is_from_iesaccountsaas", "device_id",
    "install_id", "did", "iid", "device_platform", "version_code", "biz_trace_id", "msToken", "a_bogus",
  ];
}

function buildQRCreateQuery(): string {
  const params = buildPassportNormalValues();
  params.next = "https://api.qishui.com";
  params.need_logo = "false";
  params.need_short_url = "false";
  params.is_frontier = "true";
  return encodeOrderedForm(params, [...passportNormalQueryOrder(), "next", "need_logo", "need_short_url", "is_frontier"]);
}

function buildQRCheckQuery(): string {
  return encodeOrderedForm(buildPassportNormalValues(), passportNormalQueryOrder());
}

function buildPassportLiteQueryFor(apiPath: string): string {
  const params = buildPassportBaseValues("5.1.2", "lite");
  params.new_authn_sdk_version = "1.0.0.404-web";
  params.account_app_language = "en-US";
  applyCapturedQueryParams(params, apiPath);
  return encodeOrderedForm(params, passportLiteQueryOrder());
}

function qrConnectForm(token: string): Record<string, string> {
  return {
    need_logo: "false",
    need_short_url: "false",
    is_frontier: "true",
    token: token.trim(),
    is_new_login: "1",
    next: "https://api.qishui.com",
  };
}

function applyVerifyParams(params: Record<string, string>, verifyParams: string): void {
  if (!trim(verifyParams)) return;
  const vp = new URLSearchParams(verifyParams);
  for (const [k, v] of vp.entries()) {
    params[k] = v; // 对齐 Go params.Set：覆盖已有值
  }
}

function scanLoginURL(token: string): string {
  const params = new URLSearchParams({ token: token.trim(), os: "Windows", computer_name: "music-web" });
  return `https://bff-pc.qishui.com/light/invoke/scan_login?${params}`;
}

function qrCodeImageURL(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (t.startsWith("data:") || t.startsWith("http://") || t.startsWith("https://")) return t;
  return "data:image/png;base64," + t;
}

function encodeSMSCode(code: string): string {
  return Buffer.from(code.trim(), "utf8").toString("hex");
}

function messageOK(message: string): boolean {
  const m = message.trim().toLowerCase();
  return m === "" || m === "success";
}

function apiPathOf(rawURL: string): string {
  try {
    return trim(new URL(rawURL).pathname);
  } catch {
    return "";
  }
}

function passportTraceID(rawURL: string): string {
  try {
    return trim(new URL(rawURL).searchParams.get("biz_trace_id") ?? "");
  } catch {
    return "";
  }
}

/** 对齐 sodaEncodePassportForm：按端点保序编码表单 */
function encodePassportForm(apiURL: string, form: Record<string, string>): string {
  if (apiURL.includes("/check_qrconnect/")) {
    return encodeOrderedForm(form, [
      "need_logo", "need_short_url", "is_frontier", "token", "is_new_login", "next",
      "passport_mfa_retry_tag", "std_verify_flow_id", "std_verify_scene", "std_verify_template",
      "std_verify_token", "std_verify_type", "std_verify_way",
    ]);
  }
  if (apiURL.includes("/send_code/")) {
    return encodeOrderedForm(form, [
      "mix_mode", "type", "encrypt_uid", "verify_ticket", "copywriting_key", "ies_safety_diversion_tag",
      "new_verify_flow", "std_verify_flow_id", "std_verify_scene", "std_verify_template", "std_verify_token",
      "std_verify_type", "std_verify_way", "is6Digits", "aid", "new_authn_sdk_version",
    ]);
  }
  if (apiURL.includes("/validate_code/")) {
    return encodeOrderedForm(form, [
      "mix_mode", "type", "encrypt_uid", "verify_ticket", "copywriting_key", "ies_safety_diversion_tag",
      "mfa", "new_verify_flow", "std_verify_flow_id", "std_verify_scene", "std_verify_template",
      "std_verify_token", "std_verify_type", "std_verify_way", "code", "aid", "new_authn_sdk_version",
    ]);
  }
  if (apiURL.includes("/upsms/verify/")) {
    return encodeOrderedForm(form, [
      "encrypt_uid", "verify_ticket", "copywriting_key", "ies_safety_diversion_tag", "new_verify_flow",
      "std_verify_flow_id", "std_verify_scene", "std_verify_template", "std_verify_token", "std_verify_type",
      "std_verify_way", "aid", "new_authn_sdk_version",
    ]);
  }
  return new URLSearchParams(form).toString();
}

/** 对齐 postSodaPassportWithCookie */
async function postPassport(
  apiURL: string,
  form: Record<string, string>,
  cookieValue: string,
): Promise<{ body: string; cookies: Record<string, string> }> {
  const headers: Record<string, string> = {
    "User-Agent": PASSPORT_UA,
    "Content-Type": "application/x-www-form-urlencoded",
    "sec-ch-ua": `"Not.A/Brand";v="99", "Chromium";v="136"`,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": `"Windows"`,
    Accept: apiURL.includes("/send_code/") || apiURL.includes("/validate_code/") || apiURL.includes("/upsms/verify/")
      ? "application/json, text/plain, */*"
      : "application/json, text/javascript",
    // bd-ticket-guard headers required by Bytedance Passport
    "bd-ticket-guard-version": "2",
    "bd-ticket-guard-iteration-version": "2",
    "bd-ticket-guard-ree-public-key":
      "BAnIxKL96Jby5x+Um9i7HZ2c8O6lfZJRxm6yk73Mqcr06l2qIw2iqu2Mtm3U/6OI98usukA9dqxUlsctVWK9rKA=",
    "bd-ticket-guard-server-cert-sn": "0",
  };
  const traceID = passportTraceID(apiURL);
  if (traceID) headers["X-Tt-Passport-Trace-Id"] = traceID;
  const flowID = trim(form["std_verify_flow_id"]);
  if (flowID) headers["X-Tt-Passport-Verify-Portrait"] = flowID;

  const captured = capturedHeader(apiPathOf(apiURL));
  for (const key of ["x-tt-passport-trace-id", "x-tt-passport-verify-portrait", "x-tt-trace-id"]) {
    const value = trim(captured[key]);
    if (value) headers[key] = value;
  }
  if (cookieValue.trim()) headers.Cookie = cookieValue.trim();

  const resp = await httpPostRawBodyText(
    apiURL,
    encodePassportForm(apiURL, form),
    "application/x-www-form-urlencoded",
    { headers, timeoutMs: 30_000 },
  );
  return { body: await resp.text(), cookies: responseCookies(resp) };
}

// ---- MFA 字段提取（递归 JSON 搜索） ----

function normalizeJSONKey(key: string): string {
  return key.trim().toLowerCase().replace(/[_-]/g, "");
}

function findJSONString(value: unknown, field: string): string {
  const want = normalizeJSONKey(field);
  if (typeof value === "string") {
    const t = value.trim();
    if (t.startsWith("{")) {
      try {
        return findJSONString(JSON.parse(t), field);
      } catch {
        return "";
      }
    }
    return "";
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findJSONString(child, field);
      if (found) return found;
    }
    return "";
  }
  if (!value || typeof value !== "object") return "";

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (normalizeJSONKey(key) === want) {
      if (typeof child === "string") return child.trim();
      if (typeof child === "number") return String(Math.round(child));
    }
    const found = findJSONString(child, field);
    if (found) return found;
  }
  return "";
}

function extractMFAField(body: string, field: string): string {
  try {
    return findJSONString(JSON.parse(body), field);
  } catch {
    return "";
  }
}

function extractMFAVerifyParams(body: string): string {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return "";
  }
  const params = new URLSearchParams();
  collectVerifyParams(raw, params);
  return params.toString();
}

function bodyContainsVerifyWay(body: string, way: string): boolean {
  way = way.trim();
  if (!way) return false;
  return body.includes(`"verify_way":"${way}"`) || body.includes(`"verify_way": "${way}"`);
}

function collectVerifyParams(value: unknown, params: URLSearchParams): void {
  const allow = new Set([
    "passport_mfa_retry_tag",
    "std_verify_flow_id",
    "std_verify_scene",
    "std_verify_template",
    "std_verify_token",
    "std_verify_type",
    "std_verify_way",
  ]);
  if (Array.isArray(value)) {
    for (const child of value) collectVerifyParams(child, params);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (allow.has(key)) {
        if (typeof child === "string" && child.trim()) {
          params.set(key, child.trim());
        } else if (typeof child === "number") {
          params.set(key, String(Math.round(child)));
        }
      }
      collectVerifyParams(child, params);
    }
    return;
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (text.includes("std_verify_") || text.includes("passport_mfa_retry_tag")) {
      const idx = text.indexOf("?");
      const queryText = idx >= 0 ? text.slice(idx + 1) : text;
      try {
        const parsed = new URLSearchParams(queryText);
        for (const [key, values] of parsed.entries()) {
          // URLSearchParams 每键只给首个值，与 Go values[0] 行为一致
          if (allow.has(key) && trim(values)) params.set(key, trim(values));
        }
      } catch {
        // 忽略
      }
    }
    if (text.startsWith("{")) {
      try {
        collectVerifyParams(JSON.parse(text), params);
      } catch {
        // 忽略
      }
    }
  }
}

// ---- QR 登录状态机 ----

interface QRConnectResponse {
  data?: {
    status?: string;
    error_code?: number;
    redirect_url?: string;
    description?: string;
    account_flow?: string;
    user_data?: { mobile?: string };
  };
  message?: string;
}

function qrConnectErrorMessage(resp: QRConnectResponse): string {
  for (const value of [resp.data?.description ?? "", resp.message ?? ""]) {
    const t = value.trim();
    if (t) {
      if ((resp.data?.error_code ?? 0) !== 0) {
        return `${t} (code=${resp.data?.error_code})`;
      }
      return t;
    }
  }
  if ((resp.data?.error_code ?? 0) !== 0) return `Soda QR 登录失败 (code=${resp.data?.error_code})`;
  return "Soda QR 登录失败";
}

function qrConnectExtra(resp: QRConnectResponse): Record<string, string> {
  const extra: Record<string, string> = {};
  const status = trim(resp.data?.status);
  if (status) extra.api_status = status;
  if ((resp.data?.error_code ?? 0) !== 0) extra.error_code = String(resp.data?.error_code);
  const redirect = trim(resp.data?.redirect_url);
  if (redirect) extra.redirect_url = redirect;
  return extra;
}

/** 节流时返回缓存状态（对齐 sodaThrottledResult） */
function throttledResult(token: string, pending: QRLoginPendingState | null): QRLoginResult {
  const p = pending ?? emptyPending();
  if (p.encryptUid) {
    const result: QRLoginResult = {
      source: "soda",
      key: token.trim(),
      status: "scanned",
      message: "扫码成功，需要短信验证",
      extra: {
        need_sms: "true",
        encrypt_uid: p.encryptUid,
        verify_params: p.verifyParams,
        throttled: "true",
      },
    };
    if (p.mobile) result.extra!.mobile = p.mobile;
    if (p.upSmsMobile || p.upSmsContent) {
      result.extra!.up_sms_mobile = p.upSmsMobile;
      result.extra!.up_sms_content = p.upSmsContent;
      if (p.smsMode === "sms") {
        result.extra!.sms_mode = "sms";
        if (p.canUpSms) result.extra!.can_up_sms = "true";
      } else {
        result.extra!.sms_mode = "up";
        result.extra!.need_user_sms = "true";
      }
    }
    return result;
  }
  if (p.status === "scanned") {
    const message = p.message.trim() || "已扫码，请在手机上确认";
    return {
      source: "soda",
      key: token.trim(),
      status: "scanned",
      message,
      extra: { throttled: "true", cached_status: "true" },
    };
  }
  return {
    source: "soda",
    key: token.trim(),
    status: "waiting",
    message: "等待扫码确认",
    extra: { throttled: "true" },
  };
}

/** 对齐 sodaMFARequiredResult */
function mfaRequiredResult(
  token: string,
  body: string,
  cookies: Record<string, string>,
  resp: QRConnectResponse,
): QRLoginResult | null {
  const mfaToken = cookies["passport_mfa_token"] ?? "";
  const encryptUID = extractMFAField(body, "encrypt_uid");
  const verifyParams = extractMFAVerifyParams(body);
  if (!mfaToken && !encryptUID && !verifyParams) return null;

  let mobile = extractMFAField(body, "mobile");
  if (!mobile) mobile = trim(resp.data?.user_data?.mobile);
  const upSMSMobile = extractMFAField(body, "channel_mobile");
  const upSMSContent = extractMFAField(body, "sms_content");
  const hasMobileSMSVerify = bodyContainsVerifyWay(body, "mobile_sms_verify");

  const smsMode = hasMobileSMSVerify ? "sms" : upSMSMobile || upSMSContent ? "up" : "";
  rememberPending(token, {
    cookies,
    encryptUid: encryptUID,
    verifyParams,
    mobile,
    upSmsMobile: upSMSMobile,
    upSmsContent: upSMSContent,
    smsMode,
    canUpSms: hasMobileSMSVerify && (!!upSMSMobile || !!upSMSContent),
    status: "scanned",
    message: "QR confirmed, SMS verification required",
    expiresAt: Date.now() + 10 * 60_000,
  });

  const extra = qrConnectExtra(resp);
  extra.need_sms = "true";
  extra.encrypt_uid = encryptUID;
  extra.verify_params = verifyParams;
  extra.mobile = mobile;
  if (upSMSMobile || upSMSContent) {
    extra.up_sms_mobile = upSMSMobile;
    extra.up_sms_content = upSMSContent;
    if (hasMobileSMSVerify) {
      extra.sms_mode = "sms";
      extra.can_up_sms = "true";
    } else {
      extra.sms_mode = "up";
      extra.need_user_sms = "true";
    }
  }

  return {
    source: "soda",
    key: token,
    status: "scanned",
    message: "QR confirmed, SMS verification required",
    extra,
  };
}

/** 对齐 sodaQRConnectResult */
function qrConnectResult(
  token: string,
  body: string,
  cookies: Record<string, string>,
  resp: QRConnectResponse,
): QRLoginResult {
  const result: QRLoginResult = {
    source: "soda",
    key: token,
    message: resp.message,
    status: "waiting",
  };

  // error_code=7：接口限流，回退缓存状态
  if (resp.data?.error_code === 7) {
    qrPollBackoff(token, RATE_LIMIT_BACKOFF_MS);
    const pending = getPending(token);
    const throttled = throttledResult(token, pending);
    throttled.extra = throttled.extra ?? {};
    throttled.extra.rate_limited = "true";
    if (throttled.status === "waiting") {
      throttled.message = "正在等待汽水接口冷却...";
    }
    return throttled;
  }

  // 最终成功：cookie 带真实会话
  if (cookiesHaveSession(cookies)) {
    const cookieValue = joinCookies(cookies);
    result.status = "success";
    result.cookie = cookieValue;
    result.cookies = cookies;
    result.message = "登录成功";
    setVipCache(null);
    clearPending(token);
    qrPollForget(token);
    return result;
  }

  // MFA 分支
  const status = trim(resp.data?.status).toLowerCase();
  const accountFlow = trim(resp.data?.account_flow).toLowerCase();
  if (accountFlow === "verify" || resp.data?.error_code === 2046) {
    const mfaResult = mfaRequiredResult(token, body, cookies, resp);
    if (mfaResult) return mfaResult;
    result.status = "failed";
    result.message = qrConnectErrorMessage(resp);
    result.extra = qrConnectExtra(resp);
    return result;
  }

  switch (status) {
    case "confirmed":
      // 已在手机确认但会话 cookie 未下发，继续轮询
      result.status = "scanned";
      result.message = "已扫码确认，等待登录结果";
      rememberPending(token, {
        ...emptyPending(),
        cookies: mergeCookies(cookies),
        status: "scanned",
        message: result.message,
        expiresAt: Date.now() + 10 * 60_000,
      });
      break;
    case "new":
    case "": {
      if ((resp.data?.error_code ?? 0) !== 0) {
        result.status = "failed";
        result.message = qrConnectErrorMessage(resp);
        result.extra = qrConnectExtra(resp);
      } else {
        const pending = getPending(token);
        if (pending && pending.status === "scanned") {
          result.status = "scanned";
          result.message = pending.message.trim() || "已扫码，请在手机上确认";
          result.extra = { cached_status: "true" };
        } else {
          result.status = "waiting";
        }
      }
      break;
    }
    case "scanned":
      result.status = "scanned";
      result.message = "已扫码，请在手机上确认";
      rememberPending(token, {
        ...emptyPending(),
        cookies: mergeCookies(cookies),
        status: "scanned",
        message: result.message,
        expiresAt: Date.now() + 10 * 60_000,
      });
      break;
    case "expired":
      result.status = "expired";
      clearPending(token);
      qrPollForget(token);
      break;
    case "error":
    case "failed": {
      const mfaResult = mfaRequiredResult(token, body, cookies, resp);
      if (mfaResult) return mfaResult;
      result.status = "failed";
      result.message = qrConnectErrorMessage(resp);
      result.extra = qrConnectExtra(resp);
      break;
    }
    default:
      if ((resp.data?.error_code ?? 0) !== 0) {
        const mfaResult = mfaRequiredResult(token, body, cookies, resp);
        if (mfaResult) return mfaResult;
        result.status = "failed";
        result.message = qrConnectErrorMessage(resp);
        result.extra = qrConnectExtra(resp);
      } else {
        result.status = "waiting";
      }
  }

  return result;
}

/** 对齐 sodaCheckQRConnectWithState */
async function checkQRConnectWithState(
  token: string,
  state: QRLoginPendingState | null,
  includeVerifyParams: boolean,
): Promise<QRLoginResult> {
  token = token.trim();
  const params = qrConnectForm(token);
  if (includeVerifyParams) {
    applyVerifyParams(params, state?.verifyParams ?? "");
    if (!("std_verify_way" in params)) params.std_verify_way = "";
  }

  const apiURL = `${QR_CHECK_API}?${buildQRCheckQuery()}`;
  const { body, cookies } = await postPassport(apiURL, params, cookieHeader(cookie(), state?.cookies ?? {}));

  const resp = JSON.parse(body) as QRConnectResponse;
  return qrConnectResult(token, body, mergeCookies(state?.cookies ?? {}, cookies), resp);
}

async function checkQRConnect(token: string): Promise<QRLoginResult> {
  const pending = getPending(token);
  if (!qrPollAllowed(token)) {
    return throttledResult(token, pending);
  }
  return checkQRConnectWithState(token, pending, false);
}

/** 对齐 sodaSendCode */
async function sodaSendCode(token: string, encryptUIDArg: string, verifyParamsArg: string): Promise<QRLoginResult> {
  const stored = getPending(token);
  const hasPending = stored !== null;
  const pending = stored ?? emptyPending();
  let encryptUID = encryptUIDArg;
  let verifyParams = verifyParamsArg;
  if (!encryptUID.trim()) encryptUID = pending.encryptUid;
  if (!verifyParams.trim()) verifyParams = pending.verifyParams;
  if (!encryptUID.trim()) {
    return {
      source: "soda",
      key: token,
      status: "failed",
      message: "缺少短信验证参数，请刷新二维码重试",
    };
  }

  const params: Record<string, string> = {
    mix_mode: "1",
    type: "3737",
    encrypt_uid: encryptUID,
    verify_ticket: "",
    copywriting_key: "qr_connect",
    ies_safety_diversion_tag: "mfa",
    new_verify_flow: "",
    std_verify_way: "mobile_sms_verify",
    is6Digits: "1",
    aid: PASSPORT_AID,
    new_authn_sdk_version: "1.0.0.404-web",
  };
  applyVerifyParams(params, verifyParams);

  const apiURL = `${SEND_CODE_API}?${buildPassportLiteQueryFor("/passport/web/send_code/")}`;
  const { body, cookies } = await postPassport(apiURL, params, cookieHeader(cookie(), pending.cookies));

  const resp = JSON.parse(body) as { data?: { mobile?: string; retry_time?: number }; message?: string };
  if (!messageOK(resp.message ?? "")) {
    return {
      source: "soda",
      key: token,
      status: "failed",
      message: "SMS code send failed: " + (resp.message ?? ""),
    };
  }

  const result: QRLoginResult = {
    source: "soda",
    key: token,
    status: "scanned",
    message: `验证码已发送至 ${resp.data?.mobile ?? ""}`,
    extra: {
      need_sms: "true",
      need_sms_code: "true",
      mobile: resp.data?.mobile ?? "",
      encrypt_uid: encryptUID,
      verify_params: verifyParams,
      retry_time: String(resp.data?.retry_time ?? 0),
    },
  };
  if (hasPending) {
    pending.encryptUid = encryptUID;
    pending.verifyParams = verifyParams;
    pending.cookies = mergeCookies(pending.cookies, cookies);
    rememberPending(token, pending);
  }
  return result;
}

/** 对齐 sodaVerifyUpSMS */
async function sodaVerifyUpSMS(token: string, encryptUIDArg: string, verifyParamsArg: string): Promise<QRLoginResult> {
  const pending = getPending(token) ?? emptyPending();
  let encryptUID = encryptUIDArg;
  let verifyParams = verifyParamsArg;
  if (!encryptUID.trim()) encryptUID = pending.encryptUid;
  if (!verifyParams.trim()) verifyParams = pending.verifyParams;
  if (!encryptUID.trim()) {
    return {
      source: "soda",
      key: token,
      status: "failed",
      message: "缺少短信验证参数，请刷新二维码重试",
    };
  }

  const params: Record<string, string> = {
    encrypt_uid: encryptUID,
    verify_ticket: "",
    copywriting_key: "qr_connect",
    ies_safety_diversion_tag: "mfa",
    new_verify_flow: "",
    aid: PASSPORT_AID,
    new_authn_sdk_version: "1.0.0.404-web",
  };
  applyVerifyParams(params, verifyParams);
  params.std_verify_way = "mobile_up_sms_verify";

  const apiURL = `${UP_SMS_VERIFY_API}?${buildPassportLiteQueryFor("/passport/upsms/verify/")}`;
  const { body, cookies } = await postPassport(apiURL, params, cookieHeader(cookie(), pending.cookies));

  const resp = JSON.parse(body) as {
    data?: { registered?: boolean; ticket?: string; error_code?: number };
    message?: string;
  };
  if ((!resp.data?.registered && !resp.data?.ticket) || !messageOK(resp.message ?? "")) {
    return {
      source: "soda",
      key: token,
      status: "failed",
      message: "上行短信确认失败: " + (resp.message ?? ""),
    };
  }

  pending.cookies = mergeCookies(pending.cookies, cookies);
  pending.encryptUid = encryptUID;
  pending.verifyParams = verifyParams;
  rememberPending(token, pending);

  const finalResult = await checkQRConnectWithState(token, pending, true);
  if (finalResult.status === "success") return finalResult;
  finalResult.status = "failed";
  if (!finalResult.message?.trim() || finalResult.message === "success") {
    finalResult.message = "上行短信已确认，但汽水未下发登录 Cookie";
  }
  return finalResult;
}

/** 对齐 sodaValidateCode */
async function sodaValidateCode(
  token: string,
  encryptUIDArg: string,
  verifyParamsArg: string,
  code: string,
): Promise<QRLoginResult> {
  const pending = getPending(token) ?? emptyPending();
  let encryptUID = encryptUIDArg;
  let verifyParams = verifyParamsArg;
  if (!encryptUID.trim()) encryptUID = pending.encryptUid;
  if (!verifyParams.trim()) verifyParams = pending.verifyParams;
  if (!encryptUID.trim()) {
    return {
      source: "soda",
      key: token,
      status: "failed",
      message: "缺少短信验证参数，请刷新二维码重试",
    };
  }

  const params: Record<string, string> = {
    mix_mode: "1",
    type: "3737",
    encrypt_uid: encryptUID,
    verify_ticket: "",
    copywriting_key: "qr_connect",
    ies_safety_diversion_tag: "mfa",
    new_verify_flow: "",
    std_verify_way: "mobile_sms_verify",
    code: encodeSMSCode(code),
    aid: PASSPORT_AID,
    new_authn_sdk_version: "1.0.0.404-web",
  };
  applyVerifyParams(params, verifyParams);

  const apiURL = `${VALIDATE_API}?${buildPassportLiteQueryFor("/passport/web/validate_code/")}`;
  const { body, cookies } = await postPassport(apiURL, params, cookieHeader(cookie(), pending.cookies));

  const resp = JSON.parse(body) as { data?: { ticket?: string }; message?: string };
  if (!resp.data?.ticket && !messageOK(resp.message ?? "")) {
    return {
      source: "soda",
      key: token,
      status: "failed",
      message: "验证码错误: " + (resp.message ?? ""),
    };
  }

  pending.cookies = mergeCookies(pending.cookies, cookies);
  pending.encryptUid = encryptUID;
  pending.verifyParams = verifyParams;
  rememberPending(token, pending);

  const finalResult = await checkQRConnectWithState(token, pending, true);
  if (finalResult.status === "success") return finalResult;
  finalResult.status = "failed";
  if (!finalResult.message?.trim() || finalResult.message === "success") {
    finalResult.message = "SMS verified, but Soda did not issue session cookie";
  }
  return finalResult;
}

// ---------- Provider ----------

export const soda: MusicProvider = {
  name: "soda",
  label: "汽水音乐",
  supportsFlac: true,

  /** Search 搜索歌曲（Android 端搜索 API） */
  async search(keyword: string): Promise<Song[]> {
    const resp = await fetchAndroidSearch<{
      result_groups?: { data?: { entity?: { track?: SodaTrack } }[] }[];
    }>("track", keyword, 1, ANDROID_SEARCH_PAGE_SIZE);

    const songs: Song[] = [];
    const seen = new Set<string>();
    for (const group of resp.result_groups ?? []) {
      for (const item of group.data ?? []) {
        const track = item.entity?.track;
        if (!track?.id || seen.has(track.id)) continue;
        seen.add(track.id);
        songs.push(buildSongFromTrack(track));
      }
    }
    return songs;
  },

  /** Parse 解析链接（含短链跳转提取 track_id） */
  async parse(link: string): Promise<Song> {
    let trackID: string;
    try {
      trackID = await extractTrackID(link);
    } catch {
      trackID = "";
    }
    if (!trackID) throw new Error("invalid soda link");
    return fetchSongDetail(trackID);
  },

  /** GetDownloadURL 返回下载链接（含 #auth= 解密参数） */
  async getStreamUrl(song: Song): Promise<string> {
    const info = await getDownloadInfo(song);
    return downloadInfoURL(info);
  },

  /** GetLyrics 获取歌词（SEO seo_track，[ms,ms] → LRC） */
  async getLyric(song: Song): Promise<string> {
    if (song.source !== "soda") throw new Error("source mismatch");
    const trackID = song.extra?.track_id || song.id;

    const resp = await fetchWebTrackV2(trackID);
    if (!resp.lyric?.content) return "";
    return parseSodaLyric(resp.lyric.content);
  },

  /** SearchAlbum 搜索专辑（Android 端搜索 API） */
  async searchAlbum(keyword: string): Promise<Playlist[]> {
    const resp = await fetchAndroidSearch<{
      result_groups?: {
        data?: {
          entity?: {
            album?: {
              id?: string;
              name?: string;
              artists?: SodaArtist[];
              company?: string;
              count_tracks?: number;
              url_cover?: SodaImage;
              release_date?: number;
            };
          };
        }[];
      }[];
    }>("album", keyword, 1, ANDROID_SEARCH_PAGE_SIZE);

    const albums: Playlist[] = [];
    for (const group of resp.result_groups ?? []) {
      for (const item of group.data ?? []) {
        const album = item.entity?.album;
        if (!album?.id) continue;

        const extra: Record<string, string> = { album_id: album.id };
        if ((album.release_date ?? 0) > 0) extra.release_date = String(album.release_date);

        albums.push({
          source: "soda",
          id: album.id,
          name: album.name ?? "",
          cover: buildImageURL(album.url_cover, "~c5_300x300.jpg"),
          track_count: album.count_tracks ?? 0,
          play_count: 0,
          creator: joinArtists(album.artists),
          description: trim(album.company),
          link: sodaAlbumLink(album.id),
          extra,
        });
      }
    }
    return albums;
  },

  /** GetAlbumSongs 获取专辑所有歌曲（分享页解析） */
  async getAlbumSongs(id: string): Promise<Song[]> {
    return (await fetchAlbumDetail(id)).songs;
  },

  /** ParseAlbum 解析专辑链接 */
  async parseAlbum(link: string): Promise<PlaylistDetail> {
    const albumID = extractAlbumID(link);
    if (!albumID) throw new Error("invalid soda album link");
    return fetchAlbumDetail(albumID);
  },

  /** SearchPlaylist 搜索歌单（Android 端搜索 API） */
  async searchPlaylist(keyword: string): Promise<Playlist[]> {
    const resp = await fetchAndroidSearch<{
      result_groups?: { data?: { entity?: { playlist?: SodaUserPlaylistItem } }[] }[];
    }>("playlist", keyword, 1, ANDROID_SEARCH_PAGE_SIZE);

    const playlists: Playlist[] = [];
    for (const group of resp.result_groups ?? []) {
      for (const item of group.data ?? []) {
        const pl = item.entity?.playlist;
        if (!pl?.id) continue;

        let creator = pl.owner?.public_name ?? "";
        if (!creator) creator = pl.owner?.nickname ?? "";

        playlists.push({
          source: "soda",
          id: pl.id,
          name: pl.title ?? "",
          cover: buildImageURL(pl.url_cover, "~c5_300x300.jpg"),
          track_count: pl.count_tracks ?? 0,
          play_count: 0,
          creator,
          description: pl.desc ?? "",
          link: playlistLinkOf(pl.id),
        });
      }
    }
    return playlists;
  },

  /** GetPlaylistSongs 获取歌单歌曲（PC 分页，web 兜底） */
  async getPlaylistSongs(id: string): Promise<Song[]> {
    return (await fetchPlaylistDetailPaged(id)).songs;
  },

  /** ParsePlaylist 解析歌单链接（含短链跳转提取 playlist_id） */
  async parsePlaylist(link: string): Promise<PlaylistDetail> {
    let playlistID: string;
    try {
      playlistID = await extractPlaylistID(link);
    } catch {
      playlistID = "";
    }
    if (!playlistID) throw new Error("invalid soda playlist link");
    return fetchPlaylistDetailPaged(playlistID);
  },

  /** GetUserPlaylists 用户创建/收藏歌单（需要 Cookie） */
  async getUserPlaylists(page: number, limit: number): Promise<Playlist[]> {
    return getUserPlaylists(page, limit);
  },

  /** CreateQRLogin 创建扫码登录会话 */
  async createQRLogin(): Promise<QRLoginSession> {
    cleanupPending();

    const createURL = `${QR_CREATE_API}?${buildQRCreateQuery()}`;
    const resp = await httpRequest(createURL, {
      headers: { "User-Agent": PASSPORT_UA, Accept: "application/json, text/javascript" },
      timeoutMs: 30_000,
    });
    const body = await resp.text();
    // 捕获 get_qrcode 下发的 cookie（passport_csrf_token 等）
    const createCookies = responseCookies(resp);

    const data = JSON.parse(body) as {
      data?: { token?: string; qrcode?: string; web_url?: string; qrcode_index_url?: string; is_frontier?: boolean };
      message?: string;
    };
    if (!data.data?.token) {
      throw new Error(`soda qr create failed: ${data.message ?? ""}`);
    }

    const token = data.data.token;
    const scanURL = scanLoginURL(token);
    const imageURL = qrCodeImageURL(data.data.qrcode ?? "");
    const displayQRSource = imageURL ? "qrcode_base64" : "qrcode_index_url";

    // 优先官方 qrcode_index_url
    let qrURL = trim(data.data.qrcode_index_url);
    if (!qrURL) qrURL = trim(data.data.web_url);
    if (!qrURL) qrURL = trim(scanURL);

    if (Object.keys(createCookies).length > 0) {
      rememberPending(token, {
        ...emptyPending(),
        cookies: createCookies,
        expiresAt: Date.now() + 10 * 60_000,
      });
    }

    return {
      source: "soda",
      key: token,
      url: qrURL,
      image_url: imageURL,
      expires_at: Math.floor(Date.now() / 1000) + 5 * 60,
      extra: {
        token,
        qrcode_index_url: data.data.qrcode_index_url ?? "",
        scan_login_url: scanURL,
        is_frontier: String(data.data.is_frontier === true),
        raw_qrcode_image: String(!!data.data.qrcode),
        display_qr_source: displayQRSource,
      },
    };
  },

  /**
   * CheckQRLogin 检查扫码状态，含 MFA 短信流。
   * key 格式："token" / "token|send_code|encrypt_uid|verify_params" /
   * "token|validate|encrypt_uid|verify_params|code" / "token|up_sms|encrypt_uid|verify_params"
   */
  async checkQRLogin(key: string): Promise<QRLoginResult> {
    const parts = key.split("|", 5);

    if (parts.length >= 5 && parts[1] === "validate") {
      return sodaValidateCode(parts[0], parts[2], parts[3], parts[4]);
    }
    if (parts.length >= 4 && parts[1] === "up_sms") {
      return sodaVerifyUpSMS(parts[0], parts[2], parts[3]);
    }
    if (parts.length >= 4 && parts[1] === "send_code") {
      return sodaSendCode(parts[0], parts[2], parts[3]);
    }
    return checkQRConnect(parts[0]);
  },

  // GetRecommendedPlaylists：Go 返回 "soda daily recommendation not supported" → 不实现
  // GetPlaylistCategories / GetCategoryPlaylists：Go 返回 ErrPlaylistCategoriesUnsupported → 不实现
};

// ---------- 附加能力（MusicProvider 契约之外，对齐 Go 公开方法） ----------

/** 对齐 core.FetchDecryptedSodaAudio：下载并按需解密，返回明文音频字节 */
export async function fetchDecryptedSodaAudio(song: Song): Promise<Buffer> {
  const info = await getDownloadInfo(song);
  const resp = await httpRequest(info.url, { headers: { "User-Agent": UA }, timeoutMs: 120_000 });
  if (resp.status !== 200) throw new Error(`download status: ${resp.status}`);
  const encryptedData = Buffer.from(await resp.arrayBuffer());
  // SEO 路径返回明文 m4a（无 play_auth），无需解密；Android 加密流必须解密。
  if (trim(info.playAuth)) return decryptAudio(encryptedData, info.playAuth);
  return encryptedData;
}

/** 对齐 Download：下载并在有 play_auth 时解密 */
export async function sodaDownload(song: Song, outputPath: string): Promise<void> {
  fs.writeFileSync(outputPath, await fetchDecryptedSodaAudio(song));
}

/** 对齐 IsVipAccount：用 VIP 试探曲目探测当前账号 */
export async function isSodaVipAccount(): Promise<boolean> {
  const cached = getVipCache();
  if (cached !== null) return cached;

  if (!cookie()) {
    setVipCache(false);
    return false;
  }

  let info: DownloadInfo;
  try {
    info = await getDownloadInfo({
      id: VIP_PROBE_TRACK_ID,
      source: "soda",
      name: "",
      artist: "",
      album: "",
      duration: 0,
      size: 0,
      bitrate: 0,
      url: "",
      cover: "",
      link: VIP_PROBE_TRACK_URL,
      extra: { track_id: VIP_PROBE_TRACK_ID },
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (
      msg.includes("requires cookie") ||
      msg.includes("full stream unavailable") ||
      msg.includes("returned preview stream")
    ) {
      setVipCache(false);
      return false;
    }
    throw new Error(`failed to probe soda vip account: ${msg}`);
  }

  const isVip = !!info.url && !downloadInfoIsPreview(info, 180);
  setVipCache(isVip);
  return isVip;
}
