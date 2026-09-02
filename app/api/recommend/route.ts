import { NextRequest, NextResponse } from "next/server";
import { getProvider, GetSourceDescription } from "@/lib/registry";
import { filterAvailableSources, RECOMMEND_SOURCE_NAMES, sourcesFromQuery } from "@/lib/web-core";
import type { Playlist } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/recommend?sources= → {tabs:[{source,name,count,playlists,error?}], error?}
 * 汇总 error 对齐 Go loadPlaylistSourceTabs：
 * 全部失败 → "全部来源加载失败：a、b"；部分失败 → "部分来源加载失败：a、b"
 */
export async function GET(req: NextRequest) {
  const sources = filterAvailableSources(
    sourcesFromQuery(req.nextUrl.searchParams),
    RECOMMEND_SOURCE_NAMES,
  );

  const results = await Promise.allSettled(
    sources.map(async (source) => {
      const provider = getProvider(source);
      if (!provider?.getRecommendedPlaylists) {
        throw new Error("该源不支持推荐歌单");
      }
      const playlists = await provider.getRecommendedPlaylists();
      return playlists.map((p) => ({ ...p, source })) as Playlist[];
    }),
  );

  const tabs = results.map((result, i) => {
    const source = sources[i];
    const tab: Record<string, unknown> = {
      source,
      name: GetSourceDescription(source),
    };
    if (result.status === "fulfilled") {
      tab.count = result.value.length;
      tab.playlists = result.value;
    } else {
      tab.count = 0;
      tab.playlists = [];
      tab.error = result.reason instanceof Error ? result.reason.message : String(result.reason);
    }
    return tab;
  });

  const failed = tabs.filter((t) => (t as { error?: string }).error).map((t) => (t as { name: string }).name);
  let error = "";
  if (failed.length === tabs.length && tabs.length > 0) {
    error = `全部来源加载失败：${failed.join("、")}`;
  } else if (failed.length > 0) {
    error = `部分来源加载失败：${failed.join("、")}`;
  }

  const payload: Record<string, unknown> = { tabs };
  if (error) payload.error = error;
  return NextResponse.json(payload);
}
