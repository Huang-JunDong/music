import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider } from "@/lib/registry";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";
import type { DjCategory } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 播客分类 10min / 电台列表 5min 缓存（低频数据） */
const categoryCache = createTtlCache<Record<string, unknown>>(600_000, 10);
const radioCache = createTtlCache<Record<string, unknown>>(300_000, 40);

/**
 * GET /api/podcast?categories=1 → { categories }（网易 dj_catelist + excludehot + recommend）
 * GET /api/podcast?kind=recommend|hot|today&category=&page=&limit= → { radios, has_more }
 * QQ 无播客体系 → 400 单源提示。
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);

async function getHandler(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const provider = getProvider("netease");
  if (!provider?.getDjRadios || !provider?.getDjCategories) {
    return NextResponse.json({ error: "播客电台仅支持网易云音乐" }, { status: 400 });
  }

  if (params.get("categories") === "1") {
    const payload = await categoryCache.wrap(`podcast-categories|${sourceCookieFingerprint(req)}`, async () => {
      try {
        return { categories: (await provider.getDjCategories!()) as DjCategory[] };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }, (p) => !p.error);
    return NextResponse.json(payload);
  }

  const kind = params.get("kind") === "hot" ? "hot" : params.get("kind") === "today" ? "today" : "recommend";
  const category = (params.get("category") ?? "").trim();
  const page = Math.max(parseInt(params.get("page") ?? "1", 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "30", 10) || 30, 1), 60);

  const payload = await radioCache.wrap(
    `${kind}|${category}|${page}|${limit}|${sourceCookieFingerprint(req)}`,
    async (): Promise<Record<string, unknown>> => {
      try {
        const r = await provider.getDjRadios!(kind, category || undefined, page, limit);
        return { radios: r.radios, has_more: r.has_more };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err), radios: [], has_more: false };
      }
    },
    (p) => !p.error,
  );
  return NextResponse.json(payload);
}
