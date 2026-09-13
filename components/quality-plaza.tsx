"use client";

/**
 * 精品歌单广场（P1 B4）— hi-res 专区：标签筛选 + 网格分页 + 收藏（playlist_subscribe）。
 * 挂载于 /explore 每日推荐 tab（网易 hi-res 精品歌单）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { Gem, ChevronDown, BookmarkPlus, BookmarkCheck, Play } from "lucide-react";
import { toast } from "sonner";
import { apiHighquality, apiSubscribePlaylist } from "@/lib/client/api";
import { coverProxyUrl } from "@/lib/play-url";
import type { HighqualityTag, Playlist } from "@/lib/types";

export function QualityPlaza() {
  const [tags, setTags] = useState<HighqualityTag[]>([]);
  /* P1 B4：热门歌单分类标签（playlist_hot 官方热门标签，点击直达分类歌单页） */
  const [hotTags, setHotTags] = useState<{ id: string; name: string; hot?: boolean }[]>([]);
  const [tag, setTag] = useState("全部");
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [initial, setInitial] = useState(true);
  /* 审核整改 C-12：初载失败落 error 态（原静默走"该标签下暂无精品歌单"空态） */
  const [initialError, setInitialError] = useState("");
  const [initialRetry, setInitialRetry] = useState(0);
  const [subscribed, setSubscribed] = useState<Set<string>>(new Set());
  const seqRef = useRef(0);

  useEffect(() => {
    let alive = true;
    apiHighquality("全部", 1, true)
      .then((r) => {
        if (!alive) return;
        if (r.error && !r.playlists?.length) setInitialError(r.error);
        else {
          setTags(r.tags ?? []);
          setHotTags((r.hot_tags ?? []).slice(0, 12));
          setPlaylists(r.playlists ?? []);
          setHasMore(!!r.has_more);
        }
        setInitial(false);
      })
      .catch((e) => {
        if (alive) {
          setInitialError(e instanceof Error ? e.message : "精品歌单加载失败");
          setInitial(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [initialRetry]);

  const load = useCallback(async (t: string, p: number, append: boolean) => {
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      const r = await apiHighquality(t, p);
      if (seq !== seqRef.current) return;
      if (r.error) throw new Error(r.error);
      setPlaylists((prev) => (append ? [...prev, ...(r.playlists ?? [])] : r.playlists ?? []));
      setHasMore(!!r.has_more);
    } catch (e) {
      if (seq === seqRef.current) toast.error(e instanceof Error ? e.message : "精品歌单加载失败");
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, []);

  const onTag = (t: string) => {
    if (t === tag) return;
    setTag(t);
    setPage(1);
    void load(t, 1, false);
  };

  const toggleSub = async (p: Playlist) => {
    const next = new Set(subscribed);
    const willSub = !next.has(p.id);
    try {
      await apiSubscribePlaylist("netease", p.id, willSub);
      if (willSub) next.add(p.id);
      else next.delete(p.id);
      setSubscribed(next);
      toast.success(willSub ? `已收藏：${p.name}` : "已取消收藏");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败");
    }
  };

  return (
    <section aria-label="精品歌单广场" className="glass rounded-3xl border border-white/[.07] p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-zinc-100">
          <Gem className="h-4 w-4 text-cyan-300" aria-hidden="true" /> 精品歌单 · hi-res 专区
        </h2>
        <span className="text-xs text-zinc-500">网易官方甄选</span>
      </div>

      {tags.length > 0 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="精品歌单标签">
          {tags.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tag === t.name}
              onClick={() => onTag(t.name)}
              className={`min-h-[36px] shrink-0 rounded-full border px-3.5 text-[12px] font-medium transition-colors ${
                tag === t.name ? "border-cyan-300/40 bg-cyan-400/15 text-cyan-200" : "border-white/[.08] bg-white/[0.02] text-zinc-400 hover:border-cyan-300/30 hover:text-zinc-100"
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      {/* 热门歌单分类（playlist_hot 官方热门标签 → 分类歌单页） */}
      {hotTags.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="shrink-0 text-[11px] font-semibold tracking-wide text-zinc-600">热门</span>
          {hotTags.map((t) => (
            <Link
              key={t.id}
              href={`/explore?tab=category&source=netease&category=${encodeURIComponent(t.id)}`}
              className="flex min-h-[36px] items-center rounded-full border border-white/[.06] bg-white/[0.02] px-2.5 text-[11px] text-zinc-500 transition-colors hover:border-fuchsia-400/30 hover:text-fuchsia-200"
            >
              {t.name}{t.hot ? " ·" : ""}
            </Link>
          ))}
        </div>
      )}

      <div className="mt-4" aria-busy={loading}>
        {initial ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i}>
                <div className="shimmer aspect-square rounded-2xl" />
                <div className="shimmer mt-2 h-3.5 w-3/4 rounded" />
              </div>
            ))}
          </div>
        ) : initialError && !playlists.length ? (
          /* 审核整改 C-12：初载 error 态可重试 */
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-[13px] text-zinc-400">{initialError}</p>
            <button onClick={() => setInitialRetry((k) => k + 1)} className="flex min-h-[44px] items-center rounded-xl border border-white/[.1] px-4 text-[13px] text-zinc-300 transition-colors hover:border-cyan-300/40 hover:text-zinc-100">
              重试
            </button>
          </div>
        ) : !playlists.length ? (
          <p className="py-8 text-center text-[13px] text-zinc-500">该标签下暂无精品歌单</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {playlists.map((p, i) => (
              <motion.div key={`${p.id}-${i}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.025, 0.35) }} className="group">
                <Link href={`/playlist?id=${encodeURIComponent(p.id)}&source=netease`} className="block" aria-label={`打开歌单 ${p.name}`}>
                  <div className="card-glow relative aspect-square overflow-hidden rounded-2xl bg-zinc-800/80 ring-1 ring-white/[0.06] transition-all duration-300 group-hover:-translate-y-0.5 group-hover:ring-cyan-400/40">
                    {p.cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={coverProxyUrl(p.cover, "netease")} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]" />
                    ) : null}
                    <span className="absolute bottom-2 right-2 flex h-9 w-9 translate-y-2 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white opacity-0 shadow-lg shadow-fuchsia-500/40 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100 [@media(hover:none)]:translate-y-0 [@media(hover:none)]:opacity-100">
                      <Play className="ml-0.5 h-4 w-4" fill="currentColor" />
                    </span>
                  </div>
                </Link>
                <div className="mt-2 flex items-start gap-1.5">
                  <Link href={`/playlist?id=${encodeURIComponent(p.id)}&source=netease`} className="min-w-0 flex-1">
                    <p className="tip truncate text-[13px] font-semibold text-zinc-200 transition-colors group-hover:text-cyan-200">{p.name}</p>
                    <p className="mt-0.5 truncate text-[11px] text-zinc-500">{p.creator || "精品歌单"}</p>
                  </Link>
                  <button
                    onClick={() => toggleSub(p)}
                    aria-label={subscribed.has(p.id) ? `取消收藏 ${p.name}` : `收藏 ${p.name}`}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-cyan-300"
                  >
                    {subscribed.has(p.id) ? <BookmarkCheck className="h-4 w-4 text-cyan-300" /> : <BookmarkPlus className="h-4 w-4" />}
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {hasMore && !loading && !initial && (
        <button
          onClick={() => {
            const next = page + 1;
            setPage(next);
            void load(tag, next, true);
          }}
          className="mt-4 flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-2xl border border-white/[.08] text-[13px] text-zinc-400 transition-colors hover:border-cyan-400/40 hover:text-zinc-100"
        >
          <ChevronDown className="h-4 w-4" aria-hidden="true" /> 加载更多
        </button>
      )}
    </section>
  );
}
