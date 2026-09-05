import { NextRequest, NextResponse } from "next/server";
import { upstreamHeaders } from "@/lib/web-core";
import { assertPublicHttpUrl } from "@/lib/ssrf-guard";
import { rateLimit, requestIP } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cover_proxy?url=&source= → 图片代理（Cache-Control max-age=21600）
 * 封面为小文件（KB 级）：直接单请求 + 10s 快速失败。
 * 禁用 Range 并行通道（fetchBytesWithMime）：其 probe(30s) + 分块(90s×3 重试)
 * 会长时间占用浏览器同域 6 个并发连接，导致整站请求排队卡死。
 *
 * 审核整改 A-02/A-11（保持免登录听歌链路）：私网地址拦截（SSRF）+ IP 级限流。
 * 限流仅作用于真实回源请求（缓存命中不计次）；一次多源专辑搜索可产生 100+ 张
 * 唯一封面，故额度从 60 提至 240 次/分钟，配合服务端缓存防上游放大。
 */
const COVER_TIMEOUT_MS = 10_000;
const MAX_COVER_BYTES = 8 * 1024 * 1024;
const COVER_RATE_LIMIT = 240;
const COVER_RATE_WINDOW_MS = 60_000;

/** 服务端封面缓存：与浏览器 max-age=21600（6h）对齐，重复渲染/换页零回源 */
const COVER_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** 总字节上限（封面 KB 级，128MB 足够缓存数千张；超出按插入顺序淘汰最旧的） */
const COVER_CACHE_MAX_BYTES = 128 * 1024 * 1024;

interface CoverEntry {
  mime: string;
  /** 精确 ArrayBuffer 视图类型：兼容 BodyInit（TS 5.7+ 的 Uint8Array 泛型区分） */
  body: Uint8Array<ArrayBuffer>;
  at: number;
}

const coverCache = new Map<string, CoverEntry>();
let coverCacheBytes = 0;

function cacheGet(key: string): CoverEntry | null {
  const hit = coverCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > COVER_CACHE_TTL_MS) {
    coverCache.delete(key);
    coverCacheBytes -= hit.body.byteLength;
    return null;
  }
  // Map 按插入序维护 LRU 语义
  coverCache.delete(key);
  coverCache.set(key, hit);
  return hit;
}

function cachePut(key: string, entry: CoverEntry): void {
  const size = entry.body.byteLength;
  if (size > COVER_CACHE_MAX_BYTES) return;
  const prev = coverCache.get(key);
  if (prev) coverCacheBytes -= prev.body.byteLength;
  coverCache.set(key, entry);
  coverCacheBytes += size;
  // 超总容量：从最旧开始逐条淘汰
  while (coverCacheBytes > COVER_CACHE_MAX_BYTES && coverCache.size > 1) {
    const oldest = coverCache.keys().next().value as string;
    const evicted = coverCache.get(oldest);
    coverCache.delete(oldest);
    if (evicted) coverCacheBytes -= evicted.body.byteLength;
  }
}

/** 并发去重（single-flight）：同一 URL 同时到达只回源一次 */
const inflight = new Map<string, Promise<CoverEntry | null>>();

function makeResponse(entry: CoverEntry): NextResponse {
  return new NextResponse(entry.body, {
    status: 200,
    headers: {
      "Content-Type": entry.mime,
      "Cache-Control": "public, max-age=21600",
    },
  });
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const url = (params.get("url") ?? "").trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return new NextResponse("Bad request", { status: 400 });
  }
  const ssrf = await assertPublicHttpUrl(url);
  if (ssrf) {
    return new NextResponse("Forbidden url", { status: 403 });
  }
  const source = (params.get("source") ?? "").trim() || "common";
  const cacheKey = `${source}|${url}`;

  // 缓存命中：不消耗限流额度，直接返回
  const hit = cacheGet(cacheKey);
  if (hit) return makeResponse(hit);

  // 仅对真实回源（miss）限流
  if (!rateLimit(`cover:${requestIP(req)}`, COVER_RATE_LIMIT, COVER_RATE_WINDOW_MS)) {
    return new NextResponse("Too many requests", { status: 429 });
  }

  // single-flight：同 URL 并发请求共享同一次回源
  let flight = inflight.get(cacheKey);
  if (!flight) {
    flight = fetchCover(url, source).finally(() => inflight.delete(cacheKey));
    inflight.set(cacheKey, flight);
  }
  const entry = await flight;
  if (!entry) return new NextResponse("Upstream error", { status: 502 });
  return makeResponse(entry);
}

async function fetchCover(url: string, source: string): Promise<CoverEntry | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COVER_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: upstreamHeaders(source),
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!resp.ok) return null;

    let mime = (resp.headers.get("content-type") ?? "").trim().split(";")[0].trim();
    if (!mime.startsWith("image/")) mime = "image/jpeg";

    const buf = await resp.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > MAX_COVER_BYTES) return null;

    const entry: CoverEntry = { mime, body: new Uint8Array(buf), at: Date.now() };
    cachePut(`${source}|${url}`, entry);
    return entry;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
