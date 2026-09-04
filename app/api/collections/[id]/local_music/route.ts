import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/store";
import { isImported, loadCollection } from "@/lib/collections";
import { LOCAL_MUSIC_SOURCE, localMusicTrackByID } from "@/lib/local-music";
import { checkWriteGuard } from "@/lib/write-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/collections/[id]/local_music {id} — 本地音乐加入收藏歌单（响应对齐 Go SavedSong） */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guarded = checkWriteGuard(req);
  if (guarded) return guarded;

  const { id } = await params;
  const collection = loadCollection(id);
  if (!collection) {
    return NextResponse.json({ error: "歌单不存在" }, { status: 404 });
  }
  if (isImported(collection)) {
    return NextResponse.json(
      { error: "外部导入歌单/专辑不支持直接添加本地音乐" },
      { status: 400 },
    );
  }

  let body: { id?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "缺少本地音乐 ID" }, { status: 400 });
  }
  const trackId = (body?.id ?? "").trim();
  if (!trackId) {
    return NextResponse.json({ error: "缺少本地音乐 ID" }, { status: 400 });
  }

  let track;
  try {
    track = await localMusicTrackByID(trackId);
  } catch {
    return NextResponse.json({ error: "本地音乐不存在或已不在下载目录内" }, { status: 404 });
  }

  let extraStr = "";
  try {
    extraStr = JSON.stringify(track.extra);
  } catch {
    extraStr = "";
  }

  // 对齐 Go：INSERT OR IGNORE（OnConflict DoNothing），RowsAffected=0 → duplicate，
  // 响应 song 为 SavedSong JSON（song_id / extra JSON 字符串 / added_at；重复时 db_id=0）
  const result = getDB()
    .prepare(
      `INSERT OR IGNORE INTO saved_songs (collection_id, song_id, source, extra, name, artist, cover, duration, added_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      collection.id,
      track.id,
      LOCAL_MUSIC_SOURCE,
      extraStr,
      track.name,
      track.artist,
      track.cover,
      track.duration,
      new Date().toISOString(),
    );

  return NextResponse.json({
    status: "ok",
    duplicate: result.changes === 0,
    song: {
      db_id: result.changes === 0 ? 0 : Number(result.lastInsertRowid),
      collection_id: collection.id,
      song_id: track.id,
      source: LOCAL_MUSIC_SOURCE,
      extra: extraStr,
      name: track.name,
      artist: track.artist,
      cover: track.cover,
      duration: track.duration,
      added_at: new Date().toISOString(),
    },
  });
}
