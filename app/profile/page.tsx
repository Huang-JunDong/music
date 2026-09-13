"use client";

/**
 * 个人主页 /profile（P1 A1）— 登录账号的用户资产总览。
 * 网易：资料/等级进度/关注粉丝互关/VIP 卡；QQ：VIP 状态卡（等级与关注体系单源隐藏）。
 * 未登录引导 /accounts；数据经 /api/user_profile、/api/user_follows、/api/vip_info。
 */
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { CircleUserRound, TrendingUp, Users, UserRound, Heart, RefreshCw, QrCode, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ProfileHeader } from "@/components/profile-header";
import { VipCard } from "@/components/vip-card";
import { apiUserProfile, apiVipInfo, apiUserFollows, apiFollowedArtists } from "@/lib/client/api";
import { coverProxyUrl } from "@/lib/play-url";
import type { UserProfile, UserVipInfo, FollowUser, FollowedArtist } from "@/lib/types";

type FollowKind = "follows" | "followeds" | "mutual";

const FOLLOW_TABS: { key: FollowKind; label: string }[] = [
  { key: "follows", label: "关注" },
  { key: "followeds", label: "粉丝" },
  { key: "mutual", label: "互关" },
];

export default function ProfilePage() {
  return (
    <Suspense fallback={<div className="mx-auto w-full max-w-[1000px] px-4 py-10 lg:px-8"><div className="shimmer h-48 rounded-3xl" aria-busy="true" /></div>}>
      <ProfileInner />
    </Suspense>
  );
}

function ProfileInner() {
  const params = useSearchParams();
  const router = useRouter();
  const source = params.get("source") === "qq" ? "qq" : "netease";
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [vip, setVip] = useState<UserVipInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [needLogin, setNeedLogin] = useState(false);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [followOpen, setFollowOpen] = useState<FollowKind | null>(null);

  const switchSource = (s: string) => router.replace(`/profile?source=${s}`);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    setNeedLogin(false);
    setProfile(null);
    setVip(null);
    Promise.allSettled([apiUserProfile(source), apiVipInfo(source)]).then(([p, v]) => {
      if (!alive) return;
      const pr = p.status === "fulfilled" ? p.value : { error: "加载失败" };
      if (pr.error) {
        if (/登录/.test(pr.error)) setNeedLogin(true);
        else setError(pr.error);
      } else if (pr.profile) setProfile(pr.profile);
      if (v.status === "fulfilled" && v.value.vip) setVip(v.value.vip);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [source, retryKey]);

  if (needLogin) {
    return (
      <div className="mx-auto w-full max-w-[1000px] px-4 py-6 lg:px-8 lg:py-10">
        <PageHeader icon={CircleUserRound} title="个人主页" subtitle="登录音源账号后查看你的专属资料与会员状态" />
        <LoginGuide source={source} onSwitch={switchSource} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1000px] px-4 py-6 lg:px-8 lg:py-10">
      <PageHeader
        icon={CircleUserRound}
        title="个人主页"
        subtitle="账号资料 · 会员状态 · 关注体系一览"
        actions={
          <>
            <SourceTabs source={source} onSwitch={switchSource} />
            <button
              onClick={() => setRetryKey((k) => k + 1)}
              aria-label="刷新"
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/[.1] text-zinc-400 transition-colors hover:border-violet-400/40 hover:text-zinc-100"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </>
        }
      />

      {error && !loading && (
        <div className="glass flex items-center gap-3 rounded-3xl border border-red-400/20 p-5 text-sm text-red-200" role="alert">
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{error}</span>
          <button onClick={() => setRetryKey((k) => k + 1)} className="min-h-[40px] rounded-xl border border-white/[.1] px-3 text-[12.5px] text-zinc-300 hover:border-red-400/40">
            重试
          </button>
        </div>
      )}

      {loading ? (
        <>
          <div className="shimmer h-44 rounded-3xl" aria-busy="true" />
          <div className="shimmer mt-4 h-28 rounded-3xl" aria-busy="true" />
        </>
      ) : (
        <>
          {profile && (
            <ProfileHeader
              profile={profile}
              onStatClick={source === "netease" ? (kind) => setFollowOpen(kind === "events" ? null : kind) : undefined}
            />
          )}

          {/* 等级进度条（网易专属；QQ 单源隐藏） */}
          {source === "netease" && profile?.level_progress && (
            <motion.section
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.06 }}
              className="glass mt-4 rounded-3xl border border-white/[.07] p-5"
              aria-label="等级进度"
            >
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-zinc-200">
                  <TrendingUp className="h-4 w-4 text-fuchsia-300" aria-hidden="true" /> 等级进度
                </h3>
                <span className="text-[12px] text-zinc-500">
                  已听 {profile.level_progress.now.toLocaleString("zh-CN")} 首 · 升级还需{" "}
                  {Math.max(0, profile.level_progress.next - profile.level_progress.now).toLocaleString("zh-CN")} 首
                </span>
              </div>
              <div
                className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/[0.06]"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={profile.level_progress.next}
                aria-valuenow={Math.min(profile.level_progress.now, profile.level_progress.next)}
              >
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-400 transition-[width] duration-700"
                  style={{ width: `${Math.min(100, (profile.level_progress.now / Math.max(1, profile.level_progress.next)) * 100)}%` }}
                />
              </div>
            </motion.section>
          )}

          <div className="mt-4">
            <VipCard vip={vip} source={source} loading={!vip && !error} delay={0.1} />
          </div>

          {/* 关注的歌手（P1 C2：artist_sublist · QQ GetFollowSingerList；失败静默隐藏） */}
          <FollowedArtistsRow source={source} delay={0.12} />

          {/* 关注体系（网易专属） */}
          {source === "netease" && profile && (
            <FollowSection uid={profile.id} open={followOpen} onOpenChange={setFollowOpen} />
          )}
        </>
      )}
    </div>
  );
}

