import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider } from "@/lib/registry";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 联想 60s 缓存（高频短词防抖下仍可能重复） */
const suggestCache = createTtlCache<Record<string, unknown>>(60_000, 200);

/**
 * GET /api/search_suggest?q= → { suggestions: string[] }
 * 双源并行合并去重（保持网易优先序），单源失败不影响另一源。
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);

async function getHandler(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ suggestions: [] });

  const payload = await suggestCache.wrap(
    `${q}|${sourceCookieFingerprint(req)}`,
    async (): Promise<Record<string, unknown>> => {
      const results = await Promise.allSettled(
        (["netease", "qq"] as const).map((source) => {
          const provider = getProvider(source);
          if (!provider?.getSearchSuggest) return Promise.resolve([]);
          return provider.getSearchSuggest(q);
        }),
      );
      const seen = new Set<string>();
      const suggestions: string[] = [];
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        for (const kw of r.value) {
          const k = kw.trim();
          if (!k || seen.has(k)) continue;
          seen.add(k);
          suggestions.push(k);
          if (suggestions.length >= 10) break;
        }
        if (suggestions.length >= 10) break;
      }
      /* 双源全部失败（网络故障）不缓存空结果：重试可自愈（审核整改 P2-3） */
      if (results.every((r) => r.status === "rejected")) {
        return { suggestions: [], error: "全部来源加载失败" };
      }
      return { suggestions };
    },
    (p) => !p.error,
  );
  return NextResponse.json(payload);
}
