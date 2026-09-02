"use client";

/** 全局播放条：PC 完整条 + 移动 mini 条（点击展开全屏播放页） */
import { useState, useCallback } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Play, Pause, SkipBack, SkipForward, Repeat, Repeat1, Shuffle,
  Volume2, VolumeX, ListMusic, Download, Loader2, ChevronUp,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { usePlayer } from "@/lib/client/store";
import { downloadUrl, coverUrl, sourceMeta, fmtTimeClient } from "@/lib/client/ui";
import { NowPlaying } from "./now-playing";
import { QueueDrawer } from "./queue-drawer";
import { RateMenu } from "./rate-menu";
import { toast } from "sonner";

export function PlayerBar() {
  /* useShallow 精确订阅（排除 currentTime）：进度条由 BarProgress 独立消化 8Hz 更新 */
  const {
    queue, index, playing, loading, duration, volume, muted, mode, rate,
    toggle, next, prev, setVolume, toggleMute, cycleMode, setRate, seek,
  } = usePlayer(
    useShallow((s) => ({
      queue: s.queue,
      index: s.index,
      playing: s.playing,
      loading: s.loading,
      duration: s.duration,
      volume: s.volume,
      muted: s.muted,
      mode: s.mode,
      rate: s.rate,
      toggle: s.toggle,
      next: s.next,
      prev: s.prev,
      setVolume: s.setVolume,
      toggleMute: s.toggleMute,
      cycleMode: s.cycleMode,
      setRate: s.setRate,
      seek: s.seek,
    })),
  );
  const [expanded, setExpanded] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const song = index >= 0 && index < queue.length ? queue[index] : null;

  const togglePlay = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      toggle();
    },
    [toggle],
  );

  const doDownload = useCallback(() => {
    if (!song) return;
    const a = document.createElement("a");
    a.href = downloadUrl(song, true);
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.success(`开始下载：${song.name}`);
  }, [song]);

  if (!song) return null;

  const meta = sourceMeta(song.source);
  const ModeIcon = mode === "loop-one" ? Repeat1 : mode === "shuffle" ? Shuffle : Repeat;

  return (
    <>
      {/* ---------- 移动 mini 播放条（底部 Tab 上方） ---------- */}
      <motion.button
        layout
        initial={{ y: 80 }}
        animate={{ y: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 34 }}
        onClick={() => setExpanded(true)}
        aria-label="展开播放页"
        className="glass fixed inset-x-2 bottom-[70px] z-40 flex h-[58px] items-center gap-3 rounded-2xl border border-white/[0.1] px-3 shadow-2xl shadow-black/50 lg:hidden"
      >
        <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-zinc-800">
          {song.cover && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverUrl(song)} alt="" className="h-full w-full object-cover" loading="lazy" />
          )}
          {playing && (
            <span className="absolute inset-0 flex items-end justify-center gap-[2.5px] bg-black/35 pb-1.5">
              {[0, 1, 2].map((i) => (
                <span key={i} className="eq-bar h-3 w-[2.5px] rounded-full bg-fuchsia-300" style={{ animationDelay: `${i * 0.18}s` }} />
              ))}
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col text-left">
          <span className="truncate text-[13px] font-semibold text-zinc-100">{song.name}</span>
          <span className="truncate text-[11px] text-zinc-400">{song.artist}</span>
        </span>
        <span
          role="button"
          tabIndex={0}
          onClick={togglePlay}
          onKeyDown={(e) => e.key === "Enter" && togglePlay(e as unknown as React.MouseEvent)}
          aria-label={playing ? "暂停" : "播放"}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-100 transition-transform active:scale-90"
        >
          {loading ? (
            <Loader2 className="h-6 w-6 animate-spin text-fuchsia-300" />
          ) : playing ? (
            <Pause className="h-6 w-6" fill="currentColor" />
          ) : (
            <Play className="h-6 w-6" fill="currentColor" />
          )}
        </span>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            next();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.stopPropagation();
              next();
            }
          }}
          aria-label="下一首"
          className="flex h-11 w-8 shrink-0 items-center justify-center text-zinc-300 transition-transform active:scale-90"
        >
          <SkipForward className="h-5 w-5" fill="currentColor" />
        </span>
      </motion.button>

      {/* ---------- PC 底部播放条 ---------- */}
      <motion.footer
        layout
        initial={{ y: 96 }}
        animate={{ y: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 34 }}
        className="glass fixed inset-x-0 bottom-0 z-40 hidden border-t border-white/[0.1] lg:block"
      >
        <div className="mx-auto flex h-[88px] max-w-[1600px] items-center gap-4 px-6">
          {/* 歌曲信息 */}
          <div className="flex w-[280px] min-w-0 items-center gap-3">
            <button
              onClick={() => setExpanded(true)}
              className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-zinc-800 ring-1 ring-white/10"
              aria-label="展开播放页"
            >
              {song.cover && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={coverUrl(song)} alt="" className="h-full w-full object-cover" loading="lazy" />
              )}
              <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                <ChevronUp className="h-5 w-5 text-white" />
              </span>
            </button>
            <div className="flex min-w-0 flex-col">
              <button onClick={() => setExpanded(true)} className="truncate text-left text-sm font-semibold text-zinc-100 hover:underline">
                {song.name}
              </button>
              <span className="truncate text-xs text-zinc-400">{song.artist || "未知歌手"}</span>
              <span className={`mt-0.5 inline-flex w-fit items-center rounded border px-1.5 py-px text-[10px] ${meta.badge}`}>{meta.label}</span>
            </div>
          </div>

          {/* 控制区 */}
          <div className="flex flex-1 flex-col items-center gap-1.5">
            <div className="flex items-center gap-2">
              <button onClick={() => prev()} aria-label="上一首" className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-300 transition-all hover:text-white active:scale-90">
                <SkipBack className="h-[18px] w-[18px]" fill="currentColor" />
              </button>
              <button
                onClick={toggle}
                aria-label={playing ? "暂停" : "播放"}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/30 transition-transform hover:scale-105 active:scale-95"
              >
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={playing ? "pause" : "play"}
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.6, opacity: 0 }}
                      transition={{ duration: 0.12 }}
                    >
                      {playing ? (
                        <Pause className="h-5 w-5" fill="currentColor" />
                      ) : (
                        <Play className="ml-0.5 h-5 w-5" fill="currentColor" />
                      )}
                    </motion.span>
                  </AnimatePresence>
                )}
              </button>
              <button onClick={() => next()} aria-label="下一首" className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-300 transition-all hover:text-white active:scale-90">
                <SkipForward className="h-[18px] w-[18px]" fill="currentColor" />
              </button>
              <button
                onClick={cycleMode}
                aria-label={`播放模式：${mode === "order" ? "顺序" : mode === "loop-one" ? "单曲循环" : "随机"}`}
                className={`flex h-11 w-11 items-center justify-center rounded-full transition-all active:scale-90 ${mode === "order" ? "text-zinc-400 hover:text-white" : "text-fuchsia-300"}`}
              >
                <ModeIcon className="h-[17px] w-[17px]" />
              </button>
              <RateMenu rate={rate} onPick={setRate} />
            </div>
            <BarProgress />
          </div>

          {/* 右侧操作 */}
          <div className="flex w-[280px] items-center justify-end gap-1">
            <button onClick={() => setQueueOpen(true)} aria-label="播放队列" title="队列 / 历史" className="relative flex h-11 w-11 items-center justify-center rounded-full text-zinc-400 transition-all hover:text-white active:scale-90">
              <ListMusic className="h-[18px] w-[18px]" />
              {queue.length > 1 && (
                <span className="absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-violet-500 px-1 text-[9px] font-bold leading-4 text-white">{queue.length > 99 ? "99+" : queue.length}</span>
              )}
            </button>
            <button onClick={() => setExpanded(true)} aria-label="歌词大图" title="歌词 / 大图播放页" className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-400 transition-all hover:text-white active:scale-90">
              <ChevronUp className="h-[18px] w-[18px]" />
            </button>
            <button onClick={doDownload} aria-label="下载" className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-400 transition-all hover:text-white active:scale-90">
              <Download className="h-[18px] w-[18px]" />
            </button>
            <div className="flex items-center gap-2 pl-2">
              <button onClick={toggleMute} aria-label={muted ? "取消静音" : "静音"} className="flex h-11 w-8 items-center justify-center text-zinc-400 transition-all hover:text-white">
                {muted || volume === 0 ? <VolumeX className="h-[17px] w-[17px]" /> : <Volume2 className="h-[17px] w-[17px]" />}
              </button>
              <input
                type="range"
                className="slider w-24"
                style={{ "--progress": `${(muted ? 0 : volume) * 100}%` } as React.CSSProperties}
                min={0}
                max={1}
                step={0.02}
                value={muted ? 0 : volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                aria-label="音量"
              />
            </div>
          </div>
        </div>
      </motion.footer>

      {/* ---------- 全屏播放页 ---------- */}
      <AnimatePresence>
        {expanded && <NowPlaying onClose={() => setExpanded(false)} onDownload={doDownload} />}
      </AnimatePresence>

      {/* ---------- 队列 / 历史抽屉 ---------- */}
      <QueueDrawer open={queueOpen} onClose={() => setQueueOpen(false)} />
    </>
  );
}

/** 播放条进度行：独立订阅 currentTime（8Hz 仅重渲染本小组件） */
function BarProgress() {
  const { currentTime, duration, seek } = usePlayer();
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  return (
    <div className="flex w-full max-w-[520px] items-center gap-3">
      <span className="w-10 text-right text-[11px] tabular-nums text-zinc-400">{fmtTimeClient(currentTime)}</span>
      <input
        type="range"
        className="slider flex-1"
        style={{ "--progress": `${progress}%` } as React.CSSProperties}
        min={0}
        max={Math.max(duration, 0.1)}
        step={0.5}
        value={currentTime}
        onChange={(e) => seek(Number(e.target.value))}
        aria-label="进度"
      />
      <span className="w-10 text-[11px] tabular-nums text-zinc-400">{fmtTimeClient(duration)}</span>
    </div>
  );
}
