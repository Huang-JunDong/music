"use client";

/**
 * 私人FM /fm：网易 personal_fm（心动/随性模式）· QQ 雷达推荐
 * 播放走全局队列（PlayerBar 承接）：开始收听 = 替换队列；
 * 播至批末自动预取下一批追加（usePlayer.setState，不打断当前）；
 * 垃圾桶 = 当前曲目移出推荐流（网易专属）+ 从队列移除。
 */
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { Radio, Play, Pause, SkipForward, Trash2, RefreshCw, AlertTriangle, Heart, Wind, ListMusic, Music4 } from "lucide-react";
import { toast } from "sonner";
import { usePlayer } from "@/lib/client/store";
import { apiFm, apiFmTrash } from "@/lib/client/api";
import { coverProxyUrl, sourceMeta } from "@/lib/play-url";
import { formatDuration, type Song } from "@/lib/types";

/** 网易 FM 模式（QQ 源忽略） */
const NETEASE_FM_MODES: { value: string; label: string; icon: typeof Heart }[] = [
  { value: "", label: "标准", icon: ListMusic },
  { value: "ossGB1", label: "心动", icon: Heart },
  { value: "popGB1", label: "随性", icon: Wind },
];

/** FM 会话标记：仅 FM 填充的队列触发自动续播 */
let fmSessionActive = false;

export default function FmPage() {
  return (
    <Suspense fallback={<FmFallback />}>
      <FmInner />
    </Suspense>
  );
}

