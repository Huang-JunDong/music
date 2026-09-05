import { NextRequest, NextResponse } from "next/server";
import { getProvider } from "@/lib/registry";
import { fetchSource } from "@/lib/web-core";
import { cleanupSession, renderVideo, takeSession } from "@/lib/videogen";
import { checkWriteGuard } from "@/lib/write-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/videogen/finish {session_id, name}
 * 无 ffmpeg → 501 {"error":"ffmpeg unavailable"}；成功 → {url}
 * 免登录（CSRF 写守卫保留；触发 ffmpeg 渲染与产物落盘）。
 */
export async function POST(req: NextRequest) {
  const guarded = checkWriteGuard(req);
  if (guarded) return guarded;
  let body: { session_id?: string; name?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  const sessionId = (body?.session_id ?? "").trim();

  const session = takeSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  try {
    const song = session.song;
    const fetchAudio = async (): Promise<Buffer> => {
      const provider = getProvider(song.source);
      if (!provider?.getStreamUrl) throw new Error("Audio download failed: unknown source");
      const url = await provider.getStreamUrl({
        id: song.id,
        source: song.source,
        name: "render",
        artist: "render",
        album: "",
        duration: 0,
        size: 0,
        bitrate: 0,
        url: "",
        cover: "",
        link: "",
      });
      const resp = await fetchSource(url, song.source);
      if (!resp.ok) throw new Error(`Audio download failed: HTTP ${resp.status}`);
      return Buffer.from(await resp.arrayBuffer());
    };

    const result = await renderVideo(session, {
      fetchAudio: session.customAudioPath ? undefined : fetchAudio,
    });
    return NextResponse.json({ url: `/api/videogen/file/${result.outName}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "ffmpeg unavailable") {
      return NextResponse.json({ error: "ffmpeg unavailable" }, { status: 501 });
    }
    return NextResponse.json({ error: `Render failed: ${message}` }, { status: 500 });
  } finally {
    cleanupSession(session);
  }
}
