import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider, songFromParams } from "@/lib/registry";
import type { Song } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 网易 FM 模式（社区公开值：心动/随性；标准=默认推荐流不传 mode）；guess = QQ 猜你喜欢备用流 */
const FM_MODES = new Set(["", "ossGB1", "popGB1", "guess"]);

/**
 * GET /api/fm?source=&mode= → { songs: Song[] }
 * P1 C4：mode=seed:<songId> → 网易心动模式（playmode_intelligence_list 以种子歌曲生成智能队列）。
 * 注意：FM 为个性化流，每次调用返回新批次，不做缓存。
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);

async function getHandler(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const source = (params.get("source") ?? "netease").trim();
  const rawMode = (params.get("mode") ?? "").trim();
  const mode = FM_MODES.has(rawMode) ? rawMode : "";

  /* P1 C4 心动模式：seed:<songId> 以种子歌曲生成智能队列（不侵入主队列由前端负责） */
  if (rawMode.startsWith("seed:")) {
    const seedId = rawMode.slice(5).trim();
    /* 审核整改 R2-#9：种子歌曲 id 数字校验（网易 songId，防 NaN 上送） */
    if (!/^\d+$/.test(seedId)) return NextResponse.json({ error: "seed 必须为数字歌曲 id" }, { status: 400 });
    const provider = getProvider("netease");
    if (!provider?.getIntelligenceList) {
      return NextResponse.json({ error: "心动模式仅支持网易云音乐" }, { status: 400 });
    }
    try {
      const seed = songFromParams(params);
      if (!seedId && !seed.id) return NextResponse.json({ error: "缺少种子歌曲" }, { status: 400 });
      const songs = await provider.getIntelligenceList({ ...seed, id: seedId || seed.id });
      return NextResponse.json({ source: "netease", songs: songs as Song[] });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
    }
  }

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
