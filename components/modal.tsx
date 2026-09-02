"use client";

/** 通用模态：移动端底部抽屉 / PC 居中卡片；spring 入场、Esc / 遮罩点击关闭、焦点陷阱 + 滚动锁定 */
import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Loader2 } from "lucide-react";

export function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = 440,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: number;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    /* 打开时记录触发元素，聚焦面板内首个可聚焦元素 */
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusables = panel?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusables?.[0]?.focus();
    /* 锁定背景滚动 */
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      /* 焦点陷阱：Tab 循环限制在面板内 */
      if (e.key === "Tab" && focusables && focusables.length > 0) {
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm lg:items-center lg:p-4"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={typeof title === "string" ? title : "对话框"}
        >
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            initial={{ y: 110, opacity: 0.5, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 70, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth }}
            className="glass safe-bottom max-h-[86dvh] w-full overflow-y-auto rounded-t-3xl border border-white/[0.1] p-5 shadow-2xl shadow-black/40 lg:rounded-3xl"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="min-w-0 truncate text-base font-bold text-zinc-100">{title}</h3>
              <button
                onClick={onClose}
                aria-label="关闭"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 active:scale-90"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** 危险操作确认（删除等）：双按钮，busy 时锁定 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = "删除",
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: React.ReactNode;
  confirmText?: string;
  busy?: boolean;
}) {
  return (
    <Modal open={open} onClose={busy ? () => undefined : onClose} title={title} maxWidth={400}>
      {description && <p className="text-sm leading-relaxed text-zinc-400">{description}</p>}
      <div className="mt-5 flex gap-2.5">
        <button
          onClick={onClose}
          disabled={busy}
          className="h-11 flex-1 rounded-xl border border-white/[0.1] bg-white/[0.03] text-sm font-medium text-zinc-300 transition-colors hover:bg-white/[0.06] active:scale-[0.98] disabled:opacity-50"
        >
          取消
        </button>
        <button
          onClick={onConfirm}
          disabled={busy}
          className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-500 to-rose-500 text-sm font-semibold text-white shadow-lg shadow-rose-500/25 transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {busy ? "处理中…" : confirmText}
        </button>
      </div>
    </Modal>
  );
}
