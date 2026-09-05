import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider, GetSourceDescription } from "@/lib/registry";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 分类歌单（单次拉 120 条）：5min 缓存 + 并发去重，分类页往返导航零回源；仅缓存成功结果 */
const categoryPlaylistsCache = createTtlCache<Record<string, unknown>>(300_000, 100);

/** GET /api/category_playlists?source=&category_id=&category_name= → {playlists:[...]} */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);

async function getHandler(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const source = (params.get("source") ?? "").trim();
  const categoryID = (params.get("category_id") ?? "").trim();
  let categoryName = (params.get("category_name") ?? "").trim();
  if (!categoryName) categoryName = categoryID;
  if (!categoryName) categoryName = "全部";

  const provider = getProvider(source);
  if (!source || !provider?.getCategoryPlaylists) {
    return NextResponse.json({ error: "该源不支持歌单分类" }, { status: 400 });
  }

  let upstreamError = "";
  const payload = await categoryPlaylistsCache.wrap(
    `${req.nextUrl.search}|${sourceCookieFingerprint(req)}`,
    async (): Promise<Record<string, unknown>> => {
      try {
        const playlists = (await provider.getCategoryPlaylists!(categoryID, 1, 120)).map((p) => ({
          ...p,
          source,
        }));
        return {
          playlists,
          source,
          source_name: GetSourceDescription(source),
          category_id: categoryID,
          category_name: categoryName,
        };
      } catch (err) {
        upstreamError = err instanceof Error ? err.message : String(err);
        return { error: `获取分类歌单失败: ${upstreamError}` };
      }
    },
    // 失败结果不缓存
    (p) => !p.error,
  );
  if (upstreamError && payload.error) {
    return NextResponse.json(payload, { status: 502 });
  }
  return NextResponse.json(payload);
}
