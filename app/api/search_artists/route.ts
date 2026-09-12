import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider } from "@/lib/registry";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";
import type { Artist } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 歌手搜索 5min 缓存 */
const artistSearchCache = createTtlCache<Record<string, unknown>>(300_000, 60);

/**
 * GET /api/search_artists?q=&sources= → { artists: Artist[] }
 * 双源并行聚合（网易 cloudsearch type=100 · QQ SINGER），单源失败不影响另一源。
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);

async function getHandler(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ artists: [] });
  const sources = ["netease", "qq"];

  const payload = await artistSearchCache.wrap(
    `${q}|${sources.join(",")}|${sourceCookieFingerprint(req)}`,
    async (): Promise<Record<string, unknown>> => {
      const results = await Promise.allSettled(
        sources.map(async (source) => {
          const provider = getProvider(source);
          if (!provider?.searchArtists) return [] as Artist[];
          return (await provider.searchArtists(q)).map((a) => ({ ...a, source }));
        }),
      );
      const artists: Artist[] = [];
      /* 交替合并（网易一首 QQ 一首）保持双源曝光均衡 */
      for (let i = 0; ; i++) {
        let added = false;
        for (const r of results) {
          if (r.status !== "fulfilled") continue;
          const a = r.value[i];
          if (a) {
            artists.push(a);
            added = true;
          }
        }
        if (!added || artists.length >= 12) break;
      }
      /* 双源全部失败（网络故障）不缓存空结果：重试可自愈（审核整改 P2-3） */
      if (results.every((r) => r.status === "rejected")) {
        return { artists: [], error: "全部来源加载失败" };
      }
      return { artists };
    },
    (p) => !p.error,
  );
  return NextResponse.json(payload);
}
