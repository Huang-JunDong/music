"use client";

/** 全屏播放页：大封面 + 歌词（karaoke 逐字高亮 / 行级渐变，译文+罗马音副行）+ Range 音质显示 + 完整控制 */
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "motion/react";
import {
  X, Play, Pause, SkipBack, SkipForward, Repeat, Repeat1, Shuffle,
  Download, Loader2, Music4, Gauge, ChevronDown, ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { usePlayer } from "@/lib/client/store";
import { coverUrl, sourceMeta, switchSourceUrl, fmtSizeClient, isLocalSource } from "@/lib/client/ui";
import { fmtTimeClient } from "@/lib/client/ui";
import { apiInspect } from "@/lib/client/api";
import { RateMenu } from "./rate-menu";
import { QualityMenu } from "./quality-menu";
import { SwitchSourceMenu } from "./switch-source-menu";
import { VolumeMenu } from "./volume-menu";
import { Spectrum } from "./spectrum";
import type { ClientLyricLine, ClientLyricWord } from "@/lib/lrc-client";

/* ---------- 唱机动画常量（模块级引用稳定） ----------
 * keyframes 数组 / transition 若写成内联对象，每次渲染都是新引用，
 * motion 按严格相等检测目标变化 → 4Hz 重渲染会不断重启动画 → 抽搐卡顿。
 * 常量化后引用不变，motion 值比较通过，动画不被重启。
 */
const ROTATE_WORK = { rotate: 45 };
const ROTATE_PARKED = { rotate: 0 };
const ROTATE_REST = { rotate: -72 };
const ARM_SWAP_KEYFRAMES = { rotate: [45, 14, 14, 45] };
const ARM_SWAP_TRANSITION: Transition = { duration: 0.95, times: [0, 0.3, 0.55, 1], ease: "easeInOut" };
const ARM_STATE_TRANSITION: Transition = { duration: 0.55, ease: [0.33, 0, 0.15, 1] };
const INSTANT_TRANSITION: Transition = { duration: 0.01 };

const BREATHE_KEYFRAMES = { scale: [1, 1.015, 1] };
const SCALE_SETTLED = { scale: 1 };
const BREATHE_TRANSITION: Transition = { duration: 3.2, repeat: Infinity, ease: "easeInOut" };

const DISC_DROP_IN = { scale: 0.7, opacity: 0, y: -28, rotate: -32 };
const DISC_SETTLED = { scale: 1, opacity: 1, y: 0, rotate: 0 };
/* exit 过渡内嵌在目标对象上（Transition 类型无 exit 键，目标级 transition 是 motion 支持的写法） */
const DISC_LIFT_OUT = {
  scale: 0.68,
  opacity: 0,
  y: 18,
  rotate: 24,
  transition: { duration: 0.25, ease: "easeIn" as const },
};
const DISC_SWAP_TRANSITION: Transition = { duration: 0.45, ease: [0.34, 1.56, 0.64, 1] };

/** 歌词行（memo）：换行时仅重渲染状态切换的两行、播放态翻转仅影响当前行，
 * 避免几百行歌词全量 diff（此前每次渲染 400ms+ LONG TASK 的主因） */
const LyricLine = memo(function LyricLine({
  line,
  state,
  playing,
  baseT,
  seek,
  onActive,
}: {
  line: ClientLyricLine;
  state: "past" | "active" | "future";
  playing: boolean;
  baseT: number;
  seek: (t: number) => void;
  onActive: (el: HTMLDivElement | null) => void;
}) {
  const isActive = state === "active";
  const doSeek = () => seek(line.time / 1000);
  const words = line.words ?? [];
  return (
    <div
      ref={isActive ? onActive : undefined}
      className="lyric-line w-full cursor-default select-none"
      onClick={doSeek}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && doSeek()}
      aria-label={line.text}
    >
      {words.length > 0 ? (
        /* karaoke 逐字高亮（YRC / QRC / KRC）：active 行逐词着色（CSS 动画驱动）。
         * 审核整改 P3-3：字号放大改为 transform scale（lg 基态 18px × 1.14 ≈ 原 20px × 1.03），
         * 过渡只动 transform——font-size 属布局属性，换行会触发两行 reflow */
        <p
          /* 换行阈值预留激活放大余量（移动 ×1.03 / lg ×1.14）：布局宽度恒定为容器的 1/scale，
           * 激活 scale 放大后恰好 ≤ 歌词栏宽，长行不再视觉溢出边界；阈值不随激活态变化（零 reflow）。
           * origin 跟随对齐方向：lg 左对齐 → origin-left（向右扩展，首字不被左侧 clip 裁掉）；
           * 移动居中 → origin-center（两侧各扩 1.5%，容器留白足够） */
          className={`max-w-[calc(100%/1.03)] origin-center text-base font-semibold leading-snug transition-transform duration-[350ms] ease-out lg:origin-left lg:max-w-[calc(100%/1.14)] lg:text-lg ${
            isActive
              ? `scale-[1.03] lg:scale-[1.14]${playing ? "" : " karaoke-paused"}`
              : state === "past"
                ? "text-zinc-600"
                : "text-zinc-500"
          }`}
        >
          {words.map((w, wi) => (
            /* 词间隔断点必须在两个 inline-block 词盒“之间”：
             * CJK 词无空格（视觉紧凑），用 <wbr> 提供换行机会；拉丁词尾随空格自然可断。
             * （空格若放在词盒内部不产生外部断点，长行会溢出容器边界） */
            <Fragment key={wi}>
              <KaraokeWord word={w} active={isActive} baseT={isActive ? baseT : 0} />
              {wi < words.length - 1 && (isCjkEnding(w.text) ? <wbr /> : " ")}
            </Fragment>
          ))}
        </p>
      ) : (
        /* 行级：原文 + 渐变高亮。渐变背景常驻（backgroundImage 无法从 none 平滑插值），
         * 激活时 color → transparent 过渡透出渐变；P3-3 整改：字号放大以 scale 表达（lg 18px × 1.14 ≈ 原 20px × 1.03），
         * 过渡仅 color/transform，不触发布局 */
        <p
          className={`max-w-[calc(100%/1.03)] origin-center text-base font-semibold leading-snug transition-[color,transform] duration-[350ms] ease-out lg:origin-left lg:max-w-[calc(100%/1.14)] lg:text-lg ${
            isActive ? "scale-[1.03] lg:scale-[1.14] text-transparent" : state === "past" ? "text-zinc-600" : "text-zinc-500"
          }`}
          style={{
            backgroundImage: "linear-gradient(90deg, #c4b5fd, #f0abfc)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
          }}
        >
          {line.text}
        </p>
      )}
      {line.romaji && (
        <p
          className={`mt-1 text-[12.5px] italic tracking-wide transition-colors duration-[350ms] ease-out lg:text-[13.5px] ${
            isActive ? "text-cyan-200/80" : "text-zinc-600"
          }`}
        >
          {line.romaji}
        </p>
      )}
      {line.translation && (
        <p
          className={`mt-1 text-[13px] transition-colors duration-[350ms] ease-out lg:text-sm ${
            isActive ? "text-fuchsia-200/90" : "text-zinc-600"
          }`}
        >
          {line.translation}
        </p>
      )}
    </div>
  );
});

