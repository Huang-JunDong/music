"use client";

/**
 * 排行榜中心：网易云 toplist / QQ 巅峰榜 双源聚合
 * 交互：源 tab（?source=）→ 榜单卡片网格 → 点击进入榜单详情（?id=，页内 SongList 按排名序号渲染）
 * 模块级缓存 + URL 同步，切源/返回秒显（对齐 /explore 模式）
 */
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { Trophy, RefreshCw, AlertTriangle, ChevronLeft, Clock3, Crown } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SongList } from "@/components/song-list";
import { apiToplists, apiToplistSongs, type SourceToplists } from "@/lib/client/api";
import { coverProxyUrl, sourceMeta } from "@/lib/play-url";
import type { Song, Toplist } from "@/lib/types";

/* ---------- 模块级缓存（同会话切回不重复请求） ---------- */
const toplistsCacheMap = new Map<string, { tabs: SourceToplists[]; error: string }>();
const toplistSongsCache = new Map<string, { toplist: Toplist; songs: Song[] }>();

/** 排名徽标配色：前三名品牌渐变，其余中性 */
function RankBadge({ rank }: { rank: number }) {
  const top3 = rank <= 3;
  return (
    <span
      className={`w-4 shrink-0 text-right text-[11px] font-bold tabular-nums ${
        top3 ? "text-gradient" : "text-zinc-600"
      }`}
      aria-hidden="true"
    >
      {rank}
    </span>
  );
}

export default function ChartsPage() {
  return (
    <Suspense fallback={<ChartsFallback />}>
      <ChartsInner />
    </Suspense>
  );
}

function ChartsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const source = params.get("source") === "qq" ? "qq" : "netease";
  const id = params.get("id") ?? "";

  const switchSource = (s: "netease" | "qq") => {
    if (s === source) return;
    router.replace(s === "netease" ? "/charts" : `/charts?source=${s}`, { scroll: false });
  };
  const openToplist = (t: Toplist) => {
    const p = new URLSearchParams({ source: t.source, id: t.id });
    if (t.name) p.set("name", t.name);
    if (t.cover) p.set("cover", t.cover);
    if (t.update_time) p.set("update_time", t.update_time);
    if (t.description) p.set("description", t.description);
    router.replace(`/charts?${p.toString()}`, { scroll: false });
  };
  const backToList = () => {
    router.replace(source === "netease" ? "/charts" : `/charts?source=${source}`, { scroll: false });
  };

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 lg:px-8 lg:py-10">
      <PageHeader
        icon={Trophy}
        title="排行榜中心"
        subtitle="网易云官方榜与 QQ 巅峰榜实时聚合，热门、新歌、飙升一网打尽"
        className="mb-5"
      />

      {id ? (
        <ToplistDetailView source={source} id={id} onBack={backToList} />
      ) : (
        <>
          {/* 源选择（sticky pill） */}
          <div className="sticky top-[61px] z-20 -mx-4 bg-gradient-to-b from-surface-sticky via-surface-sticky/92 to-transparent px-4 pb-2 pt-2 backdrop-blur-sm lg:top-0 lg:-mx-8 lg:px-8">
            <div className="glass inline-flex rounded-xl border border-white/[0.07] p-1" role="tablist" aria-label="榜单来源">
              {(["netease", "qq"] as const).map((s) => {
                const meta = sourceMeta(s);
                const active = s === source;
                return (
                  <button
                    key={s}
                    role="tab"
                    aria-selected={active}
                    onClick={() => switchSource(s)}
                    className={`relative flex min-h-[40px] items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-medium transition-colors ${
                      active ? "text-white" : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="charts-source-pill"
                        className="absolute inset-0 rounded-lg bg-gradient-to-r from-violet-500/25 to-fuchsia-500/20 ring-1 ring-violet-400/30"
                        transition={{ type: "spring", stiffness: 420, damping: 34 }}
                      />
                    )}
                    <span className={`relative h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
                    <span className="relative">{meta.label}榜</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-4">
            <ToplistGrid source={source} onOpen={openToplist} />
          </div>
        </>
      )}
    </div>
  );
}

/* ================= 榜单目录网格 ================= */

function ToplistGrid({ source, onOpen }: { source: string; onOpen: (t: Toplist) => void }) {
  const initial = toplistsCacheMap.get(source);
  const [tabs, setTabs] = useState<SourceToplists[] | null>(initial?.tabs ?? null);
  const [aggError, setAggError] = useState(initial?.error ?? "");
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let alive = true;
    apiToplists([source])
      .then((r) => {
        if (!alive) return;
        const ok = (r.tabs ?? []).filter((t) => t.toplists?.length);
        toplistsCacheMap.set(source, { tabs: ok, error: r.error ?? "" });
        setTabs(ok);
        setAggError(r.error ?? "");
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "加载榜单失败");
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey, source]);

  /* QQ 榜单按 group 分组展示（热门/特色/全球…）；网易全部平铺。
     Hooks 规则：useMemo 必须先于所有条件早退调用（原实现置于早退后导致 hook 数量随渲染变化崩溃） */
  const grouped = useMemo(() => {
    const map = new Map<string, Toplist[]>();
    for (const t of tabs?.find((x) => x.source === source)?.toplists ?? []) {
      const g = (t.group ?? "").trim() || "榜单";
      const arr = map.get(g) ?? [];
      arr.push(t);
      map.set(g, arr);
    }
    return [...map.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, source]);

  if (error) {
    return (
      <TabError
        text={error}
        onRetry={() => {
          setError("");
          setTabs(toplistsCacheMap.get(source)?.tabs ?? null);
          setRetryKey((k) => k + 1);
        }}
      />
    );
  }
  if (!tabs) return <GridSkeleton />;

  const current = tabs.find((t) => t.source === source);
  const toplists = current?.toplists ?? [];
  if (!toplists.length) return <BigEmpty hint="该源暂时拿不到榜单，稍后再试试" />;

  return (
    <>
      {aggError && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/15 bg-amber-500/[0.06] px-4 py-3 text-[13px] leading-relaxed text-amber-200/80">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{aggError}</span>
        </div>
      )}
      {grouped.map(([group, items], gi) => (
        <motion.section
          key={group}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: gi * 0.06, duration: 0.35 }}
          className="mb-7"
        >
          <div className="mb-3 mt-2 flex items-baseline gap-2">
            <h2 className="text-[15px] font-bold text-zinc-100">{group}</h2>
            <span className="text-xs tabular-nums text-zinc-500">{items.length} 个榜单</span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {items.map((t, i) => (
              <ToplistCard key={`${t.source}-${t.id}`} toplist={t} index={i} onOpen={onOpen} />
            ))}
          </div>
        </motion.section>
      ))}
    </>
  );
}

