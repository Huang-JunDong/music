"use client";

/**
 * 悬浮快捷工具栏（对齐 Go 右侧悬浮工具栏：回顶部/回底部）
 * - 滚动超过一屏后出现，spring 进出场动画
 * - 移动端避开 mini 播放条与底部导航；PC 固定右下
 * - 触控目标 44px；reduced-motion 时无动画直接显隐
 */
import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { ArrowUp, ArrowDown } from "lucide-react";
import { usePlayer } from "@/lib/client/store";

export function FloatingToolbar() {
  const [visible, setVisible] = useState(false);
  const [nearTop, setNearTop] = useState(false);
  const [nearBottom, setNearBottom] = useState(false);
  const hasCurrent = usePlayer((s) => s.index >= 0);
  const reduced = useReducedMotion();

  const check = useCallback(() => {
    const y = window.scrollY;
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    setVisible(y > window.innerHeight * 0.6);
    setNearTop(y < 40);
    setNearBottom(max > 0 && y >= max - 80);
  }, []);

  useEffect(() => {
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [check]);

  const toTop = () => window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  const toBottom = () =>
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: reduced ? "auto" : "smooth" });

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={reduced ? false : { opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
          className={`glass fixed right-3 z-30 flex flex-col overflow-hidden rounded-2xl border border-white/[0.1] shadow-2xl shadow-black/40 lg:right-6 ${
            hasCurrent ? "bottom-[84px] lg:bottom-[120px]" : "bottom-8"
          }`}
          role="toolbar"
          aria-label="快捷滚动"
        >
          <button
            onClick={toTop}
            disabled={nearTop}
            aria-label="回到顶部"
            title="回到顶部"
            className="flex h-11 w-11 items-center justify-center text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-white active:scale-90 disabled:opacity-30"
          >
            <ArrowUp className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
          <span className="h-px w-full bg-white/[0.07]" aria-hidden="true" />
          <button
            onClick={toBottom}
            disabled={nearBottom}
            aria-label="回到底部"
            title="回到底部"
            className="flex h-11 w-11 items-center justify-center text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-white active:scale-90 disabled:opacity-30"
          >
            <ArrowDown className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
