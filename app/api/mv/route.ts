import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider } from "@/lib/registry";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";
import { rateLimit, requestIP } from "@/lib/rate-limit";
import type { MvItem } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** MV 详情+播放链接 3min 缓存（播放直链 vkey/网易 url 均短时效，不宜久存）；仅缓存成功结果 */
const mvPlayCache = createTtlCache<Record<string, unknown>>(180_000, 40);

/**
 * GET /api/mv?source=&id=&r= → { mv: MvItem, url: string, error? }
 * 详情与链接并行获取；任一失败即 error（卡片场景调用方自带名称/封面兜底展示）。
 * P1 C7：?sublist=1 → { mvs, has_more }（网易 mv_sublist 收藏列表）
 *        ?similar=1 → { mvs }（网易 simi_mv 相似 MV）
 * POST /api/mv（JSON: { source, id, action: "sub"|"unsub" }）→ { ok }（网易 mv_sub）
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);
export const POST = (req: NextRequest) => withBrowserSourceSession(req, postHandler);

async function getHandler(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const id = (params.get("id") ?? "").trim();
  const source = (params.get("source") ?? "").trim();
  const r = Math.min(Math.max(parseInt(params.get("r") ?? "1080", 10) || 1080, 240), 1080);

  /* P1 C7：收藏 MV 列表（mv_sublist，网易专属） */
  if (params.get("sublist") === "1") {
    const ncm = getProvider("netease");
    const page = Math.max(parseInt(params.get("page") ?? "1", 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "30", 10) || 30, 1), 100);
    if (!ncm?.getSubbedMvs) return NextResponse.json({ error: "收藏 MV 仅支持网易云音乐" }, { status: 400 });
    try {
      const result = await ncm.getSubbedMvs!(page, limit);
      return NextResponse.json(result);
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
    }
  }

  /* P1 C7：相似 MV（simi_mv，网易专属） */
  if (params.get("similar") === "1") {
    /* 审核整改 R2-#5：缺 id 返回 400（不与空结果混同）；失败透传（对齐 sublist 分支风格） */
    if (!id) return NextResponse.json({ error: "Missing params" }, { status: 400 });
    const ncm = getProvider("netease");
    if (!ncm?.getSimilarMvs) return NextResponse.json({ error: "相似 MV 仅支持网易云音乐" }, { status: 400 });
    try {
      return NextResponse.json({ mvs: await ncm.getSimilarMvs(id) });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
    }
  }

  if (!id || !source) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }
  const provider = getProvider(source);
  if (!provider?.getMvUrl) {
    return NextResponse.json({ error: "该源不支持 MV 播放" }, { status: 400 });
  }

  const payload = await mvPlayCache.wrap(
    `${source}|${id}|${r}|${sourceCookieFingerprint(req)}`,
    async (): Promise<Record<string, unknown>> => {
      const [detailRes, urlRes] = await Promise.allSettled([
        provider.getMvDetail ? provider.getMvDetail(id) : Promise.resolve(null),
        provider.getMvUrl!(id, r),
      ]);

      let mv: MvItem | null = null;
      let error = "";
      if (detailRes.status === "fulfilled") mv = detailRes.value;
      if (urlRes.status === "rejected") {
        const err = urlRes.reason;
        error = err instanceof Error ? err.message : String(err);
      }

      const result: Record<string, unknown> = {
        mv: mv ?? { source, id, name: (params.get("name") ?? "").trim() },
        url: urlRes.status === "fulfilled" ? urlRes.value : "",
      };
      if (error) result.error = error;
      return result;
    },
    (p) => !p.error,
  );
  return NextResponse.json(payload);
}

/** P1 C7：收藏/取消收藏 MV（mv_sub，网易专属） */
async function postHandler(req: NextRequest) {
  const { checkWriteGuard } = await import("@/lib/write-guard");
  const guard = checkWriteGuard(req);
  if (guard) return guard;
  /* 审核整改 R2-#1：写操作频控 */
  if (!rateLimit(`mv-write:${requestIP(req)}`, 8, 60_000)) {
    return NextResponse.json({ error: "操作过于频繁，请稍后再试" }, { status: 429 });
  }

  let body: { source?: string; id?: string; action?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* ignore */
  }
  const id = (body.id ?? "").trim();
  const action = (body.action ?? "").trim();
  if (!id || !["sub", "unsub"].includes(action)) {
    return NextResponse.json({ error: "参数无效" }, { status: 400 });
  }
  const ncm = getProvider("netease");
  if (!ncm?.subMv) {
    return NextResponse.json({ error: "收藏 MV 仅支持网易云音乐" }, { status: 400 });
  }
  try {
    await ncm.subMv!(id, action === "sub");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "操作失败" }, { status: 502 });
  }
}
