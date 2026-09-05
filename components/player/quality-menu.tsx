"use client";

/**
 * 音质菜单：点击按钮向上弹出档位列表（PC 播放条 / 全屏播放页共用）。
 * 档位为全局播放偏好 — QQ（七档阶梯截断）/ 网易（level 映射）等源各自翻译，
 * 档位不可用（无 VIP / 无版权）时由后端自动向下降级，前端不做可用性预判。
 */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AudioLines } from "lucide-react";
import type { SongQuality } from "@/lib/types";

export const QUALITY_OPTIONS: { value: SongQuality; label: string; hint: string }[] = [
  { value: "best", label: "最高", hint: "自动选择最优档位" },
  { value: "lossless", label: "无损", hint: "FLAC 无损封顶" },
  { value: "high", label: "320K", hint: "较高音质封顶" },
  { value: "standard", label: "128K", hint: "标准音质 · 省流量" },
];

const ACTIVE_LABEL: Record<SongQuality, string> = {
  best: "",
  lossless: "无损",
  high: "320K",
  standard: "128K",
};

export function QualityMenu({ quality, onPick }: { quality: SongQuality; onPick: (q: SongQuality) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  /* 点击外部 / ESC 关闭（与 RateMenu 一致） */
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

  const activeLabel = ACTIVE_LABEL[quality];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`播放音质：${quality === "best" ? "最高（自动）" : activeLabel}，点击选择音质`}
        title="播放音质偏好（不支持的档位自动降级）"
        className={`flex h-11 min-w-[44px] items-center justify-center rounded-full text-[12px] font-bold transition-all active:scale-90 ${
          activeLabel ? "text-cyan-300" : "text-zinc-400 hover:text-white"
        } ${open ? "bg-white/[0.06]" : ""}`}
      >
        {activeLabel ? activeLabel : <AudioLines className="h-[17px] w-[17px]" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.16 }}
            role="menu"
            aria-label="音质选择"
            className="glass absolute bottom-[52px] left-1/2 z-50 -translate-x-1/2 rounded-2xl border border-white/[0.1] p-1.5 shadow-2xl shadow-black/50"
          >
            {QUALITY_OPTIONS.map((opt) => {
              const active = opt.value === quality;
              return (
                <button
                  key={opt.value}
                  role="menuitemradio"
                  aria-checked={active}
                  title={opt.hint}
                  onClick={() => {
                    onPick(opt.value);
                    setOpen(false);
                  }}
                  className={`flex h-9 w-[96px] items-center justify-center rounded-xl text-[12.5px] font-semibold transition-colors ${
                    active
                      ? "bg-cyan-400/15 text-cyan-300"
                      : "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
