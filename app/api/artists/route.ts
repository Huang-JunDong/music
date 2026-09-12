import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider } from "@/lib/registry";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";
import type { Artist } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 歌手库 10min 缓存（入驻歌手低频变动）；歌手榜 30min */
const libraryCache = createTtlCache<Record<string, unknown>>(600_000, 60);
const toplistCache = createTtlCache<Record<string, unknown>>(1_800_000, 4);

const AREAS = new Set(["全部", "华语", "港台", "欧美", "日本", "韩国", "其他"]);
const SEXES = new Set(["全部", "男", "女", "组合"]);

/**
 * GET /api/artists?source=&area=&sex=&initial=&page=&limit= → { artists, has_more }
 * GET /api/artists?source=netease&kind=toplist&type=1-4 → { artists }（歌手榜，网易专属）
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);

async function getHandler(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const source = params.get("source") === "qq" ? "qq" : "netease";
  const provider = getProvider(source);
  const fp = `${req.nextUrl.search}|${sourceCookieFingerprint(req)}`;

  /* 歌手榜（网易专属） */
  if (params.get("kind") === "toplist") {
    if (source !== "netease" || !provider?.getArtistToplist) {
      return NextResponse.json({ error: "歌手榜仅网易源支持" }, { status: 400 });
    }
    const type = Math.min(Math.max(parseInt(params.get("type") ?? "1", 10) || 1, 1), 4);
    const payload = await toplistCache.wrap(fp, async () => {
      try {
        return { artists: (await provider.getArtistToplist!(type)) as Artist[] };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err), artists: [] };
      }
    });
    return NextResponse.json(payload);
  }

  if (!provider?.getArtistLibrary) {
    return NextResponse.json({ error: "该源不支持歌手库" }, { status: 400 });
  }
  const areaRaw = (params.get("area") ?? "全部").trim();
  const area = AREAS.has(areaRaw) ? areaRaw : "全部";
  const sexRaw = (params.get("sex") ?? "全部").trim();
  const sex = SEXES.has(sexRaw) ? sexRaw : "全部";
  const initialRaw = (params.get("initial") ?? "").trim().toUpperCase();
  const initial = initialRaw === "" || initialRaw === "热门" || /^[A-Z#]$/.test(initialRaw) ? initialRaw : "";
  const page = Math.max(parseInt(params.get("page") ?? "1", 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "60", 10) || 60, 1), 100);

  const payload = await libraryCache.wrap(
    fp,
    async (): Promise<Record<string, unknown>> => {
      try {
        const r = await provider.getArtistLibrary!({ area, sex, initial, page, limit });
        return { artists: r.artists as Artist[], has_more: r.has_more };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err), artists: [], has_more: false };
      }
    },
    (p) => !p.error,
  );
  return NextResponse.json(payload);
}
