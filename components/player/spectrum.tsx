"use client";

/**
 * 实时频谱（播放详情页）：Web Audio AnalyserNode FFT → Canvas 2D + rAF。
 *
 * - 零第三方依赖；对数频率分桶 + AGC 滑动峰值归一化 + 高频增益补偿 ——
 *   低音鼓点 / 中频人声 / 高频镲片在各频段条上都可满幅跳动，高低音区分明显
 * - 性能：30fps 节流、分桶表与渐变预计算缓存、条数按宽度 16–36 自适应
 * - 颜色跟随封面主色（tone prop 与播放页光晕同源），无主色回退品牌渐变
 * - AudioContext 安全初始化：先 resume 成功再挂 MediaElementSource（挂上后无法撤销，
 *   若在 suspended 态挂载会把全局音频输出改道至静音 graph —— 顺序不可颠倒）
 * - graph 不可用时降级为合成波形（随播放状态起舞、暂停静止）
 * - prefers-reduced-motion：渲染静态低幅条；document.hidden 跳帧
 * - 右侧图标开关控制显示，状态持久化 localStorage("musicdl:spectrum")
 */
import { memo, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Activity } from "lucide-react";
import { getAudio } from "@/lib/client/store";

interface Graph {
  ctx: AudioContext;
  analyser: AnalyserNode;
  freq: Uint8Array<ArrayBuffer>;
}

/* 模块级单例：MediaElementSource 全局仅允许创建一次，播放页开关不重建 */
let graph: Graph | null = null;
let graphPromise: Promise<Graph | null> | null = null;

function ensureGraph(): Promise<Graph | null> {
  if (graph) return Promise.resolve(graph);
  if (graphPromise) return graphPromise;
  graphPromise = (async () => {
    try {
      const AC: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      const ctx = new AC();
      /* 安全顺序：resume 成功后才 createMediaElementSource（见文件头注释） */
      if (ctx.state === "suspended") {
        try {
          await ctx.resume();
        } catch {
          return null;
        }
      }
      if (ctx.state !== "running") return null;
      const src = ctx.createMediaElementSource(getAudio());
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      /* 必须接 destination：MediaElementSource 建立即改道，不接则全局无声 */
      src.connect(analyser);
      analyser.connect(ctx.destination);
      graph = { ctx, analyser, freq: new Uint8Array(analyser.frequencyBinCount) };
      return graph;
    } catch {
      return null;
    }
  })();
  return graphPromise;
}

const SPECTRUM_KEY = "musicdl:spectrum";

