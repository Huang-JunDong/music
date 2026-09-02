"use client";

/**
 * 歌单广场：每日推荐 / 分类浏览 / 我的收藏（需登录 cookie 的源歌单）
 * tab 与 URL query（?tab=）同步；模块级缓存 + SWR：切回 tab 秒显并后台刷新
 */
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { Sparkles, LayoutGrid, Heart, Flame, Compass, Settings, AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PlaylistGrid } from "@/components/playlist-grid";
import { PageHeader } from "@/components/page-header";
import {
  apiRecommend,
  apiPlaylistCategories,
  apiCategoryPlaylists,
  apiUserPlaylists,
  type SourcePlaylists,
  type SourceCategoryView,
} from "@/lib/client/api";
import { sourceMeta } from "@/lib/play-url";
import { getSelectedSources } from "@/lib/client/ui";
import type { Playlist } from "@/lib/types";

/** 分类视图拍平：groups → categories（带 group 名），供 chips 分组渲染 */
interface FlatCategory {
  id: string;
  name: string;
  hot: boolean;
  source: string;
  group: string;
}

interface FlatCategories {
  source: string;
  name: string;
  categories: FlatCategory[];
}

function flattenCategories(views: SourceCategoryView[]): FlatCategories[] {
  return views.map((v) => ({
    source: v.source,
    name: v.name,
    categories: v.groups.flatMap((g) =>
      g.categories.map((c) => ({ id: c.id, name: c.name, hot: c.hot, source: c.source, group: g.name })),
    ),
  }));
}

type TabKey = "recommend" | "category" | "mine";

const TABS: { key: TabKey; label: string; icon: typeof Sparkles }[] = [
  { key: "recommend", label: "每日推荐", icon: Sparkles },
  { key: "category", label: "分类浏览", icon: LayoutGrid },
  { key: "mine", label: "我的收藏", icon: Heart },
];

/* ---------- 模块级缓存（同会话内切换 / 返回不重复请求；按源集合区分） ---------- */
const recommendCacheMap = new Map<string, { tabs: SourcePlaylists[]; error: string }>();
const mineCacheMap = new Map<string, { tabs: SourcePlaylists[]; error: string }>();
let categoriesCache: FlatCategories[] | null = null;
let categoriesErrorCache = "";
const categoryPlaylistsCache = new Map<string, Playlist[]>();

/** 按首页已勾选源过滤（对齐 Go goToRecommend ∩ 已选源） */
function selectedSourceFilter(): string[] {
  return getSelectedSources();
}

function cacheKeyOf(sources: string[]): string {
  return [...sources].sort().join(",");
}

export default function ExplorePage() {
  return (
    <Suspense fallback={<ExploreFallback />}>
      <ExploreInner />
    </Suspense>
  );
}

