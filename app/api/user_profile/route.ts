import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider } from "@/lib/registry";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";
import type { UserProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 用户资料 60s 缓存（键含凭证指纹，他人主页 uid 一并入键） */
const profileCache = createTtlCache<Record<string, unknown>>(60_000, 30);

/**
 * GET /api/user_profile?source=&uid= → { profile }
 * uid 省略 = 当前登录用户（需登录）。QQ 源复用登录档案（getLoginProfile/getHomepage）。
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);

async function getHandler(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  /* 审核整改 C-01：source 白名单化 */
  const source = params.get("source") === "qq" ? "qq" : "netease";
  const uid = (params.get("uid") ?? "").trim();

  const provider = getProvider(source);
  if (!provider?.getUserProfile) {
    return NextResponse.json({ error: "该源不支持用户资料" }, { status: 400 });
  }

  const payload = await profileCache.wrap(
    `${source}|${uid}|${sourceCookieFingerprint(req)}`,
    async (): Promise<Record<string, unknown>> => {
      try {
        return { profile: (await provider.getUserProfile!(uid || undefined)) as UserProfile };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
    (p) => !p.error,
  );
  return NextResponse.json(payload);
}
