import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider } from "@/lib/registry";
import { isLocalMusicSource, localMusicTrackByID, trackAbsPath } from "@/lib/local-music";
import { fetchSource } from "@/lib/web-core";
import { cleanupSession, renderVideo, takeSession } from "@/lib/videogen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/videogen/finish {session_id, name}
 * 无 ffmpeg → 501 {"error":"ffmpeg unavailable"}；成功 → {url}
 * 免登录（无 CSRF 写守卫；触发 ffmpeg 渲染与产物落盘）。
 */
export const POST = (req: NextRequest) => withBrowserSourceSession(req, postHandler);

async function postHandler(req: NextRequest) {
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
      // 本地音乐不注册 provider（registry），直接读源文件（对齐 download-handler serveLocalMusic 的定位方式）
      if (isLocalMusicSource(song.source)) {
        const track = await localMusicTrackByID(song.id);
        return fs.readFileSync(trackAbsPath(track));
      }
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
      // timeoutMs=0 不限时：无损大文件整体下载可能远超默认 15s（body 读取同样受 signal 管控）
      const resp = await fetchSource(url, song.source, null, 0);
      if (!resp.ok) throw new Error(`Audio download failed: HTTP ${resp.status}`);
      return Buffer.from(await resp.arrayBuffer());
    };

    const result = await renderVideo(session, {
      fetchAudio: session.customAudioPath ? undefined : fetchAudio,
    });
    return NextResponse.json({ url: `/api/videogen/file/${result.outName}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // 服务端终端留痕（ffmpeg stderr 等），否则只能靠客户端 toast 猜错因
    console.error(`[videogen/finish] session=${sessionId} failed: ${message}`);
    if (message === "ffmpeg unavailable") {
      return NextResponse.json({ error: "ffmpeg unavailable" }, { status: 501 });
    }
    return NextResponse.json({ error: `Render failed: ${message}` }, { status: 500 });
  } finally {
    cleanupSession(session);
  }
}
