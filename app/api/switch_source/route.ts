import { NextRequest, NextResponse } from "next/server";
import { findBestSwitchSong } from "@/lib/switch-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/switch_source?name=&artist=&source=&target=&duration= — 匹配算法见 lib/switch-source.ts（审核整改 A-26 下沉） */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const name = (params.get("name") ?? "").trim();
  const artist = (params.get("artist") ?? "").trim();
  const current = (params.get("source") ?? "").trim();
  const target = (params.get("target") ?? "").trim();
  const origDuration = parseInt((params.get("duration") ?? "").trim(), 10) || 0;

  if (!name) {
    return NextResponse.json({ error: "missing name" }, { status: 400 });
  }

  const result = await findBestSwitchSong(name, artist, current, target, origDuration);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  const { song, score } = result;
  return NextResponse.json({
    id: song.id,
    name: song.name,
    artist: song.artist,
    album: song.album,
    album_id: song.album_id ?? "",
    duration: song.duration,
    source: song.source,
    cover: song.cover,
    extra: song.extra ?? null,
    score,
    link: song.link ?? "",
  });
}
