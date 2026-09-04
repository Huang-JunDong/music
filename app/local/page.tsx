"use client";

/**
 * 本地音乐库：分页浏览（Web 每页条数 / PgUp·PgDn / URL ?page= 状态）/ 多文件上传 /
 * 重复检测分组（可删除）/ 硬删除（二次确认）
 * 后端扫描快照缓存 10s + 过期后台异步刷新（refreshing 横幅提示）；
 * 分页切换时取消旧请求并保留最后一次结果，对短暂网络错误自动重试一次。
 */
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import {
  RefreshCw,
  Upload,
  Copy,
  Download,
  Trash2,
  Play,
  FileMusic,
  FolderOpen,
  HardDrive,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/modal";
import { PageHeader } from "@/components/page-header";
import {
  apiLocalMusic,
  apiUploadLocalMusic,
  apiDeleteLocalMusic,
  apiLocalDuplicates,
  apiSettings,
  type LocalMusicResponse,
  type LocalTrack,
} from "@/lib/client/api";
import { useShallow } from "zustand/react/shallow";
import { usePlayer } from "@/lib/client/store";
import { coverProxyUrl } from "@/lib/play-url";
import { fmtTimeClient } from "@/lib/client/ui";
import type { Song } from "@/lib/types";

type DupGroup = Awaited<ReturnType<typeof apiLocalDuplicates>>["groups"][number];
type DupSong = DupGroup["songs"][number];

const FALLBACK_PAGE_SIZE = 50;
const DUP_PAGE_SIZE = 20;

/** LocalTrack → Song */
function trackToSong(t: LocalTrack): Song {
  return {
    id: t.id,
    name: t.name,
    artist: t.artist,
    album: t.album,
    duration: t.duration,
    size: t.size,
    bitrate: 0,
    source: "local",
    url: "",
    cover: t.cover,
    link: "",
    ext: t.ext,
    extra: t.extra,
  };
}

export default function LocalMusicPage() {
  return (
    <Suspense fallback={<LocalMusicSkeleton />}>
      <LocalMusicInner />
    </Suspense>
  );
}

function LocalMusicSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 lg:px-8 lg:py-10" aria-busy="true">
      <div className="mb-5 h-11 w-48 animate-pulse rounded-xl bg-white/[0.04]" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-[68px] animate-pulse rounded-2xl bg-white/[0.035]" style={{ animationDelay: `${i * 60}ms` }} />
        ))}
      </div>
    </div>
  );
}

