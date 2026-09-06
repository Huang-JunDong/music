/**
 * 下载主流程（审核整改 A-26：自 download 路由下沉的业务层）—
 * 对齐 go-music-dl downloadHandler 六分支：本地文件（304/206/save_local JSON）、
 * save_local（去重+WebDAV）、embed=1（元数据嵌入）、soda（服务端解密+内存 Range）、
 * Range 并行分块、普通流代理（Range 透传）。路由仅做方法导出。
 */
import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { getProvider, songFromParams } from "./registry";
import { normalizeSongQuality } from "./types";
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

function nodeStreamBody(stream: fs.ReadStream, signal?: AbortSignal): ReadableStream<Uint8Array> {
  // 手动桥接替代 Readable.toWeb：toWeb 在客户端断开（cancel）后仍可能把已排队的
  // data 事件 enqueue 到已关闭的 controller → ERR_INVALID_STATE uncaughtException。
  // 此处所有 enqueue/close/error 均兜底，cancel/abort 即刻 destroy 源流；
  // desiredSize 背压：下游消费不及则 pause，pull 时 resume。
  return new ReadableStream<Uint8Array>({
    start(controller) {
      stream.on("data", (chunk: Buffer | string) => {
        try {
          controller.enqueue(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
          if (controller.desiredSize !== null && controller.desiredSize <= 0) stream.pause();
        } catch {
          stream.destroy();
        }
      });
      stream.on("end", () => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
      stream.on("error", (err) => {
        try {
          controller.error(err);
        } catch {
          /* already closed */
        }
      });
      if (signal) {
        if (signal.aborted) stream.destroy();
        else signal.addEventListener("abort", () => stream.destroy(), { once: true });
      }
    },
    pull() {
      stream.resume();
    },
    cancel() {
      stream.destroy();
    },
  });
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
    return new NextResponse(nodeStreamBody(fs.createReadStream(absPath, { start: range.start, end: range.end }), req.signal), {
      status: 206,
      headers,
    });
  }

  headers.set("Content-Length", String(stat.size));
  return new NextResponse(nodeStreamBody(fs.createReadStream(absPath), req.signal), { status: 200, headers });
}

/* ---------------- 上游断流自愈（本项目特有） ---------------- */

const STREAM_RESUME_RETRIES = 3;
/** 单次读空闲超时：QQ 黑洞式掐流（连接挂起、不发数据也不 EOF）不会触发提前结束检测，须主动断开重连 */
const STREAM_IDLE_TIMEOUT_MS = 20_000;
/** 续传请求响应头超时（headers 秒回，超时即判定直链不可用） */
const STREAM_RESUME_HEADERS_TIMEOUT_MS = 30_000;

/** `bytes 1234-5678/9…` → 1234（非 206 无此头时为 0） */
function contentRangeStart(contentRange: string | null): number {
  const m = (contentRange ?? "").match(/^bytes (\d+)-/);
  return m ? parseInt(m[1], 10) : 0;
}

/** 带空闲超时的读：null = 超时（黑洞连接），reject = 连接错误 */
async function readWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ms: number,
): Promise<ReadableStreamReadResult<Uint8Array> | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 单连接透传（fetch → Response.body）在上游断流时客户端只能拿到半个文件
 * ——206/Content-Length 头已发出，无法整段重来。此包装统计已写字节，检测到
 * 提前 EOF / 读错误 / 空闲超时，即以 Range: bytes=<offset>- 续写（最多
 * STREAM_RESUME_RETRIES 次）：
 * - 优先复用原直链；失败（vkey 过期/CDN 拒绝）则经 refreshUrl 重新取直链再试；
 * - 续传响应须为 206 且 Content-Range 起始字节与文件总长均吻合——防止上游
 *   忽略 Range 整段重发（数据重复）或直链刷新后档位降级（文件变短）导致拼接损坏；
 * - 对播放器与下载器完全透明；重试耗尽仍不足量则按短流收尾。
 */
