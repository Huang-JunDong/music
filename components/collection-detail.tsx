"use client";

/**
 * 歌单 / 专辑详情共享视图（/playlist 与 /album 页复用）
 * 头部大卡（封面/名称/创建者/简介/曲目数）+ 全部播放 + 导入到我的歌单 + SongList
 */
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { ArrowLeft, Play, ListPlus, Loader2, Disc3, ExternalLink, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { SongList } from "@/components/song-list";
import {
  apiPlaylistDetail,
  apiAlbumDetail,
  apiImportCollection,
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
  const { play } = usePlayer();

  useEffect(() => {
    if (!id || !source) {
      setError("缺少 id 或 source 参数");
      return;
    }
    let alive = true;
    setData(null);
    setError("");
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
                </p>
                {kind === "album" && releaseInfo && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-zinc-500">
                    <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {releaseInfo}
                  </p>
                )}
                {pl.description && (
                  <p className="lyric-mask mt-2.5 line-clamp-3 text-xs leading-relaxed text-zinc-500">{pl.description}</p>
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
            <SongList
              songs={songs}
              emptyHint="没有获取到曲目，可能需要登录或该源暂时受限"
              onSongsChange={(next) => setData((prev) => (prev ? { ...prev, songs: next } : prev))}
            />
          </div>
        </>
      )}
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
