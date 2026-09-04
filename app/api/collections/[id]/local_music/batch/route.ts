import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/store";
import { isImported, loadCollection } from "@/lib/collections";
import { LOCAL_MUSIC_SOURCE, localMusicTrackByID } from "@/lib/local-music";
import { checkWriteGuard } from "@/lib/write-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 审核整改 A-17：批量本地音乐上限 */
const MAX_BATCH_IDS = 1000;

/** POST /api/collections/[id]/local_music/batch {ids:[...]} → {requested,added,duplicate,failed}（单事务批量插入） */
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

  let body: { ids?: string[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "缺少本地音乐 ID 列表" }, { status: 400 });
  }
  if (!Array.isArray(body?.ids) || body.ids.length === 0) {
    return NextResponse.json({ error: "缺少本地音乐 ID 列表" }, { status: 400 });
  }
  if (body.ids.length > MAX_BATCH_IDS) {
    return NextResponse.json({ error: `批量数量过多（上限 ${MAX_BATCH_IDS}）` }, { status: 413 });
  }

  // 收集有效曲目（对齐 Go：track 缺失 → failed++）
  interface Row {
    songId: string;
    extra: string;
    name: string;
    artist: string;
    cover: string;
    duration: number;
  }
  const rows: Row[] = [];
  let failed = 0;
  for (const rawID of body.ids) {
    let track;
    try {
      track = await localMusicTrackByID((rawID ?? "").trim());
    } catch {
      failed++;
      continue;
    }
    let extraStr = "";
    try {
      extraStr = JSON.stringify(track.extra);
    } catch {
      extraStr = "";
    }
    rows.push({
      songId: track.id,
      extra: extraStr,
      name: track.name,
      artist: track.artist,
      cover: track.cover,
      duration: track.duration,
    });
  }

  // 单事务批量 INSERT OR IGNORE，统计 added（对齐 Go 单批 Create + RowsAffected）
  let added = 0;
  if (rows.length) {
    const db = getDB();
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO saved_songs (collection_id, song_id, source, extra, name, artist, cover, duration, added_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      );
      for (const row of rows) {
        const r = stmt.run(
          collection.id,
          row.songId,
          LOCAL_MUSIC_SOURCE,
          row.extra,
          row.name,
          row.artist,
          row.cover,
          row.duration,
          now,
        );
        added += r.changes;
      }
    });
    try {
      tx();
    } catch (err) {
      return NextResponse.json(
        { error: `批量添加失败: ${err instanceof Error ? err.message : String(err)}` },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    status: "ok",
    requested: body.ids.length,
    added,
    duplicate: rows.length - added,
    failed,
  });
}
