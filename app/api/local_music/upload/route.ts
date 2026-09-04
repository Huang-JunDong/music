import { NextRequest, NextResponse } from "next/server";
import {
  saveUploadedLocalMusic,
  trackJSON,
  upsertLocalMusicIndexRow,
} from "@/lib/local-music";
import { saveDownloadDedupEntry } from "@/lib/download-record";
import { requireAuth } from "@/lib/auth";
import { checkWriteGuard } from "@/lib/write-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 审核整改 A-09：上传音频大小上限（无损曲可到数百 MB，300MB 兼顾实用与防护） */
const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;

/**
 * POST /api/local_music/upload — multipart file（白名单扩展名，唯一化文件名，music-metadata 读元数据）
 * 审核整改 A-04/A-09/A-15：纳入鉴权 + 写守卫 + 大小上限（超限 413 而非整读进内存）。
 */
export async function POST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return NextResponse.json(denied.body, { status: denied.status });
  const guarded = checkWriteGuard(req);
  if (guarded) return guarded;

  // Content-Length 预检（提前拒绝，避免 multipart 解析开销）
  const declaredLength = parseInt(req.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES + 64 * 1024) {
    return NextResponse.json({ error: "文件过大（上限 300MB）" }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "请选择要上传的音乐文件" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请选择要上传的音乐文件" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "文件过大（上限 300MB）" }, { status: 413 });
  }

  let track;
  try {
    const data = Buffer.from(await file.arrayBuffer());
    track = await saveUploadedLocalMusic(file.name || "local-music.mp3", data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  upsertLocalMusicIndexRow(track);
  try {
    saveDownloadDedupEntry(track.name, track.artist);
  } catch (err) {
    return NextResponse.json(
      { error: `音乐文件已保存，但曲库索引写入失败: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ status: "ok", track: trackJSON(track) });
}
