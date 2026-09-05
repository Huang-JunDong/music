import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider } from "@/lib/registry";
import { pickBestAlbumMatch } from "@/lib/song-meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/album_jump?name=&artist=&source=
 * 搜索专辑 → pickBestAlbumMatch → 302 到 /album?id=&source=
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);

async function getHandler(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const name = (params.get("name") ?? "").trim();
  const artist = (params.get("artist") ?? "").trim();
  const source = (params.get("source") ?? "").trim();
  if (!name || !source) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const provider = getProvider(source);
  if (!provider?.searchAlbum) {
    return NextResponse.json({ error: "该源不支持查看专辑详情" }, { status: 400 });
  }

  let albums;
  try {
    albums = (await provider.searchAlbum(name)).map((a) => ({ ...a, source }));
  } catch (err) {
    return NextResponse.json(
      { error: `获取专辑失败: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
  if (!albums.length) {
    return NextResponse.json({ error: "未找到匹配的专辑" }, { status: 404 });
  }

  const selected = pickBestAlbumMatch(name, artist, albums);
  if (!selected || !(selected.id ?? "").trim()) {
    return NextResponse.json({ error: "未找到可跳转的专辑详情" }, { status: 404 });
  }

  const target = new URL(
    `/album?id=${encodeURIComponent(selected.id.trim())}&source=${encodeURIComponent(source)}`,
    req.nextUrl.origin,
  );
  return NextResponse.redirect(target, 302);
}
