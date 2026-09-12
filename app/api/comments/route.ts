import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider, songFromParams } from "@/lib/registry";
import { checkWriteGuard } from "@/lib/write-guard";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";
import type { CommentItem, CommentListResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 评论列表 60s 缓存（热评变动低频但新评刷新期望较快）；仅缓存成功结果 */
const commentsCache = createTtlCache<Record<string, unknown>>(60_000, 120);

/**
 * GET /api/comments?source=&id=&song参数集&sort=hot|new&page= → { comments, total, has_more }
 * POST /api/comments（JSON: song参数 + content + reply_to）→ { ok: true }（需登录对应源）
 * DELETE /api/comments（JSON: song参数 + comment_id）→ { ok: true }（仅能删自己的评论）
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);
export const POST = (req: NextRequest) => withBrowserSourceSession(req, postHandler);
export const DELETE = (req: NextRequest) => withBrowserSourceSession(req, deleteHandler);

async function getHandler(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const song = songFromParams(params);
  if (!song.id || !song.source) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }
  const sort = params.get("sort") === "new" ? "new" : "hot";
  const page = Math.max(parseInt(params.get("page") ?? "1", 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "20", 10) || 20, 1), 50);

  const provider = getProvider(song.source);
  if (!provider?.getSongComments) {
    return NextResponse.json({ error: "该源不支持评论" }, { status: 400 });
  }

  const payload = await commentsCache.wrap(
    `${req.nextUrl.search}|${sourceCookieFingerprint(req)}`,
    async (): Promise<Record<string, unknown>> => {
      try {
        const r: CommentListResult = await provider.getSongComments!(song, { sort, page, limit });
        return { comments: r.comments as CommentItem[], total: r.total, has_more: r.has_more };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
    (p) => !p.error,
  );
  return NextResponse.json(payload);
}

async function postHandler(req: NextRequest) {
  const guard = checkWriteGuard(req);
  if (guard) return guard;

  let body: Record<string, string> = {};
  try {
    body = (await req.json()) as Record<string, string>;
  } catch {
    /* ignore */
  }
  const p = new URLSearchParams(body);
  const song = songFromParams(p);
  const content = (body.content ?? "").trim();
  const replyTo = (body.reply_to ?? "").trim() || undefined;
  if (!song.id || !song.source || !content) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }
  if (content.length > 140) {
    return NextResponse.json({ error: "评论最长 140 字" }, { status: 400 });
  }

  const provider = getProvider(song.source);
  if (!provider?.addSongComment) {
    return NextResponse.json({ error: "该源不支持发表评论" }, { status: 400 });
  }

  try {
    await provider.addSongComment!(song, content, replyTo);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "评论失败" },
      { status: 502 },
    );
  }
}

async function deleteHandler(req: NextRequest) {
  const guard = checkWriteGuard(req);
  if (guard) return guard;

  let body: Record<string, string> = {};
  try {
    body = (await req.json()) as Record<string, string>;
  } catch {
    /* ignore */
  }
  const p = new URLSearchParams(body);
  const song = songFromParams(p);
  const commentId = (body.comment_id ?? "").trim();
  if (!song.id || !song.source || !commentId) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const provider = getProvider(song.source);
  if (!provider?.deleteSongComment) {
    return NextResponse.json({ error: "该源不支持删除评论" }, { status: 400 });
  }

  try {
    await provider.deleteSongComment!(song, commentId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "删除评论失败" },
      { status: 502 },
    );
  }
}