/** P1 C2：关注的歌手横滑（"账户侧边栏关注歌手列表"落点；点击跳歌手主页） */
function FollowedArtistsRow({ source, delay }: { source: string; delay: number }) {
  const [artists, setArtists] = useState<FollowedArtist[]>([]);

  useEffect(() => {
    let alive = true;
    apiFollowedArtists(source, 1, 30)
      .then((r) => {
        if (!alive || r.error) return;
        setArtists(r.artists ?? []);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [source]);

  if (!artists.length) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className="glass mt-4 rounded-3xl border border-white/[.07] p-5"
      aria-label="关注的歌手"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-zinc-200">
          <Heart className="h-4 w-4 text-rose-300" aria-hidden="true" /> 关注的歌手
        </h3>
        <Link href={`/artists?tab=followed&source=${source}`} className="text-[12px] text-zinc-500 transition-colors hover:text-rose-300">
          全部 ({artists.length}) →
        </Link>
      </div>
      <div className="-mx-1 mt-3 flex gap-3 overflow-x-auto px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {artists.slice(0, 14).map((a) => (
          <Link
            key={`${a.source}-${a.id}`}
            href={`/artist/${a.id}?source=${a.source}`}
            className="group flex w-[72px] shrink-0 flex-col items-center gap-1.5"
            aria-label={`查看歌手 ${a.name}`}
          >
            <span className="block aspect-square w-full overflow-hidden rounded-full bg-zinc-800 ring-1 ring-white/[0.06] transition-all group-hover:ring-rose-400/40">
              {a.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={coverProxyUrl(a.avatar, a.source)} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
              ) : (
                <span className="flex h-full w-full items-center justify-center">
                  <UserRound className="h-6 w-6 text-zinc-600" aria-hidden="true" />
                </span>
              )}
            </span>
            <span className="block w-full truncate text-center text-[11px] text-zinc-400 group-hover:text-zinc-200">{a.name}</span>
          </Link>
        ))}
      </div>
    </motion.section>
  );
}

