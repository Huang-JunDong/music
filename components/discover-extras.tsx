"use client";

/**
 * 首页发现增强组件（/explore 每日推荐 tab 顶部）：
 * - BannerCarousel：网易 banner 自动轮播（5s 淡切 + 指示点；reduced-motion 静态首帧）
 * - NewSongsRow：双源新歌速递横滑卡（点击整批入队播放）
 * - DailySongsRow：网易登录后每日推荐（未登录隐藏）
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Play, Sparkles, ImageOff } from "lucide-react";
import { usePlayer } from "@/lib/client/store";
import { coverProxyUrl, sourceMeta } from "@/lib/play-url";
import type { Banner, Song } from "@/lib/types";

/* ---------- 模块级缓存 ---------- */
let bannersCache: Banner[] | null = null;
let newSongsCache: Song[] | null = null;
let dailySongsCache: Song[] | null = null;

async function fetchJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export function DiscoverExtras() {
  return (
    <div className="mb-8 space-y-6">
      <BannerCarousel />
      <NewSongsRow />
      <DailySongsRow />
    </div>
  );
}

/* ================= Banner 轮播 ================= */

function BannerCarousel() {
  const [banners, setBanners] = useState<Banner[]>(bannersCache ?? []);
  const [idx, setIdx] = useState(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (bannersCache) {
      setBanners(bannersCache);
      return;
    }
    let alive = true;
    fetchJSON<{ banners: Banner[] }>("/api/discover?kind=banner")
      .then((r) => {
        if (!alive) return;
        const list = (r.banners ?? []).filter((b) => b.image);
        bannersCache = list;
        setBanners(list);
      })
      .catch(() => {
        /* banner 失败静默隐藏 */
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (reduced || banners.length < 2) return;
    const timer = setInterval(() => setIdx((i) => (i + 1) % banners.length), 5000);
    return () => clearInterval(timer);
  }, [reduced, banners.length]);

  if (!banners.length) return null;
  const cur = banners[Math.min(idx, banners.length - 1)];
  const targetHref = cur.target
    ? cur.target.type === "album"
      ? `/album?id=${encodeURIComponent(cur.target.id)}&source=netease`
      : cur.target.type === "playlist"
        ? `/playlist?id=${encodeURIComponent(cur.target.id)}&source=netease`
        : "/mv"
    : cur.link || "";

  return (
    <section aria-label="精选推荐" className="relative overflow-hidden rounded-3xl">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${cur.image}-${idx}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6 }}
          className="relative aspect-[21/8] w-full sm:aspect-[21/7]"
        >
          {targetHref ? (
            <Link href={targetHref} aria-label={cur.tag ? `查看${cur.tag}` : "查看推荐"} className="group block h-full w-full">
              <BannerImg banner={cur} />
            </Link>
          ) : (
            <BannerImg banner={cur} />
          )}
        </motion.div>
      </AnimatePresence>
      {/* 指示点 */}
      {banners.length > 1 && (
        <div className="absolute bottom-2.5 left-1/2 flex -translate-x-1/2 gap-1.5" role="tablist" aria-label="轮播指示">
          {banners.map((_, i) => (
            <button
              key={i}
              onClick={() => setIdx(i)}
              aria-label={`第 ${i + 1} 张`}
              aria-selected={i === idx}
              role="tab"
              className={`h-1.5 rounded-full transition-all ${i === idx ? "w-5 bg-white/90" : "w-1.5 bg-white/40 hover:bg-white/60"}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function BannerImg({ banner }: { banner: Banner }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={coverProxyUrl(banner.image, banner.source)}
        alt={banner.tag ?? "推荐"}
        className="h-full w-full rounded-3xl object-cover ring-1 ring-white/[0.08]"
      />
      {banner.tag && (
        <span className="absolute bottom-2.5 left-2.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-zinc-100 backdrop-blur-sm">
          {banner.tag}
        </span>
      )}
    </>
  );
}

/* ================= 新歌速递（双源） ================= */

function NewSongsRow() {
  const [songs, setSongs] = useState<Song[]>(newSongsCache ?? []);
  const play = usePlayer((s) => s.play);
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    if (newSongsCache) {
      setSongs(newSongsCache);
      return;
    }
    let alive = true;
    fetchJSON<{ songs: Song[] }>("/api/discover?kind=new_songs")
      .then((r) => {
        if (!alive) return;
        newSongsCache = r.songs ?? [];
        setSongs(newSongsCache);
      })
      .catch(() => {
        /* 静默 */
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!songs.length) return null;

  const onPlay = (s: Song) => {
    setCurrent(`${s.source}:${s.id}`);
    play(s, songs);
  };

  return (
    <section aria-label="新歌速递">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-zinc-100">
          <Sparkles className="h-4 w-4 text-amber-300/90" aria-hidden="true" /> 新歌速递
        </h2>
        <span className="text-xs text-zinc-500">网易 · QQ 双源精选</span>
      </div>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 no-scrollbar">
        {songs.map((s) => {
          const playing = current === `${s.source}:${s.id}`;
          return (
            <button
              key={`${s.source}-${s.id}`}
              onClick={() => onPlay(s)}
              aria-label={`播放 ${s.name}`}
              className="group w-[104px] shrink-0 rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
            >
              <span className="relative block aspect-square overflow-hidden rounded-2xl bg-zinc-800/80 ring-1 ring-white/[0.06] transition-all group-hover:-translate-y-0.5 group-hover:ring-violet-400/40">
                {s.cover ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={coverProxyUrl(s.cover, s.source)}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <span className="flex h-full items-center justify-center">
                    <ImageOff className="h-6 w-6 text-zinc-600" aria-hidden="true" />
                  </span>
                )}
                <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/35">
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-full bg-white/15 backdrop-blur-md transition-all ${
                      playing ? "scale-100 opacity-100" : "scale-90 opacity-0 group-hover:scale-100 group-hover:opacity-100"
                    }`}
                  >
                    <Play className="ml-0.5 h-4 w-4 fill-white text-white" aria-hidden="true" />
                  </span>
                </span>
                <span className={`absolute left-1 top-1 h-1.5 w-1.5 rounded-full ${sourceMeta(s.source).dot}`} aria-label={sourceMeta(s.source).label} />
              </span>
              <span className="mt-1.5 block">
                <span className="tip block truncate text-[12.5px] font-semibold text-zinc-200 group-hover:text-white">
                  {s.name}
                  <span className="tip-bubble">
                    <span className="tip-name">{s.name}</span>
                    <span className="tip-sub">{s.artist}</span>
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-zinc-500">{s.artist}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ================= 每日推荐（网易登录） ================= */

function DailySongsRow() {
  const [songs, setSongs] = useState<Song[]>(dailySongsCache ?? []);
  const play = usePlayer((s) => s.play);
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    if (dailySongsCache) {
      setSongs(dailySongsCache);
      return;
    }
    let alive = true;
    fetchJSON<{ songs?: Song[]; need_login?: boolean }>("/api/discover?kind=daily_songs")
      .then((r) => {
        if (!alive) return;
        const list = r.need_login ? [] : r.songs ?? [];
        dailySongsCache = list;
        setSongs(list);
      })
      .catch(() => {
        /* 静默 */
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!songs.length) return null;
  const display = songs.slice(0, 6);

  return (
    <section aria-label="每日推荐">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[15px] font-bold text-zinc-100">每日推荐 · 私享雷达</h2>
          <span className="text-xs text-zinc-500">共 {songs.length} 首 · 登录网易账号生成</span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {display.map((s) => {
          const playing = current === `${s.source}:${s.id}`;
          return (
            <button
              key={`${s.source}-${s.id}`}
              onClick={() => {
                setCurrent(`${s.source}:${s.id}`);
                play(s, songs);
              }}
              aria-label={`播放 ${s.name}`}
              className="group rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
            >
              <span className="relative block aspect-square overflow-hidden rounded-2xl bg-zinc-800/80 ring-1 ring-white/[0.06] transition-all group-hover:-translate-y-0.5 group-hover:ring-violet-400/40">
                {s.cover ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={coverProxyUrl(s.cover, s.source)}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : null}
                <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/35">
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-full bg-white/15 backdrop-blur-md transition-all ${
                      playing ? "scale-100 opacity-100" : "scale-90 opacity-0 group-hover:scale-100 group-hover:opacity-100"
                    }`}
                  >
                    <Play className="ml-0.5 h-4 w-4 fill-white text-white" aria-hidden="true" />
                  </span>
                </span>
              </span>
              <span className="mt-1.5 block">
                <span className="tip block truncate text-[12.5px] font-semibold text-zinc-200 group-hover:text-white">
                  {s.name}
                  <span className="tip-bubble">
                    <span className="tip-name">{s.name}</span>
                    <span className="tip-sub">{s.artist}</span>
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-zinc-500">{s.artist}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
