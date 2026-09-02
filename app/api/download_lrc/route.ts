import { NextRequest, NextResponse } from "next/server";
import { getProvider, songFromParams } from "@/lib/registry";
import { downloadDisposition } from "@/lib/web-core";
import { classifyLyricFormat, formatLyricForMode } from "@/lib/lyrics-format";
import { checkSaveLocalGuard, saveWebAssetResponse, wantsSaveLocal } from "@/lib/write-guard";
import {
  isLocalMusicSource,
  localMusicLyricFilename,
  localMusicTrackByID,
  readLocalMusicLyrics,
} from "@/lib/local-music";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEXT_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
};

/** GET/POST /api/download_lrc → LRC 文本（X-Lyric-Format；format=auto/origin/line；无歌词 404；save_local 落盘） */
async function handle(req: NextRequest): Promise<NextResponse> {
  const guarded = checkSaveLocalGuard(req);
  if (guarded) return guarded;

  const params = req.nextUrl.searchParams;
  const song = songFromParams(params);
  // 对齐 Go lyricSongFromQuery：name/artist 用原值（不做 Unknown 兜底）
  const name = song.name;
  const artist = song.artist;

  if (isLocalMusicSource(song.source)) {
    let lrc = "";
    let filename = `${name} - ${artist}.lrc`;
    try {
      const track = await localMusicTrackByID(song.id);
      filename = localMusicLyricFilename(track);
      lrc = await readLocalMusicLyrics(track);
    } catch {
      return new NextResponse("Lyric not found", { status: 404, headers: TEXT_HEADERS });
    }
    if (!lrc.trim()) {
      return new NextResponse("Lyric not found", { status: 404, headers: TEXT_HEADERS });
    }
    lrc = formatLyricForMode(lrc, params.get("format") ?? "auto");
    if (wantsSaveLocal(req)) {
      return saveWebAssetResponse(filename, Buffer.from(lrc, "utf8"));
    }
    return new NextResponse(lrc, {
      status: 200,
      headers: {
        ...TEXT_HEADERS,
        "X-Lyric-Format": classifyLyricFormat(lrc),
        "Content-Disposition": downloadDisposition(filename),
      },
    });
  }

  const provider = getProvider(song.source);
  if (!provider?.getLyric) {
    return new NextResponse("No support", { status: 404, headers: TEXT_HEADERS });
  }

  let lrc = "";
  try {
    lrc = await provider.getLyric(song);
  } catch {
    lrc = "";
  }
  if (!lrc) {
    return new NextResponse("Lyric not found", { status: 404, headers: TEXT_HEADERS });
  }

  lrc = formatLyricForMode(lrc, params.get("format") ?? "auto");
  const filename = `${name} - ${artist}.lrc`;
  if (wantsSaveLocal(req)) {
    return saveWebAssetResponse(filename, Buffer.from(lrc, "utf8"));
  }
  return new NextResponse(lrc, {
    status: 200,
    headers: {
      ...TEXT_HEADERS,
      "X-Lyric-Format": classifyLyricFormat(lrc),
      "Content-Disposition": downloadDisposition(filename),
    },
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
