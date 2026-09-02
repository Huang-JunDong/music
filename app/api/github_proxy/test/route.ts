import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_GITHUB_PROXY_URL } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_VERSION = "1.0.0";

/** GET /api/github_proxy/test?proxy= → {ok,proxy_url,target_url,status,latency_ms} */
export async function GET(req: NextRequest) {
  const proxyURL = (req.nextUrl.searchParams.get("proxy") ?? "").trim() || DEFAULT_GITHUB_PROXY_URL;
  const target =
    proxyURL.replace(/\/+$/, "") + "/" + "https://github.com/guohuiyuan/go-music-dl";
  const startedAt = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const resp = await fetch(target, {
      headers: { "User-Agent": `go-music-dl/${APP_VERSION}` },
      signal: controller.signal,
      redirect: "follow",
      cache: "no-store",
    });
    return NextResponse.json({
      ok: resp.status >= 200 && resp.status < 500,
      proxy_url: proxyURL,
      target_url: target,
      status: `${resp.status} ${resp.statusText}`,
      latency_ms: Date.now() - startedAt,
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      proxy_url: proxyURL,
      target_url: target,
      latency_ms: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    clearTimeout(timer);
  }
}
