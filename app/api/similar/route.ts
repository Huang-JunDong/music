import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider, songFromParams } from "@/lib/registry";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";
import type { Playlist, Song } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 相似推荐 10min 缓存（推荐结果稳定） */
const similarCache = createTtlCache<Record<string, unknown>>(600_000, 60);

/**
 * GET /api/similar?source=&id=&song参数集&kind=songs|playlists|users →
 *   { songs: Song[] } / { playlists: Playlist[] } / { users: FollowUser[] }（单源失败返回空数组而非错误）
 * P1 C4：kind=users → 听过此歌的用户（网易 simi_user，相似弹窗扩展）。
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);

async function getHandler(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const song = songFromParams(params);
  const rawKind = params.get("kind");
  const kind = rawKind === "playlists" ? "playlists" : rawKind === "users" ? "users" : "songs";
  if (!song.id || !song.source) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }
  const provider = getProvider(song.source);

  const payload = await similarCache.wrap(
    `${req.nextUrl.search}|${sourceCookieFingerprint(req)}`,
    async (): Promise<Record<string, unknown>> => {
      try {
        if (!provider) return kind === "songs" ? { songs: [] } : kind === "playlists" ? { playlists: [] } : { users: [] };
        if (kind === "songs") {
          if (!provider.getSimilarSongs) return { songs: [] };
          return { songs: (await provider.getSimilarSongs(song)) as Song[] };
        }
        if (kind === "users") {
          if (!provider.getSimilarUsers) return { users: [] };
          return { users: await provider.getSimilarUsers(song) };
        }
        if (!provider.getRelatedPlaylists) return { playlists: [] };
        return { playlists: (await provider.getRelatedPlaylists(song)) as Playlist[] };
      } catch (err) {
        /* 相似推荐属增强功能：失败静默空（前端隐藏该区） */
        const empty = kind === "songs" ? { songs: [] } : kind === "playlists" ? { playlists: [] } : { users: [] };
        return { ...empty, error: err instanceof Error ? err.message : String(err) };
      }
    },
    /* 失败（error 载荷）不缓存：重试可自愈（审核整改 P2-3） */
    (p) => !p.error,
  );
  return NextResponse.json(payload);
}
