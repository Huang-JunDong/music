/**
 * Web API 通用工具 — 移植 core/service.go 的 BuildSourceRequest / AudioMimeByExt /
 * DetectAudioExtByContentType / BuildDownloadFilename 与 internal/web/server.go 的
 * setDownloadHeader 等。
 */
import { getCookie } from "./cookies";
import { UA_PC, UA_IPHONE } from "./http";
import { sanitizeFilename, type Song } from "./types";
import {
  GetAlbumSourceNames,
  GetDefaultSourceNames,
  GetPlaylistSourceNames,
} from "./registry";

/* ---------------- 源能力名单（对齐 core/service.go） ---------------- */

export const RECOMMEND_SOURCE_NAMES = ["netease", "qq", "kugou", "kuwo"];
export const USER_PLAYLIST_SOURCE_NAMES = ["netease", "qq", "kugou", "soda"];

/**
 * LIKE 元字符转义（审核整改 A-25）：配合 SQL 中 ESCAPE '\' 使用，
 * 防用户输入 %/_ 强制全表扫描。用法：`... LIKE ? ESCAPE '\'` + `"%"+likeEscape(kw)+"%"`。
 */
export function likeEscape(keyword: string): string {
  return (keyword ?? "").replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export function defaultSourcesForSearchType(searchType: string): string[] {
  switch (searchType) {
    case "playlist":
      return GetPlaylistSourceNames();
    case "album":
      return GetAlbumSourceNames();
    default:
      return GetDefaultSourceNames();
  }
}

/** 解析 query 中的多值 sources（getAll + 逗号分隔），返回去重非空列表 */
export function sourcesFromQuery(
  params: URLSearchParams,
  name = "sources",
): string[] {
  const list: string[] = [];
  for (const raw of params.getAll(name)) {
    for (const part of raw.split(",")) {
      const s = part.trim();
      if (s && !list.includes(s)) list.push(s);
    }
  }
  return list;
}

/** filterAvailableSources：请求源与支持源取交集；空则回退全部支持源 */
export function filterAvailableSources(requested: string[], supported: string[]): string[] {
  const allowed = new Set(supported.map((s) => s.trim()));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of requested) {
    const s = raw.trim();
    if (!s || !allowed.has(s) || seen.has(s)) continue;
    seen.add(s);
    result.push(s);
  }
  if (result.length === 0) return [...supported];
  return result;
}

/* ---------------- 上游请求（BuildSourceRequest 移植） ---------------- */

/** 各音源防盗链请求头（UA/Referer/Cookie/Range） */
export function upstreamHeaders(source: string, range?: string | null): Record<string, string> {
  const headers: Record<string, string> = { "User-Agent": UA_PC };
  if (source === "bilibili") headers["Referer"] = "https://www.bilibili.com/";
  if (source === "netease") headers["Referer"] = "http://music.163.com/";
  if (source === "migu") {
    headers["User-Agent"] = UA_IPHONE;
    headers["Referer"] = "http://music.migu.cn/";
  }
  if (source === "qq") headers["Referer"] = "http://y.qq.com";
  if (source === "kugou") headers["Referer"] = "http://m.kugou.com";
  if (source === "kuwo") headers["Referer"] = "http://www.kuwo.cn/";
  const cookie = getCookie(source);
  if (cookie) headers["Cookie"] = cookie;
  if (range) headers["Range"] = range;
  return headers;
}

