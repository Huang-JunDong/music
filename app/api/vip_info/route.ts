import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider } from "@/lib/registry";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";
import type { UserVipInfo } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** VIP 信息 60s 缓存（审核整改 C-05：原 5min 无写后失效通路——签到后状态陈旧窗口过长，
 * 收敛至 60s 对齐 user_profile；错误态经 shouldCache 拦截不入缓存） */
const vipInfoCache = createTtlCache<Record<string, unknown>>(60_000, 30);

/**
 * GET /api/vip_info?source= → { vip }（网易 vip_info(_v2)+乐签 · QQ vip_login_base）
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);

async function getHandler(req: NextRequest) {
  /* 审核整改 C-01：source 白名单化 */
  const source = req.nextUrl.searchParams.get("source") === "qq" ? "qq" : "netease";
  const provider = getProvider(source);
  if (!provider?.getUserVipInfo) {
    return NextResponse.json({ error: "该源不支持 VIP 信息" }, { status: 400 });
  }

  const payload = await vipInfoCache.wrap(
    `${source}|${sourceCookieFingerprint(req)}`,
    async (): Promise<Record<string, unknown>> => {
      try {
        return { vip: (await provider.getUserVipInfo!()) as UserVipInfo };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
    (p) => !p.error,
  );
  return NextResponse.json(payload);
}
