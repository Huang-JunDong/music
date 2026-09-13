"use client";

/**
 * 播客电台 /podcast（P1 B1，网易专属单源）— 分类 Tab + 推荐/热门/今日优选 + 电台详情抽屉（节目分页播放）。
 * 节目主歌曲直接入全局播放队列（dj_program mainSong）。
 */
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { Podcast, Play, RefreshCw, AlertTriangle, Clock3, Headphones, X, ChevronDown, Users, MessageSquareHeart, Info } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { SongCommentsModal } from "@/components/song-comments";
import { apiDjCategories, apiDjRadios, apiDjRadioDetail, apiDjProgramDetail } from "@/lib/client/api";
import { usePlayer } from "@/lib/client/store";
import { coverProxyUrl } from "@/lib/play-url";
import { formatDuration, type DjCategory, type DjRadio, type DjProgram, type Song } from "@/lib/types";

type Kind = "recommend" | "hot" | "today";
const KIND_TABS: { key: Kind; label: string }[] = [
  { key: "recommend", label: "推荐" },
  { key: "hot", label: "热门" },
  { key: "today", label: "今日优选" },
];

export default function PodcastPage() {
  return (
    <Suspense fallback={<div className="mx-auto w-full max-w-[1200px] px-4 py-10 lg:px-8"><div className="shimmer h-40 rounded-3xl" aria-busy="true" /></div>}>
      <PodcastInner />
    </Suspense>
  );
}

