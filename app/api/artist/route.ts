import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider } from "@/lib/registry";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";
import type { Artist, ArtistOverview, MvItem, Playlist, Song } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 歌手页 5min 缓存（歌手作品集低频变动）；仅缓存成功结果 */
const artistCache = createTtlCache<Record<string, unknown>>(300_000, 60);

const KINDS = new Set(["overview", "songs", "albums", "mvs", "similar"]);

/**
 * GET /api/artist?source=&id=&kind=overview|songs|albums|mvs|similar&page=&limit=
 * overview → { artist, top_songs }
 * songs    → { songs, has_more }
 * albums   → { albums, has_more }（Playlist[] kind=album）
 * mvs      → { mvs, has_more }
 * similar  → { artists }
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);

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
