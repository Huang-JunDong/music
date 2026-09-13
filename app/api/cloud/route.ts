import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider } from "@/lib/registry";
import { checkWriteGuard } from "@/lib/write-guard";
import { rateLimit, requestIP } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cloud?page=&limit= → { songs, has_more, size, max_size, error? }
 * POST /api/cloud（JSON: { action: "match"|"delete"|"lyric", id, target? }）→ { ok } / { lyric }
 * 云盘为个人数据：GET 不缓存；删除为高危操作（频控 6 次/分钟/IP，操作以生效音源凭证授权——浏览器会话优先、全局兜底）。
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);
export const POST = (req: NextRequest) => withBrowserSourceSession(req, postHandler);

async function getHandler(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  /* P1 B3：云盘单条详情（user_cloud_detail byids） */
  const cloudId = (params.get("id") ?? "").trim();
  if (cloudId) {
    const provider = getProvider("netease");
    if (!provider?.getCloudSongDetail) {
      return NextResponse.json({ error: "云盘音乐仅支持网易云音乐" }, { status: 400 });
    }
    try {
      return NextResponse.json({ song: await provider.getCloudSongDetail(cloudId) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      /* 对齐 /api/recent 约定：未登录 200 + need_login（前端登录引导，避免控制台 502 噪音） */
      if (/登录/.test(msg)) return NextResponse.json({ need_login: true });
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  }

  const page = Math.max(parseInt(params.get("page") ?? "1", 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "50", 10) || 50, 1), 200);

  const provider = getProvider("netease");
  if (!provider?.getCloudSongs) {
    return NextResponse.json({ error: "云盘音乐仅支持网易云音乐" }, { status: 400 });
  }
  try {
    const r = await provider.getCloudSongs(page, limit);
    return NextResponse.json({
      songs: r.songs,
      has_more: r.has_more,
      size: r.size,
      max_size: r.max_size,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    /* 同上：未登录 200 + need_login */
    if (/登录/.test(msg)) return NextResponse.json({ need_login: true });
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

async function postHandler(req: NextRequest) {
  const guard = checkWriteGuard(req);
  if (guard) return guard;

  /* 高危操作频控：6 次/分钟/IP */
  if (!rateLimit(`cloud-write:${requestIP(req)}`, 6, 60_000)) {
    return NextResponse.json({ error: "操作过于频繁，请稍后再试" }, { status: 429 });
  }

  let body: { action?: string; id?: string; target?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* ignore */
  }
  const action = (body.action ?? "").trim();
  const id = (body.id ?? "").trim();
  /* 审核整改 C-02：id/target 数字白名单（防 NaN 序列化为 null 上送，破坏性操作前置校验） */
  if (!/^\d+$/.test(id) || !["match", "delete", "lyric"].includes(action)) {
    return NextResponse.json({ error: "参数无效" }, { status: 400 });
  }

  const provider = getProvider("netease");
  try {
    if (action === "match") {
      const target = (body.target ?? "").trim();
      if (!/^\d+$/.test(target) || !provider?.matchCloudSong) throw new Error("缺少匹配目标歌曲 id");
      await provider.matchCloudSong(id, target);
      return NextResponse.json({ ok: true });
    }
    if (action === "lyric") {
      if (!provider?.getCloudLyric) throw new Error("该源不支持云盘歌词");
      const lyric = await provider.getCloudLyric(id);
      return NextResponse.json({ lyric });
    }
    /* delete：二次确认语义由前端承担（确认弹窗），此处直接执行 */
    if (!provider?.deleteCloudSong) throw new Error("该源不支持云盘删除");
    await provider.deleteCloudSong(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "操作失败" }, { status: 502 });
  }
}
