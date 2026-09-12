"use client";

/**
 * MV 播放弹窗：详情+直链并行获取（/api/mv），video 播放 + 元信息 + 源站外链
 * 供 /mv 与 /artist/[id] 歌手页 MV 区复用
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Clock3, ExternalLink, RefreshCw } from "lucide-react";
import { Modal } from "@/components/modal";
import { apiMvPlay } from "@/lib/client/api";
import { sourceMeta } from "@/lib/play-url";
import type { MvItem } from "@/lib/types";

export function formatPlayCount(n: number): string {
  if (!n || n <= 0) return "";
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}亿`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`;
  return String(n);
}

export function MvPlayModal({ mv, onClose }: { mv: MvItem | null; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState<MvItem | null>(null);

  useEffect(() => {
    if (!mv) {
      setUrl("");
      setError("");
      setMeta(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError("");
    setUrl("");
    setMeta(mv);
    apiMvPlay(mv.source, mv.id)
      .then((r) => {
        if (!alive) return;
        if (r.error) throw new Error(r.error);
        if (!r.url) throw new Error("未获取到播放链接");
        if (r.mv?.name) setMeta(r.mv);
        setUrl(r.url);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "播放失败");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [mv?.source, mv?.id]);

  const info = meta ?? mv;
  const plays = info ? formatPlayCount(info.play_count) : "";

  return (
    <Modal open={!!mv} onClose={onClose} maxWidth={760} title={info?.name || "MV 播放"}>
      <div className="overflow-hidden rounded-xl bg-black">
        <div className="relative aspect-video">
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <RefreshCw className="h-6 w-6 animate-spin text-zinc-500" aria-hidden="true" />
              <p className="text-xs text-zinc-500">正在获取播放链接…</p>
            </div>
          )}
          {error && !loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
              <AlertTriangle className="h-7 w-7 text-amber-300/80" aria-hidden="true" />
              <p className="text-[13px] leading-relaxed text-zinc-400">{error}</p>
            </div>
          )}
          {url && !error && (
            /* eslint-disable-next-line jsx-a11y/media-has-caption */
            <video src={url} className="h-full w-full" controls autoPlay playsInline preload="metadata" />
          )}
        </div>
      </div>
      {info && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-100">{info.name}</p>
            <p className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
              <span className="truncate">{info.artist || sourceMeta(info.source).label}</span>
              {plays && <span className="tabular-nums">{plays}次播放</span>}
              {info.publish_time && (
                <span className="flex items-center gap-0.5">
                  <Clock3 className="h-3 w-3" aria-hidden="true" />
                  {info.publish_time}
                </span>
              )}
            </p>
          </div>
          {info.link && (
            <a
              href={info.link}
              target="_blank"
              rel="noreferrer"
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 text-[12px] text-zinc-300 transition-colors hover:bg-white/[0.07]"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              源站
            </a>
          )}
        </div>
      )}
    </Modal>
  );
}