export const Spectrum = memo(function Spectrum({
  tone,
  playing,
}: {
  tone: { r: number; g: number; b: number } | null;
  playing: boolean;
}) {
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(SPECTRUM_KEY) !== "0";
  });
  const toggle = () => {
    setEnabled((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(SPECTRUM_KEY, next ? "1" : "0");
      } catch {
        /* 私有模式等存储失败不影响功能 */
      }
      return next;
    });
  };

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const toneRef = useRef(tone);
  toneRef.current = tone;
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const c2d = canvas.getContext("2d");
    if (!c2d) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;
    let bars = 24;
    let levels: number[] = new Array(bars).fill(0);
    let peaks: number[] = new Array(bars).fill(0);
    /* AGC 滑动峰值：快 attack、慢 release，各频段条独立满幅 */
    let agc: number[] = new Array(bars).fill(0.5);
    /* 对数分桶表（resize 时预计算，帧内零 exp） */
    let bucketLo: number[] = [];
    let bucketHi: number[] = [];
    /* 渐变缓存：tone/宽度不变则复用 */
    let gradKey = "";
    let grad: CanvasGradient | null = null;

    const rebuildBuckets = () => {
      const g = graph;
      const n = g ? g.freq.length - 2 : 96;
      bucketLo = new Array(bars);
      bucketHi = new Array(bars);
      for (let i = 0; i < bars; i++) {
        const lo = Math.max(1, Math.round(Math.exp((Math.log(n) * i) / bars)));
        bucketLo[i] = lo;
        bucketHi[i] = Math.max(lo + 1, Math.round(Math.exp((Math.log(n) * (i + 1)) / bars)));
      }
    };

    const resize = () => {
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (w === width && h === height) return;
      width = w;
      height = h;
      canvas.width = w;
      canvas.height = h;
      bars = Math.min(36, Math.max(16, Math.round(canvas.clientWidth / 13)));
      if (levels.length !== bars) {
        levels = new Array(bars).fill(0);
        peaks = new Array(bars).fill(0);
        agc = new Array(bars).fill(0.5);
      }
      rebuildBuckets();
      gradKey = "";
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    void ensureGraph().then(rebuildBuckets);

    let raf = 0;
    let t0 = -1;
    let lastDraw = -1;
    /* 30fps 节流：频谱足够顺滑，GPU/主线程压力减半（缓解移动端与页面动画叠加卡顿） */
    const FRAME_MS = 1000 / 30;

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t0 < 0) t0 = t;
      const dt = Math.min(0.1, (t - t0) / 1000);
      t0 = t;
      if (document.hidden || width <= 0 || height <= 0) return;
      if (lastDraw >= 0 && t - lastDraw < FRAME_MS) return;
      lastDraw = t;

      const g = graph;
      const isPlaying = playingRef.current;
      const ton = toneRef.current;
      if (g && isPlaying) g.analyser.getByteFrequencyData(g.freq);

      /* 目标能级：FFT 对数分桶 max → 高频斜坡增益 → AGC 归一化；graph 不可用走合成波形 */
      for (let i = 0; i < bars; i++) {
        let raw: number;
        if (g && g.freq.length > 0) {
          let m = 0;
          const hi = bucketHi[i] ?? i + 1;
          for (let b = bucketLo[i] ?? 1; b < hi && b < g.freq.length; b++) m = Math.max(m, g.freq[b]);
          /* 高频斜坡增益：能量随频率衰减，0.7→1.35 补偿让镲片/气声可见 */
          raw = ((m / 255) * (0.7 + (0.65 * i) / bars)) ** 1.1;
          if (!isPlaying) raw = 0;
          /* AGC：峰值快升、缓降（2%/帧），floor 0.4 防静段爆满 */
          if (raw > agc[i]) agc[i] = raw;
          else agc[i] += (raw - agc[i]) * 0.02;
          raw = Math.min(1, raw / Math.max(agc[i], 0.4));
        } else {
          const phase = t / 1000;
          raw = isPlaying
            ? 0.22 + 0.5 * Math.abs(Math.sin(phase * 2.1 + i * 0.55) * Math.cos(phase * 0.7 + i * 0.21))
            : 0;
        }
        /* 快升缓降：上升即时跟随、下降指数衰减 */
        const cur = levels[i];
        levels[i] = raw > cur ? cur + (raw - cur) * 0.6 : Math.max(0, cur - dt * 1.6);
        peaks[i] = Math.max(peaks[i] - dt * 0.45, levels[i]);
      }

      /* 渐变缓存：仅 tone/宽度变化时重建 */
      const key = `${ton ? `${ton.r},${ton.g},${ton.b}` : "brand"}@${width}`;
      if (key !== gradKey || !grad) {
        grad = c2d.createLinearGradient(0, 0, width, 0);
        if (ton) {
          grad.addColorStop(0, `rgb(${Math.min(255, ton.r + 45)},${Math.min(255, ton.g + 45)},${Math.min(255, ton.b + 45)})`);
          grad.addColorStop(1, `rgb(${Math.round(ton.r * 0.75)},${Math.round(ton.g * 0.75)},${Math.round(ton.b * 0.75)})`);
        } else {
          grad.addColorStop(0, "#a78bfa");
          grad.addColorStop(0.55, "#e879f9");
          grad.addColorStop(1, "#67e8f9");
        }
        gradKey = key;
      }

      c2d.clearRect(0, 0, width, height);
      const gap = Math.max(2, Math.round(2 * dpr));
      const minH = Math.max(2, Math.round(2 * dpr));
      const peakH = Math.max(2, Math.round(2 * dpr));
      const bw = (width - gap * (bars - 1)) / bars;
      const usable = height - peakH - 2 * dpr;
      const canRound = supportsRoundRect(c2d);
      c2d.fillStyle = grad;
      for (let i = 0; i < bars; i++) {
        const v = reduced ? 0.08 : levels[i];
        const x = i * (bw + gap);
        const h = Math.max(minH, Math.round(v * usable));
        const y = height - h;
        if (canRound) {
          c2d.beginPath();
          c2d.roundRect(x, y, bw, h, Math.min(bw / 2, 3 * dpr));
          c2d.fill();
        } else {
          c2d.fillRect(x, y, bw, h);
        }
        if (!reduced && peaks[i] > 0.04) {
          const py = height - Math.max(minH, Math.round(peaks[i] * usable)) - peakH - dpr;
          c2d.globalAlpha = 0.75;
          c2d.fillRect(x, Math.max(0, py), bw, peakH);
          c2d.globalAlpha = 1;
        }
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [reduced, enabled]);

  return (
    /* 频谱条形区域绝对铺满整行（与进度条同宽），视觉中心对齐进度条正中；
       开关按钮悬浮右上角不占布局宽度，不挤偏频谱 */
    <div className="relative h-10 lg:h-12" role="group" aria-label="频谱">
      {/* 展开/收起：纯 scaleX+opacity 合成层动画（origin-center 从中线对称展开，
          零布局开销、canvas 分辨率不抖动）；退出快于进入；reduced-motion 直切。
          状态由 React state 直接驱动，动画可随时中断（可取消状态转换） */}
      <AnimatePresence initial={false}>
        {enabled && (
          <motion.div
            key="spectrum-canvas"
            initial={reduced ? false : { opacity: 0, scaleX: 0.55 }}
            animate={{ opacity: 1, scaleX: 1 }}
            exit={
              reduced
                ? { opacity: 0, transition: { duration: 0.01 } }
                : { opacity: 0, scaleX: 0.55, transition: { duration: 0.16, ease: "easeIn" } }
            }
            transition={reduced ? { duration: 0.01 } : { type: "spring", stiffness: 380, damping: 30 }}
            className="absolute inset-0 origin-center"
          >
            <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" />
          </motion.div>
        )}
      </AnimatePresence>
      {/* 开关：右上角悬浮；after 伪元素扩展热区（32px 视觉 + 8px 外扩 = 48px 触控达标） */}
      <motion.button
        layout
        onClick={toggle}
        aria-pressed={enabled}
        aria-label={enabled ? "关闭频谱显示" : "开启频谱显示"}
        title={enabled ? "关闭频谱" : "开启频谱"}
        className={`absolute right-0 top-0 z-10 flex h-8 w-8 items-center justify-center rounded-full transition-colors after:absolute after:-inset-2 after:content-[''] active:scale-90 ${
          enabled ? "text-fuchsia-300/80 hover:bg-white/[0.06] hover:text-fuchsia-200" : "text-zinc-600 hover:bg-white/[0.06] hover:text-zinc-300"
        }`}
      >
        {/* 双态图标弹入：scale+rotate spring，开关切换的即时视觉确认 */}
        <motion.span
          key={enabled ? "on" : "off"}
          initial={reduced ? false : { scale: 0.3, rotate: -45, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={reduced ? { duration: 0.01 } : { type: "spring", stiffness: 520, damping: 20 }}
          className="flex"
        >
          <Activity className="h-4 w-4" aria-hidden="true" />
        </motion.span>
      </motion.button>
    </div>
  );
});

/** roundRect 能力检测（函数封装打断 TS 对 "roundRect in ctx" 的 never 收窄） */
function supportsRoundRect(ctx: CanvasRenderingContext2D): boolean {
  return typeof ctx.roundRect === "function";
}
