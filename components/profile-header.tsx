"use client";

/**
 * 用户资料头部 — 个人主页 /profile 与他人主页 /user/[id] 共用。
 * 规范：头像 88px 圆形 + 品牌描边、统计芯片可点击（onClick 可选）、44px 触控目标。
 */
import { motion } from "motion/react";
import { UserRound, CalendarDays, Music2 } from "lucide-react";
import Link from "next/link";
import type { UserProfile } from "@/lib/types";
import { coverProxyUrl } from "@/lib/play-url";

export function ProfileHeader({
  profile,
  onStatClick,
  delay = 0,
}: {
  profile: UserProfile;
  /** 点击统计芯片（关注/粉丝/互关）回调；不传则纯展示 */
  onStatClick?: (kind: "follows" | "followeds" | "events") => void;
  delay?: number;
}) {
  const stats: { key: "follows" | "followeds" | "events"; label: string; value: number | undefined }[] = [
    { key: "follows", label: "关注", value: profile.follow_count },
    { key: "followeds", label: "粉丝", value: profile.followed_count },
    { key: "events", label: "动态", value: profile.event_count },
  ];
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className="glass relative overflow-hidden rounded-3xl border border-white/[.07] p-5 sm:p-6"
      aria-label="用户资料"
    >
      {/* 品牌渐变氛围光 */}
      <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-fuchsia-500/10 blur-3xl" />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
        {profile.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverProxyUrl(profile.avatar, profile.source)}
            alt={`${profile.nickname} 的头像`}
            loading="lazy"
            className="h-[88px] w-[88px] shrink-0 rounded-full object-cover ring-2 ring-violet-400/40"
          />
        ) : (
          <span className="flex h-[88px] w-[88px] shrink-0 items-center justify-center rounded-full bg-white/[0.05] ring-2 ring-violet-400/30">
            <UserRound className="h-9 w-9 text-zinc-500" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="truncate text-xl font-extrabold tracking-tight text-zinc-50">{profile.nickname || "未命名用户"}</h2>
            {profile.level !== undefined && (
              <span className="rounded-full border border-violet-400/30 bg-violet-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-violet-200">
                Lv.{profile.level}
              </span>
            )}
            {profile.create_days ? (
              <span className="flex items-center gap-1 text-[11px] text-zinc-500">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                已陪伴 {profile.create_days} 天
              </span>
            ) : null}
          </div>
          {profile.signature ? (
            <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-zinc-400">{profile.signature}</p>
          ) : (
            <p className="mt-2 text-[13px] text-zinc-600">这个人很懒，什么都没留下</p>
          )}
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            {stats
              .filter((s) => s.value !== undefined)
              .map((s) =>
                onStatClick ? (
                  <button
                    key={s.key}
                    onClick={() => onStatClick(s.key)}
                    className="flex min-h-[36px] items-center gap-1.5 rounded-xl border border-white/[.07] bg-white/[0.03] px-3 text-[12.5px] text-zinc-300 transition-colors hover:border-violet-400/40 hover:text-zinc-100"
                  >
                    <b className="font-bold text-zinc-100">{(s.value ?? 0).toLocaleString("zh-CN")}</b>
                    <span className="text-zinc-500">{s.label}</span>
                  </button>
                ) : (
                  <span
                    key={s.key}
                    className="flex min-h-[36px] items-center gap-1.5 rounded-xl border border-white/[.07] bg-white/[0.03] px-3 text-[12.5px]"
                  >
                    <b className="font-bold text-zinc-100">{(s.value ?? 0).toLocaleString("zh-CN")}</b>
                    <span className="text-zinc-500">{s.label}</span>
                  </span>
                ),
              )}
            {profile.listen_song_count ? (
              <span className="flex min-h-[36px] items-center gap-1.5 rounded-xl border border-white/[.07] bg-white/[0.03] px-3 text-[12.5px]">
                <Music2 className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
                <b className="font-bold text-zinc-100">{profile.listen_song_count.toLocaleString("zh-CN")}</b>
                <span className="text-zinc-500">累计听歌</span>
              </span>
            ) : null}
            {profile.link ? (
              <Link
                href={profile.link}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-[36px] items-center rounded-xl px-2 text-[12px] text-zinc-500 transition-colors hover:text-fuchsia-300"
              >
                源站主页 ↗
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </motion.section>
  );
}
