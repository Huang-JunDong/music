import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider } from "@/lib/registry";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";
import type { UserFollowsResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 关注列表 120s 缓存（低频数据；键含凭证指纹） */
const followsCache = createTtlCache<Record<string, unknown>>(120_000, 30);

/**
 * GET /api/user_follows?source=&uid=&kind=follows|followeds|mutual&page=&limit=
 * → { users, has_more }（网易 user_follows/followeds/mutualfollow_get；QQ 无对应能力）
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);

async function getHandler(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  /* 审核整改 C-01：source 白名单化 */
  const source = params.get("source") === "qq" ? "qq" : "netease";
  const uid = (params.get("uid") ?? "").trim();
  const kind = params.get("kind") === "followeds" ? "followeds" : params.get("kind") === "mutual" ? "mutual" : "follows";
  const page = Math.max(parseInt(params.get("page") ?? "1", 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "30", 10) || 30, 1), 50);

  const provider = getProvider(source);
  if (!provider?.getUserFollows) {
    return NextResponse.json({ error: "该源不支持关注列表" }, { status: 400 });
  }
  if (!uid) {
    return NextResponse.json({ error: "缺少用户 id" }, { status: 400 });
  }

  const payload = await followsCache.wrap(
    `${source}|${uid}|${kind}|${page}|${limit}|${sourceCookieFingerprint(req)}`,
    async (): Promise<Record<string, unknown>> => {
      try {
        const r: UserFollowsResult = await provider.getUserFollows!(uid, kind, page, limit);
        return { users: r.users, has_more: r.has_more };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
    (p) => !p.error,
  );
  return NextResponse.json(payload);
}
