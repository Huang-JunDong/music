import { NextRequest, NextResponse } from "next/server";
import { addFrames, getSession } from "@/lib/videogen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const err = addFrames(session, frames, startIdx);
  if (err) {
    return NextResponse.json(
      { error: `Failed to write frame stream: ${err.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ status: "ok", received: frames.length });
}
