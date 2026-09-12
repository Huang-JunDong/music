"use client";

/**
 * 播放历史 /history：本机播放（会话 Cookie 隔离，可清空）/ 网易最近（账号三区：歌曲/专辑/歌单）
 * 播放时服务端已自动 scrobble 同步网易账号听歌历史
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { Rewind, Clock3, RefreshCw, AlertTriangle, Trash2, QrCode, Music4, Disc3, ListMusic, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { SongList } from "@/components/song-list";
import { PlaylistGrid } from "@/components/playlist-grid";
import { apiPlayHistory, apiClearPlayHistory, apiRecent } from "@/lib/client/api";
import type { Playlist, Song } from "@/lib/types";

type TabKey = "local" | "netease";

const TABS: { key: TabKey; label: string; icon: typeof Clock3 }[] = [
  { key: "local", label: "本机播放", icon: Clock3 },
  { key: "netease", label: "网易云最近", icon: Rewind },
];

const NETEASE_SECTIONS: { kind: "album" | "playlist"; label: string; icon: typeof Disc3 }[] = [
  { kind: "album", label: "最近专辑", icon: Disc3 },
  { kind: "playlist", label: "最近歌单", icon: ListMusic },
];

/* 模块级缓存（同会话切换秒显） */
let localCache: Song[] | null = null;

export default function HistoryPage() {
  return (
    <Suspense fallback={<HistoryFallback />}>
      <HistoryInner />
    </Suspense>
  );
}

