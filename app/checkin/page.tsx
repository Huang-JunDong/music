"use client";

/**
 * 签到中心 /checkin（网易账号专属）：每日签到（经验）/ 云贝签到 / VIP 乐签
 * 三卡并行状态 + 当月签到进度格子；签到成功本地翻转状态
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { CalendarCheck, CheckCircle2, Circle, Loader2, RefreshCw, AlertTriangle, Sparkles, Coins, Crown, QrCode } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { apiCheckinStatus, apiDoCheckin, type CheckinKind } from "@/lib/client/api";
import type { CheckinStatus } from "@/lib/types";

const CARDS: {
  kind: CheckinKind;
  title: string;
  desc: string;
  reward: string;
  icon: typeof Sparkles;
}[] = [
  { kind: "daily", title: "每日签到", desc: "安卓端签到 +3 成长经验", reward: "+3 经验", icon: Sparkles },
  { kind: "yunbei", title: "云贝签到", desc: "每日签到赚取云贝", reward: "+云贝", icon: Coins },
  { kind: "vip", title: "VIP 乐签", desc: "黑胶会员每日打卡", reward: "会员权益", icon: Crown },
];

export default function CheckinPage() {
  const [status, setStatus] = useState<CheckinStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<CheckinKind | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setError("");
    apiCheckinStatus()
      .then((r) => {
        if (!alive) return;
        if (r.error) throw new Error(r.error);
        setStatus(r.status ?? {});
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "加载签到状态失败");
      });
    return () => {
      alive = false;
    };
  }, [retryKey]);

  const doSign = async (kind: CheckinKind) => {
    if (busy) return;
    setBusy(kind);
    try {
      await apiDoCheckin(kind);
      toast.success("签到成功");
      /* 本地翻转 */
      setStatus((prev) => {
        const next = { ...prev };
        if (kind === "daily") {
          const progress = [...(next.daily?.progress ?? [])];
          const t = new Date().getDate();
          if (!progress.includes(t)) progress.push(t);
          next.daily = { signed: true, progress };
        } else if (kind === "yunbei") next.yunbei = { signed: true };
        else next.vip = { signed: true, total_days: next.vip?.total_days };
        return next;
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "签到失败");
    } finally {
      setBusy(null);
    }
  };

  const today = new Date().getDate();
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const signedSet = new Set(status?.daily?.progress ?? []);

  return (
    <div className="mx-auto w-full max-w-[1000px] px-4 py-6 lg:px-8 lg:py-10">
      <PageHeader
        icon={CalendarCheck}
        title="签到中心"
        subtitle="网易云账号每日签到聚合：经验 / 云贝 / VIP 乐签，一处打卡"
        actions={
          <button
            onClick={() => setRetryKey((k) => k + 1)}
            aria-label="刷新签到状态"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.1] bg-white/[0.04] text-zinc-300 transition-colors hover:bg-white/[0.08]"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </button>
        }
        className="mb-6"
      />

      {error ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10">
            <AlertTriangle className="h-7 w-7 text-red-300/80" aria-hidden="true" />
          </span>
          <p className="max-w-sm text-sm leading-relaxed text-zinc-400">{error}</p>
          <button
            onClick={() => {
              setError("");
              setRetryKey((k) => k + 1);
            }}
            className="mt-1 flex h-11 items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] px-5 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.08] active:scale-95"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> 重试
          </button>
        </div>
      ) : status?.need_login ? (
        <div className="glass flex flex-col items-center gap-3 rounded-3xl border border-white/[0.07] py-14 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10">
            <QrCode className="h-7 w-7 text-amber-300/80" aria-hidden="true" />
          </span>
          <p className="max-w-sm text-sm leading-relaxed text-zinc-400">签到需要登录网易云账号</p>
          <Link
            href="/accounts"
            className="mt-1 flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/25 transition-all hover:brightness-110 active:scale-95"
          >
            <QrCode className="h-4 w-4" aria-hidden="true" /> 去扫码登录
          </Link>
        </div>
      ) : (
        <>
          {/* 三张签到卡 */}
          <div className="grid gap-3 sm:grid-cols-3">
            {CARDS.map((card, i) => {
              const Icon = card.icon;
              const state =
                card.kind === "daily" ? status?.daily : card.kind === "yunbei" ? status?.yunbei : status?.vip;
              const signed = state?.signed === true;
              const loading = !status && !error;
              return (
                <motion.div
                  key={card.kind}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.07, duration: 0.35 }}
                  className={`glass card-glow flex flex-col rounded-3xl border p-5 ${
                    signed ? "border-violet-400/25" : "border-white/[0.07]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/25 to-fuchsia-500/20">
                      <Icon className="h-5 w-5 text-violet-200" aria-hidden="true" />
                    </span>
                    {loading ? (
                      <Loader2 className="h-5 w-5 animate-spin text-zinc-500" aria-hidden="true" />
                    ) : signed ? (
                      <span className="flex items-center gap-1 text-[12px] font-medium text-violet-300">
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> 已签到
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[12px] font-medium text-zinc-500">
                        <Circle className="h-4 w-4" aria-hidden="true" /> 未签到
                      </span>
                    )}
                  </div>
                  <h2 className="mt-3 text-[15px] font-bold text-zinc-100">{card.title}</h2>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-500">{card.desc}</p>
                  {card.kind === "vip" && status?.vip?.total_days ? (
                    <p className="mt-1 text-[11.5px] tabular-nums text-zinc-600">累计签到 {status.vip.total_days} 天</p>
                  ) : null}
                  <div className="mt-4 flex items-center justify-between gap-2">
                    <span className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[11px] font-medium text-zinc-400">
                      {card.reward}
                    </span>
                    <button
                      onClick={() => void doSign(card.kind)}
                      disabled={signed || busy !== null || loading}
                      aria-label={`${signed ? "已" : ""}签到 ${card.title}`}
                      className={`flex h-10 items-center gap-1.5 rounded-xl px-4 text-[13px] font-semibold transition-all active:scale-95 disabled:cursor-default ${
                        signed
                          ? "bg-white/[0.05] text-zinc-500"
                          : "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/25 hover:brightness-110 disabled:opacity-50"
                      }`}
                    >
                      {busy === card.kind ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                      {signed ? "今日完成" : busy === card.kind ? "签到中…" : "签到"}
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* 当月签到进度 */}
          {status?.daily?.progress?.length ? (
            <motion.section
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25, duration: 0.35 }}
              className="glass mt-6 rounded-3xl border border-white/[0.07] p-5"
              aria-label="本月签到进度"
            >
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-[15px] font-bold text-zinc-100">本月签到进度</h2>
                <span className="text-xs tabular-nums text-zinc-500">
                  已签 {status.daily.progress.length} / {daysInMonth} 天
                </span>
              </div>
              <div className="grid grid-cols-10 gap-1.5" role="img" aria-label={`本月已签到 ${status.daily.progress.length} 天`}>
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
                  const signed = signedSet.has(d);
                  const isToday = d === today;
                  return (
                    <span
                      key={d}
                      className={`flex h-7 items-center justify-center rounded-lg text-[10.5px] font-medium tabular-nums ${
                        signed
                          ? "bg-gradient-to-br from-violet-500/40 to-fuchsia-500/30 text-white"
                          : isToday
                            ? "border border-violet-400/40 text-violet-200"
                            : "bg-white/[0.03] text-zinc-600"
                      }`}
                    >
                      {d}
                    </span>
                  );
                })}
              </div>
            </motion.section>
          ) : null}
        </>
      )}
    </div>
  );
}
