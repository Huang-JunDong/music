"use client";

/** 播放队列 / 历史抽屉：PC 右侧滑出，移动底部上滑；遮罩点击 / Esc 关闭；清空前二次确认 */
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, ListMusic, History, Trash2, Play, Music4 } from "lucide-react";
import { usePlayer } from "@/lib/client/store";
import { coverUrl, sourceMeta } from "@/lib/client/ui";
import { ConfirmDialog } from "@/components/modal";

export function QueueDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<"queue" | "history">("queue");
  const [confirmClear, setConfirmClear] = useState(false);
  const { queue, index, history, play, removeFromQueue, clearQueue, clearHistory } = usePlayer();

  /* Esc 关闭 + 打开时锁定背景滚动 */
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  const doClear = () => {
    if (tab === "queue") clearQueue();
    else clearHistory();
    setConfirmClear(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 360, damping: 36 }}
            className="glass safe-bottom fixed inset-x-0 bottom-0 z-50 flex h-[72dvh] flex-col rounded-t-3xl border-t border-white/[0.1] lg:inset-y-0 lg:left-auto lg:right-0 lg:h-auto lg:w-[380px] lg:rounded-none lg:border-l lg:border-t-0"
            role="dialog"
            aria-label="播放队列"
          >
            <span className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/15 lg:hidden" aria-hidden="true" />
            <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
              <div className="glass flex rounded-xl border border-white/[0.07] p-1" role="tablist" aria-label="队列或历史">
                <button
                  role="tab"
                  aria-selected={tab === "queue"}
                  onClick={() => setTab("queue")}
                  className={`relative flex min-h-[36px] items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-colors ${
                    tab === "queue" ? "text-white" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {tab === "queue" && (
                    <motion.span layoutId="queue-tab" className="absolute inset-0 rounded-lg bg-gradient-to-r from-violet-500/25 to-fuchsia-500/20 ring-1 ring-violet-400/30" />
                  )}
                  <ListMusic className="relative h-3.5 w-3.5" aria-hidden="true" />
                  <span className="relative">队列 {queue.length}</span>
                </button>
                <button
                  role="tab"
                  aria-selected={tab === "history"}
                  onClick={() => setTab("history")}
                  className={`relative flex min-h-[36px] items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-colors ${
                    tab === "history" ? "text-white" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {tab === "history" && (
                    <motion.span layoutId="queue-tab" className="absolute inset-0 rounded-lg bg-gradient-to-r from-violet-500/25 to-fuchsia-500/20 ring-1 ring-violet-400/30" />
                  )}
                  <History className="relative h-3.5 w-3.5" aria-hidden="true" />
                  <span className="relative">历史 {history.length}</span>
                </button>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setConfirmClear(true)}
                  disabled={tab === "queue" ? queue.length === 0 : history.length === 0}
                  aria-label={tab === "queue" ? "清空队列" : "清空历史"}
                  title={tab === "queue" ? "清空队列" : "清空历史"}
                  className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-500 transition-colors hover:text-red-300 disabled:opacity-30 disabled:hover:text-zinc-500"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <button onClick={onClose} aria-label="关闭" className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-500 hover:text-zinc-200">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {tab === "queue" ? (
                queue.length === 0 ? (
                  <EmptyHint text="队列为空，去搜索或打开歌单播放吧" />
                ) : (
                  queue.map((s, i) => {
                    const cur = i === index;
                    const meta = sourceMeta(s.source);
                    return (
                      <div
                        key={`${s.source}-${s.id}-${i}`}
                        className={`group flex min-h-[56px] items-center gap-3 rounded-xl px-2 transition-colors ${cur ? "bg-violet-500/[0.14]" : "hover:bg-white/[0.04]"}`}
                      >
                        <button onClick={() => play(s, queue)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                          <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-zinc-800">
                            {s.cover ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={coverUrl(s)} alt="" className="h-full w-full object-cover" loading="lazy" />
                            ) : (
                              <Music4 className="absolute inset-0 m-auto h-4 w-4 text-zinc-500" aria-hidden="true" />
                            )}
                          </span>
                          <span className="flex min-w-0 flex-col">
                            <span className={`truncate text-[13px] font-semibold ${cur ? "text-fuchsia-200" : "text-zinc-200"}`} title={`${s.name} - ${s.artist || "未知歌手"}`}>{s.name}</span>
                            <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                              <span className={`shrink-0 rounded border px-1 text-[9px] ${meta.badge}`}>{meta.label}</span>
                              <span className="min-w-0 flex-1 truncate">{s.artist}</span>
                            </span>
                          </span>
                        </button>
                        <button
                          onClick={() => removeFromQueue(i)}
                          aria-label={`移除 ${s.name}`}
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-zinc-500 opacity-0 transition-opacity hover:text-red-300 group-hover:opacity-100"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })
                )
              ) : history.length === 0 ? (
                <EmptyHint text="暂无播放历史" />
              ) : (
                history.map((s, i) => {
                  const meta = sourceMeta(s.source);
                  return (
                    <button
                      key={`${s.source}-${s.id}-h-${i}`}
                      onClick={() => play(s)}
                      className="flex min-h-[56px] w-full items-center gap-3 rounded-xl px-2 text-left transition-colors hover:bg-white/[0.04]"
                    >
                      <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-zinc-800">
                        {s.cover ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={coverUrl(s)} alt="" className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <Music4 className="absolute inset-0 m-auto h-4 w-4 text-zinc-500" aria-hidden="true" />
                        )}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[13px] font-semibold text-zinc-200" title={`${s.name} - ${s.artist || "未知歌手"}`}>{s.name}</span>
                        <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                          <span className={`shrink-0 rounded border px-1 text-[9px] ${meta.badge}`}>{meta.label}</span>
                          <span className="min-w-0 flex-1 truncate">{s.artist}</span>
                        </span>
                      </span>
                      <Play className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden="true" />
                    </button>
                  );
                })
              )}
            </div>
          </motion.div>

          {/* 清空二次确认 */}
          <ConfirmDialog
            open={confirmClear}
            onClose={() => setConfirmClear(false)}
            onConfirm={doClear}
            title={tab === "queue" ? "清空播放队列" : "清空播放历史"}
            confirmText="清空"
            description={
              tab === "queue"
                ? <>确定清空全部 {queue.length} 首播放队列吗？当前播放会继续。</>
                : <>确定清空全部 {history.length} 条播放历史吗？</>
            }
          />
        </>
      )}
    </AnimatePresence>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <Music4 className="h-8 w-8 text-zinc-600" aria-hidden="true" />
      <p className="text-[13px] text-zinc-500">{text}</p>
    </div>
  );
}
