"use client";

/**
 * 首页发现增强组件（/explore 每日推荐 tab 顶部）：
 * - BannerCarousel：网易 banner 自动轮播（5s 淡切 + 指示点；reduced-motion 静态首帧）
 * - NewSongsRow：双源新歌速递横滑卡（点击整批入队播放）
 * - DailySongsRow：网易登录后每日推荐（未登录隐藏）
 * P1 B4 新增：
 * - PrivateContentRow：网易独家放送横滑（personalized_privatecontent/_list）
 * - RecommendedMvRow：网易推荐 MV 横滑（personalized_mv）
 * - DailyPlaylistRow：网易每日推荐歌单（recommend_resource，登录）
 * - MyLikedRow：我喜欢的 MLOG 歌单（playlist_mylike，登录）
 * - QualityPlaza：精品歌单 hi-res 专区（独立组件）
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Play, Sparkles, ImageOff, Zap, MonitorPlay, CalendarClock, FolderHeart, LayoutGrid } from "lucide-react";
import { usePlayer } from "@/lib/client/store";
import { apiPrivateContents, apiRecommendedMvs, apiDailyPlaylists, apiMyLikedPlaylists, apiDiscoverBlocks } from "@/lib/client/api";
import { coverProxyUrl, sourceMeta } from "@/lib/play-url";
import { QualityPlaza } from "@/components/quality-plaza";
import type { Banner, Song, MvItem, Playlist, DiscoverBlock } from "@/lib/types";

/* ---------- 模块级缓存 ---------- */
let bannersCache: Banner[] | null = null;
let newSongsCache: Song[] | null = null;
let dailySongsCache: Song[] | null = null;
let privateCache: Banner[] | null = null;
let mvCache: MvItem[] | null = null;
let dailyPlaylistCache: Playlist[] | null = null;
let myLikedCache: Playlist[] | null = null;
let blocksCache: DiscoverBlock[] | null = null;

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
      <DailyPlaylistRow />
      <PrivateContentRow />
      <RecommendedMvRow />
      <HomeBlocksRow />
      <MyLikedRow />
      <QualityPlaza />
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
    fetchJSON<{ banners: Banner[]; error?: string }>("/api/discover?kind=banner")
      .then((r) => {
        if (!alive) return;
        /* 审核整改 R2-F4：失败结果不写缓存（防空结果固化） */
        if (r.error) return;
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
    fetchJSON<{ songs: Song[]; error?: string }>("/api/discover?kind=new_songs")
      .then((r) => {
        if (!alive) return;
        /* 审核整改 R2-F4：失败结果不写缓存 */
        if (r.error) return;
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

/* ================= P1 B4：独家放送（网易 personalized_privatecontent/_list） ================= */

function PrivateContentRow() {
  const [banners, setBanners] = useState<Banner[]>(privateCache ?? []);

  useEffect(() => {
    if (privateCache) {
      setBanners(privateCache);
      return;
    }
    let alive = true;
    apiPrivateContents()
      .then((r) => {
        if (!alive) return;
        /* 审核整改 R2-F4：失败结果不写缓存 */
        if (r.error) return;
        privateCache = r.banners ?? [];
        setBanners(privateCache);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!banners.length) return null;
  const display = banners.slice(0, 10);

  return (
    <section aria-label="独家放送">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-zinc-100">
          <Zap className="h-4 w-4 text-amber-300" aria-hidden="true" /> 独家放送
        </h2>
        <span className="text-xs text-zinc-500">网易官方出品</span>
      </div>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 no-scrollbar">
        {display.map((b, i) => (
          <motion.div key={`${b.image}-${i}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.05, 0.4) }} className="w-[240px] shrink-0">
            <Link
              href={b.target ? `/playlist?id=${encodeURIComponent(b.target.id)}&source=netease` : b.link || "#"}
              target={b.link && !b.target ? "_blank" : undefined}
              rel={b.link && !b.target ? "noreferrer" : undefined}
              className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
              aria-label={b.title}
            >
              <span className="relative block aspect-[16/9] overflow-hidden rounded-2xl bg-zinc-800/80 ring-1 ring-white/[0.06] transition-all group-hover:-translate-y-0.5 group-hover:ring-amber-400/40">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={coverProxyUrl(b.image, "netease")} alt={b.title ?? "独家放送"} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                {b.tag && <span className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-zinc-100 backdrop-blur">{b.tag}</span>}
              </span>
              <span className="mt-1.5 block truncate text-[12.5px] font-semibold text-zinc-200 group-hover:text-amber-100">{b.title}</span>
            </Link>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* ================= P1 B4：推荐 MV（网易 personalized_mv） ================= */

function RecommendedMvRow() {
  const [mvs, setMvs] = useState<MvItem[]>(mvCache ?? []);

  useEffect(() => {
    if (mvCache) {
      setMvs(mvCache);
      return;
    }
    let alive = true;
    apiRecommendedMvs()
      .then((r) => {
        if (!alive) return;
        /* 审核整改 R2-F4：失败结果不写缓存 */
        if (r.error) return;
        mvCache = r.mvs ?? [];
        setMvs(mvCache);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!mvs.length) return null;
  const display = mvs.slice(0, 10);

  return (
    <section aria-label="推荐 MV">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-zinc-100">
          <MonitorPlay className="h-4 w-4 text-fuchsia-300" aria-hidden="true" /> 推荐 MV
        </h2>
        <Link href="/mv" className="text-xs text-zinc-500 transition-colors hover:text-fuchsia-300">
          全部 MV →
        </Link>
      </div>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 no-scrollbar">
        {display.map((m, i) => (
          <motion.div key={`${m.id}-${i}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.05, 0.4) }} className="w-[168px] shrink-0">
            <Link href={`/mv?vid=${encodeURIComponent(m.id)}&source=netease`} className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60" aria-label={`播放 MV ${m.name}`}>
              <span className="relative block aspect-video overflow-hidden rounded-2xl bg-zinc-800/80 ring-1 ring-white/[0.06] transition-all group-hover:-translate-y-0.5 group-hover:ring-fuchsia-400/40">
                {m.cover ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={coverProxyUrl(m.cover, "netease")} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                ) : null}
                <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/30">
                  <Play className="h-8 w-8 scale-90 fill-white/90 text-white/90 opacity-0 transition-all group-hover:scale-100 group-hover:opacity-100" aria-hidden="true" />
                </span>
              </span>
              <span className="mt-1.5 block truncate text-[12.5px] font-semibold text-zinc-200 group-hover:text-fuchsia-200">{m.name}</span>
              <span className="mt-0.5 block truncate text-[11px] text-zinc-500">{m.artist}</span>
            </Link>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* ================= P1 B4：每日推荐歌单（网易 recommend_resource 登录） ================= */

function DailyPlaylistRow() {
  const [playlists, setPlaylists] = useState<Playlist[]>(dailyPlaylistCache ?? []);

  useEffect(() => {
    if (dailyPlaylistCache) {
      setPlaylists(dailyPlaylistCache);
      return;
    }
    let alive = true;
    apiDailyPlaylists()
      .then((r) => {
        if (!alive) return;
        /* 审核整改 R2-F4：未登录/失败结果不写缓存（防登录后返回仍读到空缓存的固化问题） */
        if (r.need_login || r.error) return;
        const list = r.playlists ?? [];
        dailyPlaylistCache = list;
        setPlaylists(list);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!playlists.length) return null;
  const display = playlists.slice(0, 10);

  return (
    <section aria-label="每日推荐歌单">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-zinc-100">
          <CalendarClock className="h-4 w-4 text-violet-300" aria-hidden="true" /> 每日推荐歌单
        </h2>
        <span className="text-xs text-zinc-500">每天 6:00 更新 · 登录生成</span>
      </div>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 no-scrollbar">
        {display.map((p, i) => (
          <motion.div key={`${p.id}-${i}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.04, 0.4) }} className="w-[120px] shrink-0">
            <Link href={`/playlist?id=${encodeURIComponent(p.id)}&source=netease`} className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60" aria-label={`打开歌单 ${p.name}`}>
              <span className="relative block aspect-square overflow-hidden rounded-2xl bg-zinc-800/80 ring-1 ring-white/[0.06] transition-all group-hover:-translate-y-0.5 group-hover:ring-violet-400/40">
                {p.cover ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={coverProxyUrl(p.cover, "netease")} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                ) : null}
              </span>
              <span className="mt-1.5 block truncate text-[12.5px] font-semibold text-zinc-200 group-hover:text-violet-200">{p.name}</span>
            </Link>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* ================= P1 B4：首页聚合区块（网易 homepage_block_page + QQ get_home_feed 双源合并） ================= */

function HomeBlocksRow() {
  const [blocks, setBlocks] = useState<DiscoverBlock[]>(blocksCache ?? []);

  useEffect(() => {
    if (blocksCache) {
      setBlocks(blocksCache);
      return;
    }
    let alive = true;
    apiDiscoverBlocks()
      .then((r) => {
        if (!alive) return;
        /* 审核整改 R2-F4：失败结果不写缓存 */
        if (r.error) return;
        blocksCache = r.blocks ?? [];
        setBlocks(blocksCache);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!blocks.length) return null;
  /* 每个区块取前 10 个歌单横滑；点击跳歌单详情 */
  return (
    <>
      {blocks.slice(0, 3).map((block) =>
        block.playlists?.length ? (
          <section key={block.key} aria-label={block.title}>
            <div className="mb-3 flex items-baseline gap-2">
              <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-zinc-100">
                <LayoutGrid className="h-4 w-4 text-violet-300" aria-hidden="true" /> {block.title}
              </h2>
              <span className="text-xs text-zinc-500">双源聚合</span>
            </div>
            <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 no-scrollbar">
              {block.playlists.slice(0, 10).map((p, i) => (
                <motion.div key={`${block.key}-${p.id}-${i}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.04, 0.35) }} className="w-[120px] shrink-0">
                  <Link href={`/playlist?id=${encodeURIComponent(p.id)}&source=${p.source}`} className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60" aria-label={`打开歌单 ${p.name}`}>
                    <span className="relative block aspect-square overflow-hidden rounded-2xl bg-zinc-800/80 ring-1 ring-white/[0.06] transition-all group-hover:-translate-y-0.5 group-hover:ring-violet-400/40">
                      {p.cover ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={coverProxyUrl(p.cover, p.source)} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                      ) : null}
                    </span>
                    <span className="mt-1.5 block truncate text-[12.5px] font-semibold text-zinc-200 group-hover:text-violet-200">{p.name}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-zinc-500">{p.creator || sourceMeta(p.source).label}</span>
                  </Link>
                </motion.div>
              ))}
            </div>
          </section>
        ) : null,
      )}
    </>
  );
}

function MyLikedRow() {
  const [playlists, setPlaylists] = useState<Playlist[]>(myLikedCache ?? []);

  useEffect(() => {
    if (myLikedCache) {
      setPlaylists(myLikedCache);
      return;
    }
    let alive = true;
    apiMyLikedPlaylists()
      .then((r) => {
        if (!alive) return;
        /* 审核整改 R2-F4：失败结果不写缓存（原失败空数组固化，用户误以为"没有收藏"） */
        if (r.error) return;
        myLikedCache = r.playlists ?? [];
        setPlaylists(myLikedCache);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!playlists.length) return null;
  const display = playlists.slice(0, 8);

  return (
    <section aria-label="我喜欢的视频歌单">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-zinc-100">
          <FolderHeart className="h-4 w-4 text-rose-300" aria-hidden="true" /> 我喜欢的视频歌单
        </h2>
        <span className="text-xs text-zinc-500">MLOG 合集</span>
      </div>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 no-scrollbar">
        {display.map((p, i) => (
          <motion.div key={`${p.id}-${i}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.04, 0.3) }} className="w-[120px] shrink-0">
            <a href={p.link} target="_blank" rel="noreferrer" className="group block rounded-2xl" aria-label={`在网易云打开 ${p.name}`}>
              <span className="relative block aspect-square overflow-hidden rounded-2xl bg-zinc-800/80 ring-1 ring-white/[0.06] transition-all group-hover:-translate-y-0.5 group-hover:ring-rose-400/40">
                {p.cover ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={coverProxyUrl(p.cover, "netease")} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                ) : null}
              </span>
              <span className="mt-1.5 block truncate text-[12.5px] font-semibold text-zinc-200 group-hover:text-rose-200">{p.name} ↗</span>
            </a>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

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
    fetchJSON<{ songs?: Song[]; need_login?: boolean; error?: string }>("/api/discover?kind=daily_songs")
      .then((r) => {
        if (!alive) return;
        /* 审核整改 R2-F4：未登录/失败结果不写缓存（防登录后仍读到空缓存的固化问题） */
        if (r.need_login || r.error) return;
        const list = r.songs ?? [];
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
