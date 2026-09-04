import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getDB, downloadDir } from "@/lib/store";
import { collectionSongsJSON, insertSavedSong, isImported, loadCollection } from "@/lib/collections";
import { isLocalMusicSource, decodeLocalMusicID } from "@/lib/local-music";
import { checkWriteGuard } from "@/lib/write-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/collections/[id]/songs — imported 实时拉上游，manual 读表；本地歌曲标记文件缺失（失效） */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const collection = loadCollection(id);
  if (!collection) {
    return NextResponse.json({ error: "歌单不存在" }, { status: 404 });
  }
  try {
    const songs = await collectionSongsJSON(collection);
    // 删除被收藏过的本地歌曲后条目保留并显示为失效：source=local 且文件不存在 → is_invalid
    for (const song of songs) {
      const source = String(song.source ?? "");
      if (!isLocalMusicSource(source)) continue;
      try {
        const relPath = decodeLocalMusicID(String(song.id ?? ""));
        song.is_invalid = !fs.existsSync(path.join(downloadDir(), relPath));
      } catch {
        song.is_invalid = true;
      }
    }
    return NextResponse.json(songs);
  } catch (err) {
    return NextResponse.json(
      { error: `获取歌曲失败: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}

/** POST /api/collections/[id]/songs {id, source, name, artist, cover, duration, extra} — 添加单曲 */
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

  let body: {
    id?: string;
    source?: string;
    name?: string;
    artist?: string;
    cover?: string;
    duration?: number;
    extra?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "参数错误，缺少 id 或 source" }, { status: 400 });
  }
  const songId = (body?.id ?? "").trim();
  const source = (body?.source ?? "").trim();
  if (!songId || !source) {
    return NextResponse.json({ error: "参数错误，缺少 id 或 source" }, { status: 400 });
  }

  try {
    insertSavedSong(collection.id, {
      id: songId,
      source,
      name: body.name,
      artist: body.artist,
      cover: body.cover,
      duration: body.duration,
      extra: body.extra,
    });
    return NextResponse.json({ status: "ok" });
  } catch (err) {
    return NextResponse.json(
      { error: `添加失败: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}

/** DELETE /api/collections/[id]/songs — body {songs:[{id,source}]} 批量 或 query id+source 单条 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guarded = checkWriteGuard(req);
  if (guarded) return guarded;

  const { id } = await params;
  const collection = loadCollection(id);
  if (!collection) {
    return NextResponse.json({ error: "歌单不存在" }, { status: 404 });
  }
  if (isImported(collection)) {
    return NextResponse.json({ error: "外部导入歌单/专辑没有本地歌曲明细可删除" }, { status: 400 });
  }

  let bodySongs: { id?: string; source?: string }[] = [];
  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as { songs?: { id?: string; source?: string }[] };
      if (Array.isArray(body?.songs)) bodySongs = body.songs;
    }
  } catch {
    /* ignore */
  }

  const db = getDB();
  if (bodySongs.length) {
    // 对齐 Go：批量删除在单事务内执行（任一条非法则整体回滚）
    try {
      const tx = db.transaction((songs: { id?: string; source?: string }[]) => {
        for (const song of songs) {
          const songId = (song.id ?? "").trim();
          const source = (song.source ?? "").trim();
          if (!songId || !source) {
            throw new Error("批量取消收藏需要提供每首歌的 id 和 source");
          }
          db.prepare("DELETE FROM saved_songs WHERE collection_id = ? AND song_id = ? AND source = ?").run(
            collection.id,
            songId,
            source,
          );
        }
      });
      tx(bodySongs);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("批量取消收藏")) {
        return NextResponse.json({ error: message }, { status: 400 });
      }
      return NextResponse.json({ error: "删除失败" }, { status: 500 });
    }
    return NextResponse.json({ status: "ok" });
  }

  const params2 = req.nextUrl.searchParams;
  const songId = (params2.get("id") ?? "").trim();
  const source = (params2.get("source") ?? "").trim();
  if (!songId || !source) {
    return NextResponse.json({ error: "需要通过 query 传递 id 和 source" }, { status: 400 });
  }
  db.prepare("DELETE FROM saved_songs WHERE collection_id = ? AND song_id = ? AND source = ?").run(
    collection.id,
    songId,
    source,
  );
  return NextResponse.json({ status: "ok" });
}
