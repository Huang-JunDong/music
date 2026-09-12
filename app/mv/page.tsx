"use client";

/**
 * MV 中心：网易（最新/网易出品/MV榜/全部筛选）· QQ（分类列表）
 * 交互：源 tab + 二级 tab + 地区 chips（URL 同步）→ 16:9 卡片网格 → 点击 Modal 播放
 * 分页为追加式「加载更多」，模块级缓存切换秒显（对齐 /explore、/charts 模式）
 */
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { MonitorPlay, Play, RefreshCw, AlertTriangle, Film, ChevronDown } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { MvPlayModal, formatPlayCount } from "@/components/mv-play-modal";
import { apiMvList } from "@/lib/client/api";
import { coverProxyUrl, sourceMeta } from "@/lib/play-url";
import { formatDuration, type MvItem, type MvListTab } from "@/lib/types";

const AREAS = ["全部", "内地", "港台", "欧美", "日本", "韩国"] as const;

/** 各源二级 tab（QQ 仅 all） */
const SUB_TABS: Record<string, { key: MvListTab; label: string }[]> = {
  netease: [
    { key: "latest", label: "最新MV" },
    { key: "exclusive", label: "网易出品" },
    { key: "top", label: "MV榜" },
    { key: "all", label: "全部" },
  ],
  qq: [{ key: "all", label: "全部MV" }],
};

/* ---------- 模块级分页缓存：key = source:tab:area ---------- */
const mvCacheMap = new Map<string, { mvs: MvItem[]; hasMore: boolean }>();

export default function MvPage() {
  return (
    <Suspense fallback={<MvFallback />}>
      <MvInner />
    </Suspense>
  );
}

