/**
 * SourceRangeFetch — 移植 core/service.go 的 NewSourceRangeFetch / writeParallelRange。
 * 上游支持 Range（probe bytes=0-3 返回 206 且 Content-Range total 已知）时，
 * 以 32KB 首块 + 256KB 分块、16 并发的方式并行下载并按序流式写出。
 */
import { detectExtByContentType, fetchSource, upstreamHeaders } from "./web-core";

export interface SourceRangeFetch {
  url: string;
  source: string;
  statusCode: number;
  contentLength: number;
  contentRange: string;
  contentType: string;
  ext: string;
  start: number;
  end: number;
  total: number;
}

const FIRST_CHUNK_SIZE = 32 * 1024;
const CHUNK_SIZE = 256 * 1024;
const MAX_CONCURRENT_CHUNKS = 16;
const MAX_TOTAL_BYTES = 2 ** 53 - 1; // 对齐 Go 64 位上限语义（实际由内存约束）

/** 签名探测（DetectAudioExtBySignature 移植，分支顺序/长度门槛与 Go 完全一致：
 *  wma(16)→flac(4)→ID3(3)→MPEG sync(2)→ogg(4)→ftyp(12)；4 字节 probe 下裸 mp3 可命中） */
export function detectExtBySignature(bytes: Uint8Array): string {
  const b = bytes;
  if (
    b.length >= 16 &&
    b[0] === 0x30 && b[1] === 0x26 && b[2] === 0xb2 && b[3] === 0x75 &&
    b[4] === 0x8e && b[5] === 0x66 && b[6] === 0xcf && b[7] === 0x11 &&
    b[8] === 0xa6 && b[9] === 0xd9 && b[10] === 0x00 && b[11] === 0xaa &&
    b[12] === 0x00 && b[13] === 0x62 && b[14] === 0xce && b[15] === 0x6c
  ) {
    return "wma";
  }
  if (b.length >= 4 && b[0] === 0x66 && b[1] === 0x4c && b[2] === 0x61 && b[3] === 0x43) return "flac";
  if (b.length >= 3 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return "mp3"; // ID3
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return "mp3"; // MPEG frame sync
  if (b.length >= 4 && b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return "ogg";
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return "m4a"; // ftyp
  return "";
}

/** parseContentRangeTotal 移植：`bytes 0-3/12345` → 12345 */
export function parseContentRangeTotal(contentRange: string | null): number {
  const parts = (contentRange ?? "").split("/");
  if (parts.length !== 2) return 0;
  const total = parseInt(parts[1].trim(), 10);
  return Number.isFinite(total) && total > 0 ? total : 0;
}

/** resolveRangeHeader 移植：解析请求 Range，返回需下载的 [start,end] 与是否部分（任意显式 Range 均 partial，含 `bytes=0-`） */
function resolveRangeHeader(
  rangeHeader: string | null | undefined,
  total: number,
): { start: number; end: number; partial: boolean } | null {
  const text = (rangeHeader ?? "").trim();
  if (!text) return { start: 0, end: total - 1, partial: false };
  const m = text.match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return null;
  const [, s, e] = m;
  if (s === "" && e === "") return null;
  if (s === "") {
    const len = parseInt(e, 10);
    if (len <= 0) return null;
    const start = Math.max(0, total - len);
    return { start, end: total - 1, partial: true };
  }
  const start = parseInt(s, 10);
  if (!Number.isFinite(start) || start >= total) return null;
  const end = e === "" ? total - 1 : Math.min(parseInt(e, 10), total - 1);
  if (start > end) return null;
  return { start, end, partial: true };
}

/**
 * NewSourceRangeFetch 移植。
 * 返回：
 *  - { handled: false }：上游不支持 Range，走普通代理
 *  - { handled: true, fetch }：可并行分块下载
 *  - { handled: true, error }：探测到过大 / 非法 Range
 */
export async function newSourceRangeFetch(
  urlStr: string,
  source: string,
  rangeHeader: string | null,
): Promise<{ handled: boolean; fetch?: SourceRangeFetch; error?: string }> {
  let probe: Response;
  try {
    probe = await fetchSource(urlStr, source, "bytes=0-3", 30_000);
  } catch {
    return { handled: false };
  }
  if (probe.status !== 206) {
    try {
      await probe.body?.cancel();
    } catch {
      /* ignore */
    }
    return { handled: false };
  }

  const total = parseContentRangeTotal(probe.headers.get("content-range"));
  if (total <= 0) {
    try {
      await probe.body?.cancel();
    } catch {
      /* ignore */
    }
    return { handled: false };
  }
  if (total > MAX_TOTAL_BYTES) {
    try {
      await probe.body?.cancel();
    } catch {
      /* ignore */
    }
    return { handled: true, error: `download too large: ${total} bytes` };
  }

  const probeData = new Uint8Array(await probe.arrayBuffer().catch(() => new ArrayBuffer(0)));
  const ext = detectExtBySignature(probeData) || detectExtByContentType(probe.headers.get("content-type") ?? "");
  let contentType = (probe.headers.get("content-type") ?? "").trim().split(";")[0].trim();
  if (ext && (!contentType || contentType.toLowerCase().startsWith("application/octet-stream"))) {
    contentType = "";
  }

  const range = resolveRangeHeader(rangeHeader, total);
  if (!range) {
    return { handled: true, error: `invalid range: ${rangeHeader}` };
  }

  const fetchInfo: SourceRangeFetch = {
    url: urlStr,
    source,
    statusCode: 200,
    contentLength: range.end - range.start + 1,
    contentRange: "",
    contentType,
    ext,
    start: range.start,
    end: range.end,
    total,
  };
  if (range.partial) {
    fetchInfo.statusCode = 206;
    fetchInfo.contentRange = `bytes ${range.start}-${range.end}/${total}`;
  }
  return { handled: true, fetch: fetchInfo };
}

interface RangeChunkJob {
  index: number;
  start: number;
  end: number;
}

function buildRangeChunkJobs(start: number, end: number): RangeChunkJob[] {
  const jobs: RangeChunkJob[] = [];
  let firstEnd = start + FIRST_CHUNK_SIZE - 1;
  if (firstEnd > end) firstEnd = end;
  jobs.push({ index: 0, start, end: firstEnd });
  for (let chunkStart = firstEnd + 1; chunkStart <= end; chunkStart += CHUNK_SIZE) {
    const chunkEnd = Math.min(chunkStart + CHUNK_SIZE - 1, end);
    jobs.push({ index: jobs.length, start: chunkStart, end: chunkEnd });
  }
  return jobs;
}

/** fetchRangeChunk 移植：3 次重试，90s 超时；长度强校验（短读即重试，防残块损坏音频） */
async function fetchRangeChunk(
  urlStr: string,
  source: string,
  start: number,
  end: number,
): Promise<Uint8Array> {
  let lastErr: unknown = null;
  const expected = end - start + 1;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetchSource(urlStr, source, `bytes=${start}-${end}`, 90_000);
      const data = new Uint8Array(await resp.arrayBuffer());
      if (resp.status !== 206 && resp.status !== 200) {
        lastErr = new Error(`range ${start}-${end} returned status ${resp.status}`);
        continue;
      }
      if (data.length !== expected) {
        lastErr = new Error(`range ${start}-${end} short read: got ${data.length}, want ${expected}`);
        continue;
      }
      return data;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("range chunk failed");
}

/**
 * writeParallelRange 移植：16 并发分块、乱序到达按序写出（ReadableStream）。
 */
export function rangeFetchStream(info: SourceRangeFetch): ReadableStream<Uint8Array> {
  const jobs = buildRangeChunkJobs(info.start, info.end);
  const pending = new Map<number, Uint8Array>();
  let next = 0;
  let cursor = 0;

  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        while (next < jobs.length) {
          const ready = pending.get(next);
          if (!ready) break;
          controller.enqueue(ready);
          pending.delete(next);
          next++;
          return; // 每次_pull_至多入队一块，保持背压
        }
        if (cursor >= jobs.length) {
          if (next >= jobs.length) controller.close();
          return;
        }
        // 用信号量约束并发（每次 pull 预取若干块填满窗口）
        const inflight = cursor - next - pending.size;
        const launch = Math.min(MAX_CONCURRENT_CHUNKS - inflight, jobs.length - cursor);
        const launched: Promise<void>[] = [];
        for (let i = 0; i < launch; i++) {
          const job = jobs[cursor++];
          launched.push(
            fetchRangeChunk(info.url, info.source, job.start, job.end)
              .then((data) => {
                pending.set(job.index, data);
              })
              .catch((err) => controller.error(err)),
          );
        }
        await Promise.race(launched.length ? launched : [Promise.resolve()]);
      },
      cancel() {
        pending.clear();
      },
    },
    { highWaterMark: MAX_CONCURRENT_CHUNKS },
  );
}

