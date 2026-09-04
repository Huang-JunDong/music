import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/store";
import { insertSavedSong, isImported, loadCollection } from "@/lib/collections";
import { checkWriteGuard } from "@/lib/write-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 审核整改 A-17：批量收藏上限（大歌单整单收藏一次到位） */
const MAX_BATCH_SONGS = 1000;

interface BatchSong {
  id?: string;
  source?: string;
  name?: string;
  artist?: string;
  cover?: string;
  duration?: number;
  extra?: unknown;
}

/** POST /api/collections/[id]/songs/batch {songs:[...]} → {requested,added,duplicate,failed} */
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
      { error: "外部导入歌单/专辑不保存歌曲明细，不能直接加入歌曲" },
      { status: 400 },
    );
  }

  let body: { songs?: BatchSong[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "缺少要收藏的歌曲列表" }, { status: 400 });
  }
  if (!Array.isArray(body?.songs) || body.songs.length === 0) {
    return NextResponse.json({ error: "缺少要收藏的歌曲列表" }, { status: 400 });
  }
  if (body.songs.length > MAX_BATCH_SONGS) {
    return NextResponse.json({ error: `批量收藏数量过多（上限 ${MAX_BATCH_SONGS}）` }, { status: 413 });
  }

  let added = 0;
  let failed = 0;
  let inserted = 0;
  try {
    const db = getDB();
    const tx = db.transaction(() => {
      for (const item of body.songs!) {
        const songId = (item?.id ?? "").trim();
        const source = (item?.source ?? "").trim();
        if (!songId || !source) {
          failed++;
          continue;
        }
        if (
          insertSavedSong(collection.id, {
            id: songId,
            source,
            name: item?.name,
            artist: item?.artist,
            cover: item?.cover,
            duration: item?.duration,
            extra: item?.extra,
          })
        ) {
          added++;
        }
        inserted++;
      }
    });
    tx();
  } catch (err) {
    return NextResponse.json(
      { error: `批量收藏失败: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    status: "ok",
    requested: body.songs.length,
    added,
    duplicate: inserted - added,
    failed,
  });
}
