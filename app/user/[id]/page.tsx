"use client";

/**
 * 用户主页 /user/[id]（P1 A2）— 他人资料只读视图。
 * 网易：user_detail + 创建/收藏歌单分离 Tab（user_playlist_create/collect）；
 * QQ：复用登录档案结构展示（关注列表从评论区头像、相似用户跳转进入）。
 */
import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { UserRound, ArrowLeft, ListMusic, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { ProfileHeader } from "@/components/profile-header";
import { PlaylistGrid } from "@/components/playlist-grid";
import { apiUserProfile, apiOwnerPlaylists } from "@/lib/client/api";
import type { UserProfile, Playlist } from "@/lib/types";

type Tab = "created" | "collected";

export default function UserPage() {
  return (
    <Suspense fallback={<div className="mx-auto w-full max-w-[1000px] px-4 py-10 lg:px-8"><div className="shimmer h-44 rounded-3xl" aria-busy="true" /></div>}>
      <UserInner />
    </Suspense>
  );
}

function UserInner() {
  const routeParams = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const source = searchParams.get("source") === "qq" ? "qq" : "netease";
  const uid = decodeURIComponent(routeParams?.id ?? "");

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [tab, setTab] = useState<Tab>("created");
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError] = useState("");
  /* 审核整改 C-12：错误恢复路径可操作（原仅"去歌手库逛逛"无重试）+ 歌单加载错误与空态区分 */
  const [retryKey, setRetryKey] = useState(0);
  const [listError, setListError] = useState("");
  const [listRetry, setListRetry] = useState(0);

  useEffect(() => {
    let alive = true;
    if (!uid) return;
    setLoading(true);
    setError("");
    apiUserProfile(source, uid)
      .then((r) => {
        if (!alive) return;
        if (r.error) throw new Error(r.error);
        setProfile(r.profile ?? null);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [source, uid, retryKey]);

  useEffect(() => {
    if (source !== "netease" || !uid) return;
    let alive = true;
    setListLoading(true);
    setListError("");
    apiOwnerPlaylists("netease", uid, tab)
      .then((r) => {
        if (!alive) return;
        if (r.error) {
          setListError(r.error);
          setPlaylists([]);
        } else {
          setPlaylists(r.playlists ?? []);
        }
      })
      .catch((e) => {
        if (!alive) return;
        setListError(e instanceof Error ? e.message : "歌单加载失败");
        setPlaylists([]);
      })
      .finally(() => alive && setListLoading(false));
    return () => {
      alive = false;
    };
  }, [uid, tab, source, listRetry]);

  return (
    <div className="mx-auto w-full max-w-[1000px] px-4 py-6 lg:px-8 lg:py-10">
      <PageHeader
        icon={UserRound}
        title="用户主页"
        subtitle={profile ? `${profile.nickname} 的主页` : "查看 TA 的资料与歌单"}
        actions={
          <button
            onClick={() => router.back()}
            className="flex min-h-[40px] items-center gap-1.5 rounded-xl border border-white/[.1] px-3.5 text-[12.5px] text-zinc-400 transition-colors hover:border-violet-400/40 hover:text-zinc-100"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> 返回
          </button>
        }
      />

      {error && !loading && (
        <div className="glass flex items-center gap-3 rounded-3xl border border-red-400/20 p-5 text-sm text-red-200" role="alert">
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{error}</span>
          <button onClick={() => setRetryKey((k) => k + 1)} className="min-h-[44px] rounded-xl border border-white/[.1] px-3 py-2 text-[12.5px] text-zinc-300 transition-colors hover:border-violet-400/40 hover:text-zinc-100">
            重试
          </button>
        </div>
      )}

      {loading ? (
        <div className="shimmer h-44 rounded-3xl" aria-busy="true" />
      ) : (
        profile && <ProfileHeader profile={profile} />
      )}

      {source === "netease" && profile && (
        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08 }}
          className="mt-5"
          aria-label="TA 的歌单"
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-[15px] font-bold text-zinc-100">
              <ListMusic className="h-4.5 w-4.5 h-[18px] w-[18px] text-fuchsia-300" aria-hidden="true" /> TA 的歌单
            </h2>
            <div className="flex rounded-xl border border-white/[.08] bg-white/[0.02] p-1" role="tablist">
              {([
                { key: "created", label: `创建 ${profile.create_playlist_count ?? ""}` },
                { key: "collected", label: `收藏 ${profile.collected_playlist_count ?? ""}` },
              ] as { key: Tab; label: string }[]).map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className={`min-h-[40px] rounded-lg px-3.5 text-[12.5px] font-medium transition-colors ${
                    tab === t.key ? "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white" : "text-zinc-400 hover:text-zinc-100"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          {listError && !listLoading ? (
            /* 审核整改 C-12：歌单加载失败与空态区分（原网络错误被误报为"TA 还没有创建歌单"） */
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-[13px] text-zinc-400">{listError}</p>
              <button onClick={() => setListRetry((k) => k + 1)} className="flex min-h-[44px] items-center rounded-xl border border-white/[.1] px-4 text-[13px] text-zinc-300 transition-colors hover:border-fuchsia-400/40 hover:text-zinc-100">
                重试
              </button>
            </div>
          ) : (
            <PlaylistGrid playlists={playlists} loading={listLoading} emptyHint={tab === "created" ? "TA 还没有创建歌单" : "TA 还没有收藏歌单"} />
          )}
        </motion.section>
      )}
    </div>
  );
}
