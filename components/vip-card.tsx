"use client";

/**
 * VIP 状态卡 — /profile 主卡 + /accounts 账户页嵌入复用。
 * 网易：黑胶VIP/到期倒计时/乐签状态（跳签到中心）；QQ：豪华绿钻状态。
 * 未登录 → 引导登录；未开通 → 展示开通权益说明（不渲染空态假数据）。
 */
import { motion } from "motion/react";
import { Crown, Clock3, CalendarCheck, QrCode } from "lucide-react";
import Link from "next/link";
import type { UserVipInfo } from "@/lib/types";

function daysLeft(expireAt?: number): number | undefined {
  if (!expireAt) return undefined;
  return Math.max(0, Math.ceil((expireAt * 1000 - Date.now()) / 86_400_000));
}

export function VipCard({
  vip,
  source,
  loading = false,
  delay = 0,
  compact = false,
}: {
  vip: UserVipInfo | null;
  source: string;
  loading?: boolean;
  delay?: number;
  /** 账户页嵌入的紧凑形态 */
  compact?: boolean;
}) {
  if (loading) {
    return (
      <div className={`glass shimmer rounded-3xl border border-white/[.07] ${compact ? "p-4" : "p-5"}`} style={{ minHeight: compact ? 84 : 108 }} aria-busy="true" />
    );
  }
  if (!vip) return null;

  const left = daysLeft(vip.expire_at);
  const sourceLabel = source === "qq" ? "QQ音乐" : "网易云音乐";

  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className={`glass relative overflow-hidden rounded-3xl border ${compact ? "p-4" : "p-5"} ${
        vip.is_vip ? "border-amber-300/25" : "border-white/[.07]"
      }`}
      aria-label="会员状态"
    >
      {vip.is_vip && (
        <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-14 h-44 w-44 rounded-full bg-amber-400/10 blur-3xl" />
      )}
      <div className="relative flex items-center gap-4">
        <span
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
            vip.is_vip ? "bg-gradient-to-br from-amber-300 to-orange-500 shadow-lg shadow-amber-500/25" : "bg-white/[0.05]"
          }`}
          aria-hidden="true"
        >
          <Crown className={`h-6 w-6 ${vip.is_vip ? "text-white" : "text-zinc-500"}`} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={`text-[15px] font-bold ${vip.is_vip ? "text-amber-100" : "text-zinc-200"}`}>
              {vip.vip_name ?? (vip.is_vip ? "会员" : "普通账号")}
            </h3>
            <span className="rounded-full border border-white/[.1] px-2 py-px text-[11px] text-zinc-500">{sourceLabel}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-zinc-400">
            {left !== undefined && (
              <span className="flex items-center gap-1">
                <Clock3 className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
                {left > 0 ? `剩余 ${left} 天` : "已到期"}
              </span>
            )}
            {vip.total_days !== undefined && (
              <span className="flex items-center gap-1">
                <CalendarCheck className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
                累计签到 {vip.total_days} 天
              </span>
            )}
          </div>
        </div>
        {source === "netease" && (
          <Link
            href="/checkin"
            className={`flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-[12.5px] font-semibold transition-colors ${
              vip.is_vip
                ? "bg-gradient-to-r from-amber-300 to-orange-400 text-zinc-900 hover:brightness-110"
                : "border border-white/[.1] text-zinc-400 hover:border-amber-300/40 hover:text-amber-200"
            }`}
          >
            <CalendarCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {vip.signed_today ? "今日已签" : "乐签打卡"}
          </Link>
        )}
      </div>
      {!vip.is_vip && (
        <p className="relative mt-3 flex items-center gap-1.5 text-[11.5px] text-zinc-500">
          <QrCode className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          开通源站会员后可解锁无损音质与会员曲库（登录账号即自动识别会员状态）
        </p>
      )}
    </motion.section>
  );
}
