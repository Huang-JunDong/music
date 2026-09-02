/**
 * 下载链路核心 — 移植 go-music-dl core/download.go + webdav.go + service.go
 * （DetectAudioExtBySignature / EmbedSongMetadata / DownloadSongDataWithTemplate /
 *  SaveSongToFileWithTemplate / DownloadWithDedupCheckWithTemplate / WebDAV 上传）。
 */
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseBuffer } from "music-metadata";
import { fetchSource, audioMimeByExt, detectExtByContentType, buildDownloadFilename } from "./web-core";
import { fetchBytesWithMime as fetchBytesWithMimeParallel } from "./range-fetch";
import { sanitizeFilename, type Song } from "./types";
import { getProvider } from "./registry";
import { fetchDecryptedSodaAudio } from "./providers/soda";
import {
  DOWNLOAD_STATUS_FAILED,
  DOWNLOAD_STATUS_SKIPPED,
  DOWNLOAD_STATUS_SUCCESS,
  isSongDownloaded,
  loadDownloadDedupSet,
  saveDownloadRecord,
  songKey,
} from "./download-record";
import type { WebSettings } from "./store";
import { downloadDir, getWebSettings } from "./store";

/* ---------------- 扩展名探测（magic bytes） ---------------- */

/** DetectAudioExtBySignature 移植 */
export function detectAudioExtBySignature(data: Buffer): string {
  if (data.length >= 16) {
    const wma = Buffer.from([0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0x00, 0xaa, 0x00, 0x62, 0xce, 0x6c]);
    if (data.subarray(0, 16).equals(wma)) return "wma";
  }
  if (data.length >= 4 && data.subarray(0, 4).toString("latin1") === "fLaC") return "flac";
  if (data.length >= 3 && data.subarray(0, 3).toString("latin1") === "ID3") return "mp3";
  if (data.length >= 2 && data[0] === 0xff && (data[1] & 0xe0) === 0xe0) return "mp3";
  if (data.length >= 4 && data.subarray(0, 4).toString("latin1") === "OggS") return "ogg";
  if (data.length >= 12 && data.subarray(4, 8).toString("latin1") === "ftyp") return "m4a";
  return "";
}

/** DetectAudioExt 移植：signature → mp3 */
export function detectAudioExt(data: Buffer): string {
  return detectAudioExtBySignature(data) || "mp3";
}

/* ---------------- ffmpeg 元数据嵌入（EmbedSongMetadata 移植） ---------------- */

let ffmpegPathCache: string | null = null;

function execFileAsync(cmd: string, args: string[], timeoutMs = 120_000): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ code: err ? (err as NodeJS.ErrnoException & { code?: number }).code ?? 1 : 0, output: `${stdout ?? ""}${stderr ?? ""}` });
    });
  });
}

/** ResolveFFmpegPath 移植：PATH 优先，失败回退 ffmpeg-static（npm 静态二进制），结果缓存 */
export async function resolveFFmpegPath(): Promise<string> {
  if (ffmpegPathCache !== null) return ffmpegPathCache;
  const candidates = process.platform === "win32" ? ["ffmpeg", "ffmpeg.exe"] : ["ffmpeg"];
  for (const candidate of candidates) {
    try {
      const { code } = await execFileAsync(candidate, ["-version"], 8_000);
      if (code === 0) {
        ffmpegPathCache = candidate;
        return candidate;
      }
    } catch {
      /* next */
    }
  }
  // 环境变量 MUSIC_DL_FFMPEG（对齐 Go ResolveFFmpegPath）> ffmpeg-static 兜底
  const envPath = (process.env.MUSIC_DL_FFMPEG ?? "").trim();
  if (envPath) {
    try {
      const { code } = await execFileAsync(envPath, ["-version"], 8_000);
      if (code === 0) {
        ffmpegPathCache = envPath;
        return envPath;
      }
    } catch {
      /* next */
    }
  }
  const staticPath = resolveFFmpegStatic();
  if (staticPath) {
    try {
      const { code } = await execFileAsync(staticPath, ["-version"], 8_000);
      if (code === 0) {
        ffmpegPathCache = staticPath;
        return staticPath;
      }
    } catch {
      /* unavailable */
    }
  }
  ffmpegPathCache = "";
  return "";
}

