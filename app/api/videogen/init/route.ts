import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/videogen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/videogen/init（multipart: id, source[, audio_file] 或 JSON {id, source}）
 * → {session_id, audio_url}（会话存内存）
 */
export async function POST(req: NextRequest) {
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

  const session = createSession({ songId: id.trim(), source: source.trim() });

  let audioUrl = "";
  if (customAudio) {
    const ext = path.extname(customAudio.name) || ".mp3";
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
