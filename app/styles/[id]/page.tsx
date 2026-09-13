"use client";

/**
 * 曲风详情 /styles/[id]（P1 B2）— 歌曲/专辑/歌手/歌单四 Tab 分页浏览。
 * 歌曲可点击入队列播放；专辑/歌单跳详情页；歌手跳歌手主页。
 */
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion } from "motion/react";
import { AudioWaveform, Play, Music2, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { PlaylistGrid } from "@/components/playlist-grid";
import { apiStyleMeta, apiStyleResource } from "@/lib/client/api";
import { usePlayer } from "@/lib/client/store";
import { coverProxyUrl } from "@/lib/play-url";
import { formatDuration, type StyleDetail, type Song, type Playlist, type Artist } from "@/lib/types";

type Tab = "song" | "album" | "artist" | "playlist";
const TABS: { key: Tab; label: string }[] = [
  { key: "song", label: "歌曲" },
  { key: "album", label: "专辑" },
  { key: "artist", label: "歌手" },
  { key: "playlist", label: "歌单" },
];

export default function StyleDetailPage() {
  return (
    <Suspense fallback={<div className="mx-auto w-full max-w-[1200px] px-4 py-10 lg:px-8"><div className="shimmer h-32 rounded-3xl" aria-busy="true" /></div>}>
      <StyleInner />
    </Suspense>
  );
}

function StyleInner() {
  const { id } = useParams<{ id: string }>();
  const styleId = decodeURIComponent(id ?? "");
  const [meta, setMeta] = useState<StyleDetail | null>(null);
  const [tab, setTab] = useState<Tab>("song");
  const [songs, setSongs] = useState<Song[]>([]);
  const [albums, setAlbums] = useState<Playlist[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const seqRef = useRef(0);
  /* 审核整改 C-09：selector 订阅 play */
  const play = usePlayer((s) => s.play);

  useEffect(() => {
    if (!styleId) return;
    apiStyleMeta(styleId)
      .then((r) => {
        /* 审核整改 C-12：头部加载失败可见反馈（原静默吞错） */
        if (r.error) toast.error(`曲风信息加载失败：${r.error}`);
        else setMeta(r.style ?? null);
      })
      .catch(() => toast.error("曲风信息加载失败，请稍后重试"));
  }, [styleId]);

  const load = useCallback(
    async (t: Tab, p: number, append: boolean) => {
      const seq = ++seqRef.current;
      setLoading(true);
      try {
        const r = await apiStyleResource(styleId, t, p, 30);
        if (seq !== seqRef.current) return;
        if (r.error) throw new Error(r.error);
        if (t === "song") setSongs((prev) => (append ? [...prev, ...(r.songs ?? [])] : r.songs ?? []));
        if (t === "album") setAlbums((prev) => (append ? [...prev, ...(r.albums ?? [])] : r.albums ?? []));
        if (t === "artist") setArtists((prev) => (append ? [...prev, ...(r.artists ?? [])] : r.artists ?? []));
        if (t === "playlist") setPlaylists((prev) => (append ? [...prev, ...(r.playlists ?? [])] : r.playlists ?? []));
        setHasMore(!!r.has_more);
      } catch (e) {
        if (seq === seqRef.current) toast.error(e instanceof Error ? e.message : "加载失败");
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    [styleId],
  );

  useEffect(() => {
    setPage(1);
    void load(tab, 1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, styleId]);

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 lg:px-8 lg:py-10">
      <PageHeader icon={AudioWaveform} title={meta?.name || "曲风详情"} subtitle={meta?.description || "该曲风下的歌曲、专辑、歌手与歌单"} />

      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="曲风资源">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`min-h-[40px] rounded-xl px-4 text-[13px] font-medium transition-colors ${
              tab === t.key
                ? "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/20"
                : "border border-white/[.08] bg-white/[0.02] text-zinc-400 hover:border-violet-400/40 hover:text-zinc-100"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-5" aria-busy={loading}>
        {tab === "song" ? (
          <>
            {loading && !songs.length ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="shimmer h-14 rounded-2xl" />
                ))}
              </div>
            ) : !songs.length ? (
              <p className="py-10 text-center text-[13px] text-zinc-500">该曲风暂无歌曲</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {songs.map((song, i) => (
                  <li key={`${song.id}-${i}`}>
                    <button
                      onClick={() => {
                        play(song, songs);
                        toast.success(`开始播放：${song.name}`);
                      }}
                      className="flex w-full items-center gap-2.5 rounded-2xl bg-white/[0.02] px-3 py-2 text-left transition-colors hover:bg-white/[0.05]"
                      aria-label={`播放 ${song.name}`}
                    >
                      <span className="w-6 text-center text-[12px] font-bold text-zinc-600">{i + 1}</span>
                      {song.cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={coverProxyUrl(song.cover, song.source)} alt="" loading="lazy" className="h-11 w-11 rounded-xl object-cover" />
                      ) : (
                        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.05]">
                          <Music2 className="h-4 w-4 text-zinc-500" aria-hidden="true" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <b className="block truncate text-[13px] text-zinc-200">{song.name}</b>
                        <span className="block truncate text-[11px] text-zinc-500">{song.artist}</span>
                      </span>
                      <span className="shrink-0 text-[11px] text-zinc-600">{formatDuration(song.duration)}</span>
                      <Play className="h-4 w-4 shrink-0 text-zinc-600" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : tab === "album" ? (
          <PlaylistGrid playlists={albums} loading={loading && !albums.length} kind="album" emptyHint="该曲风暂无专辑" hrefOf={(p) => `/album?id=${encodeURIComponent(p.id)}&source=netease`} />
        ) : tab === "playlist" ? (
          <PlaylistGrid playlists={playlists} loading={loading && !playlists.length} emptyHint="该曲风暂无歌单" hrefOf={(p) => `/playlist?id=${encodeURIComponent(p.id)}&source=netease`} />
        ) : (
          <>
            {loading && !artists.length ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-busy="true">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="shimmer aspect-square rounded-2xl" />
                ))}
              </div>
            ) : !artists.length ? (
              <p className="py-10 text-center text-[13px] text-zinc-500">该曲风暂无歌手</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {artists.map((a, i) => (
                  <motion.div key={a.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.4) }}>
                    <Link href={`/artist/${a.id}?source=netease`} className="group block text-center" aria-label={`查看歌手 ${a.name}`}>
                      <div className="mx-auto aspect-square w-full max-w-[140px] overflow-hidden rounded-full bg-zinc-800/80 ring-1 ring-white/[0.06] transition-all group-hover:ring-violet-400/40">
                        {a.avatar ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={coverProxyUrl(a.avatar, "netease")} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]" />
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            <Music2 className="h-8 w-8 text-zinc-600" aria-hidden="true" />
                          </div>
                        )}
                      </div>
                      <p className="mt-2 truncate text-[13px] font-semibold text-zinc-200 group-hover:text-fuchsia-200">{a.name}</p>
                      {a.alias && <p className="truncate text-[11px] text-zinc-500">{a.alias}</p>}
                    </Link>
                  </motion.div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {hasMore && !loading && (
        <button
          onClick={() => {
            const next = page + 1;
            setPage(next);
            void load(tab, next, true);
          }}
          className="mt-4 flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-2xl border border-white/[.08] text-[13px] text-zinc-400 transition-colors hover:border-violet-400/40 hover:text-zinc-100"
        >
          <ChevronDown className="h-4 w-4" aria-hidden="true" /> 加载更多
        </button>
      )}
    </div>
  );
}
