"use client";

/**
 * 相似推荐弹窗：相似歌曲（点击整批入队）+ 包含此歌的歌单（跳 /playlist）
 * 网易 simi_song/simi_playlist · QQ GetSimilarSongs/GetRelatedPlaylist
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { AudioLines, ListMusic, Play } from "lucide-react";
import { Modal } from "@/components/modal";
import { apiSimilarSongs, apiRelatedPlaylists } from "@/lib/client/api";
import { usePlayer } from "@/lib/client/store";
import { coverProxyUrl } from "@/lib/play-url";
import { fmtTimeClient } from "@/lib/client/ui";
import type { Playlist, Song } from "@/lib/types";

export function SimilarModal({ song, open, onClose }: { song: Song | null; open: boolean; onClose: () => void }) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(false);
  const play = usePlayer((s) => s.play);
  const [playing, setPlaying] = useState<string | null>(null);

  const songKey = song ? `${song.source}:${song.id}` : "";

  useEffect(() => {
    if (!open || !song) return;
    let alive = true;
    setLoading(true);
    setSongs([]);
    setPlaylists([]);
    Promise.all([apiSimilarSongs(song), apiRelatedPlaylists(song)])
      .then(([sr, pr]) => {
        if (!alive) return;
        setSongs(sr.songs ?? []);
        setPlaylists(pr.playlists ?? []);
      })
      .catch(() => {
        /* 静默空态 */
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, songKey]);

  const onPlay = (s: Song) => {
    setPlaying(`${s.source}:${s.id}`);
    play(s, songs.length ? songs : [s]);
  };

  return (
    <Modal open={open && !!song} onClose={onClose} maxWidth={560} title={song ? `相似推荐 · ${song.name}` : "相似推荐"}>
      {loading ? (
        <div className="space-y-2 py-2" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="shimmer h-11 w-11 rounded-xl" />
              <div className="flex-1 space-y-1.5">
                <div className="shimmer h-3.5 w-2/3 rounded" />
                <div className="shimmer h-3 w-1/3 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : !songs.length && !playlists.length ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <AudioLines className="h-9 w-9 text-zinc-600" aria-hidden="true" />
          <p className="text-[13px] text-zinc-500">暂无相似推荐</p>
        </div>
      ) : (
        <div className="max-h-[56vh] space-y-5 overflow-y-auto pr-1">
          {/* 相似歌曲 */}
          {songs.length > 0 && (
            <section aria-label="相似歌曲">
              <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-zinc-300">
                <AudioLines className="h-4 w-4 text-violet-300/80" aria-hidden="true" /> 相似歌曲
                <span className="text-[11px] font-normal text-zinc-600">{songs.length} 首 · 点击播放</span>
              </h3>
              <ul className="space-y-1">
                {songs.map((s, i) => {
                  const isPlaying = playing === `${s.source}:${s.id}`;
                  return (
                    <motion.li
                      key={`${s.source}-${s.id}-${i}`}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.03, 0.3), duration: 0.2 }}
                    >
                      <button
                        onClick={() => onPlay(s)}
                        aria-label={`播放 ${s.name}`}
                        className={`group flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors ${
                          isPlaying ? "bg-violet-500/10 ring-1 ring-violet-400/25" : "hover:bg-white/[0.04]"
                        }`}
                      >
                        <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-zinc-800">
                          {s.cover ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={coverProxyUrl(s.cover, s.source)} alt="" loading="lazy" className="h-full w-full object-cover" />
                          ) : null}
                          <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/40">
                            <Play className="h-4 w-4 scale-90 fill-white text-white opacity-0 transition-all group-hover:scale-100 group-hover:opacity-100" aria-hidden="true" />
                          </span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="tip block truncate text-[13px] font-semibold text-zinc-200">
                            {s.name}
                            <span className="tip-bubble">
                              <span className="tip-name">{s.name}</span>
                              <span className="tip-sub">{s.artist}</span>
                            </span>
                          </span>
                          <span className="mt-0.5 block truncate text-[11.5px] text-zinc-500">{s.artist}</span>
                        </span>
                        <span className="shrink-0 text-[11px] tabular-nums text-zinc-600">{fmtTimeClient(s.duration)}</span>
                      </button>
                    </motion.li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* 包含此歌的歌单 */}
          {playlists.length > 0 && (
            <section aria-label="包含此歌的歌单">
              <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-zinc-300">
                <ListMusic className="h-4 w-4 text-fuchsia-300/80" aria-hidden="true" /> 包含此歌的歌单
              </h3>
              <div className="grid grid-cols-3 gap-2.5">
                {playlists.slice(0, 9).map((p) => (
                  <Link
                    key={`${p.source}-${p.id}`}
                    href={`/playlist?id=${encodeURIComponent(p.id)}&source=${p.source}`}
                    onClick={onClose}
                    className="group rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
                    aria-label={`打开歌单 ${p.name}`}
                  >
                    <span className="relative block aspect-square overflow-hidden rounded-xl bg-zinc-800 ring-1 ring-white/[0.06] transition-all group-hover:-translate-y-0.5 group-hover:ring-violet-400/40">
                      {p.cover ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={coverProxyUrl(p.cover, p.source)}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                      ) : null}
                    </span>
                    <span className="tip mt-1.5 block truncate text-[11.5px] font-medium text-zinc-300 group-hover:text-white">
                      {p.name}
                      <span className="tip-bubble">
                        <span className="tip-name">{p.name}</span>
                        <span className="tip-sub">{p.track_count} 首</span>
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}