/** CT 为空时按魔数推断 mime（对齐 Go http.DetectContentType 的音频场景） */
function detectMimeByData(data: Uint8Array): string {
  const ext = detectExtBySignature(data);
  switch (ext) {
    case "flac":
      return "audio/flac";
    case "ogg":
      return "audio/ogg";
    case "m4a":
      return "audio/mp4";
    case "wma":
      return "audio/x-ms-wma";
    default:
      return "";
  }
}

/** FetchBytesWithMime 移植：优先 Range 通道并行取字节，失败退回单请求（无大小上限，对齐 Go） */
export async function fetchBytesWithMime(
  url: string,
  source: string,
  timeoutMs = 120_000,
): Promise<{ data: Uint8Array; contentType: string } | null> {
  const probe = await newSourceRangeFetch(url, source, null);
  if (probe.handled && probe.fetch) {
    try {
      const reader = rangeFetchStream(probe.fetch).getReader();
      const parts: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
      }
      const size = parts.reduce((n, p) => n + p.length, 0);
      const data = new Uint8Array(size);
      let off = 0;
      for (const p of parts) {
        data.set(p, off);
        off += p.length;
      }
      let contentType = probe.fetch.contentType;
      if (!contentType) contentType = detectMimeByData(data);
      return { data, contentType };
    } catch {
      /* fallthrough to single fetch */
    }
  }
  try {
    const headers = upstreamHeaders(source);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let resp: Response;
    try {
      resp = await fetch(url, { headers, redirect: "follow", cache: "no-store", signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) return null;
    const data = new Uint8Array(await resp.arrayBuffer());
    let contentType = (resp.headers.get("content-type") ?? "").trim();
    if (contentType.includes(";")) contentType = contentType.split(";")[0].trim();
    if (!contentType) contentType = detectMimeByData(data);
    return { data, contentType };
  } catch {
    return null;
  }
}
