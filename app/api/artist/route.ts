import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider } from "@/lib/registry";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";
import { rateLimit, requestIP } from "@/lib/rate-limit";
import type { Artist, ArtistOverview, MvItem, Playlist, Song } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 歌手页 5min 缓存（歌手作品集低频变动）；仅缓存成功结果 */
const artistCache = createTtlCache<Record<string, unknown>>(300_000, 60);

const KINDS = new Set(["overview", "songs", "albums", "mvs", "similar", "wiki", "videos"]);

/**
 * GET /api/artist?source=&id=&kind=overview|songs|albums|mvs|similar|wiki|videos&page=&limit=
 * overview → { artist, top_songs }
 * songs    → { songs, has_more }
 * albums   → { albums, has_more }（Playlist[] kind=album）
 * mvs      → { mvs, has_more }
 * similar  → { artists }
 * wiki     → { desc, follower_count }（P1 C2：artist_detail/dynamic + QQ GetSingerDetail/TabDetail）
 * videos   → { videos, has_more }（P1 C2：artist_video，网易专属）
 * POST /api/artist（JSON: { source, id, action: "follow"|"unfollow" }）→ { ok }（P1 C2：artist_sub）
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);
export const POST = (req: NextRequest) => withBrowserSourceSession(req, postHandler);

async function getHandler(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const id = (params.get("id") ?? "").trim();
  const source = (params.get("source") ?? "").trim();
  const rawKind = (params.get("kind") ?? "overview").trim();
  const kind = KINDS.has(rawKind) ? rawKind : "overview";
  const page = Math.max(parseInt(params.get("page") ?? "1", 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "30", 10) || 30, 1), 100);
  if (!id || !source) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }
  const provider = getProvider(source);
  if (!provider?.getArtistOverview) {
    return NextResponse.json({ error: "该源不支持歌手主页" }, { status: 400 });
  }

  /* wiki 为动态图文内容，走独立分支不缓存（审核整改 R2：修正原"写操作绕过缓存"的误导注释） */
  if (kind === "wiki") {
    if (!provider?.getArtistWiki) return NextResponse.json({ error: "该源不支持歌手简介" }, { status: 400 });
    try {
      const r = await provider.getArtistWiki!(id);
      return NextResponse.json(r);
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
    }
  }

  const payload = await artistCache.wrap(
    `${req.nextUrl.search}|${sourceCookieFingerprint(req)}`,
    async (): Promise<Record<string, unknown>> => {
      try {
        if (kind === "overview") {
          const ov: ArtistOverview = await provider.getArtistOverview!(id);
          return { artist: ov.artist, top_songs: ov.top_songs };
        }
        if (kind === "songs") {
          const r = await provider.getArtistSongs!(id, page, limit);
          return { songs: r.songs as Song[], has_more: r.has_more };
        }
        if (kind === "albums") {
          const r = await provider.getArtistAlbums!(id, page, limit);
          return { albums: r.albums as Playlist[], has_more: r.has_more };
        }
        if (kind === "mvs") {
          const r = await provider.getArtistMvs!(id, page, limit);
          return { mvs: r.mvs as MvItem[], has_more: r.has_more };
        }
        if (kind === "videos") {
          if (!provider?.getArtistVideos) throw new Error("歌手视频仅支持网易云音乐");
          const r = await provider.getArtistVideos!(id, page, limit);
          return { videos: r.videos as MvItem[], has_more: r.has_more };
        }
        const artists = await provider.getSimilarArtists!(id);
        return { artists: artists as Artist[] };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
    (p) => !p.error,
  );
  return NextResponse.json(payload);
}

async function postHandler(req: NextRequest) {
  const { checkWriteGuard } = await import("@/lib/write-guard");
  const guard = checkWriteGuard(req);
  if (guard) return guard;
  /* 审核整改 R2-#1：写操作频控 */
  if (!rateLimit(`artist-write:${requestIP(req)}`, 8, 60_000)) {
    return NextResponse.json({ error: "操作过于频繁，请稍后再试" }, { status: 429 });
  }

  let body: { source?: string; id?: string; action?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* ignore */
  }
  const source = (body.source ?? "").trim();
  const id = (body.id ?? "").trim();
  const action = (body.action ?? "").trim();
  if (!source || !id || !["follow", "unfollow"].includes(action)) {
    return NextResponse.json({ error: "参数无效" }, { status: 400 });
  }
  const provider = getProvider(source);
  if (!provider?.followArtist) {
    return NextResponse.json({ error: "该源不支持关注歌手" }, { status: 400 });
  }
  try {
    await provider.followArtist!(id, action === "follow");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "操作失败" }, { status: 502 });
  }
}
