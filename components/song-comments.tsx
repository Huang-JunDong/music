"use client";

/**
 * 评论弹窗：热门/最新/推荐（QQ）排序 + 分页 + 发表/回复 + 点赞/抱抱/楼层展开
 * 网易 comment_new（自动回退 comment_music 等旧版）· QQ GetHot/New/RecommendCommentList
 * P1 C3：target 可选——多资源评论区（album/playlist/mv/video/dj），该模式下隐藏发表框。
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { MessageSquareHeart, RefreshCw, ThumbsUp, CornerDownRight, Send, Loader2, Trash2, UserRound, HeartHandshake, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/modal";
import { apiCommentsV2, apiAddSongComment, apiDeleteSongComment, apiLikeComment, apiHugComment, apiCommentFloor } from "@/lib/client/api";
import { coverProxyUrl } from "@/lib/play-url";
import type { CommentItem, Song, CommentTarget } from "@/lib/types";

type SortKey = "hot" | "new" | "recommended";

export function SongCommentsModal({
  song,
  open,
  onClose,
  target,
}: {
  song: Song | null;
  open: boolean;
  onClose: () => void;
  /** 多资源评论目标（默认 song；传入后按 type 走对应资源评论区，隐藏发表框） */
  target?: CommentTarget["type"];
}) {
  const [sort, setSort] = useState<SortKey>("hot");
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  /* P1 C3：已点赞评论 id 集（本地乐观标记） */
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  /* 发表框 */
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<CommentItem | null>(null);
  const [sending, setSending] = useState(false);
  const seqRef = useRef(0);

  const songKey = song ? `${song.source}:${song.id}` : "";
  const targetType = target ?? "song";
  const isMultiResource = targetType !== "song";

  /* 加载第一页（开弹窗/切排序/重试；P1 C3 走 V2 多资源通道，QQ recommended 为推荐评论） */
  useEffect(() => {
    if (!open || !song) return;
    let alive = true;
    const seq = ++seqRef.current;
    setLoading(true);
    setError("");
    apiCommentsV2(song, targetType, sort, 1)
      .then((r) => {
        if (!alive || seq !== seqRef.current) return;
        setLikedIds(new Set());
        if (r.error) throw new Error(r.error);
        setComments(r.comments ?? []);
        setTotal(r.total ?? 0);
        setHasMore(!!r.has_more);
        setPage(1);
      })
      .catch((e) => {
        if (alive && seq === seqRef.current) setError(e instanceof Error ? e.message : "加载评论失败");
      })
      .finally(() => {
        if (alive && seq === seqRef.current) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, songKey, sort, retryKey, targetType]);

  /* P1 C3：点赞评论（comment_like 网易专属；QQ 源静默不支持） */
  const toggleLike = async (c: CommentItem) => {
    if (!song || song.source !== "netease") {
      toast.error("评论点赞仅支持网易云音乐");
      return;
    }
    const willLike = !likedIds.has(c.id);
    /* 乐观更新 */
    setLikedIds((prev) => {
      const next = new Set(prev);
      if (willLike) next.add(c.id);
      else next.delete(c.id);
      return next;
    });
    setComments((prev) => prev.map((x) => (x.id === c.id ? { ...x, liked_count: Math.max(0, x.liked_count + (willLike ? 1 : -1)) } : x)));
    try {
      /* 审核整改 R2-F1：传当前资源类型（原硬编码 "song"，MV/歌单等评论区点赞错位失败） */
      await apiLikeComment(song, targetType, c.id, willLike);
    } catch (e) {
      /* 回滚 */
      setLikedIds((prev) => {
        const next = new Set(prev);
        if (willLike) next.delete(c.id);
        else next.add(c.id);
        return next;
      });
      setComments((prev) => prev.map((x) => (x.id === c.id ? { ...x, liked_count: Math.max(0, x.liked_count + (willLike ? -1 : 1)) } : x)));
      toast.error(e instanceof Error ? e.message : "点赞失败");
    }
  };

  /* P1 C3：抱抱评论（hug_comment 网易专属，需评论作者 id） */
  const hug = async (c: CommentItem) => {
    if (!song) return;
    if (song.source !== "netease") {
      toast.error("抱抱仅支持网易云音乐");
      return;
    }
    if (!c.user_id) {
      toast.error("该评论暂不支持抱抱");
      return;
    }
    try {
      await apiHugComment(song, targetType, c.id, c.user_id);
      toast.success(`已给 ${c.user} 一个抱抱`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "抱抱失败");
    }
  };

  /* P1 C3：展开楼层回复（comment_floor，网易专属） */
  const [floorOf, setFloorOf] = useState<string | null>(null);
  const [floorItems, setFloorItems] = useState<CommentItem[]>([]);
  const [floorLoading, setFloorLoading] = useState(false);
  /* 审核整改 R2-F3：楼层键控（快速切换不同评论的回复时，旧响应不覆盖新宿主的楼层） */
  const floorSeq = useRef(0);
  const loadFloor = async (c: CommentItem) => {
    if (!song) return;
    if (floorOf === c.id) {
      setFloorOf(null);
      return;
    }
    if (song.source !== "netease") {
      toast.error("楼层回复仅支持网易云音乐");
      return;
    }
    setFloorOf(c.id);
    const seq = ++floorSeq.current;
    setFloorLoading(true);
    try {
      const r = await apiCommentFloor(song, targetType, c.id, 1, 20);
      if (seq !== floorSeq.current) return;
      if (r.error) throw new Error(r.error);
      setFloorItems(r.comments ?? []);
    } catch (e) {
      if (seq !== floorSeq.current) return;
      toast.error(e instanceof Error ? e.message : "加载回复失败");
      setFloorOf(null);
    } finally {
      if (seq === floorSeq.current) setFloorLoading(false);
    }
  };

  const loadMore = () => {
    if (!song || loadingMore || !hasMore) return;
    const next = page + 1;
    setLoadingMore(true);
    apiCommentsV2(song, targetType, sort, next)
      .then((r) => {
        if (r.error) throw new Error(r.error);
        setComments((prev) => [...prev, ...(r.comments ?? [])]);
        setHasMore(!!r.has_more);
        setTotal(r.total ?? 0);
        setPage(next);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "加载更多失败"))
      .finally(() => setLoadingMore(false));
  };

  const submit = async () => {
    if (!song || sending) return;
    const content = draft.trim();
    if (!content) return;
    setSending(true);
    try {
      await apiAddSongComment(song, content, replyTo?.id);
      toast.success(replyTo ? "回复成功" : "评论成功");
      setDraft("");
      setReplyTo(null);
      /* 发表成功 → 切到最新并刷新（自己的评论可见） */
      if (sort !== "new") setSort("new");
      else setRetryKey((k) => k + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "评论失败（可能需要登录对应源账号）");
    } finally {
      setSending(false);
    }
  };

  /* 删除评论（上游仅允许删自己的；删除后刷新当前页） */
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const remove = async (c: CommentItem) => {
    if (!song || deletingId) return;
    if (!window.confirm(`删除这条评论？\n「${c.content.slice(0, 40)}${c.content.length > 40 ? "…" : ""}」`)) return;
    setDeletingId(c.id);
    try {
      await apiDeleteSongComment(song, c.id);
      toast.success("评论已删除");
      setComments((prev) => prev.filter((x) => x.id !== c.id));
      setTotal((t) => Math.max(t - 1, 0));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败（仅能删除自己的评论）");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Modal open={open && !!song} onClose={onClose} maxWidth={560} title={song ? `评论 · ${song.name}` : "评论"}>
      {/* 排序 tab */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="glass inline-flex rounded-lg border border-white/[0.07] p-0.5" role="tablist" aria-label="评论排序">
          {[
            { key: "hot" as SortKey, label: "热门" },
            { key: "new" as SortKey, label: "最新" },
            /* P1 C3：QQ 推荐评论（GetRecommendComments） */
            ...(song?.source === "qq" ? [{ key: "recommended" as SortKey, label: "推荐" }] : []),
          ].map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={sort === t.key}
              onClick={() => setSort(t.key)}
              className={`flex min-h-[36px] items-center rounded-md px-3 text-[12.5px] font-medium transition-colors ${
                sort === t.key ? "bg-white/[0.08] text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {t.label}
              {sort === t.key && total > 0 && <span className="ml-1 text-[11px] tabular-nums text-zinc-500">{total}</span>}
            </button>
          ))}
        </div>
        <button
          onClick={() => setRetryKey((k) => k + 1)}
          aria-label="刷新评论"
          className="flex h-11 w-11 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/[0.05] hover:text-zinc-200"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* 列表 */}
      <div className="max-h-[46vh] overflow-y-auto pr-1">
        {loading ? (
          <div className="space-y-3 py-2" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex gap-2.5">
                <div className="shimmer h-8 w-8 shrink-0 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <div className="shimmer h-3 w-24 rounded" />
                  <div className="shimmer h-3.5 w-full rounded" />
                  <div className="shimmer h-3.5 w-2/3 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <MessageSquareHeart className="h-8 w-8 text-amber-300/70" aria-hidden="true" />
            <p className="text-[13px] leading-relaxed text-zinc-400">{error}</p>
            <button
              onClick={() => {
                setError("");
                setRetryKey((k) => k + 1);
              }}
              className="mt-1 flex h-9 items-center gap-1.5 rounded-lg border border-white/[0.12] bg-white/[0.04] px-4 text-[12.5px] text-zinc-200 transition-colors hover:bg-white/[0.08]"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> 重试
            </button>
          </div>
        ) : comments.length ? (
          <>
            <ul className="space-y-1">
              {comments.map((c, i) => (
                <motion.li
                  key={`${c.id}-${i}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.02, 0.3), duration: 0.22 }}
                  className="flex gap-2.5 rounded-xl p-2 transition-colors hover:bg-white/[0.03]"
                >
                  {/* P1 A2：头像可跳用户主页（网易 userId 存在时；QQ 无公开用户页参数则纯展示） */}
                  {c.user_id && song?.source === "netease" ? (
                    <Link
                      href={`/user/${c.user_id}?source=netease`}
                      onClick={onClose}
                      aria-label={`查看 ${c.user} 的主页`}
                      className="shrink-0"
                    >
                      {c.avatar ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={coverProxyUrl(c.avatar, "netease")}
                          alt=""
                          loading="lazy"
                          className="h-8 w-8 rounded-full object-cover ring-1 ring-transparent transition-all hover:ring-violet-400/50"
                        />
                      ) : (
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.06] transition-colors hover:bg-white/[0.1]">
                          <UserRound className="h-4 w-4 text-zinc-500" aria-hidden="true" />
                        </span>
                      )}
                    </Link>
                  ) : c.avatar ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={coverProxyUrl(c.avatar, song?.source ?? "netease")}
                      alt=""
                      loading="lazy"
                      className="h-8 w-8 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06]">
                      <UserRound className="h-4 w-4 text-zinc-500" aria-hidden="true" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-[12.5px] font-semibold text-zinc-300">{c.user}</span>
                      {c.location && <span className="shrink-0 text-[11.5px] text-zinc-600">{c.location}</span>}
                      {c.time && <span className="ml-auto shrink-0 text-[11.5px] text-zinc-600">{c.time}</span>}
                    </div>
                    {c.reply_to && (
                      <p className="mt-1 truncate rounded-md bg-white/[0.04] px-2 py-1 text-[11.5px] text-zinc-500">
                        <CornerDownRight className="mr-1 inline h-3 w-3" aria-hidden="true" />
                        回复 {c.reply_to.user}：{c.reply_to.content}
                      </p>
                    )}
                    <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-zinc-200">
                      {c.content}
                    </p>
                    <div className="mt-1 flex items-center gap-3">
                      {/* P1 C3：点赞评论（comment_like，网易专属；本地乐观计数） */}
                      <button
                        onClick={() => toggleLike(c)}
                        aria-label={`点赞 ${c.user} 的评论`}
                        className="flex min-h-[32px] items-center gap-1 text-[11px] tabular-nums text-zinc-500 transition-colors hover:text-rose-300"
                      >
                        <ThumbsUp className="h-3 w-3" aria-hidden="true" />
                        {c.liked_count}
                      </button>
                      <button
                        onClick={() => {
                          setReplyTo(c);
                          setDraft(`@${c.user} `);
                        }}
                        className="min-h-[32px] text-[11px] text-zinc-500 transition-colors hover:text-violet-300"
                      >
                        回复
                      </button>
                      {/* P1 C3：抱抱（hug_comment，网易专属） */}
                      {song?.source === "netease" && c.user_id && (
                        <button
                          onClick={() => void hug(c)}
                          aria-label={`抱抱 ${c.user} 的评论`}
                          className="flex items-center gap-0.5 text-[11px] text-zinc-500 transition-colors hover:text-pink-300"
                        >
                          <HeartHandshake className="h-3 w-3" aria-hidden="true" /> 抱抱
                        </button>
                      )}
                      {/* P1 C3：展开楼层回复（comment_floor，网易专属） */}
                      {song?.source === "netease" && (c.reply_count ?? 0) > 0 && (
                        <button
                          onClick={() => void loadFloor(c)}
                          aria-expanded={floorOf === c.id}
                          className="flex items-center gap-0.5 text-[11px] text-zinc-500 transition-colors hover:text-cyan-300"
                        >
                          {floorOf === c.id ? "收起回复" : `展开 ${c.reply_count} 条回复`}
                          <ChevronDown className={`h-3 w-3 transition-transform ${floorOf === c.id ? "rotate-180" : ""}`} aria-hidden="true" />
                        </button>
                      )}
                      <button
                        onClick={() => void remove(c)}
                        disabled={deletingId !== null}
                        aria-label="删除评论"
                        title="删除（仅自己的评论）"
                        className="flex items-center gap-1 text-[11px] text-zinc-600 transition-colors hover:text-rose-300 disabled:opacity-50"
                      >
                        {deletingId === c.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                        ) : (
                          <Trash2 className="h-3 w-3" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                    {/* P1 C3：楼层回复子列表（comment_floor） */}
                    {floorOf === c.id && (
                      <div className="mt-2 ml-10 rounded-xl bg-white/[0.02] p-2.5" aria-label="楼层回复">
                        {floorLoading ? (
                          <p className="flex items-center gap-1.5 py-1.5 text-[11.5px] text-zinc-500">
                            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> 加载回复中…
                          </p>
                        ) : floorItems.length ? (
                          <ul className="space-y-1.5">
                            {floorItems.map((f, fi) => (
                              <li key={`${f.id}-${fi}`} className="flex items-start gap-2">
                                <CornerDownRight className="mt-0.5 h-3 w-3 shrink-0 text-zinc-600" aria-hidden="true" />
                                <span className="min-w-0 flex-1">
                                  <b className="text-[11.5px] font-semibold text-zinc-300">{f.user}</b>
                                  <span className="ml-1.5 text-[11.5px] leading-relaxed text-zinc-400">{f.content}</span>
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="py-1.5 text-[11.5px] text-zinc-500">暂无更多回复</p>
                        )}
                      </div>
                    )}
                  </div>
                </motion.li>
              ))}
            </ul>
            {hasMore && (
              <div className="flex justify-center py-3">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="flex h-9 items-center gap-1.5 rounded-lg border border-white/[0.12] bg-white/[0.04] px-4 text-[12.5px] text-zinc-300 transition-colors hover:bg-white/[0.08] disabled:opacity-50"
                >
                  {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
                  {loadingMore ? "加载中…" : "加载更多"}
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <MessageSquareHeart className="h-8 w-8 text-zinc-600" aria-hidden="true" />
            <p className="text-[13px] text-zinc-500">还没有评论，来抢沙发吧</p>
          </div>
        )}
      </div>

      {/* 发表框（多资源评论区只读，隐藏发表） */}
      {!isMultiResource && (
      <div className="mt-3 border-t border-white/[0.07] pt-3">
        {replyTo && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-violet-500/10 px-2.5 py-1.5 text-[11.5px] text-violet-200/90">
            <span className="truncate">
              回复 {replyTo.user}：{replyTo.content.slice(0, 30)}
              {replyTo.content.length > 30 ? "…" : ""}
            </span>
            <button onClick={() => setReplyTo(null)} aria-label="取消回复" className="shrink-0 text-violet-300/70 hover:text-violet-100">
              取消
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <label className="sr-only" htmlFor="comment-input">
            发表评论
          </label>
          <textarea
            id="comment-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 140))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void submit();
              }
            }}
            rows={2}
            placeholder={`${song?.source === "qq" ? "QQ音乐" : "网易云"}账号登录后可评论（Ctrl+Enter 发送）`}
            className="input-shell min-h-[56px] flex-1 resize-none rounded-xl px-3 py-2 text-[13px] text-zinc-100"
          />
          <button
            onClick={() => void submit()}
            disabled={sending || !draft.trim()}
            aria-label="发送评论"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/25 transition-all hover:brightness-110 active:scale-95 disabled:opacity-40"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
        <p className="mt-1 text-right text-[11.5px] tabular-nums text-zinc-600">{draft.length}/140</p>
      </div>
      )}
    </Modal>
  );
}
