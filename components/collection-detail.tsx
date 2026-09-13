"use client";

/**
 * 歌单 / 专辑详情共享视图（/playlist 与 /album 页复用）
 * 头部大卡（封面/名称/创建者/简介/曲目数）+ 全部播放 + 导入到我的歌单 + SongList
 */
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { ArrowLeft, Play, ListPlus, Loader2, Disc3, ExternalLink, CalendarDays, MessageSquareHeart } from "lucide-react";
import { SongCommentsModal } from "@/components/song-comments";
import { toast } from "sonner";
import { SongList } from "@/components/song-list";
import {
  apiPlaylistDetail,
  apiAlbumDetail,
  apiImportCollection,
  apiPlaylistTracksPage,
  type PlaylistDetailResponse,
} from "@/lib/client/api";
import { usePlayer } from "@/lib/client/store";
import { coverProxyUrl, sourceMeta } from "@/lib/play-url";

export function CollectionDetail({ kind }: { kind: "playlist" | "album" }) {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const source = params.get("source") ?? "";

  const [data, setData] = useState<PlaylistDetailResponse | null>(null);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  /* P1 C3：多资源评论区开关（comment_playlist/comment_album） */
  const [commentsOpen, setCommentsOpen] = useState(false);
  /* P1 C4：大歌单增量分页（playlist_track_all，网易专属） */
  const [loadingMore, setLoadingMore] = useState(false);
  /* 审核整改 R2-F14：已拉页码记录（detail 变化时重置） */
  const loadedPageRef = useRef(1);
  /* 审核整改 R2-F16：selector 订阅（原整库订阅在 currentTime 高频更新时详情页全量重渲染） */
  const play = usePlayer((s) => s.play);

  useEffect(() => {
    if (!id || !source) {
      setError("缺少 id 或 source 参数");
      return;
    }
    let alive = true;
    setData(null);
    setError("");
    loadedPageRef.current = 1;
    const req = kind === "album" ? apiAlbumDetail(source, id) : apiPlaylistDetail(source, id);
    req
      .then((r) => {
        if (!alive) return;
        if (r.error || !r.playlist) setError(r.error || (kind === "album" ? "专辑解析失败" : "歌单解析失败"));
        else setData(r);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "加载失败");
      });
    return () => {
      alive = false;
    };
  }, [id, source, kind]);

  const pl = data?.playlist ?? null;
  const songs = data?.songs ?? [];
  const dynamic = data?.dynamic;

  /* P1 C4：曲目数超出已加载量（网易大歌单）→ 增量分页续载（playlist_track_all） */
  const canLoadMore = kind === "playlist" && source === "netease" && !!pl && pl.track_count > songs.length && songs.length > 0;
  const loadMoreTracks = async () => {
    if (!data || loadingMore) return;
    setLoadingMore(true);
    try {
      /* 审核整改 R2-F14：独立页码记录（原按 songs.length/200 推算，去重后长度非整页倍数会重复请求已拉页） */
      const nextPage = loadedPageRef.current + 1;
      const r = await apiPlaylistTracksPage("netease", id, nextPage, 200);
      if (r.error) throw new Error(r.error);
      const incoming = r.songs ?? [];
      const seen = new Set(songs.map((s) => s.id));
      const merged = [...songs, ...incoming.filter((s) => !seen.has(s.id))];
      setData({ ...data, songs: merged });
      loadedPageRef.current = nextPage;
      if (!r.has_more) {
        toast.success(`已加载全部 ${merged.length} 首`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载更多失败");
    } finally {
      setLoadingMore(false);
    }
  };

  const onImport = async () => {
    if (!pl) return;
    setImporting(true);
    try {
      const r = await apiImportCollection({
        content_type: kind,
        source,
        external_id: id,
        name: pl.name,
        link: pl.link,
        description: pl.description,
        cover: pl.cover,
        creator: pl.creator,
        track_count: pl.track_count,
      });
      const err = (r as { error?: string }).error;
      if (err) {
        toast.error(err);
        return;
      }
      const view = () => router.push("/collections");
      if (r.duplicate) toast.info(`「${r.name}」已在你的歌单库中`, { action: { label: "查看", onClick: view } });
      else toast.success(`已导入「${r.name}」到我的歌单`, { action: { label: "查看", onClick: view } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "导入失败");
    } finally {
      setImporting(false);
    }
  };

  const meta = sourceMeta(source);
  /* 专辑发行信息（extra 中常见字段，缺省则不显示） */
  const extra = pl?.extra ?? {};
  const releaseInfo = ["publish_time", "publishTime", "release_date", "releaseDate", "date", "company"]
    .map((k) => extra[k])
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 lg:px-8 lg:py-10">
      {/* 返回 */}
      <button
        onClick={() => router.back()}
        className="-ml-2 mb-4 flex h-11 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-zinc-100"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> 返回
      </button>

      {error ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10">
            <Disc3 className="h-7 w-7 text-red-300/80" aria-hidden="true" />
          </span>
          <p className="max-w-sm text-sm leading-relaxed text-zinc-400">{error}</p>
          <p className="text-xs text-zinc-500">可以返回重试，或稍后再来</p>
        </div>
      ) : !data || !pl ? (
        <DetailSkeleton />
      ) : (
        <>
          {/* ---------- 头部大卡 ---------- */}
          <motion.section
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            aria-label={`${kind === "album" ? "专辑" : "歌单"}信息`}
            className="glass rounded-3xl border border-white/[0.1] p-4 lg:p-6"
          >
            <div className="flex flex-col gap-5 sm:flex-row">
              <div className="h-44 w-44 shrink-0 self-center overflow-hidden rounded-2xl bg-zinc-800/80 ring-1 ring-white/10 sm:self-start lg:h-52 lg:w-52">
                {pl.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <motion.img
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.4 }}
                    src={coverProxyUrl(pl.cover, pl.source)}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <Disc3 className="h-12 w-12 text-zinc-600" aria-hidden="true" />
                  </div>
                )}
              </div>

              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded border px-1.5 py-px text-[10px] ${meta.badge}`}>{meta.label}</span>
                  <span className="rounded border border-white/[0.1] bg-white/[0.04] px-1.5 py-px text-[10px] text-zinc-400">
                    {kind === "album" ? "专辑" : "歌单"}
                  </span>
                </div>
                <h1 className="mt-2 text-xl font-extrabold leading-snug text-zinc-50 lg:text-2xl">{pl.name}</h1>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
                  {pl.creator && <span>{kind === "album" ? "歌手" : "创建者"}：{pl.creator}</span>}
                  <span className="tabular-nums">{songs.length || pl.track_count || 0} 首</span>
                  {pl.play_count > 0 && <span className="tabular-nums">{formatCount(pl.play_count)} 次播放</span>}
                  {/* P1 B4：动态数徽标（playlist_detail_dynamic / album_detail_dynamic，网易） */}
                  {dynamic?.subscribed_count ? <span className="tabular-nums">{formatCount(dynamic.subscribed_count)} 收藏</span> : null}
                  {dynamic?.comment_count ? <span className="tabular-nums">{formatCount(dynamic.comment_count)} 评论</span> : null}
                  {dynamic?.share_count ? <span className="tabular-nums">{formatCount(dynamic.share_count)} 分享</span> : null}
                </p>
                {kind === "album" && releaseInfo && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-zinc-500">
                    <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {releaseInfo}
                  </p>
                )}
                {pl.description && (
                  <p className="lyric-mask mt-2.5 line-clamp-3 text-xs leading-relaxed text-zinc-500" title={pl.description}>{pl.description}</p>
                )}

                {/* 操作 */}
                <div className="mt-4 flex flex-wrap items-center gap-2.5">
                  <button
                    onClick={() => songs.length && play(songs[0], songs)}
                    disabled={!songs.length}
                    aria-label="播放全部"
                    className="flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-6 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/25 transition-all hover:brightness-110 active:scale-95 disabled:opacity-50"
                  >
                    <Play className="h-4 w-4" fill="currentColor" aria-hidden="true" /> 全部播放
                  </button>
                  <button
                    onClick={onImport}
                    disabled={importing}
                    className="flex h-11 items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] px-5 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.08] active:scale-95 disabled:opacity-50"
                  >
                    {importing ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <ListPlus className="h-4 w-4" aria-hidden="true" />
                    )}
                    导入到我的歌单
                  </button>
                  {/* P1 C3：多资源评论区（comment_playlist / comment_album，经 V2 通道） */}
                  {pl.source && (
                    <button
                      onClick={() => setCommentsOpen(true)}
                      aria-label="查看评论"
                      className="flex h-11 items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] px-5 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.08] active:scale-95"
                    >
                      <MessageSquareHeart className="h-4 w-4" aria-hidden="true" />
                      评论
                      {dynamic?.comment_count ? <span className="text-[11px] tabular-nums text-zinc-500">{formatCount(dynamic.comment_count)}</span> : null}
                    </button>
                  )}
                  {pl.link && (
                    <a
                      href={pl.link}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="在源站打开"
                      title="在源站打开"
                      className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.12] bg-white/[0.04] text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-zinc-100 active:scale-95"
                    >
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </a>
                  )}
                </div>
              </div>
            </div>
          </motion.section>

          {/* ---------- 曲目 ---------- */}
          <div className="mt-5">
            <div className="mb-3 mt-2 flex items-baseline gap-2">
              <h2 className="text-[15px] font-bold text-zinc-100">{kind === "album" ? "专辑曲目" : "歌单曲目"}</h2>
              <span className="text-xs tabular-nums text-zinc-500">{songs.length} 首</span>
            </div>
            {/* P1 C4：增量加载更多曲目（大歌单） */}
            {canLoadMore && (
              <button
                onClick={() => void loadMoreTracks()}
                disabled={loadingMore}
                className="mb-3 flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-2xl border border-white/[.08] text-[13px] text-zinc-400 transition-colors hover:border-violet-400/40 hover:text-zinc-100 disabled:opacity-60"
              >
                {loadingMore ? "加载中…" : `加载更多曲目（已 ${songs.length}/${pl?.track_count ?? "?"} 首）`}
              </button>
            )}
            <SongList
              songs={songs}
              emptyHint="没有获取到曲目，可能需要登录或该源暂时受限"
              onSongsChange={(next) => setData((prev) => (prev ? { ...prev, songs: next } : prev))}
            />
          </div>
        </>
      )}

      {/* P1 C3：多资源评论区（歌单/专辑，网易 comment_playlist/comment_album） */}
      <SongCommentsModal
        song={
          pl
            ? { source: pl.source, id: pl.id, name: pl.name, artist: "", album: "", duration: 0, size: 0, bitrate: 128, cover: pl.cover, link: pl.link }
            : null
        }
        open={commentsOpen}
        onClose={() => setCommentsOpen(false)}
        target={kind}
      />
    </div>
  );
}

/** Suspense fallback：头部卡 + 列表骨架 */
export function DetailFallback() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 lg:px-8 lg:py-10" aria-busy="true">
      <div className="mb-4 h-11 w-20 animate-pulse rounded-xl bg-white/[0.04]" />
      <div className="glass flex flex-col gap-5 rounded-3xl border border-white/[0.1] p-4 sm:flex-row lg:p-6">
        <div className="h-44 w-44 shrink-0 animate-pulse rounded-2xl bg-white/[0.05] lg:h-52 lg:w-52" />
        <div className="flex flex-1 flex-col gap-3 py-2">
          <div className="h-4 w-28 animate-pulse rounded bg-white/[0.05]" />
          <div className="h-7 w-2/3 animate-pulse rounded bg-white/[0.05]" />
          <div className="h-3.5 w-1/2 animate-pulse rounded bg-white/[0.04]" />
          <div className="h-3.5 w-5/6 animate-pulse rounded bg-white/[0.03]" />
          <div className="mt-2 flex gap-2.5">
            <div className="h-11 w-32 animate-pulse rounded-xl bg-white/[0.05]" />
            <div className="h-11 w-36 animate-pulse rounded-xl bg-white/[0.04]" />
          </div>
        </div>
      </div>
      <div className="mt-6 flex flex-col gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-[60px] animate-pulse rounded-xl bg-white/[0.035] lg:h-[52px]" style={{ animationDelay: `${i * 60}ms` }} />
        ))}
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return <DetailFallback />;
}

function formatCount(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}亿`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`;
  return String(n);
}
