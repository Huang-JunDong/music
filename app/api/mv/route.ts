import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider } from "@/lib/registry";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";
import type { MvItem } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** MV 详情+播放链接 3min 缓存（播放直链 vkey/网易 url 均短时效，不宜久存）；仅缓存成功结果 */
const mvPlayCache = createTtlCache<Record<string, unknown>>(180_000, 40);

/**
 * GET /api/mv?source=&id=&r= → { mv: MvItem, url: string, error? }
 * 详情与链接并行获取；任一失败即 error（卡片场景调用方自带名称/封面兜底展示）。
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);

async function getHandler(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const id = (params.get("id") ?? "").trim();
  const source = (params.get("source") ?? "").trim();
  const r = Math.min(Math.max(parseInt(params.get("r") ?? "1080", 10) || 1080, 240), 1080);
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
