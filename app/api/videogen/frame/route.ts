import { NextRequest, NextResponse } from "next/server";
import { addFrames, getSession, VideogenFrameLimitError } from "@/lib/videogen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 审核整改 A-10：单帧大小与单批数量上限（防未授权资源耗尽；总量上限见 lib/videogen.ts） */
const MAX_FRAME_BYTES = 5 * 1024 * 1024;
const MAX_FRAMES_PER_BATCH = 120;

function decodeBase64Frame(dataURI: string): Buffer {
  let text = dataURI ?? "";
  const comma = text.indexOf(",");
  if (comma >= 0) text = text.slice(comma + 1);
  else if (text.length > 23) text = text.slice(23);
  return Buffer.from(text, "base64");
}

/**
 * POST /api/videogen/frame（multipart: session_id, start_idx, frames[] 多文件
 * 或 JSON {session_id, frames:[base64], start_idx}）→ {status, received}
 */
export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";
  let sessionId = "";
  let startIdx = -1;
  let frames: Buffer[] = [];

  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "Bad multipart request" }, { status: 400 });
    }
    sessionId = String(form.get("session_id") ?? "");
    startIdx = parseInt(String(form.get("start_idx") ?? ""), 10);
    const files = form.getAll("frames");
    for (const file of files) {
      if (file instanceof File) frames.push(Buffer.from(await file.arrayBuffer()));
    }
    if (!sessionId || Number.isNaN(startIdx) || !files.length) {
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }
  } else {
    let body: { session_id?: string; frames?: string[]; start_idx?: number };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }
    sessionId = body?.session_id ?? "";
    startIdx = body?.start_idx ?? NaN;
    frames = (body?.frames ?? []).map(decodeBase64Frame);
    if (!sessionId || Number.isNaN(startIdx) || !frames.length) {
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }
  }

  // 审核整改 A-10：批次数量与单帧大小上限
  if (frames.length > MAX_FRAMES_PER_BATCH) {
    return NextResponse.json({ error: `too many frames in one batch (max ${MAX_FRAMES_PER_BATCH})` }, { status: 413 });
  }
  if (frames.some((f) => f.byteLength > MAX_FRAME_BYTES)) {
    return NextResponse.json({ error: "frame too large (max 5MB)" }, { status: 413 });
  }

  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const err = addFrames(session, frames, startIdx);
  if (err) {
    // 审核整改 A-06：帧总量超限返回 413（资源上限），乱序仍为 500（协议错误）
    if (err instanceof VideogenFrameLimitError) {
      return NextResponse.json({ error: err.message }, { status: 413 });
    }
    return NextResponse.json(
      { error: `Failed to write frame stream: ${err.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ status: "ok", received: frames.length });
}
