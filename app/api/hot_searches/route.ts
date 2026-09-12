import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider, GetSourceDescription } from "@/lib/registry";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";
import type { HotSearch } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 热搜榜 10min 缓存（热搜小时级更新）；仅缓存无失败 tab 的结果 */
const hotSearchCache = createTtlCache<Record<string, unknown>>(600_000, 10);

/**
 * GET /api/hot_searches?sources= → {tabs:[{source,name,count,hot_searches,error?}], error?}
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);

async function getHandler(req: NextRequest) {
  const sources = ["netease", "qq"];
  const payload = await hotSearchCache.wrap(
    `${sources.join(",")}|${sourceCookieFingerprint(req)}`,
    async (): Promise<Record<string, unknown>> => {
      const results = await Promise.allSettled(
        sources.map(async (source) => {
          const provider = getProvider(source);
          if (!provider?.getHotSearches) throw new Error("该源不支持热搜");
          return (await provider.getHotSearches()).map((h) => ({ ...h, source })) as HotSearch[];
        }),
      );

      const tabs = results.map((result, i) => {
        const source = sources[i];
        const tab: Record<string, unknown> = { source, name: GetSourceDescription(source) };
        if (result.status === "fulfilled") {
          tab.count = result.value.length;
          tab.hot_searches = result.value;
          /* 默认搜索词：网易 search_default 接口；QQ 无独立接口，取热搜首位 */
          tab.default_keyword = result.value[0]?.keyword ?? "";
        } else {
          tab.count = 0;
          tab.hot_searches = [];
          tab.error = result.reason instanceof Error ? result.reason.message : String(result.reason);
        }
        return tab;
      });

      /* 网易默认词单独拉取（showKeyword 优先于热搜首位），失败降级热搜首位 */
      const neteaseProvider = getProvider("netease");
      if (neteaseProvider?.getDefaultSearchKeyword) {
        const kw = await neteaseProvider.getDefaultSearchKeyword().catch(() => null);
        const tab = tabs.find((t) => t.source === "netease");
        if (tab && kw) tab.default_keyword = kw;
      }

      const failed = tabs.filter((t) => (t as { error?: string }).error).map((t) => (t as { name: string }).name);
      let error = "";
      if (failed.length === tabs.length) error = `全部来源加载失败：${failed.join("、")}`;
      else if (failed.length > 0) error = `部分来源加载失败：${failed.join("、")}`;

      const result: Record<string, unknown> = { tabs };
      if (error) result.error = error;
      return result;
    },
    (p) => !p.error,
  );
  return NextResponse.json(payload);
}
