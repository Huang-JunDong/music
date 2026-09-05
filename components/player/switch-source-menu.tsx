"use client";

/**
 * 换源菜单：智能匹配（全网相似度打分）或定向换到指定源。
 * 定向换源走 /api/switch_source 的 target 参数（后端早已支持、此前前端零使用）。
 * PC 播放条 / 全屏播放页共用；onPick(target?) 传 undefined = 智能匹配。
 */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { RefreshCcw } from "lucide-react";
import { SOURCE_META } from "@/lib/play-url";

/** 可定向换源的候选源 —— 与后端 lib/switch-source.ts isSwitchSourceAllowed 的排除集对齐：
 *  登录通道 qq_wx、本地源，以及后端明确排除的 soda/fivesing（点选必返回 no match） */
const SWITCHABLE_SOURCES = Object.keys(SOURCE_META).filter(
  (s) => s !== "qq_wx" && s !== "local" && s !== "local-file" && s !== "soda" && s !== "fivesing",
);

export function SwitchSourceMenu({
  source,
  busy,
  onPick,
}: {
  source: string;
  busy?: boolean;
  onPick: (target?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

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
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="换源播放：选择目标音源"
        className="flex h-11 items-center gap-1.5 rounded-full border border-white/[0.1] px-4 text-xs font-medium text-zinc-300 transition-all hover:border-fuchsia-400/40 hover:text-fuchsia-200 active:scale-95 disabled:opacity-40"
      >
        <RefreshCcw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} aria-hidden="true" />
        换源
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.16 }}
            role="menu"
            aria-label="换源目标选择"
            className="glass absolute bottom-[52px] left-1/2 z-50 -translate-x-1/2 rounded-2xl border border-white/[0.1] p-1.5 shadow-2xl shadow-black/50"
          >
            <button
              role="menuitem"
              onClick={() => {
                onPick(undefined);
                setOpen(false);
              }}
              className="flex h-9 w-[108px] items-center justify-center gap-1.5 rounded-xl text-[12.5px] font-semibold text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-zinc-100"
            >
              <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />
              智能匹配
            </button>
            <div className="mx-2 my-1 h-px bg-white/[0.08]" role="separator" />
            <div className="grid max-h-[264px] w-[224px] grid-cols-2 gap-1 overflow-y-auto no-scrollbar">
              {SWITCHABLE_SOURCES.filter((s) => s !== source).map((s) => {
                const meta = SOURCE_META[s];
                return (
                  <button
                    key={s}
                    role="menuitem"
                    onClick={() => {
                      onPick(s);
                      setOpen(false);
                    }}
                    className="flex h-9 items-center justify-center gap-1.5 rounded-xl text-[12.5px] font-medium text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-100"
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
