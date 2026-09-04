import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_GITHUB_PROXY_URL } from "@/lib/store";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_VERSION = "1.0.0";

/** GET /api/github_proxy/test?proxy= → {ok,proxy_url,target_url,status,latency_ms}
 *  审核整改 A-03：纳入鉴权（设置页管理功能；proxy 参数用户可控构成 SSRF 探测面）。 */
export async function GET(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return NextResponse.json(denied.body, { status: denied.status });

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
