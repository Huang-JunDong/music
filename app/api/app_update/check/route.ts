import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_GITHUB_PROXY_URL, getWebSettings } from "@/lib/store";
import { requireAuth } from "@/lib/auth";
import { checkAppUpdate } from "@/lib/app-update";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/app_update/check?repo=&proxy=&use_proxy= — 版本比较与资产打分见 lib/app-update.ts。
 * 审核整改 A-04：纳入鉴权（设置页管理功能，且 proxy 参数可控构成 SSRF 面）。
 */
export async function GET(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return NextResponse.json(denied.body, { status: denied.status });

  const params = req.nextUrl.searchParams;
  const settings = getWebSettings();
  const repoURL = (params.get("repo") ?? "").trim() || settings.updateRepoUrl;
  const proxyURL = (params.get("proxy") ?? "").trim() || settings.githubProxyUrl || DEFAULT_GITHUB_PROXY_URL;
  let proxyEnabled = settings.githubProxyEnabled;
  const rawUseProxy = (params.get("use_proxy") ?? "").trim();
  if (rawUseProxy) proxyEnabled = rawUseProxy === "1" || rawUseProxy.toLowerCase() === "true";

  try {
    const result = await checkAppUpdate({ repoURL, proxyURL, proxyEnabled });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