function SourceTabs({ source, onSwitch }: { source: string; onSwitch: (s: string) => void }) {
  return (
    <div className="flex rounded-xl border border-white/[.08] bg-white/[0.02] p-1" role="tablist" aria-label="音源切换">
      {[
        { key: "netease", label: "网易云" },
        { key: "qq", label: "QQ音乐" },
      ].map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={source === t.key}
          onClick={() => source !== t.key && onSwitch(t.key)}
          className={`min-h-[40px] rounded-lg px-3.5 text-[12.5px] font-medium transition-colors ${
            source === t.key ? "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white" : "text-zinc-400 hover:text-zinc-100"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function LoginGuide({ source, onSwitch }: { source: string; onSwitch: (s: string) => void }) {
  return (
    <div className="glass flex flex-col items-center gap-4 rounded-3xl border border-white/[.07] p-10 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.04]">
        <QrCode className="h-7 w-7 text-zinc-500" aria-hidden="true" />
      </span>
      <p className="text-sm text-zinc-400">
        {source === "qq" ? "在「我的音源账号」登录 QQ 音乐后查看" : "在「我的音源账号」登录网易云后查看"}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Link
          href="/accounts"
          className="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 text-[13px] font-semibold text-white"
        >
          <QrCode className="h-4 w-4" aria-hidden="true" /> 去扫码登录
        </Link>
        <button
          onClick={() => onSwitch(source === "qq" ? "netease" : "qq")}
          className="flex min-h-[44px] items-center rounded-xl border border-white/[.1] px-4 text-[13px] text-zinc-300 hover:border-violet-400/40"
        >
          切换到{source === "qq" ? "网易云" : "QQ音乐"}
        </button>
      </div>
    </div>
  );
}

/** 关注/粉丝/互关三 Tab 分页列表（user_follows / user_followeds / user_mutualfollow_get） */
function FollowSection({
  uid,
  open,
  onOpenChange,
}: {
  uid: string;
  open: FollowKind | null;
  onOpenChange: (k: FollowKind | null) => void;
}) {
  const [kind, setKind] = useState<FollowKind>("follows");
  const [users, setUsers] = useState<FollowUser[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const seqRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    setKind(open);
    setPage(1);
  }, [open]);

  const load = useCallback(
    async (k: FollowKind, p: number, append: boolean) => {
      const seq = ++seqRef.current;
      setLoading(true);
      setError("");
      try {
        const r = await apiUserFollows("netease", uid, k, p, 30);
        if (seq !== seqRef.current) return;
        if (r.error) throw new Error(r.error);
        setUsers((prev) => (append ? [...prev, ...(r.users ?? [])] : r.users ?? []));
        setHasMore(!!r.has_more);
      } catch (e) {
        if (seq === seqRef.current) setError(e instanceof Error ? e.message : "加载失败");
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    [uid],
  );

  useEffect(() => {
    if (open) void load(kind, 1, false);
    /* 审核整改 R2：补全依赖（load 为 useCallback([uid])，uid 变化时用新 load 重载） */
  }, [open, kind, load]);

  if (!open) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.14 }}
        className="glass mt-4 rounded-3xl border border-white/[.07] p-5"
      >
        <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-zinc-200">
          <Users className="h-4 w-4 text-fuchsia-300" aria-hidden="true" /> 关注体系
        </h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {FOLLOW_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => onOpenChange(t.key)}
              className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-white/[.08] bg-white/[0.02] px-4 text-[13px] text-zinc-300 transition-colors hover:border-violet-400/40 hover:text-zinc-100"
            >
              {t.key === "mutual" ? <Heart className="h-4 w-4" aria-hidden="true" /> : <UserRound className="h-4 w-4" aria-hidden="true" />}
              {t.label}列表
            </button>
          ))}
        </div>
      </motion.section>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="glass mt-4 rounded-3xl border border-white/[.07] p-5"
      aria-label="关注列表"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-xl border border-white/[.08] bg-white/[0.02] p-1" role="tablist">
          {FOLLOW_TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={kind === t.key}
              onClick={() => {
                setKind(t.key);
                setPage(1);
              }}
              className={`min-h-[40px] rounded-lg px-3.5 text-[12.5px] font-medium transition-colors ${
                kind === t.key ? "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white" : "text-zinc-400 hover:text-zinc-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => onOpenChange(null)}
          className="min-h-[40px] rounded-xl border border-white/[.1] px-3 text-[12.5px] text-zinc-400 hover:border-violet-400/40 hover:text-zinc-100"
        >
          收起
        </button>
      </div>

      <div className="mt-4" aria-busy={loading}>
        {error ? (
          <p className="py-6 text-center text-[13px] text-red-300">{error}</p>
        ) : loading && !users.length ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="shimmer h-16 rounded-2xl" />
            ))}
          </div>
        ) : !users.length ? (
          <p className="py-8 text-center text-[13px] text-zinc-500">暂无内容</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {users.map((u) => (
              <li key={u.id}>
                <Link
                  href={`/user/${u.id}?source=netease`}
                  className="flex min-h-[64px] items-center gap-3 rounded-2xl border border-white/[.05] bg-white/[0.02] p-2.5 transition-colors hover:border-violet-400/30"
                >
                  {u.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={coverProxyUrl(u.avatar, "netease")} alt="" loading="lazy" className="h-11 w-11 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/[0.05]">
                      <UserRound className="h-5 w-5 text-zinc-500" aria-hidden="true" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <b className="truncate text-[13px] font-semibold text-zinc-200">{u.nickname}</b>
                      {u.mutual && <span className="rounded-full bg-fuchsia-500/15 px-1.5 py-px text-[11px] text-fuchsia-300">互关</span>}
                    </span>
                    {u.signature && <span className="mt-0.5 block truncate text-[11.5px] text-zinc-500">{u.signature}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {hasMore && !loading && (
          <button
            onClick={() => {
              const next = page + 1;
              setPage(next);
              void load(kind, next, true);
            }}
            className="mt-3 flex min-h-[44px] w-full items-center justify-center rounded-xl border border-white/[.08] text-[13px] text-zinc-400 transition-colors hover:border-violet-400/40 hover:text-zinc-100"
          >
            加载更多
          </button>
        )}
      </div>
    </motion.section>
  );
}
