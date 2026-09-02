import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/store";
import { insertSavedSong, isImported, loadCollection } from "@/lib/collections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
