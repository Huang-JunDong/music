import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider, songFromParams } from "@/lib/registry";
import { checkWriteGuard } from "@/lib/write-guard";
import { rateLimit, requestIP } from "@/lib/rate-limit";
import { UpstreamError } from "@/lib/types";
import type { Song } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/playlist/manage — 源站歌单管理（需对应源登录态）
 * { action: "create", source, name } → { ok, playlist_id }
 * { action: "delete", source, playlist_id } → { ok }
 * { action: "add_songs" | "remove_songs", source, playlist_id, songs: [song参数集] } → { ok }
 * { action: "update", source, playlist_id, name, desc? } → { ok }（仅网易支持编辑）
 * { action: "subscribe" | "unsubscribe", source, playlist_id } → { ok }（P1 B4：收藏歌单，网易 playlist_subscribe · QQ favSonglist）
 */
export const POST = (req: NextRequest) => withBrowserSourceSession(req, postHandler);

interface ManageBody {
  action?: string;
  source?: string;
  name?: string;
  desc?: string;
  playlist_id?: string;
  songs?: Record<string, string>[];
  playlist_ids?: string[];
}

async function postHandler(req: NextRequest) {
  const guard = checkWriteGuard(req);
  if (guard) return guard;
  /* 审核整改 R2-#1：写操作频控 */
  if (!rateLimit(`playlist-manage:${requestIP(req)}`, 8, 60_000)) {
    return NextResponse.json({ error: "操作过于频繁，请稍后再试" }, { status: 429 });
  }

  let body: ManageBody = {};
  try {
    body = (await req.json()) as ManageBody;
  } catch {
    /* ignore */
  }

  const action = (body.action ?? "").trim();
  const source = (body.source ?? "").trim();
  if (!action || !source) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }
  const provider = getProvider(source);

  try {
    if (action === "create") {
      const name = (body.name ?? "").trim();
      if (!name) return NextResponse.json({ error: "歌单名不能为空" }, { status: 400 });
      if (!provider?.createPlaylist) throw new UpstreamError("该源不支持创建歌单");
      const playlistId = await provider.createPlaylist!(name);
      return NextResponse.json({ ok: true, playlist_id: playlistId });
    }
    if (action === "delete") {
      const playlistId = (body.playlist_id ?? "").trim();
      if (!playlistId) return NextResponse.json({ error: "Missing playlist_id" }, { status: 400 });
      if (!provider?.deletePlaylist) throw new UpstreamError("该源不支持删除歌单");
      await provider.deletePlaylist!(playlistId);
      return NextResponse.json({ ok: true });
    }
    if (action === "update") {
      const playlistId = (body.playlist_id ?? "").trim();
      const name = (body.name ?? "").trim();
      if (!playlistId || !name) {
        return NextResponse.json({ error: "Missing playlist_id 或歌单名为空" }, { status: 400 });
      }
      if (!provider?.updatePlaylistInfo) throw new UpstreamError("该源不支持编辑歌单信息");
      await provider.updatePlaylistInfo!(playlistId, { name, desc: body.desc ?? "" });
      return NextResponse.json({ ok: true });
    }
    if (action === "add_songs" || action === "remove_songs") {
      const playlistId = (body.playlist_id ?? "").trim();
      if (!playlistId || !Array.isArray(body.songs) || !body.songs.length) {
        return NextResponse.json({ error: "Missing params" }, { status: 400 });
      }
      const songs: Song[] = body.songs.map((raw) => songFromParams(new URLSearchParams(raw)));
      const valid = songs.filter((s) => s.id && s.source === source);
      if (!valid.length) {
        /* 审核整改 R2-#13：原文案在第三方源时误导（提示"仅支持QQ音乐源歌曲"） */
        return NextResponse.json({ error: `歌曲与歌单源不一致（本次操作源：${source}）` }, { status: 400 });
      }
      if (action === "add_songs") {
        if (!provider?.addSongsToPlaylist) throw new UpstreamError("该源不支持添加歌曲");
        await provider.addSongsToPlaylist!(playlistId, valid);
      } else {
        if (!provider?.removeSongsFromPlaylist) throw new UpstreamError("该源不支持移除歌曲");
        await provider.removeSongsFromPlaylist!(playlistId, valid);
      }
      return NextResponse.json({ ok: true, count: valid.length });
    }
    if (action === "subscribe" || action === "unsubscribe") {
      const playlistId = (body.playlist_id ?? "").trim();
      if (!playlistId) return NextResponse.json({ error: "Missing playlist_id" }, { status: 400 });
      if (!provider?.subscribePlaylist) throw new UpstreamError("该源不支持收藏歌单");
      await provider.subscribePlaylist!(playlistId, action === "subscribe");
      return NextResponse.json({ ok: true });
    }
    /* P1 C4：歌单排序（playlist_order_update：ids 全量顺序，置顶=移至首位） */
    if (action === "order") {
      const playlistIds = Array.isArray((body as { playlist_ids?: string[] }).playlist_ids)
        ? (body as { playlist_ids: string[] }).playlist_ids.filter((x) => typeof x === "string" && x.trim())
        : [];
      if (playlistIds.length < 2) return NextResponse.json({ error: "至少需要两个歌单 id" }, { status: 400 });
      if (!provider?.updatePlaylistOrder) throw new UpstreamError("该源不支持歌单排序");
      await provider.updatePlaylistOrder!(playlistIds);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "无效的 action" }, { status: 400 });
  } catch (err) {
    /* 业务拒绝（能力缺失/需登录等客户端可纠正）→ 400；网络/服务故障 → 502（审核整改 P3-1） */
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "操作失败" },
      { status: err instanceof UpstreamError ? 400 : 502 },
    );
  }
}