/** 按源请求上游 URL（默认 15s 超时；timeoutMs<=0 表示不限时，用于大文件流式传输） */
export async function fetchSource(
  url: string,
  source: string,
  range?: string | null,
  timeoutMs = 15_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await fetch(url, {
      headers: upstreamHeaders(source, range),
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* ---------------- MIME / 扩展名 ---------------- */

export function audioMimeByExt(ext: string): string {
  switch (ext.replace(/^\./, "").toLowerCase()) {
    case "flac":
      return "audio/flac";
    case "m4a":
      return "audio/mp4";
    case "ogg":
      return "audio/ogg";
    case "wav":
      return "audio/wav";
    case "aac":
      return "audio/aac";
    case "wma":
      return "audio/x-ms-wma";
    default:
      return "audio/mpeg";
  }
}

/** Content-Type → 扩展名（DetectAudioExtByContentType 移植，映射表与 Go 逐项一致） */
export function detectExtByContentType(contentType: string): string {
  const ct = (contentType ?? "").split(";")[0].trim().toLowerCase();
  switch (ct) {
    case "audio/flac":
    case "audio/x-flac":
      return "flac";
    case "audio/x-ms-wma":
    case "audio/wma":
    case "video/x-ms-asf":
    case "application/vnd.ms-asf":
      return "wma";
    case "audio/mpeg":
    case "audio/mp3":
    case "audio/x-mp3":
      return "mp3";
    case "audio/ogg":
    case "application/ogg":
      return "ogg";
    case "audio/mp4":
    case "audio/x-m4a":
    case "audio/aac":
    case "audio/aacp":
      return "m4a";
    default:
      return "";
  }
}

/** URL 路径后缀 → 扩展名 */
export function extFromUrlPath(url: string): string {
  try {
    const suffix = new URL(url).pathname.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
    if (["mp3", "flac", "ogg", "m4a", "aac", "wav"].includes(suffix)) return suffix;
  } catch {
    /* ignore */
  }
  return "";
}

/* ---------------- 下载头 / 文件名 ---------------- */

function asciiDownloadFilenameFallback(filename: string): string {
  let out = "";
  for (const ch of filename) out += ch.charCodeAt(0) < 128 ? ch : "_";
  return out.replace(/["\\\r\n]/g, "_") || "download";
}

/** setDownloadHeader 移植：attachment + RFC5987 编码文件名 */
export function downloadDisposition(filename: string): string {
  let name = (filename ?? "").trim().replace(/\\/g, "/");
  const slash = name.lastIndexOf("/");
  if (slash >= 0) name = name.slice(slash + 1).trim();
  if (!name) name = "download";
  const encoded = encodeURIComponent(name);
  return `attachment; filename="${asciiDownloadFilenameFallback(name)}"; filename*=UTF-8''${encoded}`;
}

function sanitizeTemplateValue(value: string, fallback: string): string {
  let v = (value ?? "").trim();
  if (!v) return fallback;
  v = sanitizeFilename(v).trim();
  return v || fallback;
}

function sanitizeRelativePath(name: string): string {
  const parts = (name ?? "").trim().replace(/\\/g, "/").split("/");
  const safe: string[] = [];
  for (const part of parts) {
    const p = sanitizeFilename(part).trim().replace(/^[.\s]+|[.\s]+$/g, "");
    if (!p || p === "." || p === "..") continue;
    safe.push(p);
  }
  return safe.join("/") || "download";
}

/** BuildDownloadFilename 移植：{name}/{artist}/{album}/{source}/{id}/{ext} 模板 */
export function buildDownloadFilename(
  song: Pick<Song, "id" | "name" | "artist" | "album" | "source">,
  ext: string,
  filenameTemplate?: string,
): string {
  const template = (filenameTemplate ?? "").trim() || "{artist} - {name}"; // 对齐 Go DefaultDownloadFilenameTemplate（{ext} 缺省时末尾追加）
  ext = (ext ?? "").trim().replace(/^\./, "");

  const name = sanitizeTemplateValue(song.name, "Unknown");
  const artist = sanitizeTemplateValue(song.artist, "Unknown");
  const album = sanitizeTemplateValue(song.album, "");
  const source = sanitizeTemplateValue(song.source, "");
  const id = sanitizeTemplateValue(song.id, "");

  const hasExtToken = template.includes("{ext}");
  let rendered = template
    .replaceAll("{name}", name)
    .replaceAll("{artist}", artist)
    .replaceAll("{album}", album)
    .replaceAll("{source}", source)
    .replaceAll("{id}", id)
    .replaceAll("{ext}", ext)
    .trim();
  if (!rendered) rendered = `${artist} - ${name}${ext ? "." + ext : ""}`;
  if (!hasExtToken && ext) rendered += "." + ext;
  return sanitizeRelativePath(rendered);
}

/* ---------------- extra 解析（parseSongExtraQuery 移植） ---------------- */

export function parseSongExtraQuery(raw: string | null | undefined): Record<string, string> | undefined {
  const text = (raw ?? "").trim();
  if (!text) return undefined;
  let decoded: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    decoded = parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(decoded)) {
    if (typeof v === "string") extra[k] = v;
    else if (typeof v === "number" && Number.isFinite(v)) extra[k] = String(Math.round(v));
    else if (typeof v === "boolean") extra[k] = v ? "true" : "false";
    else {
      try {
        extra[k] = JSON.stringify(v);
      } catch {
        /* ignore */
      }
    }
  }
  return Object.keys(extra).length ? extra : undefined;
}

/* ---------------- 杂项 ---------------- */

/** FormatSize 移植："%.1f MB" 或 "-" */
export function formatSizeMB(bytes: number): string {
  if (!bytes || bytes <= 0) return "-";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function intAbs(a: number): number {
  return a < 0 ? -a : a;
}

/** 解析 Range 头（单区间），用于本地文件服务 */
export function parseRangeHeader(
  header: string | null,
  size: number,
): { start: number; end: number } | "invalid" | "unsatisfiable" | null {
  if (!header) return null;
  const m = header.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return "invalid";
  const [, s, e] = m;
  if (s === "" && e === "") return "invalid";
  if (s === "") {
    const len = parseInt(e, 10);
    if (len <= 0) return "unsatisfiable";
    return { start: Math.max(0, size - len), end: size - 1 };
  }
  const start = parseInt(s, 10);
  if (Number.isNaN(start) || start >= size) return "unsatisfiable";
  const end = e === "" ? size - 1 : Math.min(parseInt(e, 10), size - 1);
  if (start > end) return "unsatisfiable";
  return { start, end };
}
