"use client";

/**
 * 首页 = 聚合搜索：关键词 / 分享链接（自动识别解析）
 * 类型 tab（单曲/歌单/专辑）+ 13 源多选 + exact_artist 精确过滤
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { Search, Link2, X, Loader2, Sparkles, Music4, ListMusic, Disc3, Filter, ListPlus, ExternalLink, RefreshCw, Clock, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Song, Playlist } from "@/lib/types";
import { apiSearch, apiImportCollection, apiSearchSuggest, type SearchResponse } from "@/lib/client/api";
import { HotSearchSection, ArtistResults } from "@/components/search-enhance";
import { SongList } from "@/components/song-list";
import { PlaylistGrid } from "@/components/playlist-grid";
import { SOURCE_META } from "@/lib/play-url";
import { coverProxyUrl, sourceMeta } from "@/lib/play-url";
import { setSelectedSources } from "@/lib/client/ui";
import Link from "next/link";

type SearchType = "song" | "playlist" | "album";

const TYPE_TABS: { key: SearchType; label: string; icon: typeof Music4 }[] = [
  { key: "song", label: "单曲", icon: Music4 },
  { key: "playlist", label: "歌单", icon: ListMusic },
  { key: "album", label: "专辑", icon: Disc3 },
];

/** 默认源（对齐 Go GetDefaultSourceNames） */
const DEFAULT_SOURCES = ["netease", "qq", "kugou", "kuwo", "migu", "qianqian", "soda", "apple"];
/** qq_wx 仅为扫码登录通道（服务端归并到 qq Cookie），无独立搜索 provider，不出现在源网格 */
const ALL_SOURCES = Object.keys(SOURCE_META).filter((s) => s !== "qq_wx");

/** 按类型的能力矩阵（对齐 Go GetPlaylistSourceNames / GetAlbumSourceNames；歌单含本地收藏集） */
const PLAYLIST_SUPPORT = ["netease", "qq", "kugou", "kuwo", "migu", "jamendo", "joox", "qianqian", "bilibili", "soda", "fivesing", "apple", "local"];
const ALBUM_SUPPORT = ["netease", "qq", "kugou", "kuwo", "migu", "jamendo", "joox", "qianqian", "soda", "apple"];

function sourceSupported(s: string, type: SearchType): boolean {
  if (type === "playlist") return PLAYLIST_SUPPORT.includes(s);
  if (type === "album") return ALBUM_SUPPORT.includes(s);
  return true; // song 全部可用
}

const PLACEHOLDER: Record<SearchType, string> = {
  song: "搜索歌曲 / 歌手，或粘贴歌曲、歌单、专辑分享链接…",
  playlist: "搜索歌单名称，或粘贴歌单分享链接…",
  album: "搜索专辑名 / 歌手，或粘贴专辑分享链接…",
};

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-[1200px] px-4 py-10 lg:px-8" role="status" aria-label="加载中">
          <div className="shimmer h-[70px] rounded-2xl" />
        </div>
      }
    >
      <SearchPageInner />
    </Suspense>
  );
}

