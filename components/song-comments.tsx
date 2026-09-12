"use client";

/**
 * 歌曲评论弹窗：热门/最新排序 tab + 分页加载 + 发表/回复（@对象）
 * 网易 comment_music · QQ GetHotCommentList/GetNewCommentList（写入需对应源登录）
 */
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { MessageSquareHeart, RefreshCw, ThumbsUp, CornerDownRight, Send, Loader2, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/modal";
import { apiSongComments, apiAddSongComment, apiDeleteSongComment } from "@/lib/client/api";
import { coverProxyUrl } from "@/lib/play-url";
import type { CommentItem, Song } from "@/lib/types";

type SortKey = "hot" | "new";

export function SongCommentsModal({ song, open, onClose }: { song: Song | null; open: boolean; onClose: () => void }) {
  const [sort, setSort] = useState<SortKey>("hot");
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
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

  /* 加载第一页（开弹窗/切排序/重试） */
  useEffect(() => {
    if (!open || !song) return;
    let alive = true;
    const seq = ++seqRef.current;
    setLoading(true);
    setError("");
    apiSongComments(song, sort, 1)
      .then((r) => {
        if (!alive || seq !== seqRef.current) return;
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
  }, [open, songKey, sort, retryKey]);

  const loadMore = () => {
    if (!song || loadingMore || !hasMore) return;
    const next = page + 1;
    setLoadingMore(true);
    apiSongComments(song, sort, next)
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
          ].map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={sort === t.key}
              onClick={() => setSort(t.key)}
              className={`flex min-h-[32px] items-center rounded-md px-3 text-[12.5px] font-medium transition-colors ${
                sort === t.key ? "bg-white/[0.08] text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {t.label}
              {sort === t.key && total > 0 && <span className="ml-1 text-[10px] tabular-nums text-zinc-500">{total}</span>}
            </button>
          ))}
        </div>
        <button
          onClick={() => setRetryKey((k) => k + 1)}
          aria-label="刷新评论"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/[0.05] hover:text-zinc-200"
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
                  {c.avatar ? (
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
                      {c.location && <span className="shrink-0 text-[10.5px] text-zinc-600">{c.location}</span>}
                      {c.time && <span className="ml-auto shrink-0 text-[10.5px] text-zinc-600">{c.time}</span>}
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
                      <span className="flex items-center gap-1 text-[11px] tabular-nums text-zinc-500">
                        <ThumbsUp className="h-3 w-3" aria-hidden="true" />
                        {c.liked_count}
                      </span>
                      <button
                        onClick={() => {
                          setReplyTo(c);
                          setDraft(`@${c.user} `);
                        }}
                        className="text-[11px] text-zinc-500 transition-colors hover:text-violet-300"
                      >
                        回复
                      </button>
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

      {/* 发表框 */}
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
        <p className="mt-1 text-right text-[10.5px] tabular-nums text-zinc-600">{draft.length}/140</p>
      </div>
    </Modal>
  );
}
