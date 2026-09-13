"use client";

/**
 * MV 播放弹窗：详情+直链并行获取（/api/mv），video 播放 + 元信息 + 源站外链
 * 供 /mv 与 /artist/[id] 歌手页 MV 区复用。
 * P1 C7：网易 MV 增加收藏按钮（mv_sub）与"相似 MV"侧栏（simi_mv）。
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Clock3, ExternalLink, RefreshCw, Bookmark, BookmarkCheck, Play, MessageSquareHeart } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/modal";
import { SongCommentsModal } from "@/components/song-comments";
import { apiMvPlay, apiSubMv, apiSimilarMvs, apiVideoPlay, apiRelatedVideos, apiSubbedMvs } from "@/lib/client/api";
import { sourceMeta, coverProxyUrl } from "@/lib/play-url";
import { usePlayer } from "@/lib/client/store";
import type { MvItem } from "@/lib/types";

export function formatPlayCount(n: number): string {
  if (!n || n <= 0) return "";
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}亿`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`;
  return String(n);
}

export function MvPlayModal({ mv, onClose, onPlaySimilar }: { mv: MvItem | null; onClose: () => void; onPlaySimilar?: (mv: MvItem) => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState<MvItem | null>(null);
  /* P1 C7：收藏状态 + 相似 MV */
  const [subbed, setSubbed] = useState(false);
  const [subBusy, setSubBusy] = useState(false);
  const [similars, setSimilars] = useState<MvItem[]>([]);
  /* P1 C3：MV/视频评论区（comment_mv / comment_video） */
  const [commentsOpen, setCommentsOpen] = useState(false);

  useEffect(() => {
    if (!mv) {
      setUrl("");
      setError("");
      setMeta(null);
      setSubbed(false);
      setSimilars([]);
      return;
    }
    let alive = true;
    setLoading(true);
    setError("");
    setUrl("");
    setMeta(mv);
    setSubbed(false);
    setSimilars([]);
    /* P1 C7：video（R_VI 体系）与 MV 是两套 id——按 extra.kind 分发播放与相关推荐链路 */
    const isVideo = mv.extra?.kind === "video";
    /* 审核整改 R2-F9：打开时按收藏列表回查状态（原恒 false，已收藏 MV 再点击实际执行取消收藏且 UI 颠倒）。
       三审 R3 登记取舍：上游 mv_sublist 上限 100/页，仅回查第一页——第 101+ 条收藏的 MV
       显示"未收藏"（行为保守正确：点击执行收藏而非误取消）。 */
    if (!isVideo && mv.source === "netease") {
      apiSubbedMvs(1, 100)
        .then((r) => {
          if (alive && !r.error && r.mvs?.some((m) => m.id === mv.id)) setSubbed(true);
        })
        .catch(() => undefined);
    }
    /* 审核整改 R2-F17：视频与全局音频并发叠加，打开弹窗时暂停背景音乐 */
    const st = usePlayer.getState();
    if (st.playing) st.toggle();
    (isVideo
      ? apiVideoPlay(mv.id).then((r) => ({ mv: r.video ?? undefined, url: r.url, error: r.error }))
      : apiMvPlay(mv.source, mv.id)
    )
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
    /* 相似内容：MV → simi_mv；视频 → related_allvideo（网易专属；失败静默隐藏侧栏） */
    if (mv.source === "netease") {
      (isVideo ? apiRelatedVideos(mv.id).then((r) => r.related ?? []) : apiSimilarMvs(mv.id).then((r) => r.mvs ?? []))
        .then((list) => alive && setSimilars(list.slice(0, 6)))
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [mv?.source, mv?.id, mv?.extra?.kind]);

  const toggleSub = async () => {
    if (!mv || subBusy) return;
    const next = !subbed;
    setSubbed(next); /* 乐观更新 */
    setSubBusy(true);
    try {
      await apiSubMv(mv.id, next);
      toast.success(next ? "已收藏该 MV" : "已取消收藏");
    } catch (e) {
      setSubbed(!next); /* 回滚 */
      toast.error(e instanceof Error ? e.message : "操作失败");
    } finally {
      setSubBusy(false);
    }
  };

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
          {/* P1 C3：MV/视频评论区（comment_mv / comment_video，网易） */}
          {info.source === "netease" && (
            <button
              onClick={() => setCommentsOpen(true)}
              aria-label="查看评论"
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 text-[12px] text-zinc-300 transition-colors hover:border-violet-400/40 hover:text-violet-200"
            >
              <MessageSquareHeart className="h-3.5 w-3.5" aria-hidden="true" /> 评论
            </button>
          )}
          {/* P1 C7：收藏 MV（mv_sub，网易专属） */}
          {info.source === "netease" && (
            <button
              onClick={toggleSub}
              disabled={subBusy}
              aria-pressed={subbed}
              aria-label={subbed ? "取消收藏该 MV" : "收藏该 MV"}
              className={`flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[12px] font-medium transition-colors disabled:opacity-60 ${
                subbed
                  ? "border-rose-400/40 bg-rose-500/15 text-rose-200"
                  : "border-white/[0.1] bg-white/[0.03] text-zinc-300 hover:border-rose-400/40 hover:text-rose-200"
              }`}
            >
              {subbed ? <BookmarkCheck className="h-3.5 w-3.5" aria-hidden="true" /> : <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />}
              {subbed ? "已收藏" : "收藏"}
            </button>
          )}
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

      {/* P1 C7：相似 MV 侧栏（simi_mv，网易专属；点击切换播放） */}
      {info?.source === "netease" && similars.length > 0 && (
        <div className="mt-4" aria-label="相似 MV">
          <p className="mb-2 text-[12px] font-semibold tracking-wide text-zinc-500">相似 MV</p>
          <div className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1">
            {similars.map((m, i) => (
              <button
                key={`${m.id}-${i}`}
                onClick={() => onPlaySimilar?.(m)}
                aria-label={`播放相似 MV ${m.name}`}
                className="group w-[150px] shrink-0 text-left"
              >
                <span className="relative block aspect-video overflow-hidden rounded-xl bg-zinc-800/80 ring-1 ring-white/[0.06] transition-all group-hover:-translate-y-0.5 group-hover:ring-rose-400/40">
                  {m.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={coverProxyUrl(m.cover, "netease")} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                  ) : null}
                  <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/30">
                    <Play className="h-6 w-6 scale-90 fill-white/90 text-white/90 opacity-0 transition-all group-hover:scale-100 group-hover:opacity-100" aria-hidden="true" />
                  </span>
                </span>
                <span className="mt-1 block truncate text-[12px] font-medium text-zinc-300 group-hover:text-rose-200">{m.name}</span>
                <span className="block truncate text-[11.5px] text-zinc-500">{m.artist}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* P1 C3：MV/视频评论区（网易 comment_mv / comment_video，按 extra.kind 分发） */}
      <SongCommentsModal
        song={
          info
            ? { source: info.source, id: info.id, name: info.name, artist: info.artist, album: "", duration: info.duration, size: 0, bitrate: 128, cover: info.cover, link: info.link ?? "" }
            : null
        }
        open={commentsOpen}
        onClose={() => setCommentsOpen(false)}
        target={info?.extra?.kind === "video" ? "video" : "mv"}
      />
    </Modal>
  );
}
