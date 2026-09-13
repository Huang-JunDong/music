"use client";

/**
 * 歌曲百科弹窗（P1 C1）— 播放页"百科"入口。
 * 网易：图文段落 + 创作人员 + 元信息 + 精彩评论数 + 版权替代推荐；
 * QQ：标签 + 制作人 + 其他版本（可点击切歌）+ 收藏数。
 * 懒加载：打开时才请求（Tab 切换时才请求的语义由 open 控制）。
 */
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { BookOpenText, Play, RefreshCw, UserRound, Sparkles, Copyright, X } from "lucide-react";
import { toast } from "sonner";
import { apiSongWiki } from "@/lib/client/api";
import { usePlayer } from "@/lib/client/store";
import { coverProxyUrl, sourceMeta } from "@/lib/play-url";
import { formatDuration, type Song, type SongWiki } from "@/lib/types";

export function SongWikiPanel({ song, open, onClose }: { song: Song | null; open: boolean; onClose: () => void }) {
  const [wiki, setWiki] = useState<SongWiki | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  /* 审核整改 C-09：selector 订阅 play */
  const play = usePlayer((s) => s.play);

  /* 审核整改 C-10：弹层打开期间锁定背景滚动（对齐 app-shell MobileDrawer 范式） */
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !song) return;
    let alive = true;
    setLoading(true);
    setError("");
    apiSongWiki(song)
      .then((r) => {
        if (!alive) return;
        if (r.error) throw new Error(r.error);
        setWiki(r.wiki ?? null);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "百科加载失败"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, song?.id, song?.source, retryKey]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center" onClick={onClose} role="dialog" aria-modal="true" aria-label="歌曲百科">
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 400, damping: 34 }}
        className="flex max-h-[86vh] w-[min(96vw,720px)] flex-col rounded-t-3xl border border-white/[.1] bg-zinc-950/95 pb-[env(safe-area-inset-bottom)] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/[.07] p-4">
          <h2 className="flex items-center gap-2 text-[15px] font-bold text-zinc-100">
            <BookOpenText className="h-4 w-4 text-fuchsia-300" aria-hidden="true" />
            歌曲百科
            {song && <span className={`rounded border px-1.5 py-px text-[11px] ${sourceMeta(song.source).badge}`}>{sourceMeta(song.source).label}</span>}
          </h2>
          <div className="flex items-center gap-1">
            <button onClick={() => setRetryKey((k) => k + 1)} aria-label="刷新" className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200">
              <RefreshCw className="h-4 w-4" />
            </button>
            <button onClick={onClose} aria-label="关闭" className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4" aria-busy={loading}>
          {error ? (
            <p className="py-10 text-center text-[13px] text-red-300">{error}</p>
          ) : loading ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="shimmer h-20 rounded-2xl" />
              ))}
            </div>
          ) : !wiki || (!wiki.sections.length && !wiki.creators?.length && !wiki.meta?.length && !wiki.other_versions?.length) ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <BookOpenText className="h-8 w-8 text-zinc-600" aria-hidden="true" />
              <p className="text-[13px] text-zinc-500">这首歌还没有百科资料</p>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {/* 元信息 + 精彩评论数 */}
              {(wiki.meta?.length || wiki.hot_comment_count !== undefined) && (
                <section aria-label="歌曲信息">
                  <h3 className="mb-2 text-[12px] font-semibold tracking-wide text-zinc-400">歌曲信息</h3>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {(wiki.meta ?? []).map((m, i) => (
                      <div key={i} className="rounded-xl border border-white/[.06] bg-white/[0.03] p-2.5">
                        <p className="truncate text-[11.5px] text-zinc-500" title={m.label}>{m.label}</p>
                        <p className="mt-0.5 truncate text-[12.5px] font-bold text-zinc-100" title={m.value}>{m.value}</p>
                      </div>
                    ))}
                    {wiki.hot_comment_count !== undefined && (
                      <div className="rounded-xl border border-red-400/20 bg-red-500/[0.06] p-2.5">
                        <p className="text-[11.5px] text-zinc-500">精彩评论</p>
                        <p className="mt-0.5 text-[12.5px] font-bold text-red-200">{wiki.hot_comment_count.toLocaleString("zh-CN")} 条</p>
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* 图文段落 */}
              {wiki.sections.length > 0 && (
                <section aria-label="百科图文">
                  {wiki.sections.map((sec, i) => (
                    <div key={i} className={i > 0 ? "mt-4" : ""}>
                      <h4 className="flex items-center gap-1.5 text-[13px] font-semibold text-zinc-200">
                        <Sparkles className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" /> {sec.title}
                      </h4>
                      <p className="mt-1.5 text-[12.5px] leading-relaxed text-zinc-400">{sec.content}</p>
                    </div>
                  ))}
                </section>
              )}

              {/* 创作人员 */}
              {wiki.creators?.length ? (
                <section aria-label="创作人员">
                  <h3 className="mb-2 text-[12px] font-semibold tracking-wide text-zinc-400">创作人员</h3>
                  <ul className="grid gap-1.5 sm:grid-cols-2">
                    {wiki.creators.map((c, i) => (
                      <li key={i} className="flex items-center gap-2.5 rounded-xl bg-white/[0.02] px-3 py-2">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.05]">
                          <UserRound className="h-4 w-4 text-zinc-500" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <b className="block truncate text-[12.5px] text-zinc-200">{c.name}</b>
                          <span className="block text-[11px] text-zinc-500">{c.role}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {/* 其他版本（可点击切歌） */}
              {wiki.other_versions?.length ? (
                <section aria-label="其他版本">
                  <h3 className="mb-2 text-[12px] font-semibold tracking-wide text-zinc-400">其他版本（Live / 伴奏 / 翻唱）</h3>
                  <ul className="flex flex-col gap-1">
                    {wiki.other_versions.map((v, i) => (
                      <li key={`${v.id}-${i}`}>
                        <button
                          onClick={() => {
                            play(v, wiki.other_versions);
                            toast.success(`已切换：${v.name}`);
                            onClose();
                          }}
                          className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-white/[0.05]"
                          aria-label={`播放 ${v.name}`}
                        >
                          {v.cover ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={coverProxyUrl(v.cover, v.source)} alt="" loading="lazy" className="h-9 w-9 rounded-lg object-cover" />
                          ) : (
                            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.05]">
                              <Play className="h-4 w-4 text-zinc-500" aria-hidden="true" />
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <b className="block truncate text-[12.5px] text-zinc-200">{v.name}</b>
                            <span className="block truncate text-[11px] text-zinc-500">{v.artist} · {formatDuration(v.duration)}</span>
                          </span>
                          <Play className="h-3.5 w-3.5 shrink-0 text-zinc-600" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {/* 版权受限替代推荐 */}
              {wiki.substitutes?.length ? (
                <section aria-label="版权替代推荐">
                  <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold tracking-wide text-zinc-400">
                    <Copyright className="h-3.5 w-3.5" aria-hidden="true" /> 版权受限？试试这些
                  </h3>
                  <ul className="flex flex-col gap-1">
                    {wiki.substitutes.slice(0, 5).map((v, i) => (
                      <li key={`${v.id}-${i}`}>
                        <button
                          onClick={() => {
                            play(v, wiki.substitutes);
                            toast.success(`已切换：${v.name}`);
                            onClose();
                          }}
                          className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-white/[0.05]"
                          aria-label={`播放 ${v.name}`}
                        >
                          {v.cover ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={coverProxyUrl(v.cover, v.source)} alt="" loading="lazy" className="h-9 w-9 rounded-lg object-cover" />
                          ) : null}
                          <span className="min-w-0 flex-1">
                            <b className="block truncate text-[12.5px] text-zinc-200">{v.name}</b>
                            <span className="block truncate text-[11px] text-zinc-500">{v.artist}</span>
                          </span>
                          <Play className="h-3.5 w-3.5 shrink-0 text-zinc-600" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
