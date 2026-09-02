import { NextResponse } from "next/server";
import { resolveFFmpegPath } from "@/lib/download-flow";
import { downloadDir } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_VERSION = "1.1.0";

/** GET /api/system/status — 环境能力状态（ffmpeg 可用性/来源、下载目录、版本） */
export async function GET() {
  let ffmpegPath = "";
  try {
    ffmpegPath = await resolveFFmpegPath();
  } catch {
    ffmpegPath = "";
  }
  const envFfmpeg = (process.env.MUSIC_DL_FFMPEG ?? "").trim();
  let ffmpegSource = "unavailable";
  if (ffmpegPath) {
    if (envFfmpeg && ffmpegPath === envFfmpeg) ffmpegSource = "env";
    else if (ffmpegPath.includes("ffmpeg-static")) ffmpegSource = "builtin";
    else ffmpegSource = "path";
  }

  return NextResponse.json({
    app_version: APP_VERSION,
    ffmpeg_available: !!ffmpegPath,
    ffmpeg_path: ffmpegPath,
    ffmpeg_source: ffmpegSource, // builtin = ffmpeg-static 内置二进制
    download_dir: downloadDir(),
    platform: process.platform,
  });
}
