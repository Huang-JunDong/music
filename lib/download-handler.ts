/**
 * 下载主流程（审核整改 A-26：自 download 路由下沉的业务层）—
 * 对齐 go-music-dl downloadHandler 六分支：本地文件（304/206/save_local JSON）、
 * save_local（去重+WebDAV）、embed=1（元数据嵌入）、soda（服务端解密+内存 Range）、
 * Range 并行分块、普通流代理（Range 透传）。路由仅做方法导出。
 */
import fs from "node:fs";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { getProvider, songFromParams } from "./registry";
import {
  audioMimeByExt,
  buildDownloadFilename,
  detectExtByContentType,
  downloadDisposition,
  extFromUrlPath,
  fetchSource,
  parseRangeHeader,
} from "./web-core";
import {
  detectAudioExt,
  downloadWithDedupCheckWithTemplate,
  downloadSongDataWithTemplate,
  uploadSongToWebDAV,
  webdavConfigured,
} from "./download-flow";
import { downloadDir, getWebSettings } from "./store";
import { loadDownloadDedupSet } from "./download-record";
import { checkSaveLocalGuard, wantsSaveLocal } from "./write-guard";
import { isLocalMusicSource, localMusicTrackByID, trackAbsPath } from "./local-music";
import { newSourceRangeFetch, rangeFetchStream } from "./range-fetch";

/**
 * 审核整改 A-29：服务端错误信息脱敏——SQLite/文件系统错误常携带服务器绝对路径
 * （如 ENOENT: no such file ... c:\...\downloads\x.mp3），返回客户端前统一剥离。
 */
function sanitizeServerErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/[A-Za-z]:\\[^\s"';,)]*/g, "<server-path>")
    .replace(/(?:\/(?:home|Users|root|var|tmp|opt|srv|data)\/[^\s"';,)]*)/g, "<server-path>");
}

function localAudioMime(ext: string): string {
  switch (ext.toLowerCase().replace(/^\./, "")) {
    case "aac":
      return "audio/aac";
    case "wav":
      return "audio/wav";
    default:
      return audioMimeByExt(ext);
  }
}

function nodeStreamBody(stream: fs.ReadStream): ReadableStream<Uint8Array> {
  return Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
}

/* ---------------- 本地音乐文件服务（对齐 serveLocalMusicDownload + ServeContent） ---------------- */

async function serveLocalMusic(req: NextRequest, id: string, saveLocal: boolean): Promise<NextResponse> {
  let track;
  try {
    track = await localMusicTrackByID(id);
  } catch {
    return new NextResponse("Local music not found", { status: 404 });
  }

  if (saveLocal) {
    return NextResponse.json({
      status: "ok",
      saved: true,
      path: trackAbsPath(track),
      filename: track.filename,
    });
  }

  const absPath = trackAbsPath(track);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absPath);
    if (!stat.isFile()) throw new Error("not a file");
  } catch {
    return new NextResponse("Local music not found", { status: 404 });
  }

  const headers = new Headers({
    "Content-Type": localAudioMime(track.ext),
    "Accept-Ranges": "bytes",
    "Last-Modified": stat.mtime.toUTCString(),
    ETag: `"${stat.size}-${Math.floor(stat.mtimeMs / 1000)}"`,
  });

  // 协商缓存（对齐 http.ServeContent 的 304）
  const ifModifiedSince = req.headers.get("if-modified-since");
  if (ifModifiedSince) {
    const since = Date.parse(ifModifiedSince);
    if (!Number.isNaN(since) && Math.floor(stat.mtime.getTime() / 1000) <= Math.floor(since / 1000)) {
      return new NextResponse(null, { status: 304, headers });
    }
  }
  const ifNoneMatch = req.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatch === headers.get("ETag")) {
    return new NextResponse(null, { status: 304, headers });
  }

  const streamPlayback = req.nextUrl.searchParams.get("stream") === "1";
  if (!streamPlayback) {
    headers.set("Content-Disposition", downloadDisposition(track.filename));
  }

  const range = parseRangeHeader(req.headers.get("range"), stat.size);
  if (range === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${stat.size}`);
    return new NextResponse(null, { status: 416, headers });
  }
  if (range && range !== "invalid") {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${stat.size}`);
    headers.set("Content-Length", String(range.end - range.start + 1));
    return new NextResponse(nodeStreamBody(fs.createReadStream(absPath, { start: range.start, end: range.end })), {
      status: 206,
      headers,
    });
  }

  headers.set("Content-Length", String(stat.size));
  return new NextResponse(nodeStreamBody(fs.createReadStream(absPath)), { status: 200, headers });
}

/* ---------------- 主流程（对齐 Go downloadHandler 六分支） ---------------- */

