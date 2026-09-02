import { NextRequest, NextResponse } from "next/server";
import { getProvider, songFromParams } from "@/lib/registry";
import { fetchSource, formatSizeMB } from "@/lib/web-core";
import { isLocalMusicSource, localMusicTrackByID, trackAbsPath } from "@/lib/local-music";
import fs from "node:fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/inspect?id=&source=&duration=&extra=
 * 可播性探测：Range bytes=0-1 请求上游（5s 超时），解析 Content-Range 得大小与码率。
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const id = params.get("id") ?? "";
  const source = params.get("source") ?? "";
  const duration = parseInt((params.get("duration") ?? "").trim(), 10) || 0;
  const song = songFromParams(params);

  if (isLocalMusicSource(source)) {
    try {
      const track = await localMusicTrackByID(id);
      const size = track.size || fs.statSync(trackAbsPath(track)).size;
      let bitrate = "-";
      const extraKbps = parseInt(track.extra.bitrate ?? "", 10);
      if (extraKbps > 0) bitrate = `${extraKbps} kbps`;
      else if (track.duration > 0 && size > 0) bitrate = `${Math.floor((size * 8) / track.duration / 1000)} kbps`;
      else if (duration > 0 && size > 0) bitrate = `${Math.floor((size * 8) / duration / 1000)} kbps`;
      return NextResponse.json({
        valid: true,
        url: "",
        size: track.sizeText || formatSizeMB(size),
        bitrate,
        duration: track.duration,
        song: {
          id: track.id,
          source: "local",
          name: track.name,
          artist: track.artist,
          album: track.album,
          cover: track.cover,
          duration: track.duration,
          extra: track.extra,
        },
      });
    } catch {
      return NextResponse.json({ valid: false });
    }
  }

  const provider = getProvider(source);
  if (!provider?.getStreamUrl) {
    return NextResponse.json({ valid: false });
  }

  let url = "";
  try {
    url = await provider.getStreamUrl({ ...song, id, source });
    if (!url) return NextResponse.json({ valid: false });
  } catch {
    return NextResponse.json({ valid: false });
  }

  let valid = false;
  let size = 0;
  try {
    const resp = await fetchSource(url, source, "bytes=0-1", 5_000);
    if (resp.status === 200 || resp.status === 206) {
      valid = true;
      const contentRange = resp.headers.get("content-range") ?? "";
      const parts = contentRange.split("/");
      if (parts.length === 2) {
        size = parseInt(parts[1], 10) || 0;
      } else {
        size = parseInt(resp.headers.get("content-length") ?? "", 10) || 0;
      }
    }
  } catch {
    valid = false;
  }

  let bitrate = "-";
  if (valid && size > 0 && duration > 0) {
    bitrate = `${Math.floor((size * 8) / duration / 1000)} kbps`;
  }

  return NextResponse.json({
    valid,
    url,
    size: formatSizeMB(size),
    bitrate,
  });
}
