import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider, GetSourceDescription } from "@/lib/registry";
import { filterAvailableSources, TOPLIST_SOURCE_NAMES, sourcesFromQuery } from "@/lib/web-core";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";
import type { Toplist } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 榜单目录 10min 缓存（榜单目录低频变动：官方榜日更/周更）；仅缓存无失败 tab 的结果；
 *  key 含音源凭证指纹防跨账号串数据 */
const toplistsCache = createTtlCache<Record<string, unknown>>(600_000, 20);

/**
 * GET /api/toplists?sources= → {tabs:[{source,name,count,toplists,error?}], error?}
 * 汇总 error 语义对齐 /api/recommend：全部失败/部分失败聚合文案。
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);

async function getHandler(req: NextRequest) {
  const sources = filterAvailableSources(
    sourcesFromQuery(req.nextUrl.searchParams),
    TOPLIST_SOURCE_NAMES,
  );

  const payload = await toplistsCache.wrap(
    `${sources.join(",")}|${sourceCookieFingerprint(req)}`,
    async (): Promise<Record<string, unknown>> => {
      const results = await Promise.allSettled(
        sources.map(async (source) => {
          const provider = getProvider(source);
          if (!provider?.getToplists) {
            throw new Error("该源不支持排行榜");
          }
          const toplists = await provider.getToplists();
          return toplists.map((t) => ({ ...t, source })) as Toplist[];
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
          tab.toplists = result.value;
        } else {
          tab.count = 0;
          tab.toplists = [];
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

      const result: Record<string, unknown> = { tabs };
      if (error) result.error = error;
      return result;
    },
    // 有失败 tab 不缓存：重试可自愈
    (p) => !p.error,
  );
  return NextResponse.json(payload);
}
