import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider } from "@/lib/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/followed_artists?source=&page=&limit= → { artists, has_more, error? }
 * P1 C2：已关注歌手（网易 artist_sublist · QQ GetFollowSingerList）；个人数据不缓存。
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);

async function getHandler(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const source = params.get("source") === "qq" ? "qq" : "netease";
  const page = Math.max(parseInt(params.get("page") ?? "1", 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "30", 10) || 30, 1), 100);

  const provider = getProvider(source);
  if (!provider?.getFollowedArtists) {
    return NextResponse.json({ error: "该源不支持关注歌手列表" }, { status: 400 });
  }
  try {
    const r = await provider.getFollowedArtists!(page, limit);
    return NextResponse.json(r);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    /* 对齐 /api/recent 约定：未登录 200 + need_login（前端登录引导） */
    if (/登录/.test(msg)) return NextResponse.json({ need_login: true });
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