/** ffmpeg-static 兜底：动态 require（optionalDependency，缺失时返回空） */
function resolveFFmpegStatic(): string {
  try {
    const staticFFmpeg = createRequire(import.meta.url)("ffmpeg-static") as string | undefined;
    if (staticFFmpeg && typeof staticFFmpeg === "string") return staticFFmpeg;
  } catch {
    /* not installed */
  }
  return "";
}

async function tempFile(prefix: string, ext: string, data: Buffer): Promise<string> {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), prefix)), `data${ext}`);
  fs.writeFileSync(file, data);
  return file;
}

/**
 * EmbedSongMetadata 移植：ffmpeg 写入 title/artist/album/lyrics/封面。
 * mp3 时同样走 ffmpeg（Go 对 mp3 用纯 Go tag 库写 ID3v2.3，此处统一 ffmpeg，效果等价）。
 * 返回 null 表示 ffmpeg 不可用（对齐 ErrFFmpegNotFound）。
 */
export async function embedSongMetadata(
  audioData: Buffer,
  song: Song,
  lyric: string,
  coverData: Buffer | null,
  coverMime: string,
): Promise<Buffer | null> {
  if (!audioData.length) return null;

  let ext = detectAudioExt(audioData);
  const songExt = (song.ext ?? "").trim().replace(/^\./, "").toLowerCase();
  if (["mp3", "flac", "m4a", "wma"].includes(songExt)) ext = songExt;
  if (!["mp3", "flac", "m4a", "wma"].includes(ext)) return audioData;

  let title = song.name.trim();
  let artist = song.artist.trim();
  let album = song.album.trim();
  lyric = lyric.trim();

  // 对齐 Go EmbedSongMetadata：嵌入前读取既有元数据补空（mp3 无新封面时复用内嵌封面）
  let hasNewCover = !!(coverData && coverData.length);
  try {
    // fileInfo.path 走扩展名分发（music-metadata v11 + file-type v21 的 mime 嗅探路径对 mp3 误判，绕过）
    const meta = await parseBuffer(audioData, { path: `file.${ext}` });
    if (!title) title = (meta.common.title ?? "").trim();
    if (!artist) artist = (meta.common.artist ?? meta.common.albumartist ?? "").trim();
    if (!album) album = (meta.common.album ?? "").trim();
    if (!lyric) {
      const raw = meta.common.lyrics as unknown as string | string[] | undefined;
      lyric = (Array.isArray(raw) ? raw.join("\n") : raw ?? "").trim();
    }
    if (!hasNewCover && ext === "mp3") {
      const pic = meta.common.picture?.[0];
      if (pic && pic.data?.length) {
        coverData = Buffer.from(pic.data);
        coverMime = (pic.format ?? "").trim();
        hasNewCover = true;
      }
    }
  } catch {
    /* 读取失败按原值嵌入 */
  }

  if (!title && !artist && !album && !lyric && !hasNewCover) return audioData;

  const ffmpeg = await resolveFFmpegPath();
  if (!ffmpeg) return null;

  const inPath = await tempFile("musicdl-in-", `.${ext}`, audioData);
  const outPath = path.join(path.dirname(inPath), `out.${ext}`);
  try {
    const args: string[] = ["-y", "-hide_banner", "-loglevel", "error", "-i", inPath];

    const hasCover = !!coverData && coverData.length > 0;
    let coverPath = "";
    if (hasCover) {
      const coverExt = coverMime.includes("png") ? ".png" : ".jpg";
      coverPath = path.join(path.dirname(inPath), `cover${coverExt}`);
      fs.writeFileSync(coverPath, coverData as Buffer);
      args.push("-i", coverPath);
    }

    if (hasCover) {
      args.push("-map", "0:a:0", "-map", "1:v:0");
    } else {
      args.push("-map", "0");
    }
    args.push("-map_metadata", "0");

    if (hasCover) {
      args.push(
        "-c:a", "copy",
        "-c:v", "copy", "-disposition:v:0", "attached_pic",
        "-metadata:s:v:0", "title=Album cover",
        "-metadata:s:v:0", "comment=Cover (front)",
      );
    } else {
      args.push("-c", "copy");
    }

    if (title) args.push("-metadata", `title=${title}`);
    if (artist) args.push("-metadata", `artist=${artist}`);
    if (album) args.push("-metadata", `album=${album}`);
    if (lyric) args.push("-metadata", `lyrics=${lyric}`);
    if (ext === "mp3") args.push("-id3v2_version", "3", "-write_id3v1", "1");
    args.push(outPath);

    const { code, output } = await execFileAsync(ffmpeg, args);
    if (code !== 0) throw new Error(`ffmpeg metadata embed failed: ${output.trim()}`);

    const finalData = fs.readFileSync(outPath);
    if (!finalData.length) throw new Error("embedded output is empty");
    return finalData;
  } catch {
    // 对齐 Go：嵌入失败时使用原始音频（warning 由调用方拼接）
    return audioData;
  } finally {
    fs.rmSync(path.dirname(inPath), { recursive: true, force: true });
  }
}

