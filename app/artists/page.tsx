"use client";

/**
 * 歌手库 /artists：双源歌手库（地区/性别筛选 + A-Z 字母索引 + 追加分页）
 * + 歌手榜 tab（网易专属：华语/欧美/日语/韩语四榜 Top 100）
 * 歌手卡点击 → /artist/[id]?source= 主页
 */
import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { Users, RefreshCw, AlertTriangle, ChevronDown, Trophy, UserRound, Crown } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { apiArtistLibrary, apiArtistToplist } from "@/lib/client/api";
import { coverProxyUrl, sourceMeta } from "@/lib/play-url";
import type { Artist } from "@/lib/types";

const AREAS = ["全部", "华语", "港台", "欧美", "日本", "韩国"] as const;
const SEXES = ["全部", "男", "女", "组合"] as const;
const INITIALS = ["热门", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "#"] as const;
const TOPLIST_TYPES = [
  { type: 1, label: "华语" },
  { type: 2, label: "欧美" },
  { type: 3, label: "日语" },
  { type: 4, label: "韩语" },
] as const;

type TabKey = "library" | "toplist";

/* 模块级分页缓存：key = source:area:sex:initial */
const libraryCache = new Map<string, { artists: Artist[]; hasMore: boolean }>();
let toplistCache: Artist[] | null = null;

export default function ArtistsPage() {
  return (
    <Suspense fallback={<ArtistsFallback />}>
      <ArtistsInner />
    </Suspense>
  );
}

function ArtistsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const source = params.get("source") === "qq" ? "qq" : "netease";
  const tab: TabKey = source === "netease" && params.get("tab") === "toplist" ? "toplist" : "library";
  const rawArea = params.get("area") ?? "";
  const area = (AREAS as readonly string[]).includes(rawArea) ? rawArea : "全部";
  const rawSex = params.get("sex") ?? "";
  const sex = (SEXES as readonly string[]).includes(rawSex) ? rawSex : "全部";
  const rawInitial = (params.get("initial") ?? "热门").toUpperCase();
  const initial = (INITIALS as readonly string[]).includes(rawInitial) ? rawInitial : "热门";

  const replaceQuery = (
    next: Partial<{ source: string; tab: string; area: string; sex: string; initial: string }>,
  ) => {
    const p = new URLSearchParams();
    p.set("source", next.source ?? source);
    const t = next.tab ?? tab;
    if (t === "toplist") p.set("tab", "toplist");
    const a = next.area ?? area;
    if (a !== "全部") p.set("area", a);
    const s = next.sex ?? sex;
    if (s !== "全部") p.set("sex", s);
    const i = next.initial ?? initial;
    if (i !== "热门") p.set("initial", i);
    router.replace(`/artists?${p.toString()}`, { scroll: false });
  };

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 lg:px-8 lg:py-10">
      <PageHeader
        icon={Users}
        title="歌手库"
        subtitle="网易云与 QQ 音乐入驻歌手全库检索：地区 / 性别 / 首字母三维筛选，直达歌手主页"
        className="mb-5"
      />

      <div className="sticky top-[61px] z-20 -mx-4 bg-gradient-to-b from-surface-sticky via-surface-sticky/92 to-transparent px-4 pb-2 pt-2 backdrop-blur-sm lg:top-0 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <div className="glass inline-flex rounded-xl border border-white/[0.07] p-1" role="tablist" aria-label="歌手库来源">
            {(["netease", "qq"] as const).map((s) => {
              const meta = sourceMeta(s);
              const active = s === source && tab === "library";
              return (
                <button
                  key={s}
                  role="tab"
                  aria-selected={active}
                  onClick={() => replaceQuery({ source: s, tab: "library" })}
                  className={`relative flex min-h-[40px] items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-medium transition-colors ${
                    active ? "text-white" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="artists-source-pill"
                      className="absolute inset-0 rounded-lg bg-gradient-to-r from-violet-500/25 to-fuchsia-500/20 ring-1 ring-violet-400/30"
                      transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    />
                  )}
                  <span className={`relative h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
                  <span className="relative">{meta.label}歌手库</span>
                </button>
              );
            })}
            {source === "netease" && (
              <button
                role="tab"
                aria-selected={tab === "toplist"}
                onClick={() => replaceQuery({ tab: "toplist" })}
                className={`relative flex min-h-[40px] items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-medium transition-colors ${
                  tab === "toplist" ? "text-white" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {tab === "toplist" && (
                  <motion.span
                    layoutId="artists-source-pill"
                    className="absolute inset-0 rounded-lg bg-gradient-to-r from-amber-500/25 to-orange-500/20 ring-1 ring-amber-400/30"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                )}
                <Trophy className="relative h-3.5 w-3.5" aria-hidden="true" />
                <span className="relative">歌手榜</span>
              </button>
            )}
          </div>
        </div>

        {tab === "library" && (
          <div className="mt-2 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {AREAS.map((a) => (
                <button
                  key={a}
                  onClick={() => replaceQuery({ area: a })}
                  aria-pressed={a === area}
                  className={`flex min-h-[32px] items-center rounded-full border px-2.5 text-[11px] font-medium transition-all active:scale-95 ${
                    a === area
                      ? "border-violet-400/40 bg-violet-500/20 text-violet-100 ring-1 ring-violet-400/25"
                      : "border-white/[0.08] bg-white/[0.02] text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {a}
                </button>
              ))}
              <span className="mx-1 h-4 w-px bg-white/[0.08]" aria-hidden="true" />
              {SEXES.map((s) => (
                <button
                  key={s}
                  onClick={() => replaceQuery({ sex: s })}
                  aria-pressed={s === sex}
                  className={`flex min-h-[32px] items-center rounded-full border px-2.5 text-[11px] font-medium transition-all active:scale-95 ${
                    s === sex
                      ? "border-fuchsia-400/40 bg-fuchsia-500/15 text-fuchsia-100"
                      : "border-white/[0.08] bg-white/[0.02] text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5 no-scrollbar" role="tablist" aria-label="首字母索引">
              {INITIALS.map((ch) => (
                <button
                  key={ch}
                  onClick={() => replaceQuery({ initial: ch })}
                  aria-selected={ch === initial}
                  role="tab"
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11.5px] font-bold transition-all active:scale-90 ${
                    ch === initial
                      ? "bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-md shadow-fuchsia-500/25"
                      : "bg-white/[0.03] text-zinc-500 hover:bg-white/[0.08] hover:text-zinc-200"
                  }`}
                >
                  {ch === "热门" ? "★" : ch}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-4">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${tab}:${source}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22 }}
          >
            {tab === "toplist" ? (
              <ToplistView />
            ) : (
              <LibraryView source={source} area={area} sex={sex} initial={initial} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ================= 歌手库（筛选+追加分页） ================= */

function LibraryView({ source, area, sex, initial }: { source: string; area: string; sex: string; initial: string }) {
  const cacheKey = `${source}:${area}:${sex}:${initial}`;
  const initialData = libraryCache.get(cacheKey);
  const [artists, setArtists] = useState<Artist[]>(initialData?.artists ?? []);
  const [hasMore, setHasMore] = useState(initialData?.hasMore ?? true);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!initialData);
  const [loadingMore, setLoadingMore] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const hadCache = useRef(!!initialData);

  useEffect(() => {
    if (hadCache.current) {
      hadCache.current = false;
      return;
    }
    let alive = true;
    setArtists([]);
    setLoading(true);
    setError("");
    apiArtistLibrary(source, { area, sex, initial, page: 1 })
      .then((r) => {
        if (!alive) return;
        if (r.error) throw new Error(r.error);
        libraryCache.set(cacheKey, { artists: r.artists ?? [], hasMore: !!r.has_more });
        setArtists(r.artists ?? []);
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
    apiArtistLibrary(source, { area, sex, initial, page: next })
      .then((r) => {
        if (r.error) throw new Error(r.error);
        setArtists((prev) => {
          const merged = [...prev, ...(r.artists ?? [])];
          libraryCache.set(cacheKey, { artists: merged, hasMore: !!r.has_more });
          return merged;
        });
        setHasMore(!!r.has_more);
        setPage(next);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载更多失败"))
      .finally(() => setLoadingMore(false));
  };

  if (error && !artists.length) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10">
          <AlertTriangle className="h-7 w-7 text-amber-300/80" aria-hidden="true" />
        </span>
        <p className="max-w-sm text-sm leading-relaxed text-zinc-400">{error}</p>
        <button
          onClick={() => {
            setError("");
            libraryCache.delete(cacheKey);
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
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8">
        {loading
          ? Array.from({ length: 16 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center gap-2">
                <div className="shimmer h-20 w-20 rounded-full" />
                <div className="shimmer h-3 w-14 rounded" />
              </div>
            ))
          : artists.map((a, i) => (
              <motion.div
                key={`${a.source}-${a.id}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.02, 0.4), duration: 0.25 }}
              >
                <Link
                  href={`/artist/${encodeURIComponent(a.id)}?source=${a.source}`}
                  aria-label={`查看歌手 ${a.name}`}
                  className="group flex flex-col items-center gap-2 rounded-2xl p-1.5 transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
                >
                  <span className="relative block h-20 w-20 overflow-hidden rounded-full ring-1 ring-white/[0.08] transition-all group-hover:ring-violet-400/40">
                    {a.avatar ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={coverProxyUrl(a.avatar, a.source)}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <span className="flex h-full items-center justify-center bg-gradient-to-br from-violet-500/20 to-fuchsia-500/15">
                        <UserRound className="h-8 w-8 text-zinc-500" aria-hidden="true" />
                      </span>
                    )}
                  </span>
                  <span className="tip max-w-full">
                    <span className="block truncate text-center text-[12.5px] font-medium text-zinc-300 group-hover:text-white">
                      {a.name}
                    </span>
                    <span className="tip-bubble">
                      <span className="tip-name">{a.name}</span>
                      <span className="tip-sub">{a.alias || `${sourceMeta(a.source).label}歌手`}</span>
                    </span>
                  </span>
                </Link>
              </motion.div>
            ))}
      </div>

      {!loading && !artists.length && !error && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.04]">
            <Users className="h-7 w-7 text-zinc-500" aria-hidden="true" />
          </span>
          <p className="text-sm text-zinc-500">该筛选下暂无歌手，换个条件试试</p>
        </div>
      )}

      {!loading && hasMore && !!artists.length && (
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

/* ================= 歌手榜（网易专属） ================= */

function ToplistView() {
  const [type, setType] = useState(1);
  const [artists, setArtists] = useState<Artist[]>(toplistCache ?? []);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!toplistCache);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    apiArtistToplist(type)
      .then((r) => {
        if (!alive) return;
        if (r.error) throw new Error(r.error);
        const list = r.artists ?? [];
        toplistCache = list;
        setArtists(list);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "加载歌手榜失败");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [type]);

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="歌手榜语种">
        {TOPLIST_TYPES.map((t) => (
          <button
            key={t.type}
            role="tab"
            aria-selected={t.type === type}
            onClick={() => setType(t.type)}
            className={`flex min-h-[34px] items-center gap-1 rounded-full border px-3 text-[12px] font-medium transition-all active:scale-95 ${
              t.type === type
                ? "border-amber-400/40 bg-amber-500/15 text-amber-100"
                : "border-white/[0.08] bg-white/[0.02] text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="shimmer h-5 w-6 rounded" />
              <div className="shimmer h-12 w-12 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <div className="shimmer h-3.5 w-32 rounded" />
                <div className="shimmer h-3 w-20 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10">
            <AlertTriangle className="h-7 w-7 text-red-300/80" aria-hidden="true" />
          </span>
          <p className="max-w-sm text-sm leading-relaxed text-zinc-400">{error}</p>
          <button
            onClick={() => setType((t) => (t === 1 ? 2 : 1))}
            className="mt-1 flex h-11 items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] px-5 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.08] active:scale-95"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> 重试
          </button>
        </div>
      ) : (
        <ol className="space-y-1">
          {artists.slice(0, 100).map((a, i) => (
            <motion.li
              key={`${a.source}-${a.id}`}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(i * 0.015, 0.4), duration: 0.22 }}
            >
              <Link
                href={`/artist/${encodeURIComponent(a.id)}?source=${a.source}`}
                aria-label={`第 ${i + 1} 名 ${a.name}`}
                className="group flex items-center gap-3 rounded-2xl px-3 py-2 transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
              >
                <span
                  className={`flex h-6 w-7 shrink-0 items-center justify-center rounded-md text-[12px] font-bold tabular-nums ${
                    i < 3 ? "bg-gradient-to-br from-amber-400/30 to-orange-500/25 text-amber-200" : "text-zinc-600"
                  }`}
                  aria-hidden="true"
                >
                  {i < 3 ? <Crown className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full ring-1 ring-white/[0.08] transition-all group-hover:ring-violet-400/40">
                  {a.avatar ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={coverProxyUrl(a.avatar, a.source)} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full items-center justify-center bg-gradient-to-br from-violet-500/20 to-fuchsia-500/15">
                      <UserRound className="h-5 w-5 text-zinc-500" aria-hidden="true" />
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="tip block">
                    <span className="block truncate text-[13.5px] font-semibold text-zinc-200 group-hover:text-white">
                      {a.name}
                    </span>
                    <span className="tip-bubble">
                      <span className="tip-name">{a.name}</span>
                      <span className="tip-sub">{a.alias || "查看主页"}</span>
                    </span>
                  </span>
                  {a.alias && <span className="mt-0.5 block truncate text-[11.5px] text-zinc-500">{a.alias}</span>}
                </span>
              </Link>
            </motion.li>
          ))}
        </ol>
      )}
    </>
  );
}

function ArtistsFallback() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 lg:px-8 lg:py-10" aria-busy="true">
      <div className="mb-5 h-11 w-40 animate-pulse rounded-2xl bg-white/[0.05]" />
      <div className="mb-4 h-12 w-96 animate-pulse rounded-xl bg-white/[0.04]" />
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8">
        {Array.from({ length: 16 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <div className="shimmer h-20 w-20 rounded-full" />
            <div className="shimmer h-3 w-14 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
