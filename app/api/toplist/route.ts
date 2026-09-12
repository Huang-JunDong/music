import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider } from "@/lib/registry";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";
import type { Song, Toplist } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 榜单曲目 10min 缓存（官方榜日更/周更，重复访问秒回）；仅缓存成功结果 */
const toplistCache = createTtlCache<Record<string, unknown>>(600_000, 40);

/**
 * GET /api/toplist?source=&id= → {toplist, songs, error?}
 * toplist 元信息来自 query（name/cover/update_time），缺失字段由各源 provider 无法单榜查询时留空——
 * 前端从榜单目录卡片跳转时始终携带，刷新场景直接复用缓存。
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);

async function getHandler(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const id = params.get("id") ?? "";
  const source = params.get("source") ?? "";
  if (!id || !source) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }
  const provider = getProvider(source);
  if (!provider?.getToplistSongs) {
    return NextResponse.json({ error: "该源不支持查看榜单详情" }, { status: 400 });
  }

  const payload = await toplistCache.wrap(
    `${req.nextUrl.search}|${sourceCookieFingerprint(req)}`,
    async (): Promise<Record<string, unknown>> => {
      let songs: Song[] = [];
      let error = "";
      try {
        songs = (await provider.getToplistSongs!(id)).map((s) => ({ ...s, source: s.source || source }));
      } catch (err) {
        error = `获取榜单失败: ${err instanceof Error ? err.message : String(err)}`;
      }

      const toplist: Toplist = {
        source,
        id,
        name: (params.get("name") ?? "").trim(),
        cover: (params.get("cover") ?? "").trim(),
        update_time: (params.get("update_time") ?? "").trim(),
        description: (params.get("description") ?? "").trim(),
        track_count: parseInt(params.get("track_count") ?? "", 10) || songs.length,
      };

      const result: Record<string, unknown> = { toplist, songs };
      if (error) result.error = error;
      return result;
    },
    (p) => !p.error,
  );
  return NextResponse.json(payload);
}
