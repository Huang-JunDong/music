import { NextRequest, NextResponse } from "next/server";
import {
  loadTracksFromIndex,
  localMusicDownloadDir,
  markAlreadyAddedLocalTracks,
  parseLocalMusicRangeInt,
  refreshLocalMusicScanAsync,
  scanLocalMusicTracksCached,
  syncTracksToIndexAsync,
  trackJSON,
} from "@/lib/local-music";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function rangeInt(params: URLSearchParams, key: string, fallback: number): number {
  return parseLocalMusicRangeInt(params.get(key), fallback);
}

/**
 * GET /api/local_music?offset=&limit=&refresh=1&force=1&collection_id=
 * 快速路径走 SQLite 索引并后台异步刷新；慢路径全量扫描（10s 快照缓存）。
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const forceRefresh = params.get("refresh") === "1" || params.get("force") === "1";
  const offset = rangeInt(params, "offset", 0);
  const limit = rangeInt(params, "limit", 0);
  const collectionId = parseInt((params.get("collection_id") ?? "").trim(), 10) || 0;

  if (!forceRefresh) {
    const indexed = loadTracksFromIndex(offset, limit);
    if (indexed && indexed.total > 0) {
      // 对齐 Go：快速路径命中后仍异步刷新文件系统（索引自动同步增删）
      refreshLocalMusicScanAsync();
      let tracks = indexed.tracks;
      if (collectionId) {
        markAlreadyAddedLocalTracks(collectionId, tracks);
      }
      return NextResponse.json({
        download_dir: localMusicDownloadDir().replaceAll("\\", "/"),
        exists: true,
        tracks: tracks.map(trackJSON),
        total: indexed.total,
        offset,
        limit,
        has_more: offset + tracks.length < indexed.total,
        refreshing: false,
        scanned_at: new Date().toISOString(),
      });
    }
  }

  const result = await scanLocalMusicTracksCached(forceRefresh);
  if (result.err) {
    return NextResponse.json({ error: result.err }, { status: 500 });
  }

  const total = result.tracks.length;
  const pageTracks = result.tracks.slice(
    offset,
    limit > 0 ? Math.min(offset + limit, total) : total,
  );
  if (collectionId) {
    markAlreadyAddedLocalTracks(collectionId, pageTracks);
  }

  // 扫描完成后异步同步索引（空扫描也清理旧行）
  if (!result.refreshing) {
    syncTracksToIndexAsync(result.tracks);
  }

  return NextResponse.json({
    download_dir: result.dir.replaceAll("\\", "/"),
    exists: result.exists,
    tracks: pageTracks.map(trackJSON),
    total,
    offset,
    limit,
    has_more: offset + pageTracks.length < total,
    refreshing: result.refreshing,
    scanned_at: new Date(result.scannedAt).toISOString(),
  });
}

/** DELETE /api/local_music?id= — 硬删除（磁盘文件 + 索引行） */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  try {
    const { deleteLocalMusicTrack } = await import("@/lib/local-music");
    await deleteLocalMusicTrack(id);
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ error: "本地音乐不存在或已不在下载目录内" }, { status: 400 });
  }
}