function ToplistCard({ toplist, index, onOpen }: { toplist: Toplist; index: number; onOpen: (t: Toplist) => void }) {
  const meta = sourceMeta(toplist.source);
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.4), duration: 0.3, ease: [0.22, 0.61, 0.36, 1] }}
    >
      <button
        onClick={() => onOpen(toplist)}
        aria-label={`查看榜单 ${toplist.name}`}
        className="card-glow glass group flex w-full items-stretch gap-3 rounded-2xl border border-white/[0.07] p-3 text-left transition-all duration-300 hover:-translate-y-0.5 hover:border-violet-400/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 active:scale-[0.99]"
      >
        {/* 封面 */}
        <span className="relative block h-[84px] w-[84px] shrink-0 overflow-hidden rounded-xl bg-zinc-800/80 ring-1 ring-white/[0.06]">
          {toplist.cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverProxyUrl(toplist.cover, toplist.source)}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
            />
          ) : (
            <span className="flex h-full items-center justify-center">
              <Trophy className="h-7 w-7 text-zinc-600" aria-hidden="true" />
            </span>
          )}
        </span>
        {/* 信息 */}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[14px] font-bold text-zinc-100 group-hover:text-white">{toplist.name}</span>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} aria-label={meta.label} />
          </span>
          {toplist.update_time && (
            <span className="mt-0.5 flex items-center gap-1 text-[11px] text-zinc-500">
              <Clock3 className="h-3 w-3" aria-hidden="true" />
              {toplist.update_time}
            </span>
          )}
          {toplist.highlights?.length ? (
            <span className="mt-1.5 flex flex-col gap-[3px]">
              {toplist.highlights.slice(0, 3).map((h, i) => (
                <span key={i} className="flex items-center gap-1.5 text-[12px] leading-snug">
                  <RankBadge rank={i + 1} />
                  <span className="truncate text-zinc-400 group-hover:text-zinc-300">{h}</span>
                </span>
              ))}
            </span>
          ) : (
            <span className="mt-1.5 text-[12px] text-zinc-600">
              {toplist.description ? toplist.description.slice(0, 40) : "点击查看完整榜单"}
            </span>
          )}
        </span>
      </button>
    </motion.div>
  );
}

