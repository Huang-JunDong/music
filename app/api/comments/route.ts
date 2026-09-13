import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider, songFromParams } from "@/lib/registry";
import { checkWriteGuard } from "@/lib/write-guard";
import { rateLimit, requestIP } from "@/lib/rate-limit";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";
import type { CommentItem, CommentListResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 评论列表 60s 缓存（热评变动低频但新评刷新期望较快）；仅缓存成功结果 */
const commentsCache = createTtlCache<Record<string, unknown>>(60_000, 120);

/**
 * GET /api/comments?source=&id=&song参数集&sort=hot|new|recommended&page= → { comments, total, has_more }
 * P1 C3 增强：
 * - type=song|album|playlist|mv|video|dj 多资源评论区（网易 comment_new，失败自动回退旧版 comment_*）
 * - floor=1 + parent_id → 楼层回复详情（comment_floor）
 * POST /api/comments（JSON: song参数 + content + reply_to）→ { ok: true }（需登录对应源）
 * POST /api/comments（JSON: { action: "like"|"unlike", comment_id } / { action: "hug", comment_id, target_user_id }）
 * DELETE /api/comments（JSON: song参数 + comment_id）→ { ok: true }（仅能删自己的评论）
 */
const COMMENT_TYPES = new Set(["song", "album", "playlist", "mv", "video", "dj"]);

export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);
export const POST = (req: NextRequest) => withBrowserSourceSession(req, postHandler);
export const DELETE = (req: NextRequest) => withBrowserSourceSession(req, deleteHandler);

async function getHandler(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const song = songFromParams(params);
  if (!song.id || !song.source) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }
  const rawSort = params.get("sort") ?? "hot";
  const sort = rawSort === "new" ? "new" : rawSort === "recommended" ? "recommended" : "hot";
  /* P0 修复：type 缺省时回退 "song"（原三元在缺省时把 params.get("type") 的 null 赋给 type，
     下游 legacy[null] → invokeNcm(undefined) → "module not found: undefined"，歌曲评论全挂） */
  const rawType = params.get("type") ?? "song";
  const type = (COMMENT_TYPES.has(rawType) ? rawType : "song") as "song";
  const page = Math.max(parseInt(params.get("page") ?? "1", 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "20", 10) || 20, 1), 50);

  const provider = getProvider(song.source);

  /* 楼层回复详情（comment_floor，网易专属） */
  if (params.get("floor") === "1") {
    const parentId = (params.get("parent_id") ?? "").trim();
    if (!parentId) return NextResponse.json({ error: "缺少 parent_id" }, { status: 400 });
    if (!provider?.getCommentFloor) {
      return NextResponse.json({ error: "该源不支持楼层评论" }, { status: 400 });
    }
    try {
      const r = await provider.getCommentFloor({ type, id: song.id }, parentId, page, limit);
      return NextResponse.json(r);
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
    }
  }

  /* QQ 推荐评论（GetRecommendComments） */
  if (sort === "recommended" && provider?.getRecommendedComments) {
    try {
      const r = await provider.getRecommendedComments(song, { page, limit });
      return NextResponse.json({ comments: r.comments, total: r.total, has_more: r.has_more });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
    }
  }

  /* 新版评论（comment_new 多资源 + 楼层；网易失败自动回退旧版） */
  const v2Sort = sort === "new" ? "new" : "hot";
  if (provider?.getCommentsV2) {
    const payload = await commentsCache.wrap(
      `${req.nextUrl.search}|${sourceCookieFingerprint(req)}`,
      async (): Promise<Record<string, unknown>> => {
        try {
          const r: CommentListResult = await provider.getCommentsV2!({ type, id: song.id }, { sort: v2Sort, page, limit });
          return { comments: r.comments as CommentItem[], total: r.total, has_more: r.has_more };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
      (p) => !p.error,
    );
    if (!payload.error || type !== "song") return NextResponse.json(payload);
    /* song 类型新版失败 → 继续旧版兜底 */
  }

  if (!provider?.getSongComments) {
    return NextResponse.json({ error: "该源不支持评论" }, { status: 400 });
  }

  const payload = await commentsCache.wrap(
    `${req.nextUrl.search}|${sourceCookieFingerprint(req)}`,
    async (): Promise<Record<string, unknown>> => {
      try {
        const r: CommentListResult = await provider.getSongComments!(song, { sort: sort === "recommended" ? "hot" : sort, page, limit });
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
  /* 审核整改 R2-#1：写操作频控（对齐 cloud 范式，防高频刷上游评论接口） */
  if (!rateLimit(`comments-write:${requestIP(req)}`, 8, 60_000)) {
    return NextResponse.json({ error: "操作过于频繁，请稍后再试" }, { status: 429 });
  }

  let body: Record<string, string> = {};
  try {
    body = (await req.json()) as Record<string, string>;
  } catch {
    /* ignore */
  }
  const p = new URLSearchParams(body);
  const song = songFromParams(p);

  /* P1 C3：点赞 / 抱抱 评论（comment_like / hug_comment，网易专属） */
  const action = (body.action ?? "").trim();
  if (action === "like" || action === "unlike" || action === "hug") {
    const commentId = (body.comment_id ?? "").trim();
    if (!song.id || !song.source || !commentId) {
      return NextResponse.json({ error: "Missing params" }, { status: 400 });
    }
    const provider = getProvider(song.source);
    /* 同 GET：type 缺省回退 "song"（原写法缺省时赋 undefined） */
    const rawType = body.type ?? "song";
    const type = (COMMENT_TYPES.has(rawType) ? rawType : "song") as "song";
    try {
      if (action === "hug") {
        /* 审核整改 R2-#7：抱抱必须携带评论作者 id（原空串放行，上游以 uid=0 拒绝报错不可读） */
        const targetUserId = (body.target_user_id ?? "").trim();
        if (!targetUserId) return NextResponse.json({ error: "Missing target_user_id" }, { status: 400 });
        if (!provider?.hugComment) return NextResponse.json({ error: "该源不支持抱抱评论" }, { status: 400 });
        await provider.hugComment({ type, id: song.id }, commentId, targetUserId);
      } else {
        if (!provider?.likeComment) return NextResponse.json({ error: "该源不支持评论点赞" }, { status: 400 });
        await provider.likeComment({ type, id: song.id }, commentId, action === "like");
      }
      return NextResponse.json({ ok: true });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "操作失败" }, { status: 502 });
    }
  }

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