function ExploreInner() {
  const params = useSearchParams();
  const router = useRouter();
  const raw = params.get("tab");
  const tab: TabKey = TABS.some((t) => t.key === raw) ? (raw as TabKey) : "recommend";

  const switchTab = (k: TabKey) => {
    if (k === tab) return;
    router.replace(k === "recommend" ? "/explore" : `/explore?tab=${k}`, { scroll: false });
  };

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 lg:px-8 lg:py-10">
      {/* ---------- 页头（统一 PageHeader） ---------- */}
      <PageHeader
        icon={Compass}
        title="歌单广场"
        subtitle="各源精选推荐、分类榜单，以及登录后同步的个人收藏歌单"
        className="mb-5"
      />

      {/* ---------- sticky tab（layoutId 滑动 pill） ---------- */}
      <div className="sticky top-[61px] z-20 -mx-4 bg-gradient-to-b from-[#0b0b12] via-[#0b0b12]/92 to-transparent px-4 pb-2 pt-2 backdrop-blur-sm lg:top-0 lg:-mx-8 lg:px-8">
        <div className="glass inline-flex rounded-xl border border-white/[0.07] p-1" role="tablist" aria-label="歌单广场">
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
                    layoutId="explore-tab-pill"
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

      {/* ---------- 内容 ---------- */}
      <div className="mt-4">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22 }}
          >
            {tab === "recommend" && <RecommendTab />}
            {tab === "category" && <CategoryTab />}
            {tab === "mine" && <MineTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ================= 每日推荐 ================= */

function RecommendTab() {
  const filter = selectedSourceFilter();
  const cacheKey = cacheKeyOf(filter);
  const initial = recommendCacheMap.get(cacheKey);
  const [groups, setGroups] = useState<SourcePlaylists[] | null>(initial?.tabs ?? null);
  const [aggError, setAggError] = useState(initial?.error ?? "");
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let alive = true;
    apiRecommend(filter)
      .then((r) => {
        if (!alive) return;
        recommendCacheMap.set(cacheKey, { tabs: r.tabs ?? [], error: r.error ?? "" });
        setGroups(r.tabs ?? []);
        setAggError(r.error ?? "");
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "加载推荐失败");
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey, cacheKey]);

  if (error) {
    return (
      <TabError
        text={error}
        onRetry={() => {
          setError("");
          setGroups(recommendCacheMap.get(cacheKey)?.tabs ?? null);
          setRetryKey((k) => k + 1);
        }}
      />
    );
  }
  if (!groups) return <SectionsSkeleton />;

  const ok = groups.filter((g) => g.playlists?.length);
  if (!ok.length) return <BigEmpty icon={Sparkles} hint="暂时拿不到推荐歌单，稍后再试试" />;

  return (
    <>
      {aggError && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/15 bg-amber-500/[0.06] px-4 py-3 text-[13px] leading-relaxed text-amber-200/80">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{aggError}</span>
        </div>
      )}
      {ok.map((g, i) => (
        <motion.section
          key={g.source}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.06, duration: 0.35 }}
          className="mb-8"
        >
          <SectionTitle count={g.playlists.length}>{sourceMeta(g.source).label} · 精选推荐</SectionTitle>
          <PlaylistGrid playlists={g.playlists} emptyHint="该源暂无推荐歌单" />
        </motion.section>
      ))}
    </>
  );
}

/* ================= 分类浏览 ================= */

