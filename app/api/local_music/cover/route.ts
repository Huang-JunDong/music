import { NextRequest, NextResponse } from "next/server";
import { downloadDisposition } from "@/lib/web-core";
import { checkSaveLocalGuard, saveWebAssetResponse, wantsSaveLocal } from "@/lib/write-guard";
import {
  localMusicCoverFilename,
  localMusicTrackByID,
  readLocalMusicCover,
} from "@/lib/local-music";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET/POST /api/local_music/cover?id=[&download=1][&save_local=1] — 内嵌封面优先，同名图片兜底 */
async function handle(req: NextRequest): Promise<NextResponse> {
  const guarded = checkSaveLocalGuard(req);
  if (guarded) return guarded;

  const id = req.nextUrl.searchParams.get("id") ?? "";
  let track;
  try {
    track = await localMusicTrackByID(id);
  } catch {
    return new NextResponse(null, { status: 404 });
  }

  const cover = await readLocalMusicCover(track);
  if (!cover || cover.data.length === 0) {
    return new NextResponse(null, { status: 404 });
  }

  if (wantsSaveLocal(req)) {
    return saveWebAssetResponse(localMusicCoverFilename(track, cover.ext), Buffer.from(cover.data));
  }

  const headers = new Headers({
    "Content-Type": cover.mime,
    "Cache-Control": "public, max-age=21600",
    "Content-Length": String(cover.data.length),
  });
  if (req.nextUrl.searchParams.get("download") === "1") {
    headers.set("Content-Disposition", downloadDisposition(localMusicCoverFilename(track, cover.ext)));
  }

  return new NextResponse(new Uint8Array(cover.data), { status: 200, headers });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