function FmInner() {
  const params = useSearchParams();
  const router = useRouter();
  const source = params.get("source") === "qq" ? "qq" : "netease";
  const rawMode = params.get("mode") ?? "";
  const mode = source === "netease" && NETEASE_FM_MODES.some((m) => m.value === rawMode) ? rawMode : "";

  const [batch, setBatch] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [trashing, setTrashing] = useState(false);

  const { queue, index, playing, play, toggle, next, current } = usePlayer();
  const cur = current();

  const fetchBatch = useCallback(
    async (m: string, silent = false) => {
      if (!silent) setLoading(true);
      setError("");
      try {
        const r = await apiFm(source, m);
        if (!r.songs?.length) throw new Error("FM 暂时没有推荐，稍后再试");
        setBatch(r.songs);
        return r.songs;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "加载 FM 失败";
        if (silent) toast.error(msg);
        else setError(msg);
        return null;
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [source],
  );

  /* 初始/切源/切模式 */
  useEffect(() => {
    void fetchBatch(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, mode, retryKey]);

  /* 进入页面恢复自动续播标记（离开即停，队列播完当前批为止） */
  useEffect(() => {
    fmSessionActive = true;
    return () => {
      fmSessionActive = false;
    };
  }, []);

  /* 自动续播：FM 会话中播至批末 → 预取追加（setState 不打断播放） */
  const prefetchingRef = useRef(false);
  useEffect(() => {
    if (
      !fmSessionActive ||
      !batch.length ||
      queue.length === 0 ||
      index !== queue.length - 1 ||
      !playing
    ) {
      return;
    }
    if (prefetchingRef.current) return;
    prefetchingRef.current = true;
    void apiFm(source, mode)
      .then((r) => {
        if (!fmSessionActive || !r.songs?.length) return;
        usePlayer.setState((s) => ({ queue: [...s.queue, ...r.songs] }));
        setBatch((prev) => [...prev, ...r.songs]);
      })
      .catch(() => {
        /* 预取失败静默：当前首播完自然停止，用户可手动换一批 */
      })
      .finally(() => {
        prefetchingRef.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, queue.length, playing, source, mode]);

  const startListen = async () => {
    const songs = batch.length ? batch : (await fetchBatch(mode)) || [];
    if (!songs.length) return;
    fmSessionActive = true;
    play(songs[0], songs);
  };

  const onTrash = async () => {
    if (!cur || trashing) return;
    setTrashing(true);
    try {
      await apiFmTrash(cur.source, cur.id);
      toast.success("已移出推荐流");
      usePlayer.setState((s) => {
        const q = s.queue.filter((_, i) => i !== s.index);
        return { queue: q, index: Math.min(s.index, q.length - 1) };
      });
      setBatch((prev) => prev.filter((s) => s.id !== cur.id));
      if (!usePlayer.getState().queue.length) void startListen();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败");
    } finally {
      setTrashing(false);
    }
  };

  const replaceQuery = (next: { source?: string; mode?: string }) => {
    const p = new URLSearchParams();
    const s = next.source ?? source;
    const m = next.mode ?? (next.source && next.source !== source ? "" : mode);
    p.set("source", s);
    if (m) p.set("mode", m);
    router.replace(`/fm?${p.toString()}`, { scroll: false });
  };

  /* FM 当前批是否在播（当前歌属于本批） */
  const currentInBatch = !!(cur && batch.some((s) => s.id === cur.id && s.source === cur.source));
  const display = currentInBatch ? cur! : batch[0];

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 lg:px-8 lg:py-10">
      {/* 页头：源 tab + 模式 */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="animate-pulse-glow flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-cyan-400 shadow-lg shadow-fuchsia-500/25">
            <Radio className="h-5 w-5 text-white" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-zinc-50">私人FM</h1>
            <p className="mt-0.5 text-[13px] text-zinc-500">
              {sourceMeta(source).label}
              {source === "netease" ? " · 根据口味生成的专属电台" : " · 雷达推荐相似歌"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="glass inline-flex rounded-xl border border-white/[0.07] p-1" role="tablist" aria-label="FM 来源">
            {(["netease", "qq"] as const).map((s) => {
              const meta = sourceMeta(s);
              const active = s === source;
              return (
                <button
                  key={s}
                  role="tab"
                  aria-selected={active}
                  onClick={() => replaceQuery({ source: s })}
                  className={`relative flex min-h-[38px] items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-colors ${
                    active ? "text-white" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="fm-source-pill"
                      className="absolute inset-0 rounded-lg bg-gradient-to-r from-violet-500/25 to-fuchsia-500/20 ring-1 ring-violet-400/30"
                      transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    />
                  )}
                  <span className={`relative h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
                  <span className="relative">{meta.label}</span>
                </button>
              );
            })}
          </div>
          {source === "netease" && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="FM 模式">
              {NETEASE_FM_MODES.map((m) => {
                const Icon = m.icon;
                const active = m.value === mode;
                return (
                  <button
                    key={m.value || "default"}
                    onClick={() => replaceQuery({ mode: m.value })}
                    aria-pressed={active}
                    className={`flex min-h-[38px] items-center gap-1 rounded-full border px-3 text-xs font-medium transition-all active:scale-95 ${
                      active
                        ? "border-fuchsia-400/40 bg-fuchsia-500/15 text-fuchsia-100"
                        : "border-white/[0.1] bg-white/[0.02] text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <Icon className="h-3 w-3" aria-hidden="true" />
                    {m.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
        {/* ---------- 左：当前/即将播放大卡 ---------- */}
        <div>
          {error ? (
            <FmError
              text={error}
              onRetry={() => {
                setError("");
                setRetryKey((k) => k + 1);
              }}
            />
          ) : loading ? (
            <div className="glass rounded-3xl border border-white/[0.07] p-6" aria-busy="true">
              <div className="shimmer mx-auto aspect-square w-full max-w-[280px] rounded-3xl" />
              <div className="shimmer mx-auto mt-4 h-5 w-2/3 rounded" />
              <div className="shimmer mx-auto mt-2 h-3.5 w-1/2 rounded" />
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={`${batch[0]?.id ?? "empty"}`}
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.3 }}
                className="glass card-glow rounded-3xl border border-white/[0.07] p-6"
              >
                {/* 封面 */}
                <div className="relative mx-auto aspect-square w-full max-w-[280px] overflow-hidden rounded-3xl bg-zinc-800/80 ring-1 ring-white/10">
                  {display?.cover ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={coverProxyUrl(display.cover, source)} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full items-center justify-center">
                      <Music4 className="h-16 w-16 text-zinc-600" aria-hidden="true" />
                    </span>
                  )}
                  {playing && currentInBatch && (
                    <span className="absolute bottom-2.5 right-2.5 flex h-7 items-end gap-[3px] rounded-lg bg-black/60 px-2 py-1.5" aria-hidden="true">
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="eq-bar w-[3px] rounded-full bg-gradient-to-t from-violet-400 to-fuchsia-300"
                          style={{ height: "100%", animationDelay: `${i * 0.18}s` }}
                        />
                      ))}
                    </span>
                  )}
                </div>
                {/* 歌名/歌手 */}
                <div className="mt-4 text-center">
                  <p className="tip mx-auto block max-w-full truncate text-lg font-bold text-zinc-50">
                    {display?.name ?? "暂无节目"}
                    <span className="tip-bubble">
                      <span className="tip-name">{display?.name ?? ""}</span>
                      <span className="tip-sub">{display?.artist ?? ""}</span>
                    </span>
                  </p>
                  <p className="mt-1 truncate text-[13px] text-zinc-500">
                    {display?.artist || "点击下方按钮开始收听"}
                  </p>
                </div>
                {/* 控制 */}
                <div className="mt-5 flex items-center justify-center gap-3">
                  <button
                    onClick={() => (currentInBatch ? toggle() : void startListen())}
                    disabled={!batch.length}
                    aria-label={currentInBatch && playing ? "暂停" : "播放"}
                    className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/30 transition-all hover:brightness-110 active:scale-95 disabled:opacity-40"
                  >
                    {currentInBatch && playing ? (
                      <Pause className="h-6 w-6 fill-white" aria-hidden="true" />
                    ) : (
                      <Play className="ml-0.5 h-6 w-6 fill-white" aria-hidden="true" />
                    )}
                  </button>
                  <button
                    onClick={() => (currentInBatch ? next() : void startListen())}
                    disabled={!batch.length}
                    aria-label="跳到下一首"
                    className="flex h-12 w-12 items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.04] text-zinc-200 transition-colors hover:bg-white/[0.08] active:scale-95 disabled:opacity-40"
                  >
                    <SkipForward className="h-5 w-5" aria-hidden="true" />
                  </button>
                  {source === "netease" && (
                    <button
                      onClick={() => void onTrash()}
                      disabled={!currentInBatch || trashing}
                      aria-label="不再播放这首歌"
                      title="垃圾桶：移出推荐流"
                      className="flex h-12 w-12 items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.04] text-zinc-400 transition-colors hover:border-red-400/30 hover:text-red-300 active:scale-95 disabled:opacity-40"
                    >
                      <Trash2 className="h-5 w-5" aria-hidden="true" />
                    </button>
                  )}
                  <button
                    onClick={() => void fetchBatch(mode)}
                    aria-label="换一批"
                    title="换一批推荐"
                    className="flex h-12 w-12 items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.04] text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-zinc-200 active:scale-95"
                  >
                    <RefreshCw className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>
              </motion.div>
            </AnimatePresence>
          )}
        </div>

        {/* ---------- 右：本批队列 ---------- */}
        <div>
          <div className="mb-3 flex items-baseline gap-2">
            <h2 className="text-[15px] font-bold text-zinc-100">正在轮播</h2>
            <span className="text-xs tabular-nums text-zinc-500">{batch.length} 首 · 播完自动续</span>
          </div>
          {loading ? (
            <div className="space-y-2" aria-busy="true">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="shimmer h-16 rounded-2xl" />
              ))}
            </div>
          ) : batch.length ? (
            <ol className="space-y-2">
              {batch.map((s, i) => {
                const isCur = currentInBatch && cur?.id === s.id;
                return (
                  <motion.li
                    key={`${s.id}-${i}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.05, 0.3), duration: 0.25 }}
                  >
                    <button
                      onClick={() => {
                        fmSessionActive = true;
                        play(s, batch);
                      }}
                      aria-label={`播放 ${s.name}`}
                      aria-current={isCur ? "true" : undefined}
                      className={`glass flex w-full items-center gap-3 rounded-2xl border p-2.5 text-left transition-all active:scale-[0.99] ${
                        isCur
                          ? "border-violet-400/40 bg-violet-500/10 ring-1 ring-violet-400/25"
                          : "border-white/[0.07] hover:border-violet-400/25"
                      }`}
                    >
                      <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-zinc-800">
                        {s.cover ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={coverProxyUrl(s.cover, s.source)} alt="" loading="lazy" className="h-full w-full object-cover" />
                        ) : null}
                        {isCur && playing && (
                          <span className="absolute inset-0 flex items-end justify-center gap-[2px] bg-black/45 pb-1.5" aria-hidden="true">
                            {[0, 1, 2].map((k) => (
                              <span
                                key={k}
                                className="eq-bar w-[2.5px] rounded-full bg-fuchsia-300"
                                style={{ height: "60%", animationDelay: `${k * 0.15}s` }}
                              />
                            ))}
                          </span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="tip block truncate text-[13.5px] font-semibold text-zinc-200">
                          {s.name}
                          <span className="tip-bubble">
                            <span className="tip-name">{s.name}</span>
                            <span className="tip-sub">{s.artist}</span>
                          </span>
                        </span>
                        <span className="mt-0.5 block truncate text-[11.5px] text-zinc-500">
                          {s.artist}
                          {s.album ? ` · ${s.album}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-zinc-600">{formatDuration(s.duration)}</span>
                    </button>
                  </motion.li>
                );
              })}
            </ol>
          ) : (
            !error && <p className="py-10 text-center text-sm text-zinc-500">点左侧「播放」开始收听</p>
          )}
        </div>
      </div>
    </div>
  );
}

function FmError({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="glass flex flex-col items-center gap-3 rounded-3xl border border-white/[0.07] py-14 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10">
        <AlertTriangle className="h-7 w-7 text-amber-300/80" aria-hidden="true" />
      </span>
      <p className="max-w-sm text-sm leading-relaxed text-zinc-400">{text}</p>
      <p className="text-xs text-zinc-600">网易 FM 登录后可获个性化推荐（游客也有默认流）</p>
      <button
        onClick={onRetry}
        className="mt-1 flex h-11 items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] px-5 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.08] active:scale-95"
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" /> 重试
      </button>
    </div>
  );
}

function FmFallback() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 lg:px-8 lg:py-10" aria-busy="true">
      <div className="mb-6 h-11 w-56 animate-pulse rounded-2xl bg-white/[0.05]" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
        <div className="shimmer h-[420px] rounded-3xl" />
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="shimmer h-16 rounded-2xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
