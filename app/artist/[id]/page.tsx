"use client";

/**
 * 歌手主页 /artist/[id]?source=：头部资料卡（头像/别名/统计/简介）+
 * Tab：热门50（SongList）/ 全部歌曲（分页追加）/ 专辑（PlaylistGrid）/ MV（卡片+播放弹窗）/ 相似歌手（头像卡）
 * 各 tab 懒加载 + 模块级缓存；相似歌手卡点击页内导航（replace 不堆栈）
 */
import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import {
  UserRound, Music4, Disc3, MonitorPlay, Users2, RefreshCw, AlertTriangle, ChevronDown, ExternalLink, Sparkles, ChevronRight,
} from "lucide-react";
import { SongList } from "@/components/song-list";
import { PlaylistGrid } from "@/components/playlist-grid";
import { MvPlayModal, formatPlayCount } from "@/components/mv-play-modal";
import { apiArtistOverview, apiArtistPage } from "@/lib/client/api";
import { coverProxyUrl, sourceMeta } from "@/lib/play-url";
import { formatDuration, type Artist, type MvItem, type Playlist, type Song } from "@/lib/types";

type TabKey = "hot" | "songs" | "albums" | "mvs" | "similar";

const TABS: { key: TabKey; label: string; icon: typeof Music4 }[] = [
  { key: "hot", label: "热门50", icon: Sparkles },
  { key: "songs", label: "全部歌曲", icon: Music4 },
  { key: "albums", label: "专辑", icon: Disc3 },
  { key: "mvs", label: "MV", icon: MonitorPlay },
  { key: "similar", label: "相似歌手", icon: Users2 },
];

/* ---------- 模块级缓存（同会话返回/相似歌手跳转秒显） ---------- */
const overviewCache = new Map<string, { artist: Artist; topSongs: Song[] }>();
const pageCache = new Map<string, { items: unknown[]; hasMore: boolean }>();

export default function ArtistPage() {
  return (
    <Suspense fallback={<ArtistFallback />}>
      <ArtistInner />
    </Suspense>
  );
}