function HistoryInner() {
  const params = useSearchParams();
  const router = useRouter();
  const tab: TabKey = params.get("tab") === "netease" ? "netease" : "local";

  const switchTab = (k: TabKey) => {
    if (k === tab) return;
    router.replace(k === "local" ? "/history" : "/history?tab=netease", { scroll: false });
  };

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 lg:px-8 lg:py-10">
      <PageHeader
        icon={Rewind}
        title="播放历史"
        subtitle="本机播放记录（浏览器会话隔离）与网易账号最近播放；播放时自动同步听歌打卡"
        className="mb-5"
      />

      <div className="sticky top-[61px] z-20 -mx-4 bg-gradient-to-b from-surface-sticky via-surface-sticky/92 to-transparent px-4 pb-2 pt-2 backdrop-blur-sm lg:top-0 lg:-mx-8 lg:px-8">
        <div className="glass inline-flex rounded-xl border border-white/[0.07] p-1" role="tablist" aria-label="播放历史来源">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                onClick={() => switchTab(t.key)}
                className={`relative flex min-h-[40px] items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-medium transition-colors ${
                  active ? "text-white" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="history-tab-pill"
                    className="absolute inset-0 rounded-lg bg-gradient-to-r from-violet-500/25 to-fuchsia-500/20 ring-1 ring-violet-400/30"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                )}
                <Icon className="relative h-3.5 w-3.5" aria-hidden="true" />
                <span className="relative">{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22 }}
          >
            {tab === "local" ? <LocalTab /> : <NeteaseTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ================= 本机播放 ================= */

function LocalTab() {
  const [songs, setSongs] = useState<Song[]>(localCache ?? []);
  const [loading, setLoading] = useState(localCache === null);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (localCache) {
      setSongs(localCache);
      return;
    }
    let alive = true;
    apiPlayHistory()
      .then((list) => {
        if (!alive) return;
        localCache = list;
        setSongs(list);
      })
      .catch(() => {
        /* 静默空态 */
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const onClear = async () => {
    if (clearing) return;
    setClearing(true);
    try {
      const ok = await apiClearPlayHistory();
      if (ok) {
        localCache = [];
        setSongs([]);
        toast.success("已清空本机播放历史");
      } else {
        toast.error("清空失败");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "清空失败");
    } finally {
      setClearing(false);
    }
  };

  return (
    <>
      {songs.length > 0 && (
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs tabular-nums text-zinc-500">{songs.length} 条记录</p>
          <button
            onClick={() => void onClear()}
            disabled={clearing}
            className="flex min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] text-zinc-500 transition-colors hover:text-red-300 disabled:opacity-50"
            aria-label="清空本机播放历史"
          >
            {clearing ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Trash2 className="h-3 w-3" aria-hidden="true" />}
            清空本机历史
          </button>
        </div>
      )}
      <SongList
        songs={songs}
        loading={loading}
        emptyHint="还没有播放记录，去搜索或歌单广场听点什么吧"
      />
    </>
  );
}

/* ================= 网易最近 ================= */

function NeteaseTab() {
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [albums, setAlbums] = useState<Playlist[] | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setSongs(null);
    setAlbums(null);
    setPlaylists(null);
    setNeedLogin(false);
    setError("");
    Promise.all([apiRecent("song", 50), apiRecent("album", 12), apiRecent("playlist", 12)])
      .then(([sr, ar, pr]) => {
        if (!alive) return;
        if (sr.need_login || ar.need_login || pr.need_login) {
          setNeedLogin(true);
          return;
        }
        const err = sr.error || ar.error || pr.error;
        if (err) throw new Error(err);
        setSongs(sr.songs ?? []);
        setAlbums(ar.albums ?? []);
        setPlaylists(pr.playlists ?? []);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "加载失败");
      });
    return () => {
      alive = false;
    };
  }, [retryKey]);

  const retry = useCallback(() => setRetryKey((k) => k + 1), []);

  if (needLogin) {
    return (
      <div className="glass flex flex-col items-center gap-3 rounded-3xl border border-white/[0.07] py-16 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10">
          <QrCode className="h-7 w-7 text-amber-300/80" aria-hidden="true" />
        </span>
        <p className="max-w-sm text-sm leading-relaxed text-zinc-400">查看网易账号最近播放需要先登录</p>
        <Link
          href="/accounts"
          className="mt-1 flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/25 transition-all hover:brightness-110 active:scale-95"
        >
          <QrCode className="h-4 w-4" aria-hidden="true" /> 去扫码登录
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10">
          <AlertTriangle className="h-7 w-7 text-red-300/80" aria-hidden="true" />
        </span>
        <p className="max-w-sm text-sm leading-relaxed text-zinc-400">{error}</p>
        <button
          onClick={retry}
          className="mt-1 flex h-11 items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] px-5 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.08] active:scale-95"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> 重试
        </button>
      </div>
    );
  }

  return (
    <>
      {/* 最近歌曲 */}
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-zinc-100">
          <Music4 className="h-4 w-4 text-violet-300/80" aria-hidden="true" /> 最近歌曲
        </h2>
        {songs && <span className="text-xs tabular-nums text-zinc-500">{songs.length} 首</span>}
      </div>
      <SongList songs={songs ?? []} loading={songs === null} emptyHint="暂无最近播放歌曲" />

      {/* 专辑/歌单两列区 */}
      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        {NETEASE_SECTIONS.map((sec) => {
          const list = sec.kind === "album" ? albums : playlists;
          const Icon = sec.icon;
          return (
            <section key={sec.kind} aria-label={sec.label}>
              <div className="mb-3 flex items-baseline gap-2">
                <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-zinc-100">
                  <Icon className="h-4 w-4 text-fuchsia-300/80" aria-hidden="true" /> {sec.label}
                </h2>
                {list && <span className="text-xs tabular-nums text-zinc-500">{list.length} 个</span>}
              </div>
              {list === null ? (
                <PlaylistGrid playlists={[]} loading />
              ) : (
                <PlaylistGrid
                  playlists={list.slice(0, 6)}
                  emptyHint="暂无记录"
                  kind={sec.kind === "album" ? "album" : "playlist"}
                  hrefOf={(p) =>
                    sec.kind === "album"
                      ? `/album?id=${encodeURIComponent(p.id)}&source=${p.source}`
                      : `/playlist?id=${encodeURIComponent(p.id)}&source=${p.source}`
                  }
                />
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

function HistoryFallback() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 lg:px-8 lg:py-10" aria-busy="true">
      <div className="mb-5 h-11 w-48 animate-pulse rounded-2xl bg-white/[0.05]" />
      <div className="mb-4 h-12 w-64 animate-pulse rounded-xl bg-white/[0.04]" />
      <div className="shimmer h-96 rounded-2xl" />
    </div>
  );
}