function SearchPageInner() {
  const router = useRouter();
  const params = useSearchParams();

  const [input, setInput] = useState(params.get("q") ?? "");
  const [type, setType] = useState<SearchType>((params.get("type") as SearchType) || "song");
  const [sources, setSources] = useState<string[]>(
    params.get("sources")?.split(",").filter(Boolean) || DEFAULT_SOURCES,
  );
  // 源面板折叠记忆（sessionStorage，对齐 Go app.js 面板记忆行为）
  const [showSourcePanel, setShowSourcePanel] = useState(false);
  useEffect(() => {
    if (sessionStorage.getItem("musicdl:source-panel") === "1") setShowSourcePanel(true);
  }, []);
  const toggleSourcePanel = () => {
    setShowSourcePanel((v) => {
      sessionStorage.setItem("musicdl:source-panel", v ? "0" : "1");
      return !v;
    });
  };
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [searched, setSearched] = useState(Boolean(params.get("q")));
  /** 网络/异常类搜索错误（业务错误走 result.error）；与 result 互斥展示（审核整改 A-20） */
  const [searchError, setSearchError] = useState<string | null>(null);
  /** 搜索请求序号：连续搜索/切类型时最后写入胜出，过期响应丢弃（审核整改 A-20 竞态防护） */
  const searchSeqRef = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);

  /* ---------- 搜索联想（输入防抖 250ms；非链接态触发） ---------- */
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestIndex, setSuggestIndex] = useState(-1);
  const suggestSeqRef = useRef(0);
  useEffect(() => {
    const q = input.trim();
    if (!q || /^https?:\/\//i.test(q) || q.length < 1) {
      setSuggestions([]);
      setSuggestOpen(false);
      setSuggestIndex(-1);
      return;
    }
    const timer = setTimeout(() => {
      const seq = ++suggestSeqRef.current;
      apiSearchSuggest(q)
        .then((r) => {
          if (seq !== suggestSeqRef.current) return;
          const list = (r.suggestions ?? []).filter((k) => k !== q).slice(0, 8);
          setSuggestions(list);
          setSuggestOpen(list.length > 0);
          setSuggestIndex(-1);
        })
        .catch(() => {
          if (seq !== suggestSeqRef.current) return;
          setSuggestions([]);
          setSuggestOpen(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [input]);

  /** 联想键盘导航：↑↓ 移动、Enter 选中、Esc 关闭（技能可访问性要求） */
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!suggestOpen || !suggestions.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSuggestIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSuggestIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Escape") {
      setSuggestOpen(false);
      setSuggestIndex(-1);
    } else if (e.key === "Enter" && suggestIndex >= 0 && suggestions[suggestIndex]) {
      e.preventDefault();
      const kw = suggestions[suggestIndex];
      setInput(kw);
      setSuggestOpen(false);
      void doSearch(kw, type, sources);
    }
  };

  const pickSuggestion = (kw: string) => {
    setInput(kw);
    setSuggestOpen(false);
    setSuggestIndex(-1);
    inputRef.current?.blur();
    void doSearch(kw, type, sources);
  };

  /** 本次结果对应的关键词（歌手结果区跟随） */
  const [resultQ, setResultQ] = useState("");

  const isLink = useMemo(() => /^https?:\/\//i.test(input.trim()), [input]);

  /* 搜索历史（localStorage，最多 10 条，新搜索去重置顶） */
  const [history, setHistory] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("musicdl:search-history");
      if (raw) setHistory(JSON.parse(raw));
    } catch {
      /* 忽略损坏数据 */
    }
  }, []);
  const pushHistory = useCallback((q: string) => {
    setHistory((prev) => {
      const next = [q, ...prev.filter((x) => x !== q)].slice(0, 10);
      try {
        localStorage.setItem("musicdl:search-history", JSON.stringify(next));
      } catch {
        /* 存储不可用时静默 */
      }
      return next;
    });
  }, []);
  const clearHistory = () => {
    setHistory([]);
    try {
      localStorage.removeItem("musicdl:search-history");
    } catch {
      /* ignore */
    }
  };

  /* 已勾选源持久化（sessionStorage）：供歌单广场推荐/我的收藏按交集过滤，对齐 Go goToRecommend） */
  useEffect(() => {
    if (sources.length) setSelectedSources(sources);
  }, [sources]);

  const doSearch = useCallback(
    async (q: string, t: SearchType, srcs: string[]) => {
      const query = q.trim();
      if (!query) return;
      const seq = ++searchSeqRef.current;
      setLoading(true);
      setSearched(true);
      setSearchError(null);
      try {
        const resp = await apiSearch({ q: query, type: t, sources: srcs });
        if (seq !== searchSeqRef.current) return; // 过期响应：已有更新的一次搜索在途/完成
        setResult(resp);
        setResultQ(query);
        pushHistory(query);
        const p = new URLSearchParams({ q: query, type: t, sources: srcs.join(",") });
        window.history.replaceState(null, "", `/?${p.toString()}`);
        // 小屏：搜索完成后滚动到结果区（对齐 Go 行为）
        if (window.innerWidth < 1024) {
          requestAnimationFrame(() => {
            resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        }
      } catch (e) {
        if (seq !== searchSeqRef.current) return;
        // 审核整改 A-20：错误态持久展示（错误卡 + 重试），toast 仅作即时提醒
        setSearchError(e instanceof Error ? e.message : "搜索失败");
        setResult(null);
        toast.error(e instanceof Error ? e.message : "搜索失败");
      } finally {
        if (seq === searchSeqRef.current) setLoading(false);
      }
    },
    [pushHistory],
  );

  /* URL 参数变化触发搜索（前进/后退/分享链接打开） */
  useEffect(() => {
    const q = params.get("q");
    const t = (params.get("type") as SearchType) || "song";
    const srcs = params.get("sources")?.split(",").filter(Boolean);
    if (q) {
      setInput(q);
      setType(t);
      if (srcs?.length) setSources(srcs);
      void doSearch(q, t, srcs?.length ? srcs : sources);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  /* 提交 */
  const onSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    setSuggestOpen(false);
    setSuggestIndex(-1);
    void doSearch(input, type, sources);
  };

  const toggleSource = (s: string) => {
    if (!sourceSupported(s, type)) return;
    setSources((prev) => {
      const next = prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s];
      return next.length ? next : prev;
    });
  };

  /** 切类型：对齐 Go —— 禁用源自动取消勾选，空则回退该类型默认源（先计算再统一使用，避免闭包旧值） */
  const changeType = (t: SearchType) => {
    if (isLink) return;
    const kept = sources.filter((s) => sourceSupported(s, t));
    const next = kept.length ? kept : DEFAULT_SOURCES.filter((s) => sourceSupported(s, t));
    setType(t);
    setSources(next);
    if (searched) void doSearch(input, t, next);
  };

  const selectAllSources = () => {
    setSources(ALL_SOURCES.filter((s) => sourceSupported(s, type)));
  };

  const clearSources = () => {
    // 对齐 Go：清空 = 回退该类型默认源
    setSources(DEFAULT_SOURCES.filter((s) => sourceSupported(s, type)));
  };

  const allPlaylists = useMemo(() => {
    // /api/search 返回扁平 Playlist[]（聚合搜索 + 链接解析共用）
    const raw = result?.playlists;
    if (!Array.isArray(raw) || !raw.length) return [];
    return raw;
  }, [result]);

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 lg:px-8 lg:py-10">
      {/* ---------- Hero（未搜索时） ---------- */}
      <AnimatePresence>
        {!searched && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12, height: 0 }}
            transition={{ duration: 0.4 }}
            className="mb-8 flex flex-col items-center gap-3 pt-10 text-center lg:pt-20"
          >
            <span className="animate-pulse-glow flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-cyan-400 shadow-2xl shadow-fuchsia-500/25">
              <Sparkles className="h-7 w-7 text-white" aria-hidden="true" />
            </span>
            <h1 className="bg-gradient-to-r from-violet-300 via-fuchsia-200 to-cyan-200 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent lg:text-4xl">
              全网音乐，一搜即达
            </h1>
            <p className="max-w-md text-sm leading-relaxed text-zinc-400">
              聚合网易云、QQ、酷狗、酷我、咪咕等 13 家音源；支持歌单 / 专辑 / 分享链接解析
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- 搜索框 ---------- */}
      <form onSubmit={onSubmit} role="search" aria-label="音乐搜索" className="relative z-20">
        <div className="glass flex items-center gap-2 rounded-2xl border border-white/[0.1] p-2 shadow-2xl shadow-black/30 transition-shadow duration-300 focus-within:shadow-[0_0_0_4px_rgba(139,92,246,0.13),0_24px_48px_-12px_rgba(0,0,0,0.5)]">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center text-zinc-400">
            {isLink ? <Link2 className="h-5 w-5 text-cyan-300" aria-hidden="true" /> : <Search className="h-5 w-5" aria-hidden="true" />}
          </span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onInputKeyDown}
            onFocus={() => {
              if (suggestions.length) setSuggestOpen(true);
            }}
            placeholder={PLACEHOLDER[type]}
            aria-label="搜索关键词或链接"
            aria-autocomplete="list"
            aria-expanded={suggestOpen}
            aria-controls="search-suggest-list"
            role="combobox"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
            enterKeyHint="search"
          />
          {input && (
            <button
              type="button"
              onClick={() => {
                setInput("");
                inputRef.current?.focus();
              }}
              aria-label="清空"
              className="flex h-11 w-9 items-center justify-center text-zinc-500 hover:text-zinc-200"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/25 transition-all hover:brightness-110 active:scale-95 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" aria-hidden="true" />}
            搜索
          </button>
        </div>
        {isLink && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-2 flex items-center gap-1.5 pl-2 text-[11.5px] text-cyan-300/90"
          >
            <Link2 className="h-3 w-3" aria-hidden="true" />
            检测到链接，将自动识别来源并解析
          </motion.p>
        )}

        {/* ---------- 搜索联想下拉 ---------- */}
        {suggestOpen && suggestions.length > 0 && (
          <ul
            id="search-suggest-list"
            role="listbox"
            aria-label="搜索联想"
            className="glass absolute left-0 right-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-2xl border border-white/[0.1] py-1.5 shadow-2xl shadow-black/50"
          >
            {suggestions.map((kw, i) => (
              <li key={kw} role="option" aria-selected={i === suggestIndex}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    /* mousedown 先于 blur 触发，直接选中 */
                    e.preventDefault();
                    pickSuggestion(kw);
                  }}
                  onMouseEnter={() => setSuggestIndex(i)}
                  className={`flex min-h-[42px] w-full items-center gap-2.5 px-4 text-left text-[13.5px] transition-colors ${
                    i === suggestIndex ? "bg-white/[0.07] text-white" : "text-zinc-300"
                  }`}
                >
                  <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden="true" />
                  <span className="truncate">{kw}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>

      {/* ---------- 类型 tab + 源选择 ---------- */}
      <div className="sticky top-[61px] z-20 -mx-4 mt-4 bg-gradient-to-b from-surface-sticky via-surface-sticky/92 to-transparent px-4 pb-2 pt-2 backdrop-blur-sm lg:top-0 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <div className="glass flex rounded-xl border border-white/[0.07] p-1" role="tablist" aria-label="搜索类型">
            {TYPE_TABS.map((t) => {
              const Icon = t.icon;
              const active = type === t.key && !isLink;
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => changeType(t.key)}
                  className={`relative flex min-h-[40px] items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-medium transition-colors ${
                    active ? "text-white" : "text-zinc-400 hover:text-zinc-200"
                  } ${isLink ? "opacity-50" : ""}`}
                >
                  {active && (
                    <motion.span
                      layoutId="search-type-pill"
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

          <button
            onClick={toggleSourcePanel}
            aria-expanded={showSourcePanel}
            className="glass flex min-h-[40px] items-center gap-1.5 rounded-xl border border-white/[0.07] px-3 text-[13px] text-zinc-300 transition-colors hover:border-violet-400/30"
            aria-label="音源筛选"
          >
            <Filter className="h-3.5 w-3.5" aria-hidden="true" />
            音源
            <span className="rounded-full bg-violet-500/25 px-1.5 text-[10.5px] font-bold text-violet-200">{sources.length}</span>
          </button>
        </div>

        <AnimatePresence>
          {showSourcePanel && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden"
            >
              <div className="mt-2 flex flex-wrap gap-1.5 pb-2">
                <button
                  onClick={selectAllSources}
                  className="flex min-h-[36px] items-center rounded-full border border-white/[0.1] bg-white/[0.02] px-3 text-xs text-zinc-400 transition-colors hover:text-zinc-200"
                >
                  全选
                </button>
                <button
                  onClick={clearSources}
                  className="flex min-h-[36px] items-center rounded-full border border-white/[0.1] bg-white/[0.02] px-3 text-xs text-zinc-400 transition-colors hover:text-zinc-200"
                >
                  清空
                </button>
                {ALL_SOURCES.map((s) => {
                  const meta = SOURCE_META[s];
                  const active = sources.includes(s);
                  const supported = sourceSupported(s, type);
                  return (
                    <button
                      key={s}
                      onClick={() => toggleSource(s)}
                      aria-pressed={active}
                      disabled={!supported}
                      title={supported ? undefined : `该源不支持${type === "playlist" ? "歌单" : "专辑"}搜索`}
                      className={`flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-all active:scale-95 ${
                        active ? `${meta.badge} ring-1` : "border-white/[0.1] bg-white/[0.02] text-zinc-500 hover:text-zinc-300"
                      } ${supported ? "" : "cursor-not-allowed opacity-35"}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
                      {meta.label}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ---------- 结果区 ---------- */}
      <div ref={resultRef} className="mt-4 scroll-mt-32">
        {loading ? (
          type === "song" && !isLink ? (
            <SongList songs={[]} loading />
          ) : (
            <PlaylistGrid playlists={[]} loading />
          )
        ) : result ? (
          <>
            {/* 链接解析：歌单/专辑卡 */}
            {result.import_collection && (result.playlist || result.album) && (
              <ParsedCollectionCard
                collection={result.import_collection}
                playlist={(result.playlist ?? result.album)!}
                songs={result.songs ?? []}
              />
            )}
            {/* 错误 */}
            {result.error && (
              <SearchErrorCard
                message={result.error}
                hint="可尝试直接搜索关键词，或切换其他源"
                onRetry={() => void doSearch(input, type, sources)}
              />
            )}
            {/* 单曲结果（审核整改 A-28：songs 结构校验，异常响应体防白屏） */}
            {result.type === "song" && Array.isArray(result.songs) && result.songs.length > 0 && !result.error && (
              <>
                <ArtistResults q={resultQ} />
                <SectionTitle count={result.songs.length}>单曲结果</SectionTitle>
                <SongList
                  songs={result.songs}
                  emptyHint="没有找到相关歌曲，换个关键词或启用更多音源试试"
                  onSongsChange={(next) =>
                    setResult((prev) => (prev && prev.songs ? { ...prev, songs: next } : prev))
                  }
                />
              </>
            )}
            {result.type === "song" && !result.error && (!Array.isArray(result.songs) || result.songs.length === 0) && (
              <>
                <ArtistResults q={resultQ} />
                <SectionTitle count={0}>单曲结果</SectionTitle>
                <SongList
                  songs={[]}
                  emptyHint="没有找到相关歌曲，换个关键词或启用更多音源试试"
                />
              </>
            )}
            {/* 歌单结果 */}
            {result.type === "playlist" && !result.error && (
              <>
                <SectionTitle count={allPlaylists.length}>歌单结果</SectionTitle>
                <PlaylistGrid
                  playlists={allPlaylists}
                  emptyHint="该类型下没有找到歌单，试试其他关键词"
                />
              </>
            )}
            {/* 专辑结果 */}
            {result.type === "album" && !result.error && (
              <>
                <SectionTitle count={allPlaylists.length}>专辑结果</SectionTitle>
                <PlaylistGrid
                  playlists={allPlaylists}
                  hrefOf={(p) => `/album?id=${encodeURIComponent(p.id)}&source=${p.source}`}
                  kind="album"
                  emptyHint="没有找到相关专辑"
                />
              </>
            )}
          </>
        ) : searchError ? (
          /* 审核整改 A-20：搜索异常（网络/超时等）持久错误态 + 重试入口，不再静默落空白 */
          <SearchErrorCard
            message={searchError}
            hint="请检查网络连接或稍后重试"
            onRetry={() => void doSearch(input, type, sources)}
          />
        ) : (
          !searched && (
            <>
              <HotSearchSection
                onSearch={(kw) => {
                  setInput(kw);
                  inputRef.current?.blur();
                  void doSearch(kw, type, sources);
                }}
              />
              {history.length > 0 && (
                <div className="mt-8">
                  <div className="mb-2.5 flex items-center justify-between gap-2">
                    <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-zinc-400">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" /> 最近搜索
                    </h2>
                    <button
                      onClick={clearHistory}
                      className="flex min-h-[36px] items-center gap-1 rounded-lg px-2 text-[11.5px] text-zinc-500 transition-colors hover:text-red-300"
                      aria-label="清空搜索历史"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden="true" /> 清空
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {history.map((h) => (
                      <button
                        key={h}
                        onClick={() => {
                          setInput(h);
                          void doSearch(h, type, sources);
                        }}
                        className="glass flex min-h-[40px] max-w-full items-center gap-1.5 rounded-full border border-white/[0.1] px-3.5 text-[12.5px] text-zinc-300 transition-colors hover:border-violet-400/30 hover:text-white active:scale-95"
                        title={h}
                      >
                        <Clock className="h-3 w-3 shrink-0 text-zinc-500" aria-hidden="true" />
                        <span className="max-w-[180px] truncate">{h}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <SourceShowcase />
            </>
          )
        )}
      </div>
    </div>
  );
}

function SectionTitle({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div className="mb-3 mt-2 flex items-baseline gap-2">
      <h2 className="text-[15px] font-bold text-zinc-100">{children}</h2>
      {typeof count === "number" && <span className="text-xs tabular-nums text-zinc-500">{count} 项</span>}
    </div>
  );
}

/** 搜索错误卡（审核整改 A-20）：业务错误（result.error）与网络异常（searchError）共用 */
function SearchErrorCard({ message, hint, onRetry }: { message: string; hint: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2.5 py-16 text-center" role="alert">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10">
        <Search className="h-6 w-6 text-red-300/80" aria-hidden="true" />
      </span>
      <p className="max-w-sm text-sm leading-relaxed text-red-300/90">{message}</p>
      <p className="text-xs text-zinc-500">{hint}</p>
      <button
        onClick={onRetry}
        className="mt-1 flex h-11 items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] px-5 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.08] active:scale-95"
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" /> 重新搜索
      </button>
    </div>
  );
}

/** 链接解析出的歌单/专辑卡片 */
function ParsedCollectionCard({
  collection,
  playlist,
  songs,
}: {
  collection: NonNullable<SearchResponse["import_collection"]>;
  playlist: Playlist;
  songs: Song[];
}) {
  const isAlbum = collection.content_type === "album";
  const meta = sourceMeta(collection.source);
  const [importing, setImporting] = useState(false);

  const onImport = async () => {
    setImporting(true);
    try {
      const r = await apiImportCollection({
        content_type: isAlbum ? "album" : "playlist",
        source: collection.source,
        external_id: collection.external_id,
        name: playlist.name,
        link: collection.link || playlist.link,
        description: playlist.description || collection.description,
        cover: playlist.cover || collection.cover,
        creator: collection.creator || playlist.creator,
        track_count: songs.length,
      });
      const err = (r as { error?: string }).error;
      if (err) {
        toast.error(err);
        return;
      }
      if (r.duplicate) toast.info(`「${r.name}」已在你的歌单库中`);
      else toast.success(`已导入「${r.name}」到我的歌单`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "导入失败");
    } finally {
      setImporting(false);
    }
  };

  const detailHref = `/${isAlbum ? "album" : "playlist"}?id=${encodeURIComponent(playlist.id)}&source=${encodeURIComponent(collection.source)}`;
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      aria-label={`解析结果：${playlist.name}`}
      className="glass mb-6 rounded-3xl border border-white/[0.1] p-4 lg:p-5"
    >
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="h-36 w-36 shrink-0 overflow-hidden rounded-2xl bg-zinc-800 ring-1 ring-white/10">
          {playlist.cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverProxyUrl(playlist.cover, playlist.source)} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center">
              <Disc3 className="h-10 w-10 text-zinc-600" aria-hidden="true" />
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded border px-1.5 py-px text-[10px] ${meta.badge}`}>{meta.label}</span>
            <span className="rounded border border-white/[0.1] bg-white/[0.04] px-1.5 py-px text-[10px] text-zinc-400">
              {isAlbum ? "专辑" : "歌单"}
            </span>
          </div>
          <h2 className="mt-1.5 text-xl font-bold text-zinc-50">{playlist.name}</h2>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-500">
            {playlist.description || collection.description || "暂无简介"}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {collection.creator ? `创建者：${collection.creator} · ` : ""}
            共 {songs.length} 首
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={onImport}
              disabled={importing}
              className="flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 text-[13px] font-semibold text-white shadow-lg shadow-fuchsia-500/20 transition-all hover:brightness-110 active:scale-95 disabled:opacity-50"
            >
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListPlus className="h-4 w-4" />}
              导入到我的歌单
            </button>
            <Link
              href={detailHref}
              className="flex h-10 items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] px-4 text-[13px] font-medium text-zinc-200 transition-colors hover:bg-white/[0.08] active:scale-95"
            >
              <ExternalLink className="h-4 w-4" />
              查看详情
            </Link>
            {collection.link && (
              <a
                href={collection.link}
                target="_blank"
                rel="noreferrer"
                className="flex h-10 items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] px-4 text-[13px] font-medium text-zinc-300 transition-colors hover:bg-white/[0.08] active:scale-95"
              >
                源站打开
              </a>
            )}
          </div>
        </div>
      </div>
      <div className="mt-4">
        <SongList songs={songs} />
      </div>
    </motion.section>
  );
}

/** 空态：音源一览 */
function SourceShowcase() {
  return (
    <div className="mt-10 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {ALL_SOURCES.map((s, i) => {
        const meta = SOURCE_META[s];
        const isDefault = DEFAULT_SOURCES.includes(s);
        return (
          <motion.div
            key={s}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 + i * 0.035, duration: 0.3 }}
            className="glass flex items-center gap-2.5 rounded-2xl border border-white/[0.07] px-3.5 py-3"
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} aria-hidden="true" />
            <span className="text-[13px] font-medium text-zinc-300">{meta.label}</span>
            {isDefault && <span className="ml-auto rounded-full bg-violet-500/15 px-1.5 py-px text-[9.5px] text-violet-300">默认</span>}
          </motion.div>
        );
      })}
    </div>
  );
}