function ArtistInner() {
  const routeParams = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const id = decodeURIComponent(String(routeParams?.id ?? ""));
  const source = search.get("source") === "qq" ? "qq" : "netease";
  const rawTab = search.get("tab") ?? "";
  const tab: TabKey = TABS.some((t) => t.key === rawTab) ? (rawTab as TabKey) : "hot";

  const cacheKey = `${source}:${id}`;
  const initial = overviewCache.get(cacheKey);
  const [artist, setArtist] = useState<Artist | null>(initial?.artist ?? null);
  const [topSongs, setTopSongs] = useState<Song[]>(initial?.topSongs ?? []);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const cached = overviewCache.get(cacheKey);
    if (cached) {
      setArtist(cached.artist);
      setTopSongs(cached.topSongs);
      return;
    }
    let alive = true;
    setArtist(null);
    setError("");
    apiArtistOverview(source, id)
      .then((r) => {
        if (!alive) return;
        if (r.error || !r.artist) throw new Error(r.error || "歌手不存在");
        overviewCache.set(cacheKey, { artist: r.artist, topSongs: r.top_songs ?? [] });
        setArtist(r.artist);
        setTopSongs(r.top_songs ?? []);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "加载歌手失败");
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, retryKey]);

  const switchTab = (k: TabKey) => {
    if (k === tab) return;
    const p = new URLSearchParams({ source });
    if (k !== "hot") p.set("tab", k);
    router.replace(`/artist/${encodeURIComponent(id)}?${p.toString()}`, { scroll: false });
  };

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10">
          <AlertTriangle className="h-7 w-7 text-red-300/80" aria-hidden="true" />
        </span>
        <p className="max-w-sm text-sm leading-relaxed text-zinc-400">{error}</p>
        <button
          onClick={() => {
            setError("");
            overviewCache.delete(cacheKey);
            setRetryKey((k) => k + 1);
          }}
          className="mt-1 flex h-11 items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] px-5 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.08] active:scale-95"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> 重试
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 lg:px-8 lg:py-10">
      {/* ---------- 头部资料卡 ---------- */}
      <ArtistHeader artist={artist} source={source} />
      {topSongs.length > 0 && artist && (
        <p className="sr-only">{sourceMeta(source).label}歌手 {artist.name}，共 {topSongs.length} 首热门歌曲</p>
      )}

      {/* ---------- tab 条（sticky） ---------- */}
      <div className="sticky top-[61px] z-20 -mx-4 bg-gradient-to-b from-surface-sticky via-surface-sticky/92 to-transparent px-4 pb-2 pt-2 backdrop-blur-sm lg:top-0 lg:-mx-8 lg:px-8">
        <div className="glass inline-flex max-w-full flex-nowrap overflow-x-auto rounded-xl border border-white/[0.07] p-1 no-scrollbar" role="tablist" aria-label="歌手内容">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                onClick={() => switchTab(t.key)}
                className={`relative flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-medium transition-colors ${
                  active ? "text-white" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="artist-tab-pill"
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
            {tab === "hot" && <HotTab songs={topSongs} loading={!artist} />}
            {tab === "songs" && <SongsTab source={source} id={id} />}
            {tab === "albums" && <AlbumsTab source={source} id={id} />}
            {tab === "mvs" && <MvsTab source={source} id={id} />}
            {tab === "similar" && <SimilarTab source={source} id={id} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ================= 头部资料卡 ================= */

function ArtistHeader({ artist, source }: { artist: Artist | null; source: string }) {
  const [briefOpen, setBriefOpen] = useState(false);
  if (!artist) {
    return (
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center" aria-busy="true">
        <div className="shimmer h-28 w-28 rounded-full sm:h-32 sm:w-32" />
        <div className="flex-1 space-y-2.5 py-2">
          <div className="shimmer h-7 w-52 rounded" />
          <div className="shimmer h-4 w-72 rounded" />
          <div className="shimmer h-4 w-40 rounded" />
        </div>
      </div>
    );
  }
  const stats: [label: string, value: number | undefined][] = [
    ["单曲", artist.song_count],
    ["专辑", artist.album_count],
    ["MV", artist.mv_count],
  ];
  return (
    <motion.header
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start"
    >
      {artist.avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={coverProxyUrl(artist.avatar, source)}
          alt={`${artist.name}头像`}
          className="h-28 w-28 shrink-0 rounded-full object-cover ring-2 ring-white/10 sm:h-32 sm:w-32"
        />
      ) : (
        <span className="flex h-28 w-28 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500/30 to-fuchsia-500/25 ring-2 ring-white/10 sm:h-32 sm:w-32">
          <UserRound className="h-12 w-12 text-zinc-400" aria-hidden="true" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-extrabold tracking-tight text-zinc-50">{artist.name}</h1>
          <span className="glass flex items-center gap-1 rounded-full border border-white/[0.07] px-2.5 py-1 text-[11px] text-zinc-400">
            <span className={`h-1.5 w-1.5 rounded-full ${sourceMeta(source).dot}`} aria-hidden="true" />
            {sourceMeta(source).label}
          </span>
          {artist.link && (
            <a
              href={artist.link}
              target="_blank"
              rel="noreferrer"
              className="flex h-7 items-center gap-1 rounded-full border border-white/[0.1] bg-white/[0.03] px-2.5 text-[11px] text-zinc-400 transition-colors hover:bg-white/[0.07] hover:text-zinc-200"
            >
              <ExternalLink className="h-3 w-3" aria-hidden="true" /> 源站
            </a>
          )}
        </div>
        {artist.alias && <p className="mt-1 text-[13px] text-zinc-500">{artist.alias}</p>}
        <div className="mt-2 flex flex-wrap gap-3">
          {stats
            .filter(([, v]) => typeof v === "number" && v > 0)
            .map(([label, v]) => (
              <span key={label} className="text-[12px] text-zinc-500">
                <span className="font-bold tabular-nums text-zinc-200">{v}</span> {label}
              </span>
            ))}
        </div>
        {artist.brief && (
          <div className="mt-2.5">
            <p
              className={`max-w-3xl text-[13px] leading-relaxed text-zinc-500 ${briefOpen ? "" : "line-clamp-2"}`}
            >
              {artist.brief}
            </p>
            {artist.brief.length > 90 && (
              <button
                onClick={() => setBriefOpen((v) => !v)}
                className="mt-1 flex items-center gap-0.5 text-[12px] text-violet-300/90 transition-colors hover:text-violet-200"
                aria-expanded={briefOpen}
              >
                {briefOpen ? "收起" : "展开"}
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${briefOpen ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>
    </motion.header>
  );
}

/* ================= 各 Tab ================= */

function HotTab({ songs, loading }: { songs: Song[]; loading: boolean }) {
  if (loading) return <div className="shimmer h-96 rounded-2xl" aria-busy="true" />;
  return <SongList songs={songs} emptyHint="暂无热门歌曲" showIndex />;
}

/** 通用分页追加容器（songs/albums/mvs 共用交互） */
function useArtistPager<T>(
  source: string,
  id: string,
  kind: "songs" | "albums" | "mvs" | "similar",
  pick: (r: { songs?: Song[]; albums?: Playlist[]; mvs?: MvItem[]; artists?: Artist[]; has_more?: boolean }) => T[],
) {
  const cacheKey = `${source}:${id}:${kind}`;
  const initial = pageCache.get(cacheKey);
  const [items, setItems] = useState<T[]>(() => (initial?.items as T[]) ?? []);
  const [hasMore, setHasMore] = useState(initial?.hasMore ?? true);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!initial);
  const [loadingMore, setLoadingMore] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const hadCache = useRef(!!initial);

  useEffect(() => {
    if (hadCache.current) {
      hadCache.current = false;
      return;
    }
    let alive = true;
    setItems([]);
    setLoading(true);
    setError("");
    apiArtistPage(source, id, kind, 1)
      .then((r) => {
        if (!alive) return;
        if (r.error) throw new Error(r.error);
        const list = pick(r);
        pageCache.set(cacheKey, { items: list, hasMore: !!r.has_more });
        setItems(list);
        setHasMore(!!r.has_more);
        setPage(1);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "加载失败");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, retryKey]);

  const loadMore = () => {
    if (loadingMore || !hasMore) return;
    const next = page + 1;
    setLoadingMore(true);
    apiArtistPage(source, id, kind, next)
      .then((r) => {
        if (r.error) throw new Error(r.error);
        setItems((prev) => {
          const merged = [...prev, ...pick(r)];
          pageCache.set(cacheKey, { items: merged, hasMore: !!r.has_more });
          return merged;
        });
        setHasMore(!!r.has_more);
        setPage(next);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载更多失败"))
      .finally(() => setLoadingMore(false));
  };

  return { items, hasMore, error, loading, loadingMore, loadMore, retry: () => {
    setError("");
    pageCache.delete(cacheKey);
    setRetryKey((k) => k + 1);
  } };
}

function LoadMoreButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <div className="mt-6 flex justify-center">
      <button
        onClick={onClick}
        disabled={loading}
        className="flex h-11 items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] px-6 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.08] active:scale-95 disabled:opacity-50"
      >
        {loading ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
        {loading ? "加载中…" : "加载更多"}
      </button>
    </div>
  );
}

function PagerError({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-14 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10">
        <AlertTriangle className="h-6 w-6 text-red-300/80" aria-hidden="true" />
      </span>
      <p className="max-w-sm text-sm leading-relaxed text-zinc-400">{text}</p>
      <button
        onClick={onRetry}
        className="flex h-10 items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] px-5 text-sm text-zinc-200 transition-colors hover:bg-white/[0.08] active:scale-95"
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" /> 重试
      </button>
    </div>
  );
}

function SongsTab({ source, id }: { source: string; id: string }) {
  const pager = useArtistPager<Song>(source, id, "songs", (r) => r.songs ?? []);
  if (pager.error && !pager.items.length) return <PagerError text={pager.error} onRetry={pager.retry} />;
  return (
    <>
      <SongList songs={pager.items} loading={pager.loading} emptyHint="暂无歌曲" showIndex={false} />
      {!pager.loading && pager.hasMore && !!pager.items.length && (
        <LoadMoreButton loading={pager.loadingMore} onClick={pager.loadMore} />
      )}
    </>
  );
}

function AlbumsTab({ source, id }: { source: string; id: string }) {
  const pager = useArtistPager<Playlist>(source, id, "albums", (r) => r.albums ?? []);
  if (pager.error && !pager.items.length) return <PagerError text={pager.error} onRetry={pager.retry} />;
  return (
    <>
      <PlaylistGrid
        playlists={pager.items}
        loading={pager.loading}
        emptyHint="暂无专辑"
        kind="album"
        hrefOf={(a) => `/album?id=${encodeURIComponent(a.id)}&source=${a.source}`}
      />
      {!pager.loading && pager.hasMore && !!pager.items.length && (
        <LoadMoreButton loading={pager.loadingMore} onClick={pager.loadMore} />
      )}
    </>
  );
}

function MvsTab({ source, id }: { source: string; id: string }) {
  const pager = useArtistPager<MvItem>(source, id, "mvs", (r) => r.mvs ?? []);
  const [playing, setPlaying] = useState<MvItem | null>(null);
  if (pager.error && !pager.items.length) return <PagerError text={pager.error} onRetry={pager.retry} />;
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {pager.loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i}>
                <div className="shimmer aspect-video rounded-2xl" />
                <div className="shimmer mt-2 h-3.5 w-3/4 rounded" />
              </div>
            ))
          : pager.items.map((mv, i) => {
              const plays = formatPlayCount(mv.play_count);
              return (
                <motion.button
                  key={`${mv.id}-${i}`}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.04, 0.4), duration: 0.3 }}
                  onClick={() => setPlaying(mv)}
                  aria-label={`播放 MV ${mv.name}`}
                  className="card-glow group block text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 rounded-2xl"
                >
                  <span className="relative block aspect-video overflow-hidden rounded-2xl bg-zinc-800/80 ring-1 ring-white/[0.06] transition-all duration-300 group-hover:-translate-y-0.5 group-hover:ring-violet-400/40">
                    {mv.cover ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={coverProxyUrl(mv.cover, mv.source)}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
                      />
                    ) : null}
                    {mv.duration > 0 && (
                      <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-zinc-200">
                        {formatDuration(mv.duration)}
                      </span>
                    )}
                  </span>
                  <span className="tip mt-2 block truncate text-[13px] font-semibold text-zinc-200 group-hover:text-white">
                    {mv.name}
                    <span className="tip-bubble">
                      <span className="tip-name">{mv.name}</span>
                      <span className="tip-sub">{mv.artist}</span>
                    </span>
                  </span>
                  {plays && <span className="mt-0.5 block text-[11px] tabular-nums text-zinc-500">{plays}次播放</span>}
                </motion.button>
              );
            })}
      </div>
      {!pager.loading && !pager.items.length && !pager.error && (
        <p className="py-14 text-center text-sm text-zinc-500">暂无 MV</p>
      )}
      {!pager.loading && pager.hasMore && !!pager.items.length && (
        <LoadMoreButton loading={pager.loadingMore} onClick={pager.loadMore} />
      )}
      <MvPlayModal mv={playing} onClose={() => setPlaying(null)} />
    </>
  );
}

function SimilarTab({ source, id }: { source: string; id: string }) {
  const pager = useArtistPager<Artist>(source, id, "similar", (r) => r.artists ?? []);
  const router = useRouter();
  if (pager.loading) {
    return (
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6" aria-busy="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <div className="shimmer h-20 w-20 rounded-full" />
            <div className="shimmer h-3 w-14 rounded" />
          </div>
        ))}
      </div>
    );
  }
  if (pager.error && !pager.items.length) return <PagerError text={pager.error} onRetry={pager.retry} />;
  if (!pager.items.length) {
    return (
      <div className="flex flex-col items-center gap-3 py-14 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.04]">
          <Users2 className="h-6 w-6 text-zinc-500" aria-hidden="true" />
        </span>
        <p className="text-sm text-zinc-500">暂无相似歌手（网易源需登录后可获取）</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
      {pager.items.map((a, i) => (
        <motion.button
          key={`${a.id}-${i}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: Math.min(i * 0.04, 0.4), duration: 0.3 }}
          onClick={() => {
            router.replace(`/artist/${encodeURIComponent(a.id)}?source=${a.source}`, { scroll: false });
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          aria-label={`查看歌手 ${a.name}`}
          className="group flex flex-col items-center gap-2 rounded-2xl p-2 transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
        >
          <span className="relative block h-20 w-20 overflow-hidden rounded-full ring-1 ring-white/[0.08] transition-all group-hover:ring-violet-400/40">
            {a.avatar ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={coverProxyUrl(a.avatar, a.source)} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
            ) : (
              <span className="flex h-full items-center justify-center bg-gradient-to-br from-violet-500/20 to-fuchsia-500/15">
                <UserRound className="h-8 w-8 text-zinc-500" aria-hidden="true" />
              </span>
            )}
          </span>
          <span className="flex max-w-full items-center gap-0.5">
            <span className="tip truncate text-[12px] font-medium text-zinc-300 group-hover:text-white">
              {a.name}
              <span className="tip-bubble">
                <span className="tip-name">{a.name}</span>
                <span className="tip-sub">{sourceMeta(a.source).label}歌手</span>
              </span>
            </span>
            <ChevronRight className="h-3 w-3 shrink-0 text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
          </span>
        </motion.button>
      ))}
    </div>
  );
}

/* ================= 骨架 ================= */

function ArtistFallback() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 lg:px-8 lg:py-10" aria-busy="true">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="shimmer h-28 w-28 rounded-full sm:h-32 sm:w-32" />
        <div className="flex-1 space-y-2.5 py-2">
          <div className="shimmer h-7 w-52 rounded" />
          <div className="shimmer h-4 w-72 rounded" />
        </div>
      </div>
      <div className="shimmer h-96 rounded-2xl" />
    </div>
  );
}
