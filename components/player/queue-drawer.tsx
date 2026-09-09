"use client";

/** 播放队列 / 历史抽屉：PC 右侧滑出，移动底部上滑；遮罩点击 / Esc 关闭；清空前二次确认 */
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, ListMusic, History, Trash2, Play, Music4 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { usePlayer } from "@/lib/client/store";
import { coverUrl, sourceMeta } from "@/lib/client/ui";
import type { Song } from "@/lib/types";
import { ConfirmDialog } from "@/components/modal";

/** 键盘焦点环（对齐 UX 准则：模态内控件必须有可见焦点指示） */
const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60";

export function QueueDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<"queue" | "history">("queue");
  const [confirmClear, setConfirmClear] = useState(false);
  /* useShallow 精确订阅（对齐项目内其他播放器组件）：currentTime 8Hz 更新不再触发抽屉全列表重渲染 */
  const { queue, index, history, play, removeFromQueue, clearQueue, clearHistory } = usePlayer(
    useShallow((s) => ({
      queue: s.queue,
      index: s.index,
      history: s.history,
      play: s.play,
      removeFromQueue: s.removeFromQueue,
      clearQueue: s.clearQueue,
      clearHistory: s.clearHistory,
    })),
  );

  const panelRef = useRef<HTMLDivElement | null>(null);
  const currentRowRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

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

  /* 对话框焦点管理：打开时焦点移入面板（Esc/读屏上下文），关闭时返还触发元素 */
  useEffect(() => {
    if (open) {
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
      panelRef.current?.focus({ preventScroll: true });
    } else {
      restoreFocusRef.current?.focus?.({ preventScroll: true });
      restoreFocusRef.current = null;
    }
  }, [open]);

  /* 队列 tab 可见时定位当前播放曲目（瞬时滚动：smooth 由主线程驱动，长队列会卡顿） */
  useEffect(() => {
    if (open && tab === "queue") currentRowRef.current?.scrollIntoView({ behavior: "auto", block: "center" });
  }, [open, tab]);

  const onCurrentRow = useCallback((el: HTMLDivElement | null) => {
    currentRowRef.current = el;
  }, []);

  /* tablist 左右方向键切换（对齐 WAI-ARIA tabs 模式） */
  const onTablistKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      setTab((t) => (t === "queue" ? "history" : "queue"));
    }
  };

  const doClear = () => {
    if (tab === "queue") clearQueue();
    else void clearHistory();
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
            ref={panelRef}
            tabIndex={-1}
            className="glass safe-bottom fixed inset-x-0 bottom-0 z-50 flex h-[72dvh] flex-col rounded-t-3xl border-t border-white/[0.1] focus:outline-none lg:inset-y-0 lg:left-auto lg:right-0 lg:h-auto lg:w-[380px] lg:rounded-none lg:border-l lg:border-t-0"
            role="dialog"
            aria-modal="true"
            aria-label="播放队列与历史"
          >
            <span className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/15 lg:hidden" aria-hidden="true" />
            <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
              <div
                className="glass flex rounded-xl border border-white/[0.07] p-1"
                role="tablist"
                aria-label="队列或历史"
                onKeyDown={onTablistKey}
              >
                <button
                  role="tab"
                  id="qd-tab-queue"
                  aria-selected={tab === "queue"}
                  aria-controls="qd-panel"
                  onClick={() => setTab("queue")}
                  className={`relative flex min-h-[36px] items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-colors ${FOCUS_RING} ${
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
                  id="qd-tab-history"
                  aria-selected={tab === "history"}
                  aria-controls="qd-panel"
                  onClick={() => setTab("history")}
                  className={`relative flex min-h-[36px] items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-colors ${FOCUS_RING} ${
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
                  className={`flex h-11 w-11 items-center justify-center rounded-full text-zinc-500 transition-colors hover:text-red-300 disabled:opacity-30 disabled:hover:text-zinc-500 ${FOCUS_RING}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <button
                  onClick={onClose}
                  aria-label="关闭"
                  className={`flex h-11 w-11 items-center justify-center rounded-full text-zinc-500 hover:text-zinc-200 ${FOCUS_RING}`}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div
              id="qd-panel"
              className="flex-1 overflow-y-auto p-2"
              role="tabpanel"
              aria-labelledby={tab === "queue" ? "qd-tab-queue" : "qd-tab-history"}
            >
              {/* tab 切换淡入（enter 快、无 exit：mode=wait 的空档比瞬切更生硬） */}
              <motion.div
                key={tab}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                {tab === "queue" ? (
                  queue.length === 0 ? (
                    <EmptyHint text="队列为空，去搜索或打开歌单播放吧" />
                  ) : (
                    queue.map((s, i) => (
                      <QueueRow
                        key={`${s.source}-${s.id}`}
                        song={s}
                        current={i === index}
                        queue={queue}
                        play={play}
                        removeFromQueue={removeFromQueue}
                        onCurrent={onCurrentRow}
                      />
                    ))
                  )
                ) : history.length === 0 ? (
                  <EmptyHint text="暂无播放历史" sub="播放过的歌曲会自动记录在这里" />
                ) : (
                  history.map((s) => <HistoryRow key={`${s.source}-${s.id}`} song={s} play={play} />)
                )}
              </motion.div>
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

/* ---------- 行组件（memo）：store action 引用稳定，切歌/换 tab 只重渲染状态变化的行 ---------- */

function SongAvatar({ song }: { song: Song }) {
  return (
    <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-zinc-800">
      {song.cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverUrl(song)} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <Music4 className="absolute inset-0 m-auto h-4 w-4 text-zinc-500" aria-hidden="true" />
      )}
    </span>
  );
}

const QueueRow = memo(function QueueRow({
  song,
  current,
  queue,
  play,
  removeFromQueue,
  onCurrent,
}: {
  song: Song;
  current: boolean;
  queue: Song[];
  play: (song: Song, list?: Song[]) => void;
  removeFromQueue: (i: number) => void;
  onCurrent: (el: HTMLDivElement | null) => void;
}) {
  const meta = sourceMeta(song.source);
  return (
    <div
      ref={current ? onCurrent : undefined}
      className={`group flex min-h-[56px] items-center gap-3 rounded-xl px-2 transition-colors ${current ? "bg-violet-500/[0.14]" : "hover:bg-white/[0.04]"}`}
    >
      <button
        onClick={() => play(song, queue)}
        title={`播放 ${song.name}`}
        className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left ${FOCUS_RING}`}
      >
        <SongAvatar song={song} />
        <span className="flex min-w-0 flex-col">
          <span className={`truncate text-[13px] font-semibold ${current ? "text-fuchsia-200" : "text-zinc-200"}`} title={`${song.name} - ${song.artist || "未知歌手"}`}>{song.name}</span>
          <span className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <span className={`shrink-0 rounded border px-1 text-[9px] ${meta.badge}`}>{meta.label}</span>
            <span className="min-w-0 flex-1 truncate">{song.artist}</span>
          </span>
        </span>
      </button>
      <button
        onClick={() => removeFromQueue(queue.findIndex((s) => s.id === song.id && s.source === song.source))}
        aria-label={`移除 ${song.name}`}
        /* 审核整改 P2-2：触屏（hover:none）常显——移除入口不得仅 hover 可达，避免隐形按钮误触 */
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-500 opacity-0 transition-opacity hover:text-red-300 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100 ${FOCUS_RING}`}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
});

const HistoryRow = memo(function HistoryRow({
  song,
  play,
}: {
  song: Song;
  play: (song: Song, list?: Song[]) => void;
}) {
  const meta = sourceMeta(song.source);
  return (
    <button
      onClick={() => play(song)}
      title={`播放 ${song.name}`}
      className={`flex min-h-[56px] w-full items-center gap-3 rounded-xl px-2 text-left transition-colors hover:bg-white/[0.04] active:bg-white/[0.08] ${FOCUS_RING}`}
    >
      <SongAvatar song={song} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-semibold text-zinc-200" title={`${song.name} - ${song.artist || "未知歌手"}`}>{song.name}</span>
        <span className="flex items-center gap-1.5 text-[11px] text-zinc-400">
          <span className={`shrink-0 rounded border px-1 text-[9px] ${meta.badge}`}>{meta.label}</span>
          <span className="min-w-0 flex-1 truncate">{song.artist}</span>
        </span>
      </span>
      <Play className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden="true" />
    </button>
  );
});

function EmptyHint({ text, sub }: { text: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <Music4 className="h-8 w-8 text-zinc-600" aria-hidden="true" />
      <p className="text-[13px] text-zinc-400">{text}</p>
      {sub && <p className="text-xs text-zinc-500">{sub}</p>}
    </div>
  );
}
