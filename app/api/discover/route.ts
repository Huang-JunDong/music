import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider } from "@/lib/registry";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";
import type { Banner, Song } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bannerCache = createTtlCache<Record<string, unknown>>(600_000, 5);
const newSongsCache = createTtlCache<Record<string, unknown>>(300_000, 5);
const dailyCache = createTtlCache<Record<string, unknown>>(60_000, 5);

/**
 * GET /api/discover?kind=banner|new_songs|daily_songs
 * banner      → { banners: Banner[] }（网易）
 * new_songs   → { songs: Song[] }（网易+QQ 交错合并 10 首）
 * daily_songs → { songs: Song[] } 或 { need_login: true }（网易登录每日推荐）
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);

async function getHandler(req: NextRequest) {
  const kind = (req.nextUrl.searchParams.get("kind") ?? "").trim();
  const fp = sourceCookieFingerprint(req);

  if (kind === "banner") {
    const payload = await bannerCache.wrap(fp, async () => {
      const provider = getProvider("netease");
      if (!provider?.getBanners) return { banners: [] as Banner[] };
      try {
        return { banners: (await provider.getBanners()) as Banner[] };
      } catch {
        return { banners: [] as Banner[] };
      }
    });
    return NextResponse.json(payload);
  }

  if (kind === "new_songs") {
    const payload = await newSongsCache.wrap(fp, async () => {
      const results = await Promise.allSettled(
        (["netease", "qq"] as const).map(async (source) => {
          const provider = getProvider(source);
          if (!provider?.getNewSongs) return [] as Song[];
          return (await provider.getNewSongs()).map((s) => ({ ...s, source }));
        }),
      );
      /* 双源交错（网易一首 QQ 一首）取前 10 */
      const songs: Song[] = [];
      for (let i = 0; songs.length < 10; i++) {
        let added = false;
        for (const r of results) {
          if (r.status !== "fulfilled") continue;
          const s = r.value[i];
          if (s) {
            songs.push(s as Song);
            added = true;
          }
        }
        if (!added) break;
      }
      return { songs };
    });
    return NextResponse.json(payload);
  }

  if (kind === "daily_songs") {
    const payload = await dailyCache.wrap(fp, async () => {
      const provider = getProvider("netease");
      if (!provider?.getDailySongs) return { need_login: true };
      try {
        const songs = await provider.getDailySongs();
        return { songs: songs as Song[] };
      } catch (err) {
        if (err instanceof Error && err.message === "NEED_LOGIN") return { need_login: true };
        return { songs: [] as Song[] };
      }
    });
    return NextResponse.json(payload);
  }

  return NextResponse.json({ error: "无效的 kind" }, { status: 400 });
}
