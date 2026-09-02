"use client";

/**
 * 统一页头：图标徽章 + 标题 + 副标题 + 右侧动作区
 * 规范（对齐设计系统）：标题统一 text-2xl、图标徽章统一 44px 渐变、
 * 副标题 text-[13px] text-zinc-500；动作按钮由页面通过 actions 传入。
 */
import { motion } from "motion/react";
import type { LucideIcon } from "lucide-react";

export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
  className = "",
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: React.ReactNode;
  /** 右侧动作区（移动端换行到标题下方） */
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`mb-5 flex flex-wrap items-center justify-between gap-3 ${className}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-cyan-400 shadow-lg shadow-fuchsia-500/25"
          aria-hidden="true"
        >
          <Icon className="h-5 w-5 text-white" strokeWidth={2.1} />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-zinc-50">{title}</h1>
          {subtitle && <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </motion.div>
  );
}
