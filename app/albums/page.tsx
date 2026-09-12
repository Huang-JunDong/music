"use client";

/**
 * 新碟架 /albums：新碟上架（地区筛选+追加分页）· 我的收藏专辑（登录源）
 * 自定义专辑卡（封面+歌手+发行日期+右上角收藏按钮）；点击进 /album 详情
 */
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion } from "motion/react";
import { Disc3, RefreshCw, AlertTriangle, ChevronDown, Sparkles, Heart, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { apiNewAlbums, apiFavAlbums, apiSubAlbum } from "@/lib/client/api";
import { coverProxyUrl, sourceMeta } from "@/lib/play-url";
import type { Playlist } from "@/lib/types";

const AREAS = ["全部", "华语", "港台", "欧美", "日本", "韩国"] as const;

type TabKey = "new" | "fav";

/* ---------- 模块级缓存 ---------- */
const albumCacheMap = new Map<string, { albums: Playlist[]; hasMore: boolean }>();
/* 已收藏专辑 id 集（本地维护：进入收藏 tab 或收藏操作后更新） */
const favAlbumIds = new Map<string, Set<string>>();

export default function AlbumsPage() {
  return (
    <Suspense fallback={<AlbumsFallback />}>
      <AlbumsInner />
    </Suspense>
  );
}

function AlbumsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const source = params.get("source") === "qq" ? "qq" : "netease";
  const rawTab = params.get("tab") ?? "new";
  const tab: TabKey = rawTab === "fav" ? "fav" : "new";
  const rawArea = params.get("area") ?? "";
  const area = (AREAS as readonly string[]).includes(rawArea) ? rawArea : "全部";

  const [favTick, setFavTick] = useState(0); /* 收藏集变更后重渲染卡片心形 */

  const replaceQuery = useCallback(
    (next: { source?: string; tab?: string; area?: string }) => {
      const p = new URLSearchParams();
      const s = next.source ?? source;
      const t = next.tab ?? tab;
      const a = next.area ?? area;
      p.set("source", s);
      p.set("tab", t);
      if (t === "new" && a !== "全部") p.set("area", a);
      router.replace(`/albums?${p.toString()}`, { scroll: false });
    },
    [router, source, tab, area],
  );

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 lg:px-8 lg:py-10">
      <PageHeader
        icon={Disc3}
        title="新碟架"
        subtitle="网易云与 QQ 音乐新碟上架聚合，支持收藏专辑到源站账号"
        className="mb-5"
      />

      {/* 源 tab + 二级 tab + 地区（sticky） */}
      <div className="sticky top-[61px] z-20 -mx-4 bg-gradient-to-b from-surface-sticky via-surface-sticky/92 to-transparent px-4 pb-2 pt-2 backdrop-blur-sm lg:top-0 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <div className="glass inline-flex rounded-xl border border-white/[0.07] p-1" role="tablist" aria-label="新碟来源">
            {(["netease", "qq"] as const).map((s) => {
              const meta = sourceMeta(s);
              const active = s === source;
              return (
                <button
                  key={s}
                  role="tab"
                  aria-selected={active}
                  onClick={() => replaceQuery({ source: s })}
                  className={`relative flex min-h-[40px] items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-medium transition-colors ${
                    active ? "text-white" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="albums-source-pill"
                      className="absolute inset-0 rounded-lg bg-gradient-to-r from-violet-500/25 to-fuchsia-500/20 ring-1 ring-violet-400/30"
                      transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    />
                  )}
                  <span className={`relative h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
                  <span className="relative">{meta.label}</span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="新碟分类">
            {[
              { key: "new" as TabKey, label: "新碟上架", icon: Sparkles },
              { key: "fav" as TabKey, label: "我的收藏", icon: Heart },
            ].map((t) => {
              const Icon = t.icon;
              const active = t.key === tab;
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => replaceQuery({ tab: t.key })}
                  className={`flex min-h-[38px] items-center gap-1 rounded-full border px-3 text-xs font-medium transition-all active:scale-95 ${
                    active
                      ? "border-violet-400/40 bg-violet-500/20 text-violet-100 ring-1 ring-violet-400/30"
                      : "border-white/[0.1] bg-white/[0.02] text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <Icon className="h-3 w-3" aria-hidden="true" />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
        {/* 地区 chips（仅新碟 tab） */}
        {tab === "new" && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {AREAS.map((a) => {
              const active = a === area;
              return (
                <button
                  key={a}
                  onClick={() => replaceQuery({ area: a })}
                  aria-pressed={active}
                  className={`flex min-h-[32px] items-center rounded-full border px-2.5 text-[11px] font-medium transition-all active:scale-95 ${
                    active
                      ? "border-fuchsia-400/40 bg-fuchsia-500/15 text-fuchsia-100"
                      : "border-white/[0.08] bg-white/[0.02] text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {a}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-4">
        <AlbumGrid key={`${source}:${tab}:${area}`} source={source} tab={tab} area={area} favTick={favTick} onFavChange={() => setFavTick((v) => v + 1)} />
      </div>
    </div>
  );
}

/* ================= 专辑网格（追加分页 + 收藏按钮） ================= */

function AlbumGrid({
  source,
  tab,
  area,
  favTick,
  onFavChange,
}: {
  source: string;
  tab: TabKey;
  area: string;
  favTick: number;
  onFavChange: () => void;
}) {
  const cacheKey = `${source}:${tab}:${tab === "new" ? area : "fav"}`;
  const initial = albumCacheMap.get(cacheKey);
  const [albums, setAlbums] = useState<Playlist[]>(initial?.albums ?? []);
  const [hasMore, setHasMore] = useState(initial?.hasMore ?? true);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!initial);
  const [loadingMore, setLoadingMore] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [subBusy, setSubBusy] = useState<string | null>(null);
  const hadCache = useRef(!!initial);
  /* favTick 变化仅触发重渲染（读本地 favAlbumIds），不重拉 */
  void favTick;

  /* 收藏 tab 首载时把返回集合写入 favAlbumIds（新碟 tab 心形状态源） */
  const syncFavIds = useCallback(
    (list: Playlist[]) => {
      const set = favAlbumIds.get(source) ?? new Set<string>();
      for (const a of list) set.add(a.id);
      favAlbumIds.set(source, set);
    },
    [source],
  );

  useEffect(() => {
    if (hadCache.current) {
      hadCache.current = false;
      return;
    }
    let alive = true;
    setAlbums([]);
    setLoading(true);
    setError("");
    const req = tab === "new" ? apiNewAlbums(source, area, 1) : apiFavAlbums(source, 1);
    req
      .then((r) => {
        if (!alive) return;
        if (r.error) throw new Error(r.error);
        albumCacheMap.set(cacheKey, { albums: r.albums ?? [], hasMore: !!r.has_more });
        if (tab === "fav") syncFavIds(r.albums ?? []);
        setAlbums(r.albums ?? []);
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
    const req = tab === "new" ? apiNewAlbums(source, area, next) : apiFavAlbums(source, next);
    req
      .then((r) => {
        if (r.error) throw new Error(r.error);
        setAlbums((prev) => {
          const merged = [...prev, ...(r.albums ?? [])];
          albumCacheMap.set(cacheKey, { albums: merged, hasMore: !!r.has_more });
          return merged;
        });
        setHasMore(!!r.has_more);
        setPage(next);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载更多失败"))
      .finally(() => setLoadingMore(false));
  };

  const onSub = async (album: Playlist) => {
    if (subBusy) return;
    const liked = !!favAlbumIds.get(source)?.has(album.id);
    setSubBusy(album.id);
    try {
      await apiSubAlbum(album, !liked);
      const set = favAlbumIds.get(source) ?? new Set<string>();
      const copy = new Set(set);
      if (liked) copy.delete(album.id);
      else copy.add(album.id);
      favAlbumIds.set(source, copy);
      toast.success(liked ? "已取消收藏" : "已收藏专辑");
      onFavChange();
      /* 收藏 tab 内取消 → 从列表移除 */
      if (tab === "fav" && liked) {
        setAlbums((prev) => prev.filter((a) => a.id !== album.id));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败（可能需要登录对应源账号）");
    } finally {
      setSubBusy(null);
    }
  };

  if (error && !albums.length) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10">
          <AlertTriangle className="h-7 w-7 text-amber-300/80" aria-hidden="true" />
        </span>
        <p className="max-w-sm text-sm leading-relaxed text-zinc-400">{error}</p>
        <button
          onClick={() => {
            setError("");
            albumCacheMap.delete(cacheKey);
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
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {loading
          ? Array.from({ length: 10 }).map((_, i) => (
              <div key={i}>
                <div className="shimmer aspect-square rounded-2xl" />
                <div className="shimmer mt-2 h-3.5 w-3/4 rounded" />
                <div className="shimmer mt-1.5 h-3 w-1/2 rounded" />
              </div>
            ))
          : albums.map((a, i) => (
              <AlbumCard key={`${a.source}-${a.id}-${i}`} album={a} index={i} liked={!!favAlbumIds.get(source)?.has(a.id)} busy={subBusy === a.id} onSub={onSub} />
            ))}
      </div>

      {!loading && !albums.length && !error && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.04]">
            <Disc3 className="h-7 w-7 text-zinc-500" aria-hidden="true" />
          </span>
          <p className="text-sm text-zinc-500">
            {tab === "fav" ? "还没有收藏专辑（登录后收藏的专辑会同步到这里）" : "该地区暂时没有新碟，换个筛选试试"}
          </p>
        </div>
      )}

      {!loading && hasMore && !!albums.length && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="flex h-11 items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] px-6 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.08] active:scale-95 disabled:opacity-50"
          >
            {loadingMore ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
            {loadingMore ? "加载中…" : "加载更多"}
          </button>
        </div>
      )}
    </>
  );
}

function AlbumCard({
  album,
  index,
  liked,
  busy,
  onSub,
}: {
  album: Playlist;
  index: number;
  liked: boolean;
  busy: boolean;
  onSub: (album: Playlist) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.45), duration: 0.3, ease: [0.22, 0.61, 0.36, 1] }}
      className="group relative"
    >
      <Link
        href={`/album?id=${encodeURIComponent(album.id)}&source=${album.source}`}
        aria-label={`打开专辑 ${album.name}`}
        className="block"
      >
        <span className="card-glow relative block aspect-square overflow-hidden rounded-2xl bg-zinc-800/80 ring-1 ring-white/[0.06] transition-all duration-300 group-hover:-translate-y-0.5 group-hover:ring-violet-400/40 group-hover:shadow-xl group-hover:shadow-fuchsia-500/10">
          {album.cover ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={coverProxyUrl(album.cover, album.source)}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
            />
          ) : (
            <span className="flex h-full items-center justify-center">
              <Disc3 className="h-10 w-10 text-zinc-600" aria-hidden="true" />
            </span>
          )}
        </span>
        <span className="mt-2 block">
          <span className="tip block truncate text-[13px] font-semibold text-zinc-200 group-hover:text-white">
            {album.name}
            <span className="tip-bubble">
              <span className="tip-name">{album.name}</span>
              <span className="tip-sub">{album.creator}</span>
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
            {album.creator || sourceMeta(album.source).label}
            {album.description ? ` · ${album.description}` : ""}
          </span>
        </span>
      </Link>
      {/* 收藏按钮（独立于卡片链接，阻止冒泡） */}
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void onSub(album);
        }}
        aria-label={liked ? `取消收藏 ${album.name}` : `收藏 ${album.name}`}
        aria-pressed={liked}
        title={liked ? "取消收藏（源站）" : "收藏专辑（同步到源站）"}
        className={`absolute right-1.5 top-1.5 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 backdrop-blur-md transition-all active:scale-90 ${
          liked ? "text-rose-400" : "text-zinc-300 opacity-0 group-hover:opacity-100 hover:text-rose-300"
        }`}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Heart className="h-4 w-4" fill={liked ? "currentColor" : "none"} />}
      </button>
    </motion.div>
  );
}

function AlbumsFallback() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 lg:px-8 lg:py-10" aria-busy="true">
      <div className="mb-5 h-11 w-48 animate-pulse rounded-2xl bg-white/[0.05]" />
      <div className="mb-4 h-12 w-80 animate-pulse rounded-xl bg-white/[0.04]" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i}>
            <div className="shimmer aspect-square rounded-2xl" />
            <div className="shimmer mt-2 h-3.5 w-3/4 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
