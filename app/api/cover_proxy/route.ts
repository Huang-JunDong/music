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
 * 审核整改 A-02/A-11（保持免登录听歌链路）：私网地址拦截（SSRF）+ IP 级限流（60 次/分钟）。
 */
const COVER_TIMEOUT_MS = 10_000;
const MAX_COVER_BYTES = 8 * 1024 * 1024;
const COVER_RATE_LIMIT = 60;
const COVER_RATE_WINDOW_MS = 60_000;

export async function GET(req: NextRequest) {
  if (!rateLimit(`cover:${requestIP(req)}`, COVER_RATE_LIMIT, COVER_RATE_WINDOW_MS)) {
    return new NextResponse("Too many requests", { status: 429 });
  }

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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COVER_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: upstreamHeaders(source),
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!resp.ok) return new NextResponse("Upstream error", { status: 502 });

    let mime = (resp.headers.get("content-type") ?? "").trim().split(";")[0].trim();
    if (!mime.startsWith("image/")) mime = "image/jpeg";

    const buf = await resp.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > MAX_COVER_BYTES) {
      return new NextResponse("Upstream error", { status: 502 });
    }

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Cache-Control": "public, max-age=21600",
      },
    });
  } catch {
    return new NextResponse("Upstream error", { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