function MvInner() {
  const params = useSearchParams();
  const router = useRouter();
  const source = params.get("source") === "qq" ? "qq" : "netease";
  const subTabs = SUB_TABS[source];
  const rawTab = (params.get("tab") ?? "") as MvListTab;
  const tab: MvListTab = subTabs.some((t) => t.key === rawTab) ? rawTab : subTabs[0].key;
  const rawArea = params.get("area") ?? "";
  const area = (AREAS as readonly string[]).includes(rawArea) ? rawArea : "全部";

  const [playing, setPlaying] = useState<MvItem | null>(null);

  const replaceQuery = useCallback(
    (next: { source?: string; tab?: string; area?: string }) => {
      const p = new URLSearchParams();
      const s = next.source ?? source;
      const t = next.tab ?? (next.source && next.source !== source ? SUB_TABS[next.source][0].key : tab);
      const a = next.area ?? area;
      p.set("source", s);
      p.set("tab", t);
      if (a !== "全部") p.set("area", a);
      router.replace(`/mv?${p.toString()}`, { scroll: false });
    },
    [router, source, tab, area],
  );

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 lg:px-8 lg:py-10">
      <PageHeader
        icon={MonitorPlay}
        title="MV 中心"
        subtitle="网易云与 QQ 音乐 MV 聚合，最新、最热、网易出品一屏尽览"
        className="mb-5"
      />

      {/* 源 + 二级 tab + 地区（sticky） */}
      <div className="sticky top-[61px] z-20 -mx-4 bg-gradient-to-b from-surface-sticky via-surface-sticky/92 to-transparent px-4 pb-2 pt-2 backdrop-blur-sm lg:top-0 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <div className="glass inline-flex rounded-xl border border-white/[0.07] p-1" role="tablist" aria-label="MV 来源">
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
                      layoutId="mv-source-pill"
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
          {/* 二级 tab（QQ 单 tab 时不重复渲染） */}
          {subTabs.length > 1 && (
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="MV 分类">
              {subTabs.map((t) => {
                const active = t.key === tab;
                return (
                  <button
                    key={t.key}
                    role="tab"
                    aria-selected={active}
                    onClick={() => replaceQuery({ tab: t.key })}
                    className={`flex min-h-[38px] items-center rounded-full border px-3 text-xs font-medium transition-all active:scale-95 ${
                      active
                        ? "border-violet-400/40 bg-violet-500/20 text-violet-100 ring-1 ring-violet-400/30"
                        : "border-white/[0.1] bg-white/[0.02] text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {/* 地区 chips */}
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
      </div>

      <div className="mt-4">
        <MvGrid source={source} tab={tab} area={area} onPlay={setPlaying} />
      </div>

      {/* 播放弹窗 */}
      <MvPlayModal mv={playing} onClose={() => setPlaying(null)} />
    </div>
  );
}

/* ================= MV 网格（追加分页） ================= */

function MvGrid({
  source,
  tab,
  area,
  onPlay,
}: {
  source: string;
  tab: MvListTab;
  area: string;
  onPlay: (mv: MvItem) => void;
}) {
  const cacheKey = `${source}:${tab}:${area}`;
  const initial = mvCacheMap.get(cacheKey);
  const [mvs, setMvs] = useState<MvItem[]>(initial?.mvs ?? []);
  const [hasMore, setHasMore] = useState(initial?.hasMore ?? true);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!initial);
  const [loadingMore, setLoadingMore] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  /* 初始即有缓存时跳过首次拉取 */
  const hadCache = useRef(!!initial);

  useEffect(() => {
    if (hadCache.current) {
      hadCache.current = false;
      return;
    }
    let alive = true;
    setMvs([]);
    setLoading(true);
    setError("");
    apiMvList(source, { tab, area, page: 1 })
      .then((r) => {
        if (!alive) return;
        if (r.error) throw new Error(r.error);
        mvCacheMap.set(cacheKey, { mvs: r.mvs ?? [], hasMore: !!r.has_more });
        setMvs(r.mvs ?? []);
        setHasMore(!!r.has_more);
        setPage(1);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "加载 MV 失败");
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
    const nextPage = page + 1;
    setLoadingMore(true);
    apiMvList(source, { tab, area, page: nextPage })
      .then((r) => {
        if (r.error) throw new Error(r.error);
        setMvs((prev) => {
          const merged = [...prev, ...(r.mvs ?? [])];
          mvCacheMap.set(cacheKey, { mvs: merged, hasMore: !!r.has_more });
          return merged;
        });
        setHasMore(!!r.has_more);
        setPage(nextPage);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载更多失败"))
      .finally(() => setLoadingMore(false));
  };

  if (error && !mvs.length) {
    return (
      <ListError
        text={error}
        onRetry={() => {
          setError("");
          mvCacheMap.delete(cacheKey);
          setRetryKey((k) => k + 1);
        }}
      />
    );
  }

  return (
    <>
      {error && !!mvs.length && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/15 bg-amber-500/[0.06] px-4 py-3 text-[13px] leading-relaxed text-amber-200/80">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {loading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div key={i}>
                <div className="shimmer aspect-video rounded-2xl" />
                <div className="shimmer mt-2 h-3.5 w-3/4 rounded" />
                <div className="shimmer mt-1.5 h-3 w-1/2 rounded" />
              </div>
            ))
          : mvs.map((mv, i) => <MvCard key={`${mv.source}-${mv.id}-${i}`} mv={mv} index={i} onPlay={onPlay} />)}
      </div>

      {!loading && !mvs.length && !error && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.04]">
            <Film className="h-7 w-7 text-zinc-500" aria-hidden="true" />
          </span>
          <p className="text-sm text-zinc-500">该分类下暂时没有 MV，换个筛选试试</p>
        </div>
      )}

      {!loading && hasMore && !!mvs.length && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="flex h-11 items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] px-6 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.08] active:scale-95 disabled:opacity-50"
          >
            {loadingMore ? (
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            )}
            {loadingMore ? "加载中…" : "加载更多"}
          </button>
        </div>
      )}
    </>
  );
}

function MvCard({ mv, index, onPlay }: { mv: MvItem; index: number; onPlay: (mv: MvItem) => void }) {
  const plays = formatPlayCount(mv.play_count);
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.4), duration: 0.3, ease: [0.22, 0.61, 0.36, 1] }}
    >
      <button
        onClick={() => onPlay(mv)}
        aria-label={`播放 MV ${mv.name}`}
        className="card-glow group block w-full rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
      >
        <span className="relative block aspect-video overflow-hidden rounded-2xl bg-zinc-800/80 ring-1 ring-white/[0.06] transition-all duration-300 group-hover:-translate-y-0.5 group-hover:ring-violet-400/40 group-hover:shadow-xl group-hover:shadow-fuchsia-500/10">
          {mv.cover ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={coverProxyUrl(mv.cover, mv.source)}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
            />
          ) : (
            <span className="flex h-full items-center justify-center">
              <Film className="h-9 w-9 text-zinc-600" aria-hidden="true" />
            </span>
          )}
          {/* 悬浮播放按钮 */}
          <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors duration-300 group-hover:bg-black/35">
            <span className="flex h-12 w-12 scale-90 items-center justify-center rounded-full bg-white/15 opacity-0 backdrop-blur-md transition-all duration-300 group-hover:scale-100 group-hover:opacity-100">
              <Play className="ml-0.5 h-5 w-5 fill-white text-white" aria-hidden="true" />
            </span>
          </span>
          {/* 时长角标 */}
          {mv.duration > 0 && (
            <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-zinc-200">
              {formatDuration(mv.duration)}
            </span>
          )}
        </span>
        <span className="mt-2 block">
          <span className="tip block truncate text-[13px] font-semibold text-zinc-200 group-hover:text-white">
            {mv.name}
            <span className="tip-bubble">
              <span className="tip-name">{mv.name}</span>
              <span className="tip-sub">{mv.artist}</span>
            </span>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-500">
            <span className="truncate">{mv.artist || sourceMeta(mv.source).label}</span>
            {plays && (
              <>
                <span aria-hidden="true">·</span>
                <span className="shrink-0 tabular-nums">{plays}次播放</span>
              </>
            )}
          </span>
        </span>
      </button>
    </motion.div>
  );
}

/* ================= 通用小件 ================= */

function ListError({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10">
        <AlertTriangle className="h-7 w-7 text-red-300/80" aria-hidden="true" />
      </span>
      <p className="max-w-sm text-sm leading-relaxed text-zinc-400">{text}</p>
      <button
        onClick={onRetry}
        className="mt-1 flex h-11 items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] px-5 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.08] active:scale-95"
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" /> 重试
      </button>
    </div>
  );
}

function MvFallback() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 lg:px-8 lg:py-10" aria-busy="true">
      <div className="mb-5 h-11 w-48 animate-pulse rounded-2xl bg-white/[0.05]" />
      <div className="mb-4 h-12 w-80 animate-pulse rounded-xl bg-white/[0.04]" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i}>
            <div className="shimmer aspect-video rounded-2xl" />
            <div className="shimmer mt-2 h-3.5 w-3/4 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