function PodcastInner() {
  const [categories, setCategories] = useState<DjCategory[]>([]);
  const [kind, setKind] = useState<Kind>("recommend");
  const [category, setCategory] = useState("");
  const [radios, setRadios] = useState<DjRadio[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [openRadio, setOpenRadio] = useState<DjRadio | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    /* 审核整改 C-12：分类加载失败给出可见反馈（原静默吞错） */
    apiDjCategories()
      .then((r) => {
        if (r.error) toast.error(`播客分类加载失败：${r.error}`);
        else setCategories(r.categories ?? []);
      })
      .catch(() => toast.error("播客分类加载失败，请稍后重试"));
  }, [retryKey]);

  const load = useCallback(
    async (k: Kind, cat: string, p: number, append: boolean) => {
      const seq = ++seqRef.current;
      setLoading(true);
      setError("");
      try {
        const r = await apiDjRadios(k, cat || undefined, p, 30);
        if (seq !== seqRef.current) return;
        if (r.error) throw new Error(r.error);
        const list = r.radios ?? [];
        setRadios((prev) => (append ? [...prev, ...list] : list));
        setHasMore(!!r.has_more);
      } catch (e) {
        if (seq === seqRef.current) {
          setError(e instanceof Error ? e.message : "加载失败");
          if (!append) setRadios([]);
        }
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    setPage(1);
    void load(kind, category, 1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, category, retryKey]);

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 lg:px-8 lg:py-10">
      <PageHeader
        icon={Podcast}
        title="播客电台"
        subtitle="网易播客体系：分类电台 · 热门订阅 · 今日优选 · 节目直接播放"
        actions={
          <button
            onClick={() => setRetryKey((k) => k + 1)}
            aria-label="刷新"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/[.1] text-zinc-400 transition-colors hover:border-violet-400/40 hover:text-zinc-100"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        }
      />

      {/* 维度切换 */}
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="电台维度">
        {KIND_TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={kind === t.key}
            onClick={() => setKind(t.key)}
            className={`min-h-[40px] rounded-xl px-4 text-[13px] font-medium transition-colors ${
              kind === t.key
                ? "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/20"
                : "border border-white/[.08] bg-white/[0.02] text-zinc-400 hover:border-violet-400/40 hover:text-zinc-100"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 分类横滑 */}
      {categories.length > 0 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="电台分类">
          <CategoryChip label="全部分类" active={category === ""} onClick={() => setCategory("")} />
          {categories.map((c) => (
          /* 审核整改 C-13：移除 emoji 加了再删的死代码（hot 徽标半成品） */
          <CategoryChip key={c.id} label={c.name} active={category === c.id} onClick={() => setCategory(c.id)} />
          ))}
        </div>
      )}

      {error && !loading ? (
        <div className="glass mt-5 flex items-center gap-3 rounded-3xl border border-red-400/20 p-5 text-sm text-red-200" role="alert">
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{error}</span>
          <button onClick={() => setRetryKey((k) => k + 1)} className="min-h-[40px] rounded-xl border border-white/[.1] px-3 text-[12.5px] text-zinc-300">
            重试
          </button>
        </div>
      ) : loading && !radios.length ? (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-busy="true">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i}>
              <div className="shimmer aspect-square rounded-2xl" />
              <div className="shimmer mt-2 h-3.5 w-3/4 rounded" />
            </div>
          ))}
        </div>
      ) : !radios.length ? (
        <div className="glass mt-5 flex flex-col items-center gap-3 rounded-3xl border border-white/[.07] py-16">
          <Podcast className="h-8 w-8 text-zinc-600" aria-hidden="true" />
          <p className="text-sm text-zinc-500">该分类暂无电台</p>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {radios.map((r, i) => (
            <motion.button
              key={r.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.4), duration: 0.3 }}
              onClick={() => setOpenRadio(r)}
              className="group text-left"
              aria-label={`打开电台 ${r.name}`}
            >
              <div className="card-glow relative aspect-square overflow-hidden rounded-2xl bg-zinc-800/80 ring-1 ring-white/[0.06] transition-all duration-300 group-hover:-translate-y-0.5 group-hover:ring-violet-400/40">
                {r.pic_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={coverProxyUrl(r.pic_url, "netease")} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]" />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <Podcast className="h-10 w-10 text-zinc-600" aria-hidden="true" />
                  </div>
                )}
                <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] text-zinc-200 backdrop-blur">
                  <Headphones className="h-3 w-3" aria-hidden="true" />
                  {r.sub_count ? `${r.sub_count} 订阅` : `${r.program_count} 期`}
                </span>
              </div>
              <p className="tip mt-2 truncate text-[13px] font-semibold text-zinc-200 transition-colors group-hover:text-fuchsia-200">{r.name}</p>
              <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                {r.dj ? `${r.dj} · ` : ""}
                {r.category}
              </p>
            </motion.button>
          ))}
        </div>
      )}

      {hasMore && !loading && (
        <button
          onClick={() => {
            const next = page + 1;
            setPage(next);
            void load(kind, category, next, true);
          }}
          className="mt-4 flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-2xl border border-white/[.08] text-[13px] text-zinc-400 transition-colors hover:border-violet-400/40 hover:text-zinc-100"
        >
          <ChevronDown className="h-4 w-4" aria-hidden="true" /> 加载更多
        </button>
      )}

      {/* 电台详情抽屉 */}
      <RadioDrawer radio={openRadio} onClose={() => setOpenRadio(null)} />
    </div>
  );
}

function CategoryChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`min-h-[36px] shrink-0 rounded-full border px-3.5 text-[12px] font-medium transition-colors ${
        active ? "border-violet-400/40 bg-violet-500/15 text-violet-200" : "border-white/[.08] bg-white/[0.02] text-zinc-400 hover:border-violet-400/30 hover:text-zinc-100"
      }`}
    >
      {label}
    </button>
  );
}

function RadioDrawer({ radio, onClose }: { radio: DjRadio | null; onClose: () => void }) {
  const [programs, setPrograms] = useState<DjProgram[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  /* P1 C3：电台评论区（comment_dj） */
  const [commentsOpen, setCommentsOpen] = useState(false);
  /* 审核整改 C-09：selector 订阅 play（原整库订阅在 currentTime 高频更新时重渲染节目列表） */
  const play = usePlayer((s) => s.play);
  /* 审核整改 C-12：节目加载失败落 error 态（原静默吞错渲染成"暂无节目"空态） */
  const [programError, setProgramError] = useState("");
  const [programRetry, setProgramRetry] = useState(0);
  /* 审核整改 C-08：loadMore 键控（快速翻页/切电台时旧响应不 append 进新列表） */
  const loadMoreSeq = useRef(0);

  useEffect(() => {
    if (!radio) return;
    setPrograms([]);
    setPage(1);
    setProgramError("");
  }, [radio?.id]);

  /* 审核整改 C-10：抽屉打开期间锁定背景滚动（对齐 app-shell MobileDrawer 范式） */
  useEffect(() => {
    if (!radio) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [radio?.id]);

  useEffect(() => {
    if (!radio) return;
    let alive = true;
    setLoading(true);
    setProgramError("");
    apiDjRadioDetail(radio.id, 1, 30)
      .then((r) => {
        if (!alive) return;
        if (r.programs) setPrograms(r.programs);
        else if (r.error) setProgramError(r.error);
        setHasMore(!!r.programs_has_more);
      })
      .catch((e) => {
        if (alive) setProgramError(e instanceof Error ? e.message : "节目加载失败");
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radio?.id, programRetry]);

  const loadMore = () => {
    if (!radio) return;
    const seq = ++loadMoreSeq.current;
    const next = page + 1;
    setLoading(true);
    apiDjRadioDetail(radio.id, next, 30)
      .then((r) => {
        if (seq !== loadMoreSeq.current) return;
        setPrograms((prev) => [...prev, ...(r.programs ?? [])]);
        setHasMore(!!r.programs_has_more);
        setPage(next);
      })
      .catch(() => {
        if (seq === loadMoreSeq.current) toast.error("节目加载失败");
      })
      .finally(() => {
        if (seq === loadMoreSeq.current) setLoading(false);
      });
  };

  /* P1 B1：节目完整详情（dj_program_detail，展示完整描述） */
  const [detailProgram, setDetailProgram] = useState<DjProgram | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const showProgramDetail = async (programId: string) => {
    if (detailBusy) return;
    setDetailBusy(true);
    try {
      const r = await apiDjProgramDetail(programId);
      if (r.error || !r.program) throw new Error(r.error || "详情加载失败");
      setDetailProgram(r.program);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "详情加载失败");
    } finally {
      setDetailBusy(false);
    }
  };

  const playProgram = (program: DjProgram, list: DjProgram[]) => {
    if (!program.song) {
      toast.error("该节目暂不可播放");
      return;
    }
    const songs: Song[] = list.map((p) => p.song).filter((s): s is Song => !!s);
    play(program.song, songs);
  };

  return (
    <AnimatePresence>
      {radio && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.aside
            initial={{ x: 420 }}
            animate={{ x: 0 }}
            exit={{ x: 420, transition: { duration: 0.2, ease: "easeOut" } }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
            className="fixed inset-y-0 right-0 z-50 flex w-[420px] max-w-[92vw] flex-col border-l border-white/[.07] bg-zinc-950/95 backdrop-blur-xl"
            role="dialog"
            aria-modal="true"
            aria-label={`电台 ${radio.name}`}
          >
            <div className="flex items-start gap-3 border-b border-white/[.07] p-4">
              {radio.pic_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={coverProxyUrl(radio.pic_url, "netease")} alt="" className="h-20 w-20 shrink-0 rounded-2xl object-cover" />
              ) : (
                <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-white/[0.05]">
                  <Podcast className="h-8 w-8 text-zinc-500" aria-hidden="true" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[15px] font-bold text-zinc-100">{radio.name}</h2>
                <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-zinc-500">{radio.description || "电台节目"}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 text-[11px] text-zinc-500">
                  {radio.dj && <span className="flex items-center gap-1"><Users className="h-3 w-3" aria-hidden="true" />{radio.dj}</span>}
                  <span>{radio.program_count} 期</span>
                  {radio.sub_count ? <span>{radio.sub_count} 订阅</span> : null}
                </div>
              </div>
              <button
                onClick={onClose}
                aria-label="关闭"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {loading && !programs.length ? (
                <div className="flex flex-col gap-2" aria-busy="true">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="shimmer h-[72px] rounded-2xl" />
                  ))}
                </div>
              ) : !programs.length && programError ? (
                /* 审核整改 C-12：error 态与空态区分，可重试 */
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <p className="text-[13px] text-zinc-400">{programError}</p>
                  <button onClick={() => setProgramRetry((k) => k + 1)} className="flex min-h-[44px] items-center rounded-xl border border-white/[.1] px-4 text-[13px] text-zinc-300 transition-colors hover:border-violet-400/40 hover:text-zinc-100">
                    重试
                  </button>
                </div>
              ) : !programs.length ? (
                <p className="py-10 text-center text-[13px] text-zinc-500">暂无节目</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {programs.map((p) => (
                    <li key={p.id}>
                      <div className="flex w-full items-center gap-2.5 rounded-2xl bg-white/[0.02] p-2.5 transition-colors hover:bg-white/[0.05]">
                        <button
                          onClick={() => playProgram(p, programs)}
                          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                          aria-label={`播放节目 ${p.name}`}
                        >
                          {p.cover ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={coverProxyUrl(p.cover, "netease")} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
                          ) : (
                            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/[0.05]">
                              <Podcast className="h-5 w-5 text-zinc-500" aria-hidden="true" />
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <b className="block truncate text-[13px] text-zinc-200">{p.name}</b>
                            <span className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
                              <Clock3 className="h-3 w-3" aria-hidden="true" />
                              {formatDuration(p.duration)}
                              {p.listener_count ? ` · ${p.listener_count} 次收听` : ""}
                              {p.publish_time ? ` · ${p.publish_time}` : ""}
                            </span>
                          </span>
                          <Play className="h-4 w-4 shrink-0 text-zinc-600" aria-hidden="true" />
                        </button>
                        {/* P1 B1：节目详情（dj_program_detail 完整描述） */}
                        <button
                          onClick={() => void showProgramDetail(p.id)}
                          disabled={detailBusy}
                          aria-label={`查看节目详情 ${p.name}`}
                          title="节目详情"
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-fuchsia-300 disabled:opacity-50"
                        >
                          <Info className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {hasMore && !loading && (
                <button onClick={loadMore} className="mt-3 flex min-h-[44px] w-full items-center justify-center rounded-xl border border-white/[.08] text-[12.5px] text-zinc-400 hover:border-violet-400/40">
                  加载更多节目
                </button>
              )}
            </div>
            {/* 审核整改 C-10：底部操作条适配 iOS 全面屏 home 条（safe-area） */}
            <div className="flex items-center gap-2 border-t border-white/[.07] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <button
                onClick={() => setCommentsOpen(true)}
                className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/[.08] text-[12.5px] text-zinc-300 transition-colors hover:border-violet-400/40 hover:text-violet-200"
              >
                <MessageSquareHeart className="h-3.5 w-3.5" aria-hidden="true" /> 电台评论
              </button>
              <Link href={radio.link ?? "#"} target="_blank" rel="noreferrer" className="flex min-h-[44px] items-center rounded-xl border border-white/[.08] px-3 text-[12.5px] text-zinc-500 hover:text-fuchsia-300">
                在网易云打开 ↗
              </Link>
            </div>
            {/* P1 C3：电台评论区（comment_dj，网易 A_DJ_1_ 体系） */}
            <SongCommentsModal
              song={{ source: "netease", id: radio.id, name: radio.name, artist: radio.dj ?? "", album: "", duration: 0, size: 0, bitrate: 128, cover: radio.pic_url ?? "", link: radio.link ?? "" }}
              open={commentsOpen}
              onClose={() => setCommentsOpen(false)}
              target="dj"
            />

            {/* P1 B1：节目详情弹窗（dj_program_detail） */}
            {detailProgram && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setDetailProgram(null)} role="dialog" aria-modal="true" aria-label="节目详情">
                <div className="max-h-[70vh] w-[min(92vw,480px)] overflow-y-auto rounded-3xl border border-white/[.1] bg-zinc-950/95 p-5" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="min-w-0 flex-1 text-[14px] font-bold text-zinc-100">{detailProgram.name}</h3>
                    <button onClick={() => setDetailProgram(null)} aria-label="关闭" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200">
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                  <p className="mt-2 text-[11.5px] text-zinc-500">
                    {[detailProgram.publish_time, detailProgram.listener_count ? `${detailProgram.listener_count} 次收听` : "", detailProgram.liked_count ? `${detailProgram.liked_count} 赞` : ""].filter(Boolean).join(" · ")}
                  </p>
                  <p className="mt-3 whitespace-pre-wrap text-[12.5px] leading-relaxed text-zinc-400">{detailProgram.description || "该节目暂无简介"}</p>
                </div>
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
