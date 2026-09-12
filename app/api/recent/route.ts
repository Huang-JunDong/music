import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider } from "@/lib/registry";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";
import type { Playlist, Song } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 源账号最近播放 60s 缓存（scrobble 埋点持续更新，TTL 短保新鲜） */
const recentCache = createTtlCache<Record<string, unknown>>(60_000, 20);

/**
 * GET /api/recent?kind=song|album|playlist&limit= →
 *   { songs } / { albums } / { playlists } / { need_login: true }（网易账号）
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);

async function getHandler(req: NextRequest) {
  const kind = (req.nextUrl.searchParams.get("kind") ?? "song").trim();
  if (kind !== "song" && kind !== "album" && kind !== "playlist") {
    return NextResponse.json({ error: "无效的 kind（song|album|playlist）" }, { status: 400 });
  }
  const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10) || 50, 1), 100);
  const provider = getProvider("netease");

  const payload = await recentCache.wrap(
    `${kind}|${limit}|${sourceCookieFingerprint(req)}`,
    async (): Promise<Record<string, unknown>> => {
      try {
        if (!provider) return { error: "provider missing" };
        if (kind === "song") {
          if (!provider.getRecentSongs) return { songs: [] };
          return { songs: (await provider.getRecentSongs(limit)) as Song[] };
        }
        if (kind === "album") {
          if (!provider.getRecentAlbums) return { albums: [] };
          return { albums: (await provider.getRecentAlbums(limit)) as Playlist[] };
        }
        if (kind === "playlist") {
          if (!provider.getRecentPlaylists) return { playlists: [] };
          return { playlists: (await provider.getRecentPlaylists(limit)) as Playlist[] };
        }
        return { songs: [] };
      } catch (err) {
        if (err instanceof Error && err.message === "NEED_LOGIN") return { need_login: true };
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
    (p) => !p.error,
  );
  return NextResponse.json(payload);
}
