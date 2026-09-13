import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider } from "@/lib/registry";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 详情头 30min；四类资源 5min */
const detailCache = createTtlCache<Record<string, unknown>>(1_800_000, 20);
const resourceCache = createTtlCache<Record<string, unknown>>(300_000, 60);

/**
 * GET /api/styles/detail?id=&kind=meta|song|album|artist|playlist&page=&limit=
 * → { style? , songs?/albums?/artists?/playlists?, has_more }
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);

async function getHandler(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const id = (params.get("id") ?? "").trim();
  if (!id) return NextResponse.json({ error: "缺少曲风 id" }, { status: 400 });
  const kind = params.get("kind") ?? "meta";
  const page = Math.max(parseInt(params.get("page") ?? "1", 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "30", 10) || 30, 1), 100);

  const provider = getProvider("netease");
  if (!provider?.getStyleDetail) {
    return NextResponse.json({ error: "曲风探索仅支持网易云音乐" }, { status: 400 });
  }
  const fp = sourceCookieFingerprint(req);

  if (kind === "meta") {
    const payload = await detailCache.wrap(`style-meta|${id}|${fp}`, async () => {
      try {
        return { style: await provider.getStyleDetail!(id) };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }, (p) => !p.error);
    return NextResponse.json(payload);
  }

  const payload = await resourceCache.wrap(`style-${kind}|${id}|${page}|${limit}|${fp}`, async (): Promise<Record<string, unknown>> => {
    try {
      switch (kind) {
        case "song": {
          const r = await provider.getStyleSongs!(id, page, limit);
          return { songs: r.songs, has_more: r.has_more };
        }
        case "album": {
          const r = await provider.getStyleAlbums!(id, page, limit);
          return { albums: r.albums, has_more: r.has_more };
        }
        case "artist": {
          const r = await provider.getStyleArtists!(id, page, limit);
          return { artists: r.artists, has_more: r.has_more };
        }
        case "playlist": {
          const r = await provider.getStylePlaylists!(id, page, limit);
          return { playlists: r.playlists, has_more: r.has_more };
        }
        default:
          return { error: "无效的 kind" };
      }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }, (p) => !p.error);
  return NextResponse.json(payload);
}
