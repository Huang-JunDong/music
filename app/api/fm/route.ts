import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider } from "@/lib/registry";
import type { Song } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 网易 FM 模式（社区公开值：心动/随性；标准=默认推荐流不传 mode） */
const FM_MODES = new Set(["", "ossGB1", "popGB1"]);

/**
 * GET /api/fm?source=&mode= → { songs: Song[] }
 * 注意：FM 为个性化流，每次调用返回新批次，不做缓存。
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);

async function getHandler(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const source = (params.get("source") ?? "netease").trim();
  const rawMode = (params.get("mode") ?? "").trim();
  const mode = FM_MODES.has(rawMode) ? rawMode : "";

  const provider = getProvider(source);
  if (!provider?.getFmSongs) {
    return NextResponse.json({ error: "该源不支持私人FM" }, { status: 400 });
  }

  try {
    const songs = (await provider.getFmSongs(mode)).map((s) => ({ ...s, source: s.source || source }));
    return NextResponse.json({ source, songs: songs as Song[] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