/** 卡拉 OK 词：底层暗色 + 覆盖层由 CSS animation 按词时间轴平滑填充。
 * baseT = 行激活 / seek 时的播放位置快照（ms），此后动画由浏览器插值，React 不逐帧参与。
 * 词与词之间的间隔/断点由父级 map 渲染（词盒之间），本组件只负责词本身。
 */
const CJK_ENDING_RE = /[\u4e00-\u9fff\u3040-\u30ff\uff66-\uff9f，。！？、…—]$/;
const isCjkEnding = (text: string) => CJK_ENDING_RE.test(text);

const KaraokeWord = memo(function KaraokeWord({
  word,
  active,
  baseT,
}: {
  word: ClientLyricWord;
  active: boolean;
  baseT: number;
}) {
  /* --off = 未揭示比例（窗口需平移的距离）；窗口/文字双层反向平移实现零 layout 揭示 */
  let fillVars: React.CSSProperties;
  if (baseT >= word.end) {
    // 行激活时已唱完：立即满显
    fillVars = { "--off": "0%", "--dur": "0.01s", "--delay": "0s" } as React.CSSProperties;
  } else {
    const span = Math.max(1, word.end - word.start);
    const from = Math.max(0, (baseT - word.start) / span);
    const delay = Math.max(0, word.start - baseT);
    const dur = Math.max(50, word.end - Math.max(baseT, word.start));
    fillVars = {
      "--off": `${((1 - from) * 100).toFixed(2)}%`,
      "--dur": `${(dur / 1000).toFixed(3)}s`,
      "--delay": `${(delay / 1000).toFixed(3)}s`,
    } as React.CSSProperties;
  }
  return (
    /* max-w-full：整行一个 word 的 YRC 数据下，词盒是不可断的 inline-block，
     * flex 父容器的 shrink-to-fit 会把行宽撑到 max-content 而溢出歌词栏；
     * 限宽后词盒收缩，盒内 CJK 文本恢复正常断行 */
    <span className="relative inline-block max-w-full">
      <span className={active ? "text-zinc-500" : undefined}>{word.text}</span>
      {active && (
        <span
          key={baseT}
          aria-hidden="true"
          className="karaoke-fill absolute inset-y-0 left-0 overflow-hidden whitespace-nowrap"
          style={fillVars}
        >
          <span className="bg-gradient-to-r from-violet-300 via-fuchsia-300 to-cyan-200 bg-clip-text text-transparent">
            {word.text}
          </span>
        </span>
      )}
    </span>
  );
});

