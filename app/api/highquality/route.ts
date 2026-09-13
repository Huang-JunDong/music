import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider } from "@/lib/registry";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";
import type { HighqualityTag, Playlist } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 标签 30min；列表 5min */
const tagCache = createTtlCache<Record<string, unknown>>(1_800_000, 5);
const listCache = createTtlCache<Record<string, unknown>>(300_000, 40);

/**
 * GET /api/highquality?tag=&page=&limit=&with_tags=1 → { playlists, has_more, tags? }
 * 精品歌单 hi-res 专区（网易 top_playlist_highquality + playlist_highquality_tags）。
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);

async function getHandler(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const tag = (params.get("tag") ?? "全部").trim() || "全部";
  const page = Math.max(parseInt(params.get("page") ?? "1", 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "30", 10) || 30, 1), 60);

  const provider = getProvider("netease");
  if (!provider?.getHighqualityPlaylists) {
    return NextResponse.json({ error: "精品歌单仅支持网易云音乐" }, { status: 400 });
  }
  const fp = sourceCookieFingerprint(req);

  const payload = await listCache.wrap(`hq|${tag}|${page}|${limit}|${fp}`, async (): Promise<Record<string, unknown>> => {
    try {
      const r = await provider.getHighqualityPlaylists!(tag, page, limit);
      return { playlists: r.playlists as Playlist[], has_more: r.has_more };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err), playlists: [], has_more: false };
    }
  }, (p) => !p.error);

  let tagsPayload: Record<string, unknown> = {};
  if (params.get("with_tags") === "1" && provider.getHighqualityTags) {
    tagsPayload = await tagCache.wrap(`hq-tags|${fp}`, async () => {
      try {
        const tags = (await provider.getHighqualityTags!()) as HighqualityTag[];
        return { tags: [{ id: "全部", name: "全部", hot: true }, ...tags] };
      } catch {
        return {};
      }
    });
    /* P1 B4：热门歌单分类标签（playlist_hot，网易官方热门标签；失败静默） */
    if (provider.getHotPlaylistTags) {
      const hotPayload = await tagCache.wrap(`hot-tags|${fp}`, async () => {
        try {
          return { hot_tags: (await provider.getHotPlaylistTags!()) as { id: string; name: string; hot?: boolean }[] };
        } catch {
          return {};
        }
      });
      tagsPayload = { ...tagsPayload, ...hotPayload };
    }
  }

  return NextResponse.json({ ...payload, ...tagsPayload });
}
