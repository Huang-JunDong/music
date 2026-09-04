import { NextRequest, NextResponse } from "next/server";
import { resolveFFmpegPath } from "@/lib/download-flow";
import { ffmpegPath as ffmpegPathFromEnv } from "@/lib/env";
import { requireAuth } from "@/lib/auth";
import { downloadDir } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_VERSION = "1.1.0";

/** GET /api/system/status — 环境能力状态（审核整改 A-13：纳入鉴权，防 ffmpeg 路径/下载目录侦察） */
export async function GET(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return NextResponse.json(denied.body, { status: denied.status });

  let ffmpegPath = "";
  try {
    ffmpegPath = await resolveFFmpegPath();
  } catch {
    ffmpegPath = "";
  }
  const envFfmpeg = ffmpegPathFromEnv();
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
