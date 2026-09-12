"use client";

/**
 * 搜索增强组件（供首页搜索页复用）：
 * - HotSearchSection：双源热搜榜（网易/QQ pill + Top20 列表，点击即搜）
 * - ArtistResults：歌手搜索结果横排（点击进 /artist/[id]，打通歌手主页入口）
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { Flame, Sparkles, TrendingUp, UserRound, Users2 } from "lucide-react";
import { apiHotSearches, apiSearchArtists, type SourceHotSearches } from "@/lib/client/api";
import { coverProxyUrl, sourceMeta } from "@/lib/play-url";
import type { Artist, HotSearch } from "@/lib/types";

/* ---------- 模块级缓存 ---------- */
let hotCache: { tabs: SourceHotSearches[] } | null = null;
const artistResultsCache = new Map<string, Artist[]>();

/** 热度值格式化（QQ score 为播放量级 / 网易为热度分） */
function formatHotScore(n?: number): string {
  if (!n || n <= 0) return "";
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}亿`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`;
  return String(n);
}

export function HotSearchSection({ onSearch }: { onSearch: (keyword: string) => void }) {
  const [tabs, setTabs] = useState<SourceHotSearches[] | null>(hotCache?.tabs ?? null);
  const [error, setError] = useState("");
  const [source, setSource] = useState("netease");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (hotCache) {
      setTabs(hotCache.tabs);
      return;
    }
    let alive = true;
    apiHotSearches()
      .then((r) => {
        if (!alive) return;
        const ok = (r.tabs ?? []).filter((t) => t.hot_searches?.length);
        hotCache = { tabs: ok };
        setTabs(ok);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "加载热搜失败");
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey]);

  if (error) {
    return (
      <div className="mt-8 flex items-center justify-between gap-3 text-[13px] text-zinc-500">
        <span>热搜加载失败</span>
        <button
          onClick={() => {
            setError("");
            setRetryKey((k) => k + 1);
          }}
          className="text-violet-300 transition-colors hover:text-violet-200"
        >
          重试
        </button>
      </div>
    );
  }
  if (!tabs) {
    return (
      <div className="mt-8" aria-busy="true">
        <div className="shimmer mb-3 h-5 w-24 rounded" />
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="shimmer h-8 w-full max-w-md rounded-lg" />
          ))}
        </div>
      </div>
    );
  }
  if (!tabs.length) return null;

  const current = tabs.find((t) => t.source === source) ?? tabs[0];
  const list: HotSearch[] = current?.hot_searches ?? [];

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="mt-8"
      aria-label="热门搜索"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-zinc-400">
          <TrendingUp className="h-3.5 w-3.5 text-orange-400/90" aria-hidden="true" /> 热搜榜
        </h2>
        <div className="glass inline-flex rounded-lg border border-white/[0.07] p-0.5" role="tablist" aria-label="热搜来源">
          {tabs.map((t) => {
            const meta = sourceMeta(t.source);
            const active = t.source === (current?.source ?? source);
            return (
              <button
                key={t.source}
                role="tab"
                aria-selected={active}
                onClick={() => setSource(t.source)}
                className={`flex min-h-[30px] items-center gap-1 rounded-md px-2.5 text-[11.5px] font-medium transition-colors ${
                  active ? "bg-white/[0.08] text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
                {meta.label}
              </button>
            );
          })}
        </div>
      </div>
      {current?.default_keyword ? (
        <button
          onClick={() => onSearch(current.default_keyword!)}
          className="mb-3 flex w-full items-center gap-2 rounded-xl border border-violet-400/20 bg-violet-500/[0.08] px-3 py-2 text-left transition-colors hover:border-violet-400/40"
          aria-label={`大家都在搜：${current.default_keyword}`}
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-300/90" aria-hidden="true" />
          <span className="shrink-0 text-[11.5px] text-zinc-500">大家都在搜</span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-zinc-200">{current.default_keyword}</span>
        </button>
      ) : null}
      <ol className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        {list.map((h, i) => {
          const score = formatHotScore(h.score);
          return (
            <li key={`${h.source}-${h.keyword}-${i}`}>
              <button
                onClick={() => onSearch(h.keyword)}
                className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/[0.04]"
                aria-label={`搜索 ${h.keyword}`}
              >
                <span
                  className={`w-4 shrink-0 text-right text-[12px] font-bold tabular-nums ${
                    i < 3 ? "text-gradient" : "text-zinc-600"
                  }`}
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                {h.cover ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={coverProxyUrl(h.cover, h.source)}
                    alt=""
                    loading="lazy"
                    className="h-6 w-6 shrink-0 rounded object-cover"
                  />
                ) : (
                  <Flame
                    className={`h-3.5 w-3.5 shrink-0 ${i < 3 ? "text-orange-400/80" : "text-zinc-700"}`}
                    aria-hidden="true"
                  />
                )}
                <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-300 group-hover:text-white">
                  {h.keyword}
                </span>
                {score && <span className="shrink-0 text-[11px] tabular-nums text-zinc-600">{score}</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </motion.section>
  );
}

export function ArtistResults({ q }: { q: string }) {
  const key = q.trim();
  const [artists, setArtists] = useState<Artist[]>(() => artistResultsCache.get(key) ?? []);

  useEffect(() => {
    const k = key;
    if (!k) {
      setArtists([]);
      return;
    }
    const cached = artistResultsCache.get(k);
    if (cached) {
      setArtists(cached);
      return;
    }
    let alive = true;
    apiSearchArtists(k)
      .then((r) => {
        if (!alive) return;
        artistResultsCache.set(k, r.artists ?? []);
        setArtists(r.artists ?? []);
      })
      .catch(() => {
        /* 歌手区失败静默隐藏 */
        if (alive) setArtists([]);
      });
    return () => {
      alive = false;
    };
  }, [key]);

  if (!artists.length) return null;

  return (
    <section className="mb-6" aria-label="歌手结果">
      <div className="mb-3 mt-2 flex items-baseline gap-2">
        <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-zinc-100">
          <Users2 className="h-4 w-4 text-violet-300/80" aria-hidden="true" /> 歌手
        </h2>
        <span className="text-xs tabular-nums text-zinc-500">{artists.length} 位</span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1 no-scrollbar">
        {artists.map((a) => (
          <Link
            key={`${a.source}-${a.id}`}
            href={`/artist/${encodeURIComponent(a.id)}?source=${a.source}`}
            className="group flex w-[92px] shrink-0 flex-col items-center gap-2 rounded-2xl p-1.5 transition-colors hover:bg-white/[0.04]"
            aria-label={`查看歌手 ${a.name}`}
          >
            <span className="relative block h-[72px] w-[72px] overflow-hidden rounded-full ring-1 ring-white/[0.08] transition-all group-hover:ring-violet-400/40">
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
                  <UserRound className="h-7 w-7 text-zinc-500" aria-hidden="true" />
                </span>
              )}
            </span>
            <span className="flex w-full flex-col items-center gap-0.5">
              <span className="w-full truncate text-center text-[12px] font-medium text-zinc-300 group-hover:text-white">
                {a.name}
              </span>
              <span className={`h-1 w-1 rounded-full ${sourceMeta(a.source).dot}`} aria-label={sourceMeta(a.source).label} />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