/* ---------------- 音频抓取（fetchSongAudio / FetchBytesWithMime） ---------------- */

/** FetchBytesWithMime 移植：带源防盗链头抓取字节（单请求，供封面等小文件） */
export async function fetchBytesWithMime(
  url: string,
  source: string,
  timeoutMs = 120_000,
): Promise<{ data: Buffer; contentType: string }> {
  const resp = await fetchSource(url, source, null, timeoutMs);
  if (!resp.ok && resp.status !== 206) throw new Error(`upstream ${resp.status}`);
  const contentType = resp.headers.get("content-type") ?? "";
  return { data: Buffer.from(await resp.arrayBuffer()), contentType };
}

/** 音频抓取：优先 Range 并行通道（对齐 Go FetchBytesWithMime），失败回退单请求 */
async function fetchAudioBytesWithMime(url: string, source: string): Promise<{ data: Buffer; contentType: string }> {
  const parallel = await fetchBytesWithMimeParallel(url, source);
  if (parallel) return { data: Buffer.from(parallel.data), contentType: parallel.contentType };
  return fetchBytesWithMime(url, source);
}

/** fetchSongAudio 移植：soda 走解密链，其余走 provider 直链 */
export async function fetchSongAudio(song: Song): Promise<{ data: Buffer; contentType: string }> {
  if (song.source === "soda") {
    const finalData = await fetchDecryptedSodaAudio(song);
    return { data: finalData, contentType: "" };
  }
  const provider = getProvider(song.source);
  if (!provider?.getStreamUrl) throw new Error(`unsupported source: ${song.source}`);
  const url = await provider.getStreamUrl(song);
  if (!url) throw new Error("empty download url");
  return fetchAudioBytesWithMime(url, song.source);
}

/* ---------------- 完整下载（DownloadedSong / DownloadSongDataWithTemplate） ---------------- */

export interface DownloadedSong {
  data: Buffer;
  ext: string;
  contentType: string;
  filename: string;
  savedPath: string;
  warning: string;
  skipped: boolean;
}