/* ================= 榜单详情（页内） ================= */

function ToplistDetailView({ source, id, onBack }: { source: string; id: string; onBack: () => void }) {
  const params = useSearchParams();
  const cacheKey = `${source}:${id}`;
  const [detail, setDetail] = useState(() => toplistSongsCache.get(cacheKey) ?? null);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  /* URL 带来的元信息（卡片跳转场景），取详情后以响应为准 */
  const meta = useMemo(
    () => ({
      name: params.get("name") ?? "",
      cover: params.get("cover") ?? "",
      update_time: params.get("update_time") ?? "",
      description: params.get("description") ?? "",
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source, id],
  );

  useEffect(() => {
    let alive = true;
    apiToplistSongs(source, id, meta)
      .then((r) => {
        if (!alive) return;
        if (r.error) throw new Error(r.error);
        const value = { toplist: r.toplist, songs: r.songs };
        toplistSongsCache.set(cacheKey, value);
        setDetail(value);
        setError("");
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "获取榜单失败");
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey, cacheKey]);

  const t = detail?.toplist;
  const name = t?.name || meta.name || "榜单";

  return (
    <div>
      {/* 返回 + 榜单头 */}
      <div className="mb-5 flex items-start gap-3">
        <button
          onClick={onBack}
          aria-label="返回榜单列表"
          className="glass mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.1] text-zinc-300 transition-colors hover:bg-white/[0.08] hover:text-white active:scale-95"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="flex min-w-0 flex-1 gap-4">
          <span className="relative hidden h-[96px] w-[96px] shrink-0 overflow-hidden rounded-2xl bg-zinc-800/80 ring-1 ring-white/[0.06] sm:block">
            {(t?.cover || meta.cover) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={coverProxyUrl(t?.cover || meta.cover, source)}
                alt=""
                className="h-full w-full object-cover"
              />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-extrabold tracking-tight text-zinc-50">{name}</h1>
              <span className="glass flex items-center gap-1 rounded-full border border-white/[0.07] px-2.5 py-1 text-[11px] text-zinc-400">
                <Trophy className="h-3 w-3 text-amber-300/80" aria-hidden="true" />
                {sourceMeta(source).label}
              </span>
            </div>
            {(t?.update_time || meta.update_time) && (
              <p className="mt-1 flex items-center gap-1 text-xs text-zinc-500">
                <Clock3 className="h-3 w-3" aria-hidden="true" />
                {t?.update_time || meta.update_time}
                {t?.track_count ? <span className="ml-1 tabular-nums">· 共 {t.track_count} 首</span> : null}
              </p>
            )}
            {(t?.description || meta.description) && (
              <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-zinc-500">
                {t?.description || meta.description}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* 曲目（带排名序号） */}
      {error ? (
        <TabError
          text={error}
          onRetry={() => {
            setError("");
            setRetryKey((k) => k + 1);
          }}
        />
      ) : (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
          <SongList
            songs={detail?.songs ?? []}
            loading={!detail}
            emptyHint="该榜单暂时没有曲目"
            showIndex
          />
        </motion.div>
      )}
    </div>
  );
}

/* ================= 通用小件 ================= */

function TabError({ text, onRetry }: { text: string; onRetry: () => void }) {
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

function BigEmpty({ hint }: { hint: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.04]">
        <Crown className="h-7 w-7 text-zinc-500" aria-hidden="true" />
      </span>
      <p className="text-sm text-zinc-500">{hint}</p>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-busy="true" role="status">
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} className="glass flex gap-3 rounded-2xl border border-white/[0.07] p-3">
          <div className="shimmer h-[84px] w-[84px] shrink-0 rounded-xl" />
          <div className="flex flex-1 flex-col gap-2 py-1">
            <div className="shimmer h-4 w-2/3 rounded" />
            <div className="shimmer h-3 w-1/3 rounded" />
            <div className="shimmer h-3 w-full rounded" />
            <div className="shimmer h-3 w-5/6 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ChartsFallback() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 lg:px-8 lg:py-10" aria-busy="true">
      <div className="mb-5 h-11 w-48 animate-pulse rounded-2xl bg-white/[0.05]" />
      <div className="mb-4 h-12 w-64 animate-pulse rounded-xl bg-white/[0.04]" />
      <GridSkeleton />
    </div>
  );
}