function CategoryTab() {
  const [cats, setCats] = useState<FlatCategories[] | null>(categoriesCache);
  const [aggError, setAggError] = useState(categoriesErrorCache);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [source, setSource] = useState(() => categoriesCache?.find((c) => c.categories?.length)?.source ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [loadingP, setLoadingP] = useState(false);

  useEffect(() => {
    let alive = true;
    apiPlaylistCategories()
      .then((r) => {
        if (!alive) return;
        const flat = flattenCategories(r.sources ?? []);
        categoriesCache = flat;
        categoriesErrorCache = r.error ?? "";
        setCats(flat);
        setAggError(r.error ?? "");
        setSource((s) => s || flat.find((c) => c.categories?.length)?.source || "");
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "加载分类失败");
      });
    return () => {
      alive = false;
    };
  }, [retryKey]);

  const current = useMemo(() => cats?.find((c) => c.source === source), [cats, source]);

  /* 源 / 分类列表变化时：保留仍有效的选择，否则选默认（热门优先） */
  useEffect(() => {
    if (!current?.categories?.length) return;
    setCategoryId((prev) =>
      current.categories.some((c) => c.id === prev)
        ? prev
        : (current.categories.find((c) => c.hot) ?? current.categories[0])?.id ?? "",
    );
  }, [source, current]);

  /* 拉取某分类下歌单（带缓存） */
  useEffect(() => {
    if (!source || !categoryId) {
      setPlaylists([]);
      return;
    }
    const key = `${source}:${categoryId}`;
    const cached = categoryPlaylistsCache.get(key);
    if (cached) {
      setPlaylists(cached);
      return;
    }
    let alive = true;
    setLoadingP(true);
    setPlaylists(null);
    apiCategoryPlaylists(source, categoryId)
      .then((r) => {
        if (!alive) return;
        categoryPlaylistsCache.set(key, r.playlists ?? []);
        setPlaylists(r.playlists ?? []);
      })
      .catch((e) => {
        if (alive) {
          toast.error(e instanceof Error ? e.message : "获取分类歌单失败");
          setPlaylists([]);
        }
      })
      .finally(() => {
        if (alive) setLoadingP(false);
      });
    return () => {
      alive = false;
    };
  }, [source, categoryId]);

  if (error) {
    return (
      <TabError
        text={error}
        onRetry={() => {
          setError("");
          setCats(categoriesCache);
          setRetryKey((k) => k + 1);
        }}
      />
    );
  }

  const availableSources = (cats ?? []).filter((c) => c.categories?.length);
  const grouped = useMemo(() => {
    const map = new Map<string, FlatCategory[]>();
    for (const c of current?.categories ?? []) {
      const arr = map.get(c.group) ?? [];
      arr.push(c);
      map.set(c.group, arr);
    }
    return [...map.entries()];
  }, [current]);
  const activeCat = current?.categories?.find((c) => c.id === categoryId);

  return (
    <div>
      {aggError && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/15 bg-amber-500/[0.06] px-4 py-3 text-[13px] leading-relaxed text-amber-200/80">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{aggError}</span>
        </div>
      )}
      {/* 源选择 */}
      {cats === null ? (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-9 w-20 animate-pulse rounded-full bg-white/[0.04]" />
          ))}
        </div>
      ) : (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {availableSources.map((c) => {
            const meta = sourceMeta(c.source);
            const active = c.source === source;
            return (
              <button
                key={c.source}
                onClick={() => setSource(c.source)}
                aria-pressed={active}
                className={`flex min-h-[38px] items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-all active:scale-95 ${
                  active ? `${meta.badge} ring-1` : "border-white/[0.1] bg-white/[0.02] text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
                {meta.label}
                <span className="text-[10px] opacity-60">{c.categories.length}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* 分类 chips（按 group 分组） */}
      {grouped.length > 0 && (
        <div className="glass mb-5 max-h-[38vh] overflow-y-auto rounded-2xl border border-white/[0.07] p-4">
          {grouped.map(([group, items]) => (
            <div key={group} className="mb-3 last:mb-0">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{group || "其他"}</p>
              <div className="flex flex-wrap gap-1.5">
                {items.map((c) => {
                  const active = c.id === categoryId;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setCategoryId(c.id)}
                      aria-pressed={active}
                      className={`flex min-h-[38px] items-center gap-1 rounded-full border px-3 text-xs font-medium transition-all active:scale-95 ${
                        active
                          ? "border-violet-400/40 bg-violet-500/20 text-violet-100 ring-1 ring-violet-400/30"
                          : "border-white/[0.1] bg-white/[0.02] text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {c.hot && <Flame className="h-3 w-3 text-orange-400/90" aria-hidden="true" />}
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 选中分类的歌单 */}
      <SectionTitle count={playlists?.length}>
        {activeCat ? activeCat.name : "分类歌单"}
        {activeCat && <span className="ml-2 text-xs font-normal text-zinc-500">{sourceMeta(source).label}</span>}
      </SectionTitle>
      <PlaylistGrid playlists={playlists ?? []} loading={loadingP || playlists === null} emptyHint="该分类下暂时没有歌单，换个分类试试" />
    </div>
  );
}

/* ================= 我的收藏（登录源） ================= */

function MineTab() {
  const filter = selectedSourceFilter();
  const cacheKey = cacheKeyOf(filter);
  const initial = mineCacheMap.get(cacheKey);
  const [groups, setGroups] = useState<SourcePlaylists[] | null>(initial?.tabs ?? null);
  const [aggError, setAggError] = useState(initial?.error ?? "");
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let alive = true;
    apiUserPlaylists(filter)
      .then((r) => {
        if (!alive) return;
        mineCacheMap.set(cacheKey, { tabs: r.tabs ?? [], error: r.error ?? "" });
        setGroups(r.tabs ?? []);
        setAggError(r.error ?? "");
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "加载失败");
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey, cacheKey]);

  if (error) {
    return <LoginHint text={error} />;
  }
  if (!groups) return <SectionsSkeleton />;

  const ok = groups.filter((g) => g.playlists?.length);
  const errs = groups.filter((g) => g.error || (!g.playlists?.length && g.playlists === undefined));

  if (!ok.length) {
    return (
      <LoginHint
        text={errs.length ? "部分源获取收藏歌单失败" : "该账号还没有收藏歌单"}
        hint={errs.length ? undefined : "在源 App 里收藏几个歌单后，来这里同步播放"}
      />
    );
  }

  return (
    <>
      {aggError && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/15 bg-amber-500/[0.06] px-4 py-3 text-[13px] leading-relaxed text-amber-200/80">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{aggError}</span>
        </div>
      )}
      {errs.map((g) => (
        <div
          key={g.source}
          className="mb-3 flex items-start gap-2 rounded-xl border border-amber-500/15 bg-amber-500/[0.06] px-4 py-3 text-[13px] leading-relaxed text-amber-200/80"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {sourceMeta(g.source).label}：{g.error || "获取失败（未登录或该源不支持）"}
          </span>
        </div>
      ))}
      {ok.map((g, i) => (
        <motion.section
          key={g.source}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.06, duration: 0.35 }}
          className="mb-8"
        >
          <SectionTitle count={g.playlists.length}>{sourceMeta(g.source).label} · 我的收藏</SectionTitle>
          <PlaylistGrid playlists={g.playlists} emptyHint="该源没有收藏歌单" />
        </motion.section>
      ))}
    </>
  );
}