/** DownloadSongDataWithTemplate 移植：抓取 → 扩展名探测 → 歌词/封面 → 元数据嵌入 */
export async function downloadSongDataWithTemplate(
  song: Song,
  withCover: boolean,
  withLyrics: boolean,
  filenameTemplate: string,
): Promise<DownloadedSong> {
  const normalized: Song = { ...song };
  normalized.name = normalized.name.trim() || "Unknown";
  normalized.artist = normalized.artist.trim() || "Unknown";
  normalized.album = normalized.album.trim();

  const { data: audioData, contentType } = await fetchSongAudio(normalized);

  let ext = detectAudioExtBySignature(audioData);
  if (!ext) ext = detectExtByContentType(contentType);
  if (!ext) ext = detectAudioExt(audioData);

  let lyric = "";
  if (withLyrics) {
    try {
      lyric = (await getProvider(normalized.source)?.getLyric?.(normalized)) ?? "";
    } catch {
      lyric = "";
    }
  }

  let coverData: Buffer | null = null;
  let coverMime = "";
  if (withCover && normalized.cover?.trim()) {
    try {
      const fetched = await fetchBytesWithMime(normalized.cover.trim(), normalized.source, 30_000);
      if (fetched.data.length) {
        coverData = fetched.data;
        coverMime = fetched.contentType;
      }
    } catch {
      /* ignore */
    }
  }

  let finalData = audioData;
  let warning = "";
  if (
    ["mp3", "flac", "m4a", "wma"].includes(ext) &&
    (normalized.album !== "" || lyric !== "" || (coverData && coverData.length))
  ) {
    const embedded = await embedSongMetadata(audioData, normalized, lyric, coverData, coverMime);
    if (embedded === null) {
      warning = "ffmpeg not found, metadata embedding skipped";
    } else if (embedded !== audioData) {
      finalData = embedded;
    } else {
      warning = "metadata embedding failed, using original audio";
    }
  }

  if (!ext) ext = detectAudioExt(finalData);

  return {
    data: finalData,
    ext,
    contentType: audioMimeByExt(ext),
    filename: buildDownloadFilename(normalized, ext, filenameTemplate),
    savedPath: "",
    warning,
    skipped: false,
  };
}

/** sanitizeDownloadRelativePath 移植：相对子路径白名单清洗 */
export function sanitizeDownloadRelativePath(name: string): string {
  const parts = (name ?? "").trim().replace(/\\/g, "/").split("/");
  const safe: string[] = [];
  for (const part of parts) {
    const p = sanitizeFilename(part).trim().replace(/^[.\s]+|[.\s]+$/g, "");
    if (!p || p === "." || p === "..") continue;
    safe.push(p);
  }
  return safe.join(path.sep) || "download";
}

/** saveDownloadedSongToFile 移植 */
export function saveDownloadedSongToFile(result: DownloadedSong, outDir: string): DownloadedSong {
  const targetDir = path.resolve(outDir.trim() || "data/downloads");
  fs.mkdirSync(targetDir, { recursive: true });

  const fileName = sanitizeDownloadRelativePath(result.filename);
  const filePath = path.join(targetDir, fileName);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, result.data);

  result.filename = fileName;
  result.savedPath = filePath;
  return result;
}

/** SaveSongToFileWithTemplate 移植 */
export async function saveSongToFileWithTemplate(
  song: Song,
  outDir: string,
  withCover: boolean,
  withLyrics: boolean,
  filenameTemplate: string,
): Promise<DownloadedSong> {
  const result = await downloadSongDataWithTemplate(song, withCover, withLyrics, filenameTemplate);
  return saveDownloadedSongToFile(result, outDir);
}

/** DownloadWithDedupCheckWithTemplate 移植：去重检查 + 记录（success/skipped/failed） */
export async function downloadWithDedupCheckWithTemplate(
  song: Song,
  outDir: string,
  withCover: boolean,
  withLyrics: boolean,
  filenameTemplate: string,
  dedupSet: Set<string>,
): Promise<DownloadedSong> {
  const key = songKey(song.name, song.artist);
  if (isSongDownloaded(song.name, song.artist, dedupSet)) {
    saveDownloadRecord(song.name, song.artist, song.source, DOWNLOAD_STATUS_SKIPPED, "");
    return { data: Buffer.alloc(0), ext: "", contentType: "", filename: key, savedPath: "", warning: "", skipped: true };
  }

  let result: DownloadedSong;
  try {
    result = await saveSongToFileWithTemplate(song, outDir, withCover, withLyrics, filenameTemplate);
  } catch (err) {
    saveDownloadRecord(song.name, song.artist, song.source, DOWNLOAD_STATUS_FAILED, String(err));
    throw err;
  }

  saveDownloadRecord(song.name, song.artist, song.source, DOWNLOAD_STATUS_SUCCESS, "");
  dedupSet.add(key);
  return result;
}

/* ---------------- WebDAV（webdav.go 移植） ---------------- */