export function NowPlaying({ onClose, onDownload }: { onClose: () => void; onDownload: () => void }) {
  /* useShallow 精确订阅（排除 currentTime/duration）：
   * currentTime 8Hz 更新不再触发整页渲染——进度条由 ProgressAndTime 独立消化 */
  const {
    queue, index, playing, loading, mode, rate, quality: qualityPref, volume, muted, lyrics, lyricsLoading,
    toggle, next, prev, seek, cycleMode, autoSwitch, play, replaceCurrent, setRate, setQuality: setQualityPref,
    setVolume, toggleMute,
  } = usePlayer(
    useShallow((s) => ({
      queue: s.queue,
      index: s.index,
      playing: s.playing,
      loading: s.loading,
      mode: s.mode,
      rate: s.rate,
      quality: s.quality,
      volume: s.volume,
      muted: s.muted,
      lyrics: s.lyrics,
      lyricsLoading: s.lyricsLoading,
      toggle: s.toggle,
      next: s.next,
      prev: s.prev,
      seek: s.seek,
      cycleMode: s.cycleMode,
      autoSwitch: s.autoSwitch,
      play: s.play,
      replaceCurrent: s.replaceCurrent,
      setRate: s.setRate,
      setQuality: s.setQuality,
      setVolume: s.setVolume,
      toggleMute: s.toggleMute,
    })),
  );
  const song = index >= 0 && index < queue.length ? queue[index] : null;
  const reduced = useReducedMotion();
  const activeLineRef = useRef<HTMLDivElement | null>(null);
  const onActiveLine = useCallback((el: HTMLDivElement | null) => {
    activeLineRef.current = el;
  }, []);
  const [quality, setQuality] = useState<{ size?: string; bitrate?: string } | null>(null);
  /* 移动端视图切换：唱片（默认）↔ 歌词；桌面端左右并排不受影响 */
  const [mobileView, setMobileView] = useState<"disc" | "lyrics">("disc");
  /* 歌词延迟挂载：展开动画（spring ~0.5s）期间不挂几百行歌词树，
   * 避免首次 mount 阻塞主线程冻住展开动画；动画主体完成后（400ms）再挂载 */
  const [lyricReady, setLyricReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLyricReady(true), 400);
    return () => clearTimeout(t);
  }, []);
  /* 封面主色（canvas 采样饱和像素均值，驱动背景光晕沉浸色） */
  const [coverTone, setCoverTone] = useState<{ r: number; g: number; b: number } | null>(null);

  /* 当前歌词行索引：selector 派生（返回原始 number）——currentTime 4Hz 更新只在换行时触发重渲染，
   * 唱片区动画组件不再被逐帧 re-render 打断 */
  const activeLine = usePlayer((s) => {
    const t = s.currentTime * 1000;
    let idx = -1;
    for (let i = 0; i < s.lyrics.length; i++) {
      if (s.lyrics[i].time <= t) idx = i;
      else break;
    }
    return idx;
  });

  /* 卡拉 OK 基准时间：行切换时快照当前播放位置（驱动 CSS 填充动画；行内 seek 的偏差由下一行纠正） */
  const [karaokeBase, setKaraokeBase] = useState<number | null>(null);
  useEffect(() => {
    setKaraokeBase(usePlayer.getState().currentTime * 1000);
  }, [activeLine]);
  const karaokeBaseT = karaokeBase ?? 0;

  /* 封面取主色：24×24 缩略采样，跳过近黑/近白/低饱和像素后求均值（同源代理图，无 canvas 污染） */
  useEffect(() => {
    if (!song?.cover) {
      setCoverTone(null);
      return;
    }
    let alive = true;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = coverUrl(song);
    img.onload = () => {
      if (!alive) return;
      try {
        const size = 24;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let i = 0; i < data.length; i += 4) {
          const R = data[i];
          const G = data[i + 1];
          const B = data[i + 2];
          const max = Math.max(R, G, B);
          const min = Math.min(R, G, B);
          const lum = (R + G + B) / 3;
          if (max > 0 && (max - min) / max > 0.25 && lum > 40 && lum < 220) {
            r += R;
            g += G;
            b += B;
            n++;
          }
        }
        if (n > 0 && alive) {
          setCoverTone({ r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) });
        }
      } catch {
        /* 采样失败保持默认品牌色 */
      }
    };
    img.onerror = () => {
      if (alive) setCoverTone(null);
    };
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song?.id, song?.cover]);

  /* 当前行滚动定位：瞬时跳转（smooth 平滑滚动由主线程驱动，长歌词列表滚动期间会
   * 产生 400ms+ LONG TASK 卡死动画——性能远优先于滚动动效）。
   * lyricReady：歌词延迟挂载后需要补一次定位 */
  useEffect(() => {
    activeLineRef.current?.scrollIntoView({ behavior: "auto", block: "center" });
  }, [activeLine, lyricReady]);

  /* 移动端唱片视图：当前行 ±2 共 5 行歌词窗口 */
  const lyricWindow = useMemo(() => {
    if (!lyrics.length) return [];
    const start = Math.max(0, activeLine - 2);
    return lyrics.slice(start, start + 5).map((line, idx) => ({ line, idx: start + idx }));
  }, [lyrics, activeLine]);

  /* 移动端进入歌词视图时：立即定位到当前行（避免从顶部开始） */
  useEffect(() => {
    if (mobileView === "lyrics") {
      activeLineRef.current?.scrollIntoView({ behavior: "auto", block: "center" });
    }
  }, [mobileView]);

  /* Range 探测：显示当前曲目实际大小与码率（失败回退 Song 自带字段）；
   * qualityPref 透传 —— 切换音质档位后按新档位重新探测，显示与实际播放一致 */
  useEffect(() => {
    if (!song) return;
    let alive = true;
    setQuality(null);
    if (song.source === "local" || song.source === "local-file") {
      // 本地源：inspect 走本地探测（内嵌 bitrate/size）
    }
    apiInspect(song, qualityPref)
      .then((r) => {
        if (alive && r.valid) setQuality({ size: r.size, bitrate: r.bitrate });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song?.id, song?.source, qualityPref]);

  /* ESC 关闭 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  if (!song) return null;
  const meta = sourceMeta(song.source);
  const ModeIcon = mode === "loop-one" ? Repeat1 : mode === "shuffle" ? Shuffle : Repeat;
  const qBitrate = quality?.bitrate && quality.bitrate !== "-" ? quality.bitrate : song.bitrate > 0 ? `${song.bitrate} kbps` : "";
  const qSize = quality?.size && quality.size !== "-" ? quality.size : song.size > 0 ? fmtSizeClient(song.size) : "";

  /* 封面主色衍生的光晕色（亮版 A / 暗版 B，覆盖度 40%；无主色回退品牌 violet/fuchsia） */
  const toneA = coverTone
    ? `rgba(${coverTone.r},${coverTone.g},${coverTone.b},0.40)`
    : "rgba(139,92,246,0.40)";
  const toneB = coverTone
    ? `rgba(${Math.round(coverTone.r * 0.55)},${Math.round(coverTone.g * 0.55)},${Math.round(coverTone.b * 0.55)},0.34)`
    : "rgba(217,70,239,0.34)";

  /* 换源：target 传源名 = 定向换源（switch_source 的 target 参数），undefined = 智能匹配 */
  const [switching, setSwitching] = useState(false);
  const doSwitch = async (target?: string) => {
    const tid = toast.loading(target ? `正在从${sourceMeta(target).label}匹配…` : "正在跨源匹配…");
    setSwitching(true);
    try {
      const r = await fetch(switchSourceUrl(song, target));
      const body = await r.json();
      if (!r.ok || !body?.id) throw new Error(body?.error ?? "未找到可播放的换源结果");
      toast.success(`已换源到 ${sourceMeta(body.source).label}：${body.name}`, { id: tid });
      /* 替换队列中当前曲目并立即播放新源（replaceCurrent 绕开 play() 的"同位重播=停止"语义） */
      replaceCurrent(body);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "换源失败", { id: tid });
    } finally {
      setSwitching(false);
    }
  };

  return (
    <motion.div
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      exit={{ y: "100%" }}
      transition={{ type: "spring", stiffness: 320, damping: 36 }}
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-zinc-950"
      role="dialog"
      aria-modal="true"
      aria-label={`正在播放：${song.name}`}
    >
      {/* 背景光晕（封面主色驱动；无主色回退品牌色）。中右层覆盖歌词列，避免该区域死黑 */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: song.cover
            ? `radial-gradient(130% 100% at 20% -10%, ${toneA}, transparent 72%), radial-gradient(110% 90% at 85% 10%, ${toneB}, transparent 76%), radial-gradient(95% 85% at 68% 52%, ${toneB}, transparent 74%), radial-gradient(150% 110% at 50% 115%, ${toneB}, transparent 70%)`
            : undefined,
        }}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-black/50 to-transparent" />

      {/* 顶栏 */}
      <div className="relative z-10 flex items-center justify-between px-4 py-3 lg:px-8 lg:py-4">
        <button
          onClick={onClose}
          aria-label="收起播放页"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.08] text-zinc-200 transition-all hover:bg-white/[0.14] active:scale-90"
        >
          <X className="h-5 w-5" />
        </button>
        <span className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-400">Now Playing</span>
        <span className="w-11" />
      </div>

      <div
        className={`relative z-10 grid min-h-0 flex-1 gap-3 overflow-hidden px-5 pb-7 lg:grid-cols-[minmax(0,440px)_minmax(0,520px)] lg:grid-rows-[minmax(0,1fr)_auto] lg:gap-x-16 lg:justify-center lg:px-16 lg:pb-12 ${
          mobileView === "disc"
            ? "grid-rows-[minmax(0,1fr)_0px_auto]"
            : "grid-rows-[0px_minmax(0,1fr)_auto]"
        }`}
      >
        {/* 左上：模式 + 唱片 + 标题（桌面贴靠控制区，移动端垂直居中防溢出）；首次挂载淡入。
            注意不能用 key={mobileView}：歌词↔唱片切换会使唱片 AnimatePresence 整树重挂、
            重播「换碟弹落」动画（返回唱片瞬间唱片 opacity:0 呈黑块） */}
        <div
          className={`row-start-1 w-full self-center lg:col-start-1 lg:row-start-1 lg:self-end lg:pb-1 ${
            mobileView === "disc" ? "flex" : "hidden lg:flex"
          }`}
        >
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            className="flex w-full min-w-0 flex-col items-center justify-center gap-6"
          >
          <motion.div
            initial={false}
            animate={playing && !reduced ? BREATHE_KEYFRAMES : SCALE_SETTLED}
            transition={playing && !reduced ? BREATHE_TRANSITION : undefined}
            className="relative"
          >
            {/* 唱片光晕：预模糊径向渐变（无 blur 滤镜，避免呼吸动画下逐帧重采样） */}
            <div
              className="absolute -inset-8 rounded-full [transform:translateZ(0)]"
              style={{
                background: coverTone
                  ? `radial-gradient(circle at 50% 50%, rgba(${coverTone.r},${coverTone.g},${coverTone.b},0.32) 0%, rgba(${Math.round(coverTone.r * 0.7)},${Math.round(coverTone.g * 0.7)},${Math.round(coverTone.b * 0.7)},0.16) 40%, rgba(${Math.round(coverTone.r * 0.5)},${Math.round(coverTone.g * 0.5)},${Math.round(coverTone.b * 0.5)},0.06) 60%, transparent 75%)`
                  : "radial-gradient(circle at 50% 50%, rgba(167,139,250,0.30) 0%, rgba(232,121,249,0.15) 40%, rgba(103,232,249,0.06) 60%, transparent 75%)",
              }}
            />
            {/* 唱机底座（platter）：比唱片大一圈的深色托盘 + 厚重投影（合成层隔离重绘） */}
            <div className="absolute -inset-[6%] rounded-full bg-surface-platter shadow-[0_26px_60px_-14px_rgba(0,0,0,0.85),inset_0_0_0_1px_rgba(255,255,255,0.05),inset_0_2px_6px_rgba(255,255,255,0.03)] [transform:translateZ(0)]" />
            {/* 唱片（可换件）：切歌时旧片缩小滑出 → 新片从上方弹落（物理换碟）；内层 disc-spin 持续旋转 */}
            <AnimatePresence mode="wait">
              <motion.div
                key={`${song.source}-${song.id}`}
                initial={reduced ? undefined : DISC_DROP_IN}
                animate={DISC_SETTLED}
                exit={reduced ? undefined : DISC_LIFT_OUT}
                transition={reduced ? INSTANT_TRANSITION : DISC_SWAP_TRANSITION}
                className="relative"
              >
                <div
                  onClick={() => setMobileView("lyrics")}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && setMobileView("lyrics")}
                  aria-label="查看歌词"
                  className={`disc disc-spin relative h-[min(12rem,30vh)] w-[min(12rem,30vh)] rounded-full lg:h-[min(20rem,40vh)] lg:w-[min(20rem,40vh)] lg:cursor-default ${playing ? "" : "disc-paused"}`}
                >
                  {song.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={coverUrl(song)}
                      alt={`${song.name} 封面`}
                      className="absolute left-1/2 top-1/2 h-[82%] w-[82%] -translate-x-1/2 -translate-y-1/2 rounded-full object-cover shadow-[inset_0_0_12px_rgba(0,0,0,0.6),0_0_0_1px_rgba(0,0,0,0.55)]"
                    />
                  ) : (
                    <div className="absolute left-1/2 top-1/2 flex h-[82%] w-[82%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-zinc-800 shadow-[inset_0_0_12px_rgba(0,0,0,0.6)]">
                      <Music4 className="h-12 w-12 text-zinc-500" aria-hidden="true" />
                    </div>
                  )}
                  {/* 中心主轴孔：轴台 + 铭牌环 + 轴心 */}
                  <span className="absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-surface-sticky shadow-[0_0_0_3px_rgba(0,0,0,0.4),0_0_0_4px_rgba(255,255,255,0.05)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-zinc-300/70" aria-hidden="true" />
                  </span>
                </div>
              </motion.div>
            </AnimatePresence>
            {/* 固定光源高光：两道弧形反光带（不随唱片旋转） */}
            <div className="disc-sheen pointer-events-none absolute inset-0 rounded-full" aria-hidden="true" />
            {/* 唱臂（tonearm）：外层状态角（暂停摆开回弹 / 播放落针）+ 内层换碟抬落动作 */}
            <div className="pointer-events-none absolute right-[0%] top-[0%] z-20" aria-hidden="true">
              <motion.span
                animate={reduced ? ROTATE_PARKED : playing ? ROTATE_PARKED : ROTATE_REST}
                transition={reduced ? INSTANT_TRANSITION : ARM_STATE_TRANSITION}
                className="absolute left-0 top-0 block origin-top-left will-change-transform"
              >
                <motion.span
                  key={`arm-${song.source}-${song.id}`}
                  initial={ROTATE_WORK}
                  animate={reduced ? ROTATE_WORK : ARM_SWAP_KEYFRAMES}
                  transition={reduced ? INSTANT_TRANSITION : ARM_SWAP_TRANSITION}
                  className="absolute left-0 top-0 block origin-top-left will-change-transform"
                >
                  {/* 平衡重锤（counterweight）：转轴后方 */}
                  <span className="absolute -top-[11px] left-[4px] h-[15px] w-[26px] rounded-full bg-gradient-to-r from-zinc-700 via-zinc-900 to-zinc-600 shadow-md shadow-black/60 ring-1 ring-white/10" />
                  {/* 主臂杆 */}
                  <span className="block w-[3px] rounded-full bg-gradient-to-b from-zinc-100 via-zinc-400 to-zinc-200 shadow-[0_1px_3px_rgba(0,0,0,0.8)] h-[min(80px,12vh)] lg:h-[min(132px,33vh)] lg:w-[3.5px]" />
                  {/* 唱头盒 */}
                  <span className="absolute -bottom-[11px] left-1/2 h-4 w-6 -translate-x-1/2 rounded-[4px] bg-gradient-to-br from-zinc-300 via-zinc-500 to-zinc-700 shadow-[0_2px_5px_rgba(0,0,0,0.6)] ring-1 ring-white/20" />
                  {/* 针尖 */}
                  <span className="absolute -bottom-[15px] left-1/2 h-[5px] w-[2px] -translate-x-1/2 rounded-full bg-zinc-100/90" />
                </motion.span>
              </motion.span>
              {/* 转轴台（底座 + 金属轴帽 + 中心螺钉） */}
              <span className="absolute left-0 top-0 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-zinc-800 to-zinc-950 shadow-[0_4px_10px_rgba(0,0,0,0.7)] ring-1 ring-white/15" />
              <span className="absolute left-0 top-0 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-zinc-200 via-zinc-400 to-zinc-600 shadow-inner ring-1 ring-white/30" />
              <span className="absolute left-0 top-0 h-[3px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-zinc-100/80" />
            </div>
          </motion.div>

          <div className="flex flex-col items-center gap-1.5 text-center">
            <h2 className="max-w-full text-xl font-bold text-zinc-50 lg:text-2xl">{song.name}</h2>
            <p className="text-sm text-zinc-400">
              {song.artist || "未知歌手"}
              {song.album ? ` · ${song.album}` : ""}
            </p>
            <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5">
              <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] ${meta.badge}`}>{meta.label}</span>
              {(qBitrate || qSize) && (
                <span
                  className="inline-flex items-center gap-1 rounded-full border border-white/[0.1] bg-white/[0.04] px-2.5 py-0.5 text-[11px] text-zinc-400"
                  title="Range 实时探测（失败时显示搜索结果携带的估计值）"
                >
                  <Gauge className="h-3 w-3" aria-hidden="true" />
                  {[qBitrate, qSize].filter(Boolean).join(" · ")}
                </span>
              )}
            </div>
          </div>

          {/* 移动端唱片视图：当前行 ±2 歌词窗口（点击进入歌词视图）；桌面端右列已有完整歌词 */}
          {mobileView === "disc" && lyricWindow.length > 0 && (
            <button
              onClick={() => setMobileView("lyrics")}
              className="relative -mx-2 flex w-[calc(100%+1rem)] flex-col items-center gap-2.5 overflow-hidden rounded-2xl px-2 py-2.5 lg:hidden"
              aria-label="查看完整歌词"
            >
              {lyricWindow.map(({ line, idx }) => (
                <span
                  key={idx}
                  className={`max-w-full truncate leading-relaxed transition-colors duration-300 ${
                    idx === activeLine
                      ? "text-[17px] font-semibold text-zinc-50"
                      : idx < activeLine
                        ? "text-[15px] text-zinc-600"
                        : "text-[15px] text-zinc-500"
                  }`}
                >
                  {line.text}
                </span>
              ))}
              <ChevronUp className="h-3.5 w-3.5 shrink-0 text-zinc-600" aria-hidden="true" />
            </button>
          )}
          </motion.div>
        </div>

        {/* 进度 + 控制（移动端末行贴底；桌面左列下部） */}
        <div className="row-start-3 flex w-full flex-col gap-3 self-end lg:col-start-1 lg:row-start-2">
            {/* 实时频谱：Web Audio FFT + Canvas，颜色随封面主色；装饰性（aria-hidden） */}
            <Spectrum tone={coverTone} playing={playing} />
            <ProgressAndTime />
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => prev()} aria-label="上一首" className="flex h-12 w-12 items-center justify-center rounded-full text-zinc-300 transition-all hover:text-white active:scale-90">
                <SkipBack className="h-6 w-6" fill="currentColor" />
              </button>
              <button
                onClick={toggle}
                aria-label={playing ? "暂停" : "播放"}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-xl shadow-fuchsia-500/30 transition-transform hover:scale-105 active:scale-95"
              >
                {loading ? <Loader2 className="h-7 w-7 animate-spin" /> : playing ? <Pause className="h-7 w-7" fill="currentColor" /> : <Play className="ml-1 h-7 w-7" fill="currentColor" />}
              </button>
              <button onClick={() => next()} aria-label="下一首" className="flex h-12 w-12 items-center justify-center rounded-full text-zinc-300 transition-all hover:text-white active:scale-90">
                <SkipForward className="h-6 w-6" fill="currentColor" />
              </button>
              {/* 音量：紧邻下一曲右侧，点击弹出音量面板（静音切换 + 滑条 + 百分比） */}
              <VolumeMenu volume={volume} muted={muted} onVolume={setVolume} onToggleMute={toggleMute} />
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <RateMenu rate={rate} onPick={setRate} />
              {/* 本地源音质由文件编码决定（quality 参数无效）——隐藏音质菜单避免误导 */}
              {!isLocalSource(song.source) && <QualityMenu quality={qualityPref} onPick={setQualityPref} />}
              <button
                onClick={cycleMode}
                aria-label="播放模式"
                title={mode === "order" ? "顺序播放" : mode === "loop-one" ? "单曲循环" : "随机播放"}
                className={`flex h-11 items-center gap-1.5 rounded-full border px-4 text-xs font-medium transition-all active:scale-95 ${
                  mode === "order"
                    ? "border-white/[0.1] text-zinc-300 hover:border-violet-400/40 hover:text-violet-200"
                    : "border-fuchsia-400/40 text-fuchsia-200"
                }`}
              >
                <ModeIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {mode === "order" ? "顺序" : mode === "loop-one" ? "循环" : "随机"}
              </button>
              <SwitchSourceMenu source={song.source} busy={switching} onPick={doSwitch} />
              <button
                onClick={onDownload}
                aria-label="下载"
                className="flex h-11 items-center gap-1.5 rounded-full border border-white/[0.1] px-4 text-xs font-medium text-zinc-300 transition-all hover:border-violet-400/40 hover:text-violet-200 active:scale-95"
              >
                <Download className="h-3.5 w-3.5" />
                下载
              </button>
            </div>
          </div>

        {/* 歌词：移动端歌词视图占满中段（内部滚动无滚动条、文字居中）；桌面右列通栏左对齐。
            结构要点：返回条必须放在 lyric-mask 容器之外 —— mask 顶部 0–14% 是渐隐透明带，
            若 sticky 条留在滚动容器内会被 mask 逐段裁切，呈现残缺的黑色横带 */}
        <div
          className={`relative row-start-2 min-h-0 w-full ${mobileView === "lyrics" ? "block" : "hidden lg:block"} lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:max-w-[520px]`}
        >
          {/* 移动端歌词视图：返回唱片（悬浮于滚动区上方，任意滚动位置可点）。
              胶囊底色取封面主色衍生的 toneA/toneB 渐变（与背景光晕同源，无主色回退品牌色），
              半透明 + 毛玻璃与光晕融合，避免黑色异物感；文字 zinc-50 对半透明底 ≥4.5:1 */}
          <div className="absolute inset-x-0 top-0 z-10 flex justify-center px-1 pt-1 lg:hidden">
            <button
              onClick={() => setMobileView("disc")}
              style={{ backgroundImage: `linear-gradient(90deg, ${toneA}, ${toneB})` }}
              className="flex h-11 items-center gap-1.5 rounded-full border border-white/15 px-4 text-[12.5px] font-medium text-zinc-50 shadow-lg shadow-black/25 backdrop-blur-md transition-[filter,transform] duration-200 hover:brightness-125 active:scale-95"
              aria-label="返回唱片视图"
            >
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
              返回唱片
            </button>
          </div>
          <div className="lyric-mask no-scrollbar h-full overflow-x-clip overflow-y-auto px-1 pb-3 pt-14 lg:py-16">
          <motion.div
            key={mobileView}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
          {!lyricReady ? (
            /* 展开动画期间：轻量骨架（歌词树延迟挂载，避免 mount 阻塞展开动画） */
            <div className="flex flex-col gap-[22px] px-2 py-6 opacity-60" aria-hidden="true">
              {[0, 1, 2].map((k) => (
                <div key={k} className="shimmer h-5 rounded" style={{ width: `${58 - k * 12}%` }} />
              ))}
            </div>
          ) : lyricsLoading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              歌词加载中…
            </div>
          ) : lyrics.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">纯音乐 / 无歌词</div>
          ) : (
            <div className="flex flex-col items-center gap-[22px] px-2 text-center lg:items-start lg:text-left">
              {lyrics.map((line, i) => (
                <LyricLine
                  key={`${line.time}-${i}`}
                  line={line}
                  state={i === activeLine ? "active" : i < activeLine ? "past" : "future"}
                  playing={i === activeLine ? playing : false}
                  baseT={i === activeLine ? karaokeBaseT : 0}
                  seek={seek}
                  onActive={onActiveLine}
                />
              ))}
              <div className="h-[40vh] lg:h-[30vh]" />
            </div>
          )}
          </motion.div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/** 进度行（时间 + 拖动条）：独立订阅 currentTime（4Hz 仅重渲染本小组件，不波及唱片区动画）。
 * useShallow 精确订阅三个字段：store 其他切片（队列/歌词等）变化不触发本组件重渲染 */
function ProgressAndTime() {
  const { currentTime, duration, seek } = usePlayer(
    useShallow((s) => ({ currentTime: s.currentTime, duration: s.duration, seek: s.seek })),
  );
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-11 text-right text-xs tabular-nums text-zinc-400">{fmtTimeClient(currentTime)}</span>
      <input
        type="range"
        className="slider flex-1"
        style={{ "--progress": `${progress}%` } as React.CSSProperties}
        min={0}
        max={Math.max(duration, 0.1)}
        step={0.5}
        value={currentTime}
        onChange={(e) => seek(Number(e.target.value))}
        aria-label="进度"
      />
      <span className="w-11 text-xs tabular-nums text-zinc-400">{fmtTimeClient(duration)}</span>
    </div>
  );
}
