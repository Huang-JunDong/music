"use client";

/**
 * 音量菜单：主控按钮（静音状态随图标切换）点击弹出音量面板
 * （静音切换 + 横向滑条 + 百分比），ESC / 点击外部关闭。
 * PC 播放条 / 全屏播放页共用；面板交互与 RateMenu / QualityMenu 同模式。
 */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Volume2, Volume1, VolumeX } from "lucide-react";

export function VolumeMenu({
  volume,
  muted,
  onVolume,
  onToggleMute,
}: {
  volume: number;
  muted: boolean;
  onVolume: (v: number) => void;
  onToggleMute: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  /* 点击外部 / ESC 关闭（与 RateMenu 一致；音量为连续调节，面板不自动关闭） */
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const effective = muted ? 0 : volume;
  const percent = Math.round(effective * 100);
  const Icon = effective === 0 ? VolumeX : effective < 0.5 ? Volume1 : Volume2;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`音量：${muted ? "已静音" : `${percent}%`}，点击调节音量`}
        className={`flex h-12 w-12 items-center justify-center rounded-full transition-all active:scale-90 ${
          effective === 0 ? "text-fuchsia-300" : "text-zinc-300 hover:text-white"
        } ${open ? "bg-white/[0.06]" : ""}`}
      >
        <Icon className="h-[18px] w-[18px]" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.16 }}
            role="menu"
            aria-label="音量调节"
            className="glass absolute bottom-[56px] left-1/2 z-50 flex -translate-x-1/2 items-center gap-2.5 rounded-2xl border border-white/[0.1] px-3 py-2.5 shadow-2xl shadow-black/50"
          >
            <button
              onClick={onToggleMute}
              aria-label={muted ? "取消静音" : "静音"}
              className="flex h-11 w-8 shrink-0 items-center justify-center rounded-full text-zinc-300 transition-all hover:text-white active:scale-90"
            >
              {effective === 0 ? <VolumeX className="h-[17px] w-[17px]" /> : <Volume2 className="h-[17px] w-[17px]" />}
            </button>
            <input
              type="range"
              className="slider w-28 sm:w-32"
              style={{ "--progress": `${effective * 100}%` } as React.CSSProperties}
              min={0}
              max={1}
              step={0.02}
              value={effective}
              onChange={(e) => onVolume(Number(e.target.value))}
              aria-label="音量"
              aria-valuetext={`${percent}%`}
            />
            <span className="w-9 shrink-0 text-right text-[11.5px] font-semibold tabular-nums text-zinc-400">
              {percent}%
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
