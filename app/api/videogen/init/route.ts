import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { createSession, VideogenSessionLimitError } from "@/lib/videogen";
import { requireAuth } from "@/lib/auth";
import { checkWriteGuard } from "@/lib/write-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/videogen/init（multipart: id, source[, audio_file] 或 JSON {id, source}）
 * → {session_id, audio_url}（会话存内存）
 *
 * 审核整改 A-01/A-04/A-10：纳入鉴权 + 写守卫；id/source 字符白名单
 * （消除 exec 参数注入面，见 lib/videogen.ts execFile 改造）；上传音频大小上限。
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const AUDIO_EXT_WHITELIST = new Set([".mp3", ".flac", ".m4a", ".ogg", ".wav", ".aac", ".wma"]);
const MAX_CUSTOM_AUDIO_BYTES = 100 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return NextResponse.json(denied.body, { status: denied.status });
  const guarded = checkWriteGuard(req);
  if (guarded) return guarded;

  let id = "";
  let source = "";
  let customAudio: { name: string; data: Buffer } | null = null;

  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "Bad multipart request" }, { status: 400 });
    }
    id = String(form.get("id") ?? "");
    source = String(form.get("source") ?? "");
    const audioFile = form.get("audio_file");
    if (audioFile instanceof File && audioFile.size > 0) {
      // 审核整改 A-10：上传音频大小上限（超限 413 而非整读进内存）
      if (audioFile.size > MAX_CUSTOM_AUDIO_BYTES) {
        return NextResponse.json({ error: "audio file too large (max 100MB)" }, { status: 413 });
      }
      customAudio = {
        name: audioFile.name || "audio.mp3",
        data: Buffer.from(await audioFile.arrayBuffer()),
      };
    }
  } else {
    let body: { id?: string; source?: string };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "Args error" }, { status: 400 });
    }
    id = body?.id ?? "";
    source = body?.source ?? "";
  }

  if (!id.trim() || !source.trim()) {
    return NextResponse.json({ error: "Args error" }, { status: 400 });
  }
  // 审核整改 A-01：字符白名单——id/source 进入 sessionId → tempDir/outPath → ffmpeg 参数，
  // 白名单后配合 execFile 双重消除命令注入面
  if (!ID_PATTERN.test(id.trim()) || !ID_PATTERN.test(source.trim())) {
    return NextResponse.json({ error: "id/source contains invalid characters (allowed: A-Z a-z 0-9 _ -)" }, { status: 400 });
  }

  let session;
  try {
    session = createSession({ songId: id.trim(), source: source.trim() });
  } catch (err) {
    if (err instanceof VideogenSessionLimitError) {
      // 审核整改 A-06：活跃会话达上限（含惰性清理后仍满），拒绝而非无限驻留
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }

  let audioUrl = "";
  if (customAudio) {
    // 审核整改 A-01：扩展名白名单（原 path.extname 未消毒即拼入落盘路径与 ffmpeg 参数）
    const ext = path.extname(customAudio.name).toLowerCase();
    if (!AUDIO_EXT_WHITELIST.has(ext)) {
      return NextResponse.json({ error: "unsupported audio format" }, { status: 400 });
    }
    const audioPath = path.join(session.tempDir, `audio${ext}`);
    try {
      fs.writeFileSync(audioPath, customAudio.data);
    } catch {
      return NextResponse.json({ error: "Failed to save custom audio" }, { status: 500 });
    }
    session.customAudioPath = audioPath;
  } else {
    audioUrl = `/api/download?id=${encodeURIComponent(id.trim())}&source=${encodeURIComponent(source.trim())}`;
    session.audioUrl = audioUrl;
  }

  return NextResponse.json({ session_id: session.id, audio_url: audioUrl });
}