export async function handleDownload(req: NextRequest): Promise<NextResponse> {
  const params = req.nextUrl.searchParams;
  const id = params.get("id") ?? "";
  const source = (params.get("source") ?? "").trim();
  const streamPlayback = params.get("stream") === "1";
  const noRangeRequest = !(req.headers.get("range") ?? "").trim();
  const saveLocal = !streamPlayback && noRangeRequest && wantsSaveLocal(req);

  const guarded = checkSaveLocalGuard(req);
  if (guarded) return guarded;

  if (!id || !source) {
    return new NextResponse("Missing params", { status: 400 });
  }

  if (isLocalMusicSource(source)) {
    return serveLocalMusic(req, id, saveLocal);
  }

  const song = songFromParams(params);
  if (!song.name.trim()) song.name = "Unknown";
  if (!song.artist.trim()) song.artist = "Unknown";
  // 对齐 Go：album 为空时回退 extra.album
  if (!song.album.trim() && song.extra?.album) {
    song.album = song.extra.album.trim();
  }

  const settings = getWebSettings();
  // 元数据嵌入：显式 embed=1 优先；否则跟随设置「下载时嵌入元数据」（embedDownload）
  const embedMeta = !streamPlayback && noRangeRequest && (params.get("embed") === "1" || settings.embedDownload);

  // ---- 分支 1：save_local（下载到服务器目录 + 去重 + WebDAV + JSON 响应） ----
  if (saveLocal) {
    const dedupSet = loadDownloadDedupSet();
    let result;
    try {
      result = await downloadWithDedupCheckWithTemplate(
        song,
        downloadDir(),
        embedMeta,
        embedMeta,
        settings.downloadFilenameTemplate,
        dedupSet,
      );
    } catch (err) {
      // 审核整改 A-29：错误信息脱敏（原样返回会携带服务器绝对路径）
      return NextResponse.json({ error: sanitizeServerErrorMessage(err) }, { status: 502 });
    }

    let webdavError = "";
    if (!result.skipped && webdavConfigured(settings)) {
      try {
        await uploadSongToWebDAV(settings, result.filename, result.data);
      } catch (err) {
        webdavError = String(err instanceof Error ? err.message : err);
      }
    }

    const payload: Record<string, unknown> = {
      status: "ok",
      saved: true,
      path: result.savedPath,
      filename: result.filename,
      skipped: result.skipped,
    };
    if (result.warning) payload.warning = result.warning;
    if (webdavError) payload.webdav_error = webdavError;
    return NextResponse.json(payload);
  }

  // ---- 分支 2：embed=1（元数据嵌入后整段返回） ----
  if (embedMeta) {
    let result;
    try {
      result = await downloadSongDataWithTemplate(song, true, true, settings.downloadFilenameTemplate);
    } catch {
      return new NextResponse("Upstream stream error", { status: 502 });
    }

    const warnings: string[] = [];
    if (result.warning) warnings.push(result.warning);
    if (webdavConfigured(settings)) {
      try {
        await uploadSongToWebDAV(settings, result.filename, result.data);
      } catch (err) {
        // warning header 见下
      }
    }
    const headers = new Headers({ "Content-Type": result.contentType });
    if (warnings.length) headers.set("X-MusicDL-Warning", warnings.join("; "));
    headers.set("Content-Disposition", downloadDisposition(result.filename));
    return new NextResponse(new Uint8Array(result.data), { status: 200, headers });
  }

  const provider = getProvider(source);
  if (!provider?.getStreamUrl) {
    return new NextResponse("Unknown source", { status: 400 });
  }

  // ---- 分支 3：soda（加密流必须服务端解密，Range 不适用） ----
  if (source === "soda") {
    const { fetchDecryptedSodaAudio } = await import("./providers/soda");
    let finalData: Buffer;
    try {
      finalData = await fetchDecryptedSodaAudio(song);
    } catch {
      return new NextResponse("Soda stream error", { status: 502 });
    }
    const ext = detectAudioExt(finalData);
    const filename = buildDownloadFilename(song, ext, settings.downloadFilenameTemplate);
    if (!streamPlayback && webdavConfigured(settings)) {
      try {
        await uploadSongToWebDAV(settings, filename, finalData);
      } catch (err) {
        // warning header 见下
      }
    }
    const headers = new Headers({ "Content-Type": audioMimeByExt(ext), "Accept-Ranges": "bytes" });
    if (!streamPlayback) {
      headers.set("Content-Disposition", downloadDisposition(filename));
    }
    headers.set("Content-Length", String(finalData.length));
    // 内存 Range 支持（对齐 Go http.ServeContent）
    const range = parseRangeHeader(req.headers.get("range"), finalData.length);
    if (range === "unsatisfiable") {
      headers.set("Content-Range", `bytes */${finalData.length}`);
      return new NextResponse(null, { status: 416, headers });
    }
    if (range && range !== "invalid") {
      headers.set("Content-Range", `bytes ${range.start}-${range.end}/${finalData.length}`);
      headers.set("Content-Length", String(range.end - range.start + 1));
      const slice = finalData.subarray(range.start, range.end + 1);
      return new NextResponse(new Uint8Array(slice), { status: 206, headers });
    }
    return new NextResponse(new Uint8Array(finalData), { status: 200, headers });
  }

  // ---- 分支 4：普通流代理（Range 透传） ----
  let upstreamUrl: string;
  try {
    upstreamUrl = await provider.getStreamUrl(song);
  } catch {
    // 审核整改 A-24：直链获取失败属上游故障，语义为 502 而非 404（资源并非不存在）
    return new NextResponse("Failed to get URL", { status: 502 });
  }

  // ---- 分支 4a：Range 并行分块下载（仅下载场景；播放走 4b 单连接透传） ----
  // 32KB 首块 + 256KB 分块、16 并发按序流式写出；任一分块重试耗尽即中断整流。
  // 播放器（audio 元素）对此零容忍（缓冲耗尽即卡死），且高并发易触发上游限流，
  // 故 stream=1 播放请求不走此通道。
  if (!streamPlayback) {
    const rangeFetch = await newSourceRangeFetch(upstreamUrl, source, req.headers.get("range"));
    if (rangeFetch.error) {
      return new NextResponse("Upstream range error", { status: 502 });
    }
    if (rangeFetch.fetch) {
      const info = rangeFetch.fetch;
      let ext = (info.ext ?? "").trim().replace(/^\./, "").toLowerCase();
      if (!ext) ext = (song.ext ?? "").trim().replace(/^\./, "").toLowerCase();
      if (!ext) ext = "mp3";

      const filename = buildDownloadFilename(song, ext, settings.downloadFilenameTemplate);
      const headers = new Headers();
      headers.set("Accept-Ranges", "bytes");
      headers.set("Content-Length", String(info.contentLength));
      if (info.contentRange) headers.set("Content-Range", info.contentRange);
      headers.set("Content-Type", info.contentType || audioMimeByExt(ext));
      if (streamPlayback) {
        headers.set("Content-Type", info.contentType || audioMimeByExt(ext));
      } else {
        headers.set("Content-Disposition", downloadDisposition(filename));
      }
      return new NextResponse(rangeFetchStream(info) as unknown as BodyInit, {
        status: info.statusCode,
        headers,
      });
    }
  }

  let upstream: Response;
  const rangeHeader = req.headers.get("range");
  try {
    // 大文件流式传输不设整体超时（对齐 Go http.Client{} 无超时语义）
    upstream = await fetchSource(upstreamUrl, source, rangeHeader, 0);
  } catch {
    return new NextResponse("Upstream stream error", { status: 502 });
  }

  // 扩展名探测：Content-Type → URL 后缀 → song.ext → mp3
  const contentType = upstream.headers.get("content-type") ?? "";
  let ext = detectExtByContentType(contentType) || extFromUrlPath(upstreamUrl);
  if (!ext) ext = (song.ext ?? "").replace(/^\./, "").toLowerCase();
  if (!ext) ext = "mp3";

  const filename = buildDownloadFilename(song, ext, settings.downloadFilenameTemplate);

  const headers = new Headers();
  for (const key of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const value = upstream.headers.get(key);
    if (value) headers.set(key, value);
  }
  headers.set("Accept-Ranges", "bytes");

  if (streamPlayback) {
    const ct = contentType.trim().toLowerCase();
    if (!ct || ct.startsWith("application/octet-stream")) {
      headers.set("Content-Type", audioMimeByExt(ext));
    }
  } else {
    headers.set("Content-Type", contentType || audioMimeByExt(ext));
    headers.set("Content-Disposition", downloadDisposition(filename));
  }

  // 审核整改 A-07：WebDAV 配置且非 stream 播放时改 tee 流式——客户端立即收到流式响应，
  // WebDAV 后台以 chunked PUT 上传（失败仅服务端日志，见审核文档冲突标记：
  // 偏离 Go"整段缓冲同步上传 + warning header"语义，换取消除并发 N 曲内存放大）。
  if (webdavConfigured(settings) && !streamPlayback && upstream.body) {
    if (upstream.status >= 200 && upstream.status < 300) {
      const [toClient, toWebdav] = upstream.body.tee();
      void uploadSongToWebDAV(settings, filename, toWebdav).catch((err) => {
        console.warn(`[webdav] async upload failed: ${err instanceof Error ? err.message : err}`);
      });
      return new NextResponse(toClient, { status: upstream.status, headers });
    }
  }

  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
