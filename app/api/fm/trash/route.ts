import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider } from "@/lib/registry";
import { checkWriteGuard } from "@/lib/write-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/fm/trash { source, song_id } → { ok: true }
 * 网易专属（fm_trash /api/radio/trash/add）：当前曲目进垃圾桶，后续推荐流不再出现。
 */
export const POST = (req: NextRequest) => withBrowserSourceSession(req, postHandler);

async function postHandler(req: NextRequest) {
  const guard = checkWriteGuard(req);
  if (guard) return guard;

  let body: { source?: string; song_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* ignore */
  }
  const source = (body.source ?? "").trim();
  const songId = (body.song_id ?? "").trim();
  if (!source || !songId) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const provider = getProvider(source);
  if (!provider?.trashFmSong) {
    return NextResponse.json({ error: "该源不支持垃圾桶" }, { status: 400 });
  }

  try {
    await provider.trashFmSong(songId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