export function webdavConfigured(settings: WebSettings): boolean {
  return settings.webdavEnabled && settings.webdavUrl.trim() !== "";
}

const WEBDAV_TIMEOUT_MS = 5 * 60_000;

function parseWebDAVBaseURL(raw: string): URL {
  const base = new URL(raw.trim());
  if (base.protocol !== "http:" && base.protocol !== "https:") throw new Error("webdav url must start with http:// or https://");
  return base;
}

function webdavRemoteRelativePath(settings: WebSettings, filename: string): string {
  let rel = sanitizeDownloadRelativePath(filename).replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (!rel) throw new Error("webdav upload path is empty");
  const dir = settings.webdavDir.trim().replace(/^\/+|\/+$/g, "");
  if (dir) rel = `${dir}/${rel}`;
  if (!rel) throw new Error("webdav upload path is empty");
  return rel;
}

async function webdavRequest(
  method: string,
  target: URL,
  settings: WebSettings,
  body?: Buffer,
  contentType?: string,
): Promise<Response> {
  const headers: Record<string, string> = {};
  // 对齐 Go：无条件 SetBasicAuth（空账密也发送）
  headers.Authorization = `Basic ${Buffer.from(`${settings.webdavUsername ?? ""}:${settings.webdavPassword ?? ""}`).toString("base64")}`;
  if (contentType) headers["Content-Type"] = contentType;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBDAV_TIMEOUT_MS);
  try {
    return await fetch(target.toString(), {
      method,
      headers,
      body: body ? new Uint8Array(body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** UploadSongToWebDAV 移植：MKCOL 建目录 + PUT 上传 */
export async function uploadSongToWebDAV(settings: WebSettings, filename: string, data: Buffer): Promise<void> {
  if (!data.length) throw new Error("empty webdav upload data");
  if (!filename.trim()) throw new Error("empty webdav upload filename");
  if (!webdavConfigured(settings)) return;

  const base = parseWebDAVBaseURL(settings.webdavUrl);
  const remoteRel = webdavRemoteRelativePath(settings, filename);

  const parts = remoteRel.split("/");
  let current = base.pathname.replace(/\/+$/, "");
  for (const part of parts.slice(0, -1)) {
    if (!part.trim()) continue;
    current = `${current}/${part}`;
    const target = new URL(base.toString());
    target.search = "";
    target.hash = "";
    target.pathname = `${current}/`;
    const resp = await webdavRequest("MKCOL", target, settings);
    await resp.arrayBuffer().catch(() => undefined);
    if (![200, 201, 204, 405].includes(resp.status)) {
      throw new Error(`create webdav directory ${part}: status ${resp.status}`);
    }
  }

  const target = new URL(base.toString());
  target.search = "";
  target.hash = "";
  target.pathname = `${current}/${parts[parts.length - 1]}`;
  // 对齐 Go：ext 为空则不设 Content-Type；非空按扩展名映射
  const ext = (path.extname(filename).replace(".", "") ?? "").toLowerCase();
  const mime = ext ? audioMimeByExt(ext) : "";
  const resp = await webdavRequest("PUT", target, settings, data, mime || undefined);
  if (resp.status < 200 || resp.status >= 300) {
    const body = (await resp.arrayBuffer().catch(() => new ArrayBuffer(0))) || new ArrayBuffer(0);
    const message = Buffer.from(body).toString("utf8").trim().slice(0, 4096) || `status ${resp.status}`;
    throw new Error(`upload to webdav failed: ${message}`);
  }
  await resp.arrayBuffer().catch(() => undefined);
}

/* ---------------- Web 资产保存（saveWebAssetToLocal 移植） ---------------- */

export function saveWebAssetToLocal(filename: string, data: Buffer): { savedPath: string; savedFilename: string } {
  if (!data.length) throw new Error("empty file data");
  const targetDir = path.resolve(downloadDir());
  fs.mkdirSync(targetDir, { recursive: true });
  const savedFilename = sanitizeFilename(filename.trim()) || "download";
  const savedPath = path.join(targetDir, savedFilename);
  fs.writeFileSync(savedPath, data);
  return { savedPath, savedFilename };
}
