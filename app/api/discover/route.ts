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
const blockCache = createTtlCache<Record<string, unknown>>(300_000, 10);
const privateCache = createTtlCache<Record<string, unknown>>(600_000, 5);
const mvCache = createTtlCache<Record<string, unknown>>(600_000, 5);

/**
 * GET /api/discover?kind=banner|new_songs|daily_songs|blocks|privatecontents|recommended_mvs|daily_playlists|my_liked
 * banner      → { banners: Banner[] }（网易）
 * new_songs   → { songs: Song[] }（网易+QQ 交错合并 10 首）
 * daily_songs → { songs: Song[] } 或 { need_login: true }（网易登录每日推荐）
 * blocks                → { blocks: DiscoverBlock[] }（网易 homepage_block_page + QQ get_home_feed 双源合并）
 * privatecontents       → { banners: Banner[] }（网易独家放送）
 * recommended_mvs       → { mvs: MvItem[] }（网易 personalized_mv）
 * daily_playlists       → { playlists } 或 { need_login: true }（网易 recommend_resource）
 * my_liked              → { playlists }（网易 playlist_mylike，MLOG 视频歌单）
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);

async function getHandler(req: NextRequest) {
  const kind = (req.nextUrl.searchParams.get("kind") ?? "").trim();
  const fp = sourceCookieFingerprint(req);

  if (kind === "blocks") {
    /* 审核整改 R2-#2/#3：失败结果不入缓存（shouldCache）；全部失败时给出 error（不与空态混同） */
    const payload = await blockCache.wrap(fp, async () => {
      const results = await Promise.allSettled(
        (["netease", "qq"] as const).map((source) => {
          const provider = getProvider(source);
          if (!provider?.getHomepageBlocks) return Promise.resolve([]);
          return provider.getHomepageBlocks();
        }),
      );
      const blocks: unknown[] = [];
      let failed = 0;
      for (const r of results) {
        if (r.status === "fulfilled") blocks.push(...r.value);
        else failed++;
      }
      if (!blocks.length && failed) {
        const rejected = results.find((r) => r.status === "rejected");
        const reason = rejected && rejected.status === "rejected" ? rejected.reason : undefined;
        return { blocks, error: reason instanceof Error ? reason.message : "首页区块加载失败" };
      }
      return { blocks };
    }, (p) => !p.error);
    return NextResponse.json(payload);
  }

  if (kind === "privatecontents") {
    const payload = await privateCache.wrap(fp, async () => {
      const provider = getProvider("netease");
      if (!provider?.getPrivateContents) return { banners: [] };
      try {
        return { banners: await provider.getPrivateContents() };
      } catch (err) {
        return { banners: [], error: err instanceof Error ? err.message : "独家放送加载失败" };
      }
    }, (p) => !p.error);
    return NextResponse.json(payload);
  }

  if (kind === "recommended_mvs") {
    const payload = await mvCache.wrap(fp, async () => {
      const provider = getProvider("netease");
      if (!provider?.getRecommendedMvs) return { mvs: [] };
      try {
        return { mvs: await provider.getRecommendedMvs() };
      } catch (err) {
        return { mvs: [], error: err instanceof Error ? err.message : "推荐 MV 加载失败" };
      }
    }, (p) => !p.error);
    return NextResponse.json(payload);
  }

  if (kind === "daily_playlists") {
    const provider = getProvider("netease");
    if (!provider?.getDailyRecommendPlaylists) return NextResponse.json({ need_login: true });
    try {
      return NextResponse.json({ playlists: await provider.getDailyRecommendPlaylists() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      /* 审核整改 R2-#8：非登录类失败透传 error（不与"没有收藏"空态混同） */
      if (/登录/.test(msg)) return NextResponse.json({ need_login: true });
      return NextResponse.json({ playlists: [], error: msg || "每日推荐歌单加载失败" });
    }
  }

  if (kind === "my_liked") {
    const provider = getProvider("netease");
    if (!provider?.getMyLikedPlaylists) return NextResponse.json({ playlists: [] });
    try {
      return NextResponse.json({ playlists: await provider.getMyLikedPlaylists() });
    } catch (err) {
      /* 审核整改 R2-#8：同上 */
      return NextResponse.json({ playlists: [], error: err instanceof Error ? err.message : "收藏歌单加载失败" });
    }
  }

  if (kind === "banner") {
    const payload = await bannerCache.wrap(fp, async () => {
      const provider = getProvider("netease");
      if (!provider?.getBanners) return { banners: [] as Banner[] };
      try {
        return { banners: (await provider.getBanners()) as Banner[] };
      } catch (err) {
        return { banners: [] as Banner[], error: err instanceof Error ? err.message : "横幅加载失败" };
      }
    }, (p) => !p.error);
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
      /* 审核整改 R2-#3：双源全部失败时给出 error */
      if (!songs.length && results.some((r) => r.status === "rejected")) {
        const rejected = results.find((r) => r.status === "rejected");
        const reason = rejected && rejected.status === "rejected" ? rejected.reason : undefined;
        return { songs, error: reason instanceof Error ? reason.message : "新歌速递加载失败" };
      }
      return { songs };
    }, (p) => !p.error);
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
        /* 三审 R3：同 recent 路由——匹配放宽为 /登录/（原 === "NEED_LOGIN" 永不命中） */
        if (err instanceof Error && /登录/.test(err.message)) return { need_login: true };
        return { songs: [] as Song[], error: err instanceof Error ? err.message : "每日推荐加载失败" };
      }
    }, (p) => !p.error && !p.need_login);
    return NextResponse.json(payload);
  }

  return NextResponse.json({ error: "无效的 kind" }, { status: 400 });
}