function resumeUpstreamBody(opts: {
  getUrl: () => string;
  refreshUrl: () => Promise<string>;
  label: string;
  source: string;
  totalBytes: number;
  baseOffset: number;
  expectedLength: number;
  initial: ReadableStream<Uint8Array>;
}): ReadableStream<Uint8Array> {
  const { getUrl, refreshUrl, label, source, totalBytes, baseOffset, expectedLength, initial } = opts;
  let sent = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = initial.getReader();
  let retries = 0;

  const dropReader = () => {
    reader?.cancel().catch(() => {});
    reader = null;
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        if (!reader) {
          if (sent >= expectedLength || retries >= STREAM_RESUME_RETRIES) {
            if (sent < expectedLength) {
              console.warn(
                `[stream-resume] ${label}: short stream ${sent}/${expectedLength} bytes after ${retries} retries`,
              );
            }
            controller.close();
            return;
          }
          retries++;
          const from = baseOffset + sent;
          console.warn(`[stream-resume] ${label}: interrupted at ${sent}/${expectedLength}, retry #${retries} from byte ${from}`);
          let resumeUrl = getUrl();
          try {
            let resp = await fetchSource(resumeUrl, source, `bytes=${from}-`, STREAM_RESUME_HEADERS_TIMEOUT_MS).catch(
              async (err) => {
                console.warn(
                  `[stream-resume] ${label}: reuse url failed (${err instanceof Error ? err.message : err}), refreshing`,
                );
                resumeUrl = await refreshUrl();
                return fetchSource(resumeUrl, source, `bytes=${from}-`, STREAM_RESUME_HEADERS_TIMEOUT_MS);
              },
            );
            const m = (resp.headers.get("content-range") ?? "").match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/);
            const startOk = !!m && parseInt(m[1], 10) === from;
            const totalOk = !!m && (m[3] === "*" || parseInt(m[3], 10) === totalBytes);
            if (resp.status !== 206 || !resp.body || !startOk || !totalOk) {
              resp.body?.cancel().catch(() => {});
              throw new Error(
                `resume mismatch: status ${resp.status}, range ${resp.headers.get("content-range") ?? "-"}`,
              );
            }
            reader = resp.body.getReader();
          } catch (err) {
            console.warn(`[stream-resume] ${label}: resume failed: ${err instanceof Error ? err.message : err}`);
            continue;
          }
        }
        let result: ReadableStreamReadResult<Uint8Array> | null;
        try {
          result = await readWithIdleTimeout(reader, STREAM_IDLE_TIMEOUT_MS);
        } catch {
          dropReader(); // 连接被重置 → 续传
          continue;
        }
        if (result === null) {
          console.warn(`[stream-resume] ${label}: idle ${STREAM_IDLE_TIMEOUT_MS}ms, dropping connection`);
          dropReader();
          continue;
        }
        if (result.done) {
          reader = null;
          if (sent < expectedLength) continue; // 提前 EOF → 续传
          controller.close();
          return;
        }
        if (result.value) {
          sent += result.value.length;
          controller.enqueue(result.value);
        }
        return; // 每次 pull 至多入队一块，保持背压
      }
    },
    cancel(reason) {
      reader?.cancel(reason).catch(() => {});
    },
  });
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

  /* 音质偏好（stream=1 播放与普通下载共用；save_local/embed 下载固定最高档） */
  const quality = normalizeSongQuality(params.get("quality"));

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
    upstreamUrl = await provider.getStreamUrl(song, quality);
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
    // 响应头到达设 30s 上限（headers 正常秒回，超时即直链不可用→502 触发客户端重试）；
    // 响应体不设整体超时（对齐 Go http.Client{} 无超时语义，断流由自愈流接管）
    upstream = await fetchSource(upstreamUrl, source, rangeHeader, 30_000);
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

  // 上游断流自愈：QQ 等源 CDN 会对长连接限速/中途掐断（提前 EOF / 连接重置 /
  // 黑洞挂起），单连接透传下客户端只拿半个文件（206/Content-Length 头已发出
  // 无法整段重来）。长度已知且上游支持 Range（206 / Accept-Ranges: bytes）时
  // 以断点续拉包装透传体；续传失败自动刷新直链（vkey 可能已过期）。
  const declaredLength = parseInt(upstream.headers.get("content-length") ?? "", 10);
  const rangeCapable =
    upstream.status === 206 || (upstream.headers.get("accept-ranges") ?? "").trim().toLowerCase() === "bytes";
  let responseBody: ReadableStream<Uint8Array> | null = upstream.body;
  if (upstream.body && rangeCapable && Number.isFinite(declaredLength) && declaredLength > 0) {
    let currentUrl = upstreamUrl;
    const baseOffset = contentRangeStart(upstream.headers.get("content-range"));
    responseBody = resumeUpstreamBody({
      getUrl: () => currentUrl,
      refreshUrl: async () => {
        currentUrl = await provider.getStreamUrl(song, quality);
        return currentUrl;
      },
      label: `${source}:${song.name}`,
      source,
      totalBytes: baseOffset + declaredLength,
      baseOffset,
      expectedLength: declaredLength,
      initial: upstream.body,
    });
  }

  // 审核整改 A-07：WebDAV 配置且非 stream 播放时改 tee 流式——客户端立即收到流式响应，
  // WebDAV 后台以 chunked PUT 上传（失败仅服务端日志，见审核文档冲突标记：
  // 偏离 Go"整段缓冲同步上传 + warning header"语义，换取消除并发 N 曲内存放大）。
  if (webdavConfigured(settings) && !streamPlayback && responseBody) {
    if (upstream.status >= 200 && upstream.status < 300) {
      const [toClient, toWebdav] = responseBody.tee();
      void uploadSongToWebDAV(settings, filename, toWebdav).catch((err) => {
        console.warn(`[webdav] async upload failed: ${err instanceof Error ? err.message : err}`);
      });
      return new NextResponse(toClient, { status: upstream.status, headers });
    }
  }

  return new NextResponse(responseBody, { status: upstream.status, headers });
}
