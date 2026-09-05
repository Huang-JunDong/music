"use client";

/** 歌单网格：响应式 2-6 列，封面悬浮上移动效 + 播放次数 */
import Link from "next/link";
import { motion } from "motion/react";
import { Play, Music4, Users } from "lucide-react";
import type { Playlist } from "@/lib/types";
import { coverProxyUrl, sourceMeta } from "@/lib/play-url";

export function PlaylistGrid({
  playlists,
  hrefOf,
  loading,
  emptyHint,
}: {
  playlists: Playlist[];
  /** 生成点击目标链接 */
  hrefOf?: (p: Playlist) => string;
  loading?: boolean;
  emptyHint?: string;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6" role="status">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} style={{ animationDelay: `${i * 50}ms` }}>
            <div className="shimmer aspect-square rounded-2xl" />
            <div className="shimmer mt-2 h-3.5 w-3/4 rounded" />
            <div className="shimmer mt-1.5 h-3 w-1/2 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (!playlists.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.04]">
          <Music4 className="h-7 w-7 text-zinc-500" />
        </span>
        <p className="text-sm text-zinc-500">{emptyHint ?? "暂无歌单"}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
      {playlists.map((p, i) => {
        const meta = sourceMeta(p.source);
        const href = hrefOf ? hrefOf(p) : `/playlist?id=${encodeURIComponent(p.id)}&source=${p.source}`;
        return (
          <motion.div
            key={`${p.source}-${p.id}-${i}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.03, 0.45), duration: 0.3, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <Link
              href={href}
              className="group block"
              aria-label={`打开歌单 ${p.name}`}
            >
              <div className="card-glow relative aspect-square overflow-hidden rounded-2xl bg-zinc-800/80 ring-1 ring-white/[0.06] transition-all duration-300 group-hover:-translate-y-0.5 group-hover:ring-violet-400/40 group-hover:shadow-xl group-hover:shadow-fuchsia-500/10">
                {p.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={coverProxyUrl(p.cover, p.source)}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <Music4 className="h-10 w-10 text-zinc-600" aria-hidden="true" />
                  </div>
                )}
                <span className={`absolute left-2 top-2 rounded border px-1.5 py-px text-[10px] backdrop-blur ${meta.badge}`}>{meta.label}</span>
                {p.play_count > 0 && (
                  <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] text-zinc-200 backdrop-blur">
                    <Users className="h-3 w-3" aria-hidden="true" />
                    {formatPlayCount(p.play_count)}
                  </span>
                )}
                <span className="absolute bottom-2 right-2 flex h-9 w-9 translate-y-2 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white opacity-0 shadow-lg shadow-fuchsia-500/40 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
                  <Play className="ml-0.5 h-4 w-4" fill="currentColor" />
                </span>
              </div>
              <div className="tip mt-2 w-full">
                <p className="truncate text-[13px] font-semibold text-zinc-200 transition-colors group-hover:text-fuchsia-200">{p.name}</p>
                <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                  {p.track_count > 0 ? `${p.track_count} 首` : ""}
                  {p.creator ? `${p.track_count > 0 ? " · " : ""}${p.creator}` : ""}
                </p>
                {/* 悬浮完整歌单名（PC 精确指针设备；触屏不触发） */}
                <span className="tip-bubble" aria-hidden="true">
                  <span className="tip-name">{p.name}</span>
                  <span className="tip-sub">
                    {[p.track_count > 0 ? `${p.track_count} 首` : "", p.creator, meta.label].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </div>
            </Link>
          </motion.div>
        );
      })}
    </div>
  );
}

function formatPlayCount(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}亿`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`;
  return String(n);
}