function LocalMusicInner() {
  const params = useSearchParams();
  const initialPage = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);

  const [resp, setResp] = useState<LocalMusicResponse | null>(null);
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState<number | null>(null); // null = 读取设置中
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<LocalTrack | null>(null);
  const [busyDelete, setBusyDelete] = useState(false);
  const [uploading, setUploading] = useState(false);
  /** 审核整改 A-28：加载失败态（区别于空态） */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dupOpen, setDupOpen] = useState(false);
  const [dups, setDups] = useState<DupGroup[] | null>(null);
  const [dupLoading, setDupLoading] = useState(false);
  const [dupPage, setDupPage] = useState(1);
  const [dupTotalPages, setDupTotalPages] = useState(1);
  const [dupTotal, setDupTotal] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  /* 请求竞态：序号 + AbortController，保留最后一次请求结果 */
  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  /* useShallow 精确订阅：播放中 currentTime 4-8Hz 更新不再触发整页（单页最多 200 行）重渲染 */
  const { queue, index, playing, play, toggle } = usePlayer(
    useShallow((s) => ({
      queue: s.queue,
      index: s.index,
      playing: s.playing,
      play: s.play,
      toggle: s.toggle,
    })),
  );
  const currentSong = index >= 0 ? queue[index] : null;
  const isCurrent = (t: LocalTrack) => currentSong?.id === t.id && currentSong?.source === "local";

  /* ---------- 读取「Web 每页条数」设置 ---------- */
  useEffect(() => {
    let alive = true;
    apiSettings()
      .then((st) => {
        if (!alive) return;
        const n = Number((st as { webPageSize?: unknown }).webPageSize);
        setPageSize(Number.isFinite(n) && n >= 10 ? Math.min(200, Math.trunc(n)) : FALLBACK_PAGE_SIZE);
      })
      .catch(() => alive && setPageSize(FALLBACK_PAGE_SIZE));
    return () => {
      alive = false;
    };
  }, []);

  /* ---------- 分页加载（取消旧请求 + 过期响应丢弃 + 短暂网络错误重试一次） ---------- */
  const loadPage = useCallback(
    async (targetPage: number, opts: { refresh?: boolean } = {}) => {
      const size = pageSize ?? FALLBACK_PAGE_SIZE;
      const seq = ++seqRef.current;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      const query = { offset: (targetPage - 1) * size, limit: size, refresh: opts.refresh };
      const attempt = (): Promise<LocalMusicResponse> =>
        apiLocalMusic({ ...query, signal: ac.signal }).catch((e: unknown) => {
          if (ac.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) throw e;
          // 短暂网络错误（Failed to fetch 等）延迟重试一次
          return new Promise((resolve, reject) => {
            setTimeout(() => {
              apiLocalMusic({ ...query, signal: ac.signal }).then(resolve, reject);
            }, 400);
          });
        });
      try {
        const r = await attempt();
        if (seq !== seqRef.current || ac.signal.aborted) return; // 已有更新请求，丢弃
        setResp(r);
        setLoadError(null);
        setPage(targetPage);
        // URL ?page= 状态保持
        window.history.replaceState(null, "", targetPage > 1 ? `/local?page=${targetPage}` : "/local");
        if (opts.refresh) toast.success(r.exists ? `已重新扫描 · 共 ${r.total} 首` : "目录为空或不存在");
      } catch (e) {
        if (seq !== seqRef.current || ac.signal.aborted) return;
        // 审核整改 A-28：失败态持久展示（区别于空态），不再误导"还没有本地音乐"
        const message = e instanceof Error ? e.message : "加载本地音乐失败";
        setLoadError(message);
        toast.error(message);
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    [pageSize],
  );

  /* 设置就绪后按初始页加载 */
  useEffect(() => {
    if (pageSize !== null) void loadPage(initialPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize]);

  const tracks = resp?.tracks ?? [];
  const totalPages = Math.max(1, Math.ceil((resp?.total ?? 0) / (pageSize ?? FALLBACK_PAGE_SIZE)));

  const goPage = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(1, next), totalPages);
      if (clamped !== page || resp === null) void loadPage(clamped);
    },
    [totalPages, page, resp, loadPage],
  );

  /* PgUp / PgDn 快捷翻页（焦点在输入框时不触发） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "PageUp" && e.key !== "PageDown") return;
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable) return;
      e.preventDefault();
      if (e.key === "PageDown") goPage(page + 1);
      else goPage(page - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPage, page]);

  /* ---------- 上传（多文件循环；上传后缓存失效，重扫当前页） ---------- */
  const onUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    let ok = 0;
    let fail = 0;
    for (const f of Array.from(files)) {
      const tid = toast.loading(`上传中：${f.name}`);
      try {
        await apiUploadLocalMusic(f);
        ok += 1;
        toast.success(`已上传：${f.name}`, { id: tid });
      } catch (e) {
        fail += 1;
        toast.error(`${f.name}：${e instanceof Error ? e.message : "上传失败"}`, { id: tid });
      }
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    if (ok > 0) {
      setDups(null); // 索引与缓存由后端自动同步失效
      await loadPage(1, { refresh: true });
    }
    if (fail > 0) toast.error(`${fail} 个文件上传失败`);
  };

  /* ---------- 重复检测（分页拉取，删除后刷新） ---------- */
  const loadDups = useCallback(async (p: number) => {
    setDupLoading(true);
    try {
      const r = await apiLocalDuplicates(p, DUP_PAGE_SIZE);
      setDups(r.groups ?? []);
      setDupPage(r.page ?? p);
      setDupTotalPages(r.total_pages ?? 1);
      setDupTotal(r.total ?? 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "重复检测失败");
      setDupOpen(false);
    } finally {
      setDupLoading(false);
    }
  }, []);

  const toggleDup = async () => {
    const next = !dupOpen;
    setDupOpen(next);
    if (next && dups === null) await loadDups(1);
  };

  /* ---------- 下载 / 删除 ---------- */
  const downloadTrack = (t: LocalTrack) => {
    const a = document.createElement("a");
    a.href = `/api/download?source=local&id=${encodeURIComponent(t.id)}&download=1`;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.success(`开始下载：${t.name}`);
  };

  const onDelete = async () => {
    const target = deleting;
    if (!target) return;
    setBusyDelete(true);
    try {
      const r = await apiDeleteLocalMusic(target.id);
      const err = (r as { error?: string }).error;
      if (err) throw new Error(err);
      toast.success(`已删除：${target.name}`);
      setDeleting(null);
      setDups(null); // 重复分组可能变化，重新打开时再拉
      // 当前页删空时回退上一页，否则重载当前页（后端缓存已失效会重扫）
      const remain = (resp?.total ?? 1) - 1;
      const size = pageSize ?? FALLBACK_PAGE_SIZE;
      const targetPage = remain > 0 && Math.ceil(remain / size) < page ? page - 1 : page;
      await loadPage(Math.max(1, targetPage));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusyDelete(false);
    }
  };

  const playTrack = (t: LocalTrack) => {
    const song = trackToSong(t);
    if (isCurrent(t)) toggle();
    else play(song, tracks.map(trackToSong));
  };

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 lg:px-8 lg:py-10">
      {/* ---------- 页头（统一 PageHeader）+ 操作 ---------- */}
      <PageHeader
        icon={HardDrive}
        title="本地音乐"
        subtitle={
          resp ? (
            <>
              共 <span className="tabular-nums text-zinc-300">{resp.total}</span> 首
              {resp.download_dir && <span className="ml-1.5 break-all text-zinc-500">· {resp.download_dir}</span>}
            </>
          ) : (
            "加载中…"
          )
        }
        actions={
          <>
            <button
              onClick={() => void loadPage(page, { refresh: true })}
              disabled={loading}
              className="glass flex h-11 items-center gap-2 rounded-xl border border-white/[0.1] px-4 text-[13px] font-medium text-zinc-200 transition-colors hover:border-violet-400/30 disabled:opacity-50 active:scale-95"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" /> 刷新
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 text-[13px] font-semibold text-white shadow-lg shadow-fuchsia-500/25 transition-all hover:brightness-110 active:scale-95 disabled:opacity-50"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
              {uploading ? "上传中…" : "上传音乐"}
            </button>
            <button
              onClick={toggleDup}
              aria-expanded={dupOpen}
              className={`glass flex h-11 items-center gap-2 rounded-xl border px-4 text-[13px] font-medium transition-colors active:scale-95 ${
                dupOpen ? "border-amber-400/30 text-amber-200" : "border-white/[0.1] text-zinc-200 hover:border-violet-400/30"
              }`}
            >
              <Copy className="h-4 w-4" aria-hidden="true" /> 重复检测
            </button>
          </>
        }
      />
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="audio/*,.mp3,.flac,.m4a,.aac,.ogg,.wav,.wma"
        className="hidden"
        onChange={(e) => {
          void onUpload(e.target.files);
        }}
      />

      {/* ---------- 后台刷新提示（缓存过期：立即返回旧结果 + 后台异步重扫） ---------- */}
      {resp?.refreshing && (
        <div className="mb-4 flex items-center gap-2.5 rounded-2xl border border-cyan-500/15 bg-cyan-500/[0.06] px-4 py-3 text-[13px] text-cyan-200/85">
          <RefreshCw className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
          正在后台刷新本地音乐列表，当前显示上次扫描结果
        </div>
      )}

      {/* ---------- 目录不存在提示 ---------- */}
      {resp && resp.exists === false && (
        <div className="mb-4 flex items-start gap-2.5 rounded-2xl border border-amber-500/15 bg-amber-500/[0.06] px-4 py-3.5 text-[13px] leading-relaxed text-amber-200/85">
          <FolderOpen className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            下载目录不存在或为空{resp.download_dir ? `（${resp.download_dir}）` : ""}。可以
            <button onClick={() => fileRef.current?.click()} className="mx-1 underline underline-offset-2 hover:text-amber-100">
              上传音乐
            </button>
            ，或在
            <Link href="/settings" className="mx-1 underline underline-offset-2 hover:text-amber-100">
              设置页
            </Link>
            调整下载目录。
          </span>
        </div>
      )}

      {/* ---------- 重复检测面板（分组 + 行内删除 + 分页） ---------- */}
      <AnimatePresence initial={false}>
        {dupOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28 }}
            className="overflow-hidden"
          >
            <div className="mb-5 rounded-3xl border border-white/[0.07] bg-white/[0.015] p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-[13px] font-bold text-zinc-200">重复曲目（同名同歌手多版本）</p>
                {dupTotal > 0 && <p className="text-[11px] tabular-nums text-zinc-500">{dupTotal} 组</p>}
              </div>
              {dupLoading ? (
                <div className="flex flex-col gap-2" role="status" aria-label="重复检测中">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-[52px] animate-pulse rounded-xl bg-white/[0.035]" />
                  ))}
                </div>
              ) : !dups || dups.length === 0 ? (
                <p className="py-4 text-center text-sm text-zinc-500">没有检测到重复曲目</p>
              ) : (
                <>
                  <div className="flex flex-col gap-2">
                    {dups.map((g, gi) => (
                      <DupGroupCard
                        key={`${g.name}-${g.artist}-${gi}`}
                        group={g}
                        open={expanded === gi}
                        onToggle={() => setExpanded(expanded === gi ? null : gi)}
                        onDelete={(song) => setDeleting(trackFromDup(song))}
                      />
                    ))}
                  </div>
                  {dupTotalPages > 1 && (
                    <div className="mt-3 flex items-center justify-center gap-2">
                      <button
                        onClick={() => void loadDups(Math.max(1, dupPage - 1))}
                        disabled={dupPage <= 1 || dupLoading}
                        className="flex h-10 items-center gap-1 rounded-xl border border-white/[0.1] bg-white/[0.03] px-3.5 text-[12.5px] text-zinc-300 transition-colors hover:bg-white/[0.07] disabled:opacity-40 active:scale-95"
                      >
                        <ChevronLeft className="h-4 w-4" aria-hidden="true" /> 上一页
                      </button>
                      <span className="text-xs tabular-nums text-zinc-500">
                        {dupPage} / {dupTotalPages} 页
                      </span>
                      <button
                        onClick={() => void loadDups(Math.min(dupTotalPages, dupPage + 1))}
                        disabled={dupPage >= dupTotalPages || dupLoading}
                        className="flex h-10 items-center gap-1 rounded-xl border border-white/[0.1] bg-white/[0.03] px-3.5 text-[12.5px] text-zinc-300 transition-colors hover:bg-white/[0.07] disabled:opacity-40 active:scale-95"
                      >
                        下一页 <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- 曲目列表（分页） ---------- */}
      {resp === null && loading ? (
        <div className="flex flex-col gap-2" role="status" aria-label="加载中">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-[68px] animate-pulse rounded-2xl bg-white/[0.035]" style={{ animationDelay: `${i * 60}ms` }} />
          ))}
        </div>
      ) : loadError ? (
        /* 审核整改 A-28：失败态错误卡 + 重试入口（区别于空态） */
        <div className="flex flex-col items-center gap-3 py-16 text-center" role="alert">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10">
            <TriangleAlert className="h-7 w-7 text-red-300/80" aria-hidden="true" />
          </span>
          <p className="max-w-sm text-sm leading-relaxed text-red-300/90">{loadError}</p>
          <button
            onClick={() => void loadPage(1, { refresh: true })}
            className="mt-1 flex h-11 items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] px-5 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.08] active:scale-95"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> 重新加载
          </button>
        </div>
      ) : tracks.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.04]">
            <FolderOpen className="h-7 w-7 text-zinc-500" aria-hidden="true" />
          </span>
          <p className="text-sm text-zinc-400">{resp?.exists === false ? "目录不存在或为空" : "还没有本地音乐"}</p>
          <p className="max-w-sm text-xs leading-relaxed text-zinc-500">
            上传音乐文件，或先在搜索页下载几首歌，它们会自动出现在这里
          </p>
          <div className="mt-1 flex flex-wrap justify-center gap-2.5">
            <button
              onClick={() => fileRef.current?.click()}
              className="flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/25 hover:brightness-110 active:scale-95"
            >
              <Upload className="h-4 w-4" aria-hidden="true" /> 上传音乐
            </button>
            <Link
              href="/settings"
              className="flex h-11 items-center rounded-xl border border-white/[0.12] bg-white/[0.03] px-5 text-sm font-medium text-zinc-300 hover:bg-white/[0.07] active:scale-95"
            >
              去设置
            </Link>
          </div>
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-1.5" aria-label="本地音乐列表">
            {tracks.map((t, i) => {
              const cur = isCurrent(t);
              return (
                <motion.li
                  key={t.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.025, 0.5), duration: 0.26 }}
                  className={`flex min-h-[68px] items-center gap-3 rounded-2xl px-3 py-2 transition-colors ${
                    cur ? "bg-gradient-to-r from-violet-500/[0.16] to-fuchsia-500/[0.08] ring-1 ring-violet-400/25" : "bg-white/[0.03] hover:bg-white/[0.05]"
                  }`}
                >
                  <button
                    onClick={() => playTrack(t)}
                    aria-label={`播放 ${t.name}`}
                    className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-zinc-800"
                  >
                    {t.cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={coverProxyUrl(t.cover, t.source)} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <FileMusic className="h-5 w-5 text-zinc-600" aria-hidden="true" />
                    )}
                    <span
                      className={`absolute inset-0 flex items-center justify-center bg-black/50 transition-opacity ${
                        cur ? "opacity-100" : "opacity-0 hover:opacity-100"
                      }`}
                    >
                      {cur && playing ? (
                        <span className="flex items-end gap-[2px]" aria-hidden="true">
                          {[0, 1, 2].map((k) => (
                            <span key={k} className="eq-bar h-3 w-[2.5px] rounded-full bg-fuchsia-300" style={{ animationDelay: `${k * 0.18}s` }} />
                          ))}
                        </span>
                      ) : (
                        <Play className="h-4 w-4 text-white" fill="currentColor" aria-hidden="true" />
                      )}
                    </span>
                  </button>

                  <button onClick={() => playTrack(t)} className="flex min-w-0 flex-1 flex-col items-start text-left">
                    <span className={`w-full truncate text-[14px] font-semibold ${cur ? "text-fuchsia-200" : "text-zinc-100"}`}>{t.name}</span>
                    <span className="mt-0.5 flex w-full items-center gap-1.5 text-[11.5px] text-zinc-500">
                      <span className="shrink-0 rounded border border-violet-500/30 bg-violet-500/10 px-1 py-px text-[9px] uppercase text-violet-300">
                        {t.ext || "audio"}
                      </span>
                      <span className="truncate">{t.artist || "未知歌手"}</span>
                      <span className="shrink-0">{t.size_text || ""}</span>
                      <span className="shrink-0 tabular-nums">{t.duration ? fmtTimeClient(t.duration) : ""}</span>
                    </span>
                  </button>

                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      onClick={() => downloadTrack(t)}
                      aria-label={`下载 ${t.name}`}
                      title="下载"
                      className="flex h-11 w-10 items-center justify-center rounded-full text-zinc-500 transition-colors hover:text-violet-300 active:scale-90"
                    >
                      <Download className="h-[18px] w-[18px]" />
                    </button>
                    <button
                      onClick={() => setDeleting(t)}
                      aria-label={`删除 ${t.name}`}
                      title="删除"
                      className="flex h-11 w-10 items-center justify-center rounded-full text-zinc-500 transition-colors hover:text-red-300 active:scale-90"
                    >
                      <Trash2 className="h-[18px] w-[18px]" />
                    </button>
                  </div>
                </motion.li>
              );
            })}
          </ul>

          {/* 分页控件（支持 PgUp / PgDn） */}
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              onClick={() => goPage(page - 1)}
              disabled={page <= 1 || loading}
              className="glass flex h-11 items-center gap-1 rounded-xl border border-white/[0.1] px-4 text-[13px] font-medium text-zinc-300 transition-colors hover:border-violet-400/30 disabled:opacity-40 active:scale-95"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" /> 上一页
            </button>
            <span className="text-xs tabular-nums text-zinc-500" title="快捷键：PgUp / PgDn 翻页">
              第 {page} / {totalPages} 页 · 共 {resp?.total ?? 0} 首
            </span>
            <button
              onClick={() => goPage(page + 1)}
              disabled={page >= totalPages || loading}
              className="glass flex h-11 items-center gap-1 rounded-xl border border-white/[0.1] px-4 text-[13px] font-medium text-zinc-300 transition-colors hover:border-violet-400/30 disabled:opacity-40 active:scale-95"
            >
              下一页 <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </>
      )}

      {/* ---------- 删除确认（硬删除：移除文件 + 清索引） ---------- */}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={onDelete}
        busy={busyDelete}
        title="删除本地音乐"
        confirmText="删除"
        description={
          <>
            确定删除「{deleting?.name ?? ""}」吗？
            <br />
            <span className="text-zinc-500">将移除下载目录中的实际文件并清除索引；收藏过该歌的歌单条目会保留并显示为失效，可换源恢复。</span>
          </>
        }
      />
    </div>
  );
}

