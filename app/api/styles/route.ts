import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider } from "@/lib/registry";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 曲风树 30min 缓存（极低频）；偏好 60s */
const styleCache = createTtlCache<Record<string, unknown>>(1_800_000, 5);
const prefCache = createTtlCache<Record<string, unknown>>(60_000, 10);

/**
 * GET /api/styles → { tags, top_tags, preferences? }（网易 style_list 两级树 + style_preference）
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);

async function getHandler(req: NextRequest) {
  const provider = getProvider("netease");
  if (!provider?.getStyles) {
    return NextResponse.json({ error: "曲风探索仅支持网易云音乐" }, { status: 400 });
  }
  const fp = sourceCookieFingerprint(req);

  const payload = await styleCache.wrap(`styles|${fp}`, async (): Promise<Record<string, unknown>> => {
    try {
      const tags = await provider.getStyles!();
      const top = tags.filter((t) => !t.parent_id);
      return { tags, top_tags: top };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }, (p) => !p.error);

  /* 偏好为登录数据，独立加载不阻塞主树 */
  const prefPayload = await prefCache.wrap(`style-pref|${fp}`, async () => {
    try {
      return { preferences: await provider.getStylePreferences!() };
    } catch {
      return {};
    }
  });

  return NextResponse.json({ ...payload, ...prefPayload });
}
