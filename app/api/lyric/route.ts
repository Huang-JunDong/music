import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider, songFromParams } from "@/lib/registry";
import { classifyLyricFormat, formatLyricForMode } from "@/lib/lyrics-format";
import { isLocalMusicSource, localMusicTrackByID, readLocalMusicLyrics } from "@/lib/local-music";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEXT_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "public, max-age=600",
};

const FALLBACK_LRC = "[00:00.00] 纯音乐 / 无歌词";

/** GET /api/lyric?source=&id=&format= → LRC 文本（无歌词兜底纯音乐占位） */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);

async function getHandler(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const song = songFromParams(params);

  if (isLocalMusicSource(song.source)) {
    try {
      const track = await localMusicTrackByID(song.id);
      const lrc = await readLocalMusicLyrics(track);
      if (lrc.trim()) {
        const formatted = formatLyricForMode(lrc, params.get("format") ?? "auto");
        return new NextResponse(formatted, {
          status: 200,
          headers: { ...TEXT_HEADERS, "X-Lyric-Format": classifyLyricFormat(formatted) },
        });
      }
    } catch {
      /* fallthrough */
    }
    return new NextResponse(FALLBACK_LRC, { status: 200, headers: TEXT_HEADERS });
  }

  const provider = getProvider(song.source);
  if (provider?.getLyric) {
    try {
      const lrc = await provider.getLyric(song);
      if (lrc) {
        const formatted = formatLyricForMode(lrc, params.get("format") ?? "auto");
        return new NextResponse(formatted, {
          status: 200,
          headers: { ...TEXT_HEADERS, "X-Lyric-Format": classifyLyricFormat(formatted) },
        });
      }
    } catch {
      /* fallthrough */
    }
  }
  return new NextResponse(FALLBACK_LRC, { status: 200, headers: TEXT_HEADERS });
}
