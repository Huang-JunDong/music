"use client";

/** 倍速菜单：点击按钮向上弹出档位列表，直达任意倍速（PC 播放条 / 全屏播放页共用） */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Gauge } from "lucide-react";
import { PLAY_RATES } from "@/lib/client/store";

export function RateMenu({ rate, onPick }: { rate: number; onPick: (r: number) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  /* 点击外部 / ESC 关闭 */
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

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`播放倍速：${rate}x，点击选择倍速`}
        className={`flex h-11 min-w-[44px] items-center justify-center rounded-full text-[12px] font-bold tabular-nums transition-all active:scale-90 ${
          rate === 1 ? "text-zinc-400 hover:text-white" : "text-fuchsia-300"
        } ${open ? "bg-white/[0.06]" : ""}`}
      >
        {rate === 1 ? <Gauge className="h-[17px] w-[17px]" /> : `${rate}x`}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.16 }}
            role="menu"
            aria-label="倍速选择"
            className="glass absolute bottom-[52px] left-1/2 z-50 -translate-x-1/2 rounded-2xl border border-white/[0.1] p-1.5 shadow-2xl shadow-black/50"
          >
            {PLAY_RATES.map((r) => {
              const active = Math.abs(r - rate) < 0.01;
              return (
                <button
                  key={r}
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => {
                    onPick(r);
                    setOpen(false);
                  }}
                  className={`flex h-9 w-[68px] items-center justify-center rounded-xl text-[12.5px] font-semibold tabular-nums transition-colors ${
                    active
                      ? "bg-fuchsia-400/15 text-fuchsia-300"
                      : "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
                  }`}
                >
                  {r === 1 ? "1.0x" : `${r}x`}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
