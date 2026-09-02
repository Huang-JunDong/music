import { NextRequest, NextResponse } from "next/server";
import { isSongDownloaded, loadDownloadDedupSet } from "@/lib/download-record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/downloads/precheck {songs:[{name,artist}]} → {total,skipped}（≤20000 首，字段≤500 字符） */
export async function POST(req: NextRequest) {
  let body: { songs?: { name?: string; artist?: string }[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const songs = Array.isArray(body?.songs) ? body.songs : [];
  if (songs.length > 20000) {
    return NextResponse.json({ error: "歌曲数量不能超过 20000" }, { status: 400 });
  }
  for (const song of songs) {
    if ((song?.name ?? "").length > 500 || (song?.artist ?? "").length > 500) {
      return NextResponse.json({ error: "歌曲名或歌手名长度不能超过 500 字符" }, { status: 400 });
    }
  }

  const dedupSet = loadDownloadDedupSet();
  let skipped = 0;
  for (const song of songs) {
    if (isSongDownloaded(song?.name ?? "", song?.artist ?? "", dedupSet)) skipped++;
  }
  return NextResponse.json({ total: songs.length, skipped });
}
