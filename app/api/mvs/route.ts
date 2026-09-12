import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider, GetSourceDescription } from "@/lib/registry";
import { filterAvailableSources, sourcesFromQuery } from "@/lib/web-core";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";
import type { MvItem, MvListResult, MvListTab } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** MV 列表 5min 缓存（最新MV时效高，取中庸值）；仅缓存成功结果 */
const mvListCache = createTtlCache<Record<string, unknown>>(300_000, 60);

const VALID_TABS = new Set<string>(["latest", "exclusive", "top", "all"]);

/**
 * GET /api/mvs?source=&tab=latest|exclusive|top|all&area=&page=&limit= →
 *   { source, source_name, tab, area, mvs, has_more, error? }
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);

async function getHandler(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const sources = filterAvailableSources(sourcesFromQuery(params), ["netease", "qq"]);
  const source = sources[0] ?? "netease";
  const rawTab = (params.get("tab") ?? "latest").trim();
  const tab = (VALID_TABS.has(rawTab) ? rawTab : "latest") as MvListTab;
  const area = (params.get("area") ?? "全部").trim() || "全部";
  const page = Math.max(parseInt(params.get("page") ?? "1", 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "30", 10) || 30, 1), 50);

  const provider = getProvider(source);
  if (!provider?.getMvList) {
    return NextResponse.json({ error: "该源不支持 MV" }, { status: 400 });
  }

  const payload = await mvListCache.wrap(
    `${req.nextUrl.search}|${sourceCookieFingerprint(req)}`,
    async (): Promise<Record<string, unknown>> => {
      let result: MvListResult = { mvs: [], has_more: false };
      let error = "";
      try {
        result = await provider.getMvList!({ tab, area, page, limit });
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
      return {
        source,
        source_name: GetSourceDescription(source),
        tab,
        area,
        mvs: result.mvs as MvItem[],
        has_more: result.has_more,
        ...(error ? { error } : {}),
      };
    },
    (p) => !p.error,
  );
  return NextResponse.json(payload);
}
