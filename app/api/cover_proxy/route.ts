import { NextRequest, NextResponse } from "next/server";
import { upstreamHeaders } from "@/lib/web-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cover_proxy?url=&source= → 图片代理（Cache-Control max-age=21600）
 * 封面为小文件（KB 级）：直接单请求 + 10s 快速失败。
 * 禁用 Range 并行通道（fetchBytesWithMime）：其 probe(30s) + 分块(90s×3 重试)
 * 会长时间占用浏览器同域 6 个并发连接，导致整站请求排队卡死。
 */
const COVER_TIMEOUT_MS = 10_000;
const MAX_COVER_BYTES = 8 * 1024 * 1024;

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const url = (params.get("url") ?? "").trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return new NextResponse("Bad request", { status: 400 });
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