/** 重复面板条目 → LocalTrack（删除复用主流程） */
function trackFromDup(s: DupSong): LocalTrack {
  return {
    id: s.id,
    source: "local",
    name: s.name,
    artist: s.artist,
    album: "",
    cover: "",
    duration: s.duration,
    filename: s.rel_path.split(/[\\/]/).pop() ?? s.rel_path,
    rel_path: s.rel_path,
    ext: s.ext,
    size: s.size,
    size_text: "",
    modified_at: "",
    missing: [],
    extra: {},
  };
}

/* ---------------- 重复组卡片（行内可删除） ---------------- */

function DupGroupCard({
  group,
  open,
  onToggle,
  onDelete,
}: {
  group: DupGroup;
  open: boolean;
  onToggle: () => void;
  onDelete: (song: DupSong) => void;
}) {
  const best = group.songs.reduce((a, b) => (b.size > a.size ? b : a), group.songs[0]);
  return (
    <div className="glass rounded-2xl border border-white/[0.07]">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2.5 text-left"
      >
        <Copy className="h-4 w-4 shrink-0 text-amber-300/80" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-200">
          {group.name} — {group.artist || "未知歌手"}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">{group.songs.length} 个文件</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
            <ul className="border-t border-white/[0.07] px-4 py-2">
              {group.songs.map((s: DupSong) => (
                <li key={s.id} className="flex min-h-[40px] flex-wrap items-center gap-x-2.5 gap-y-1 py-1.5 text-[12.5px]">
                  <span className="shrink-0 rounded border border-white/[0.1] bg-white/[0.04] px-1.5 py-px text-[10px] uppercase text-zinc-400">{s.ext}</span>
                  <span className="shrink-0 tabular-nums text-zinc-300">{(s.size / 1024 / 1024).toFixed(1)} MB</span>
                  <span className="shrink-0 tabular-nums text-zinc-500">{fmtTimeClient(s.duration)}</span>
                  <span className="min-w-0 flex-1 truncate text-zinc-500">{s.rel_path}</span>
                  {s.id === best.id && (
                    <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-px text-[10px] text-emerald-300">质量最佳</span>
                  )}
                  <button
                    onClick={() => onDelete(s)}
                    aria-label={`删除 ${s.name}`}
                    title="删除该文件"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors hover:text-red-300 active:scale-90"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