/* ================= 通用小件 ================= */

function SectionTitle({ count, children }: { count?: number; children: React.ReactNode }) {
  return (
    <div className="mb-3 mt-2 flex items-baseline gap-2">
      <h2 className="text-[15px] font-bold text-zinc-100">{children}</h2>
      {typeof count === "number" && <span className="text-xs tabular-nums text-zinc-500">{count} 个</span>}
    </div>
  );
}

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

/** 未登录 / 源不支持提示 */
function LoginHint({ text, hint }: { text: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10">
        <Settings className="h-7 w-7 text-amber-300/80" aria-hidden="true" />
      </span>
      <p className="max-w-sm text-sm leading-relaxed text-zinc-400">{text}</p>
      <p className="max-w-sm text-xs leading-relaxed text-zinc-500">{hint ?? "未登录或该源不支持，可在设置中扫码登录后再试"}</p>
      <div className="mt-1 flex flex-wrap justify-center gap-2.5">
        <Link
          href="/settings"
          className="flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/25 transition-all hover:brightness-110 active:scale-95"
        >
          <Settings className="h-4 w-4" aria-hidden="true" /> 去设置登录
        </Link>
        <Link
          href="/explore?tab=recommend"
          className="flex h-11 items-center rounded-xl border border-white/[0.12] bg-white/[0.03] px-5 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/[0.07] active:scale-95"
        >
          看每日推荐
        </Link>
      </div>
    </div>
  );
}

function BigEmpty({ icon: Icon, hint }: { icon: typeof Sparkles; hint: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.04]">
        <Icon className="h-7 w-7 text-zinc-500" aria-hidden="true" />
      </span>
      <p className="text-sm text-zinc-500">{hint}</p>
    </div>
  );
}

function SectionsSkeleton() {
  return (
    <div className="space-y-8">
      {[0, 1].map((k) => (
        <div key={k}>
          <div className="mb-3 mt-2 h-5 w-40 animate-pulse rounded bg-white/[0.05]" />
          <PlaylistGrid playlists={[]} loading />
        </div>
      ))}
    </div>
  );
}

function ExploreFallback() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 lg:px-8 lg:py-10" aria-busy="true">
      <div className="mb-5 h-11 w-48 animate-pulse rounded-2xl bg-white/[0.05]" />
      <div className="mb-4 h-12 w-72 animate-pulse rounded-xl bg-white/[0.04]" />
      <SectionsSkeleton />
    </div>
  );
}
