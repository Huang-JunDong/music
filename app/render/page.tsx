"use client";

/**
 * 歌词视频渲染页（对齐 Go render.html / videogen.js 流程，词级 karaoke 增强）：
 * 选歌（播放中曲目或 URL 参数）→ init 会话 → canvas 30fps 绘帧
 * （封面旋转 + 渐变背景 + 逐字 karaoke 歌词：YRC/QRC/KRC 词级渐进填充、译文/罗马音副行、
 *  行级渠道自动降级为整行进度填充）→ 每 30 帧批量上传（start_idx 严格递增）
 * → finish 合成 → 预览 / 下载。
 * 性能：歌词在渲染前一次性预布局（分词测量 + 自动换行 + 时间轴插值），帧循环零 measureText。
 * 服务端无 ffmpeg 时提示 501。
 */
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import {
  Clapperboard, Loader2, Play, Download, RotateCcw, Music4, Upload, Film,
} from "lucide-react";
import { toast } from "sonner";
import type { Song } from "@/lib/types";
import { usePlayer } from "@/lib/client/store";
import { coverUrl, coverProxyUrl, sourceMeta } from "@/lib/play-url";
import { parseLrcClient, type ClientLyricLine } from "@/lib/lrc-client";
import { PageHeader } from "@/components/page-header";
import {
  buildLineBlocks,
  clipRenderText,
  RENDER_MAIN_ROW_H,
  RENDER_SUB_ROW_H,
  type LineBlock,
} from "@/lib/render-layout";

const FPS = 30;
const BATCH = 30;
const CANVAS_W = 720;
const CANVAS_H = 1280;

const FONT_STACK = "system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif";
const MAIN_FONT = `600 42px ${FONT_STACK}`;
const SUB_ROMA_FONT = `italic 27px ${FONT_STACK}`;
const SUB_TRANS_FONT = `27px ${FONT_STACK}`;
const FADE_IN_MS = 220; // 当前行淡入时长

type Stage = "idle" | "loading-audio" | "rendering" | "finishing" | "done";

export default function RenderPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[60dvh] items-center justify-center" role="status"><Loader2 className="h-6 w-6 animate-spin text-fuchsia-300" /></div>}>
      <RenderPageInner />
    </Suspense>
  );
}

function RenderPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const currentSong = usePlayer((s) => (s.index >= 0 ? s.queue[s.index] : null));

  const [song, setSong] = useState<Song | null>(null);
  const [customAudio, setCustomAudio] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const cancelRef = useRef(false);

  /* URL 参数选歌（从歌单/搜索页“渲染”入口跳转） */
  useEffect(() => {
    const id = params.get("id");
    const source = params.get("source");
    if (id && source) {
      setSong({
        id,
        source,
        name: params.get("name") ?? "未命名",
        artist: params.get("artist") ?? "",
        album: params.get("album") ?? "",
        album_id: params.get("album_id") ?? "",
        duration: parseInt(params.get("duration") ?? "0", 10) || 0,
        size: 0,
        bitrate: 0,
        url: "",
        ext: "",
        cover: params.get("cover") ?? "",
        link: "",
      });
    } else if (currentSong) {
      setSong(currentSong);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickAudio = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setCustomAudio(file);
  };

  /* ---------------- 帧绘制 ---------------- */

  const drawFrame = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      t: number,
      duration: number,
      blocks: LineBlock[],
      coverImg: HTMLImageElement | null,
      s: Song,
    ) => {
      const W = CANVAS_W;
      const H = CANVAS_H;
      const nowMs = t * 1000;

      // 背景：深色渐变 + 封面放大模糊（若有）
      ctx.fillStyle = "#0a0a12";
      ctx.fillRect(0, 0, W, H);
      if (coverImg) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        const scale = Math.max(W / coverImg.width, H / coverImg.height) * 1.15;
        const dw = coverImg.width * scale;
        const dh = coverImg.height * scale;
        const breathe = 1 + 0.03 * Math.sin((t / duration) * Math.PI * 6);
        ctx.drawImage(coverImg, (W - dw * breathe) / 2, (H - dh * breathe) / 2, dw * breathe, dh * breathe);
        ctx.restore();
        // 压暗遮罩
        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, "rgba(8,8,16,0.55)");
        grad.addColorStop(1, "rgba(8,8,16,0.88)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
      }

      // 旋转封面唱片
      const cx = W / 2;
      const cy = H * 0.3;
      const r = 190;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((t * 0.6) % (Math.PI * 2));
      if (coverImg) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(coverImg, -r, -r, r * 2, r * 2);
        ctx.restore();
      } else {
        const g = ctx.createLinearGradient(-r, -r, r, r);
        g.addColorStop(0, "#7c3aed");
        g.addColorStop(1, "#d946ef");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
      }
      // 唱片边缘 + 中心轴
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(0, 0, r + 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(10,10,18,0.92)";
      ctx.beginPath();
      ctx.arc(0, 0, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 标题 / 歌手
      ctx.textAlign = "left";
      ctx.font = `bold 44px ${FONT_STACK}`;
      const titleText = clipRenderText(ctx, s.name, W - 120);
      ctx.fillStyle = "rgba(255,255,255,0.96)";
      ctx.fillText(titleText, (W - ctx.measureText(titleText).width) / 2, cy + r + 90);
      ctx.font = `30px ${FONT_STACK}`;
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      const artistText = clipRenderText(ctx, s.artist || "未知歌手", W - 160);
      ctx.fillText(artistText, (W - ctx.measureText(artistText).width) / 2, cy + r + 140);

      /* ---------- 歌词：词级 karaoke 渐进填充 ---------- */
      if (blocks.length) {
        let curIdx = -1;
        for (let i = 0; i < blocks.length; i++) {
          if (blocks[i].time <= nowMs) curIdx = i;
          else break;
        }

        const lyricBottom = H - 150;
        let y = H * 0.55;
        // 先向上为当前行上方的块预留高度，使当前行基本居于窗口中部
        const showFrom = Math.max(0, curIdx - 2);
        for (let i = showFrom; i < curIdx; i++) y -= blocks[i].height;

        for (let li = showFrom; li <= Math.min(blocks.length - 1, curIdx + 2); li++) {
          const block = blocks[li];
          if (y + block.height > lyricBottom && li > curIdx) break;
          const isCur = li === curIdx;
          // 行首淡入
          const alpha = isCur ? Math.min(1, 0.55 + (0.45 * Math.min(FADE_IN_MS, nowMs - block.time)) / FADE_IN_MS) : 1;
          ctx.globalAlpha = alpha;

          // 当前块主行渐变（跨整个歌词窗口宽度，颜色随填充位置连续）
          let shine: CanvasGradient | null = null;
          if (isCur) {
            shine = ctx.createLinearGradient(60, 0, W - 60, 0);
            shine.addColorStop(0, "#c4b5fd");
            shine.addColorStop(0.5, "#f0abfc");
            shine.addColorStop(1, "#67e8f9");
          }

          let rowY = y;
          for (const row of block.rows) {
            let x = (W - row.w) / 2;
            for (const seg of row.segs) {
              ctx.font = MAIN_FONT;
              if (!isCur) {
                ctx.fillStyle = li < curIdx ? "rgba(255,255,255,0.26)" : "rgba(255,255,255,0.48)";
                ctx.fillText(seg.text, x, rowY);
              } else {
                // 底字
                ctx.fillStyle = "rgba(255,255,255,0.36)";
                ctx.fillText(seg.text, x, rowY);
                // 已唱部分：按词内进度裁剪填充（karaoke 逐字）
                const p =
                  nowMs <= seg.start ? 0 : nowMs >= seg.end ? 1 : (nowMs - seg.start) / Math.max(1, seg.end - seg.start);
                if (p > 0 && shine) {
                  ctx.save();
                  ctx.beginPath();
                  ctx.rect(x, rowY - 46, seg.w * p + 0.75, 56);
                  ctx.clip();
                  ctx.fillStyle = shine;
                  ctx.shadowColor = "rgba(240,171,252,0.6)";
                  ctx.shadowBlur = 16;
                  ctx.fillText(seg.text, x, rowY);
                  ctx.restore();
                }
              }
              x += seg.w;
            }
            rowY += RENDER_MAIN_ROW_H;
          }

          // 副行：罗马音（斜体 cyan）/ 译文（fuchsia）
          if (block.romaji) {
            ctx.font = SUB_ROMA_FONT;
            ctx.fillStyle = isCur ? "rgba(165,243,252,0.82)" : "rgba(255,255,255,0.22)";
            const w = ctx.measureText(block.romaji).width;
            ctx.fillText(block.romaji, (W - w) / 2, rowY);
            rowY += RENDER_SUB_ROW_H;
          }
          if (block.translation) {
            ctx.font = SUB_TRANS_FONT;
            ctx.fillStyle = isCur ? "rgba(240,171,252,0.85)" : "rgba(255,255,255,0.22)";
            const w = ctx.measureText(block.translation).width;
            ctx.fillText(block.translation, (W - w) / 2, rowY);
            rowY += RENDER_SUB_ROW_H;
          }

          ctx.globalAlpha = 1;
          y += block.height;
        }
      }

      // 进度条
      const pbY = H - 90;
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      roundRect(ctx, 70, pbY, W - 140, 8, 4);
      ctx.fill();
      const pg = ctx.createLinearGradient(70, 0, W - 70, 0);
      pg.addColorStop(0, "#a78bfa");
      pg.addColorStop(1, "#e879f9");
      ctx.fillStyle = pg;
      roundRect(ctx, 70, pbY, (W - 140) * Math.min(1, t / Math.max(1, duration)), 8, 4);
      ctx.fill();
    },
    [],
  );

  /* ---------------- 主流程 ---------------- */

  const start = useCallback(async () => {
    if (!song) {
      toast.error("请先播放或从歌曲菜单选择一首歌");
      return;
    }
    if (!customAudio && !song.id) return;
    cancelRef.current = false;
    setVideoUrl("");
    setProgress(0);

    try {
      /* 1. init */
      setStage("loading-audio");
      setStatusText("创建渲染会话…");
      const initForm = new FormData();
      initForm.append("id", song.id);
      initForm.append("source", song.source);
      if (customAudio) initForm.append("audio_file", customAudio);
      const initResp = await fetch("/api/videogen/init", { method: "POST", body: initForm });
      const initData = await initResp.json();
      if (!initResp.ok || !initData.session_id) throw new Error(initData.error ?? "init failed");
      const sessionId = initData.session_id as string;

      /* 2. 加载音频时长（自定义音频直接 decode；在线音频拉流 decode） */
      setStatusText("加载音频…");
      const audioUrl = customAudio ? URL.createObjectURL(customAudio) : initData.audio_url;
      const audioBuf = await fetch(audioUrl)
        .then((r) => {
          if (!r.ok) throw new Error(`音频加载失败 HTTP ${r.status}`);
          return r.arrayBuffer();
        });
      const AC: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const actx = new AC();
      const decoded = await actx.decodeAudioData(audioBuf);
      const duration = decoded.duration;
      await actx.close();

      /* 3. 歌词（format=auto → verbatim 原文：YRC/QRC/KRC 词级时间戳 + 译文/罗马音行） */
      setStatusText("加载歌词…");
      let lyrics: ClientLyricLine[] = [];
      try {
        const lp = new URLSearchParams({ id: song.id, source: song.source, name: song.name, artist: song.artist, album: song.album, duration: String(Math.floor(duration)), cover: song.cover });
        const lrcResp = await fetch(`/api/lyric?${lp.toString()}`);
        const lrcText = await lrcResp.text();
        lyrics = parseLrcClient(lrcText).filter((l) => l.text?.trim());
      } catch {
        /* 纯音乐 */
      }

      /* 4. 封面 */
      let coverImg: HTMLImageElement | null = null;
      if (song.cover) {
        coverImg = await new Promise<HTMLImageElement | null>((resolve) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = coverProxyUrl(song.cover, song.source);
        });
      }

      /* 5. 离屏渲染 */
      setStage("rendering");
      const canvas = document.createElement("canvas");
      canvas.width = CANVAS_W;
      canvas.height = CANVAS_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas unavailable");

      // 预布局歌词（一次性；帧循环零 measureText，长歌也不掉帧）
      setStatusText("排版歌词…");
      const blocks = buildLineBlocks(ctx, lyrics, duration, CANVAS_W, {
        mainFont: MAIN_FONT,
        subRomaFont: SUB_ROMA_FONT,
        subTransFont: SUB_TRANS_FONT,
      });

      const previewCtx = previewRef.current?.getContext("2d") ?? null;
      const totalFrames = Math.floor(duration * FPS);
      let uploaded = 0;

      const toBlob = (quality = 0.85): Promise<Blob> =>
        new Promise((resolve, reject) => {
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error("Frame encode failed"))),
            "image/jpeg",
            quality,
          );
        });

      let batch: Blob[] = [];
      for (let f = 0; f < totalFrames; f++) {
        if (cancelRef.current) {
          toast.info("已取消渲染");
          setStage("idle");
          return;
        }
        const t = f / FPS;
        drawFrame(ctx, t, duration, blocks, coverImg, song);
        if (previewCtx && f % 6 === 0) {
          previewCtx.canvas.width = CANVAS_W;
          previewCtx.canvas.height = CANVAS_H;
          previewCtx.drawImage(canvas, 0, 0);
        }
        batch.push(await toBlob());
        if (batch.length >= BATCH || f === totalFrames - 1) {
          const form = new FormData();
          form.append("session_id", sessionId);
          form.append("start_idx", String(uploaded));
          batch.forEach((blob, i) => form.append("frames", blob, `frame_${String(uploaded + i).padStart(5, "0")}.jpg`));
          const resp = await fetch("/api/videogen/frame", { method: "POST", body: form });
          const data = await resp.json();
          if (!resp.ok) throw new Error(data.error ?? "frame upload failed");
          uploaded += batch.length;
          batch = [];
          setProgress(Math.round((uploaded / totalFrames) * 92));
          setStatusText(`逐帧渲染中 ${uploaded}/${totalFrames}（约 ${Math.round((uploaded / FPS) / 60)} 分 ${Math.floor((uploaded / FPS) % 60)} 秒处）`);
        }
        if (f % 30 === 0) await new Promise((r) => setTimeout(r, 0)); // 让出主线程
      }

      /* 6. finish */
      setStage("finishing");
      setStatusText("服务端合成视频（ffmpeg）…");
      setProgress(95);
      const finResp = await fetch("/api/videogen/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, name: `${song.artist} - ${song.name}` }),
      });
      const finData = await finResp.json();
      if (finResp.status === 501) throw new Error("ffmpeg 不可用（内置二进制缺失且系统未安装），无法合成视频");
      if (!finResp.ok || !finData.url) throw new Error(finData.error ?? "render failed");

      setVideoUrl(finData.url);
      setProgress(100);
      setStage("done");
      setStatusText("渲染完成");
      toast.success("视频渲染完成");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "渲染失败");
      setStage("idle");
      setStatusText("");
    }
  }, [song, customAudio, drawFrame]);

  const meta = song ? sourceMeta(song.source) : null;

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-6 lg:px-8 lg:py-10">
      <PageHeader
        icon={Clapperboard}
        title="歌词视频渲染"
        subtitle="canvas 逐帧绘制（词级 karaoke 逐字高亮）→ 服务端 ffmpeg 合成 MP4（30fps 竖屏 720×1280）"
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        {/* 预览画布 */}
        <div className="glass overflow-hidden rounded-3xl border border-white/[0.1]">
          <div className="relative aspect-[9/16] max-h-[70dvh] w-full bg-black">
            {stage === "done" && videoUrl ? (
              <video src={videoUrl} controls playsInline className="h-full w-full object-contain" />
            ) : (
              <canvas ref={previewRef} className="h-full w-full object-contain" aria-label="渲染预览" />
            )}
            {(stage === "rendering" || stage === "loading-audio" || stage === "finishing") && (
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-4">
                <p className="mb-2 flex items-center gap-2 text-[13px] text-zinc-200">
                  <Loader2 className="h-4 w-4 animate-spin text-fuchsia-300" />
                  {statusText || "准备中…"}
                </p>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/15">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-violet-400 to-fuchsia-400"
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
                <p className="mt-1 text-right text-[11px] tabular-nums text-zinc-400">{progress}%</p>
              </div>
            )}
          </div>
        </div>

        {/* 控制面板 */}
        <div className="flex flex-col gap-4">
          <div className="glass rounded-3xl border border-white/[0.1] p-4">
            <p className="mb-3 flex items-center gap-1.5 text-[13px] font-semibold text-zinc-300">
              <Music4 className="h-4 w-4 text-fuchsia-300" aria-hidden="true" /> 渲染曲目
            </p>
            {song ? (
              <div className="flex items-center gap-3">
                <span className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-zinc-800">
                  {song.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={coverUrl(song)} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Music4 className="m-auto h-5 w-5 text-zinc-500" aria-hidden="true" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-zinc-100" title={`${song.name} - ${song.artist || "未知歌手"}`}>{song.name}</p>
                  <p className="truncate text-xs text-zinc-500">
                    {song.artist || "未知歌手"} {meta && <span className={`ml-1 rounded border px-1 text-[9px] ${meta.badge}`}>{meta.label}</span>}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-[13px] leading-relaxed text-zinc-500">
                播放一首歌后自动带入；或在歌曲列表「更多」菜单中跳转本页（带曲目参数）。
              </p>
            )}
            <button
              onClick={() => router.push("/")}
              className="mt-3 flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-xl border border-white/[0.1] text-[13px] text-zinc-400 transition-colors hover:border-violet-400/40 hover:text-zinc-200"
            >
              去选歌
            </button>
          </div>

          <div className="glass rounded-3xl border border-white/[0.1] p-4">
            <p className="mb-3 flex items-center gap-1.5 text-[13px] font-semibold text-zinc-300">
              <Upload className="h-4 w-4 text-cyan-300" aria-hidden="true" /> 自定义音频（可选）
            </p>
            <label className="flex min-h-[46px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-white/[0.12] text-[13px] text-zinc-400 transition-colors hover:border-cyan-400/40 hover:text-zinc-200">
              {customAudio ? customAudio.name : "选择本地音频文件（mp3 / flac / m4a）"}
              <input type="file" accept="audio/*" onChange={pickAudio} className="hidden" aria-label="选择音频文件" />
            </label>
            {customAudio && (
              <button onClick={() => setCustomAudio(null)} className="mt-2 text-[12px] text-zinc-500 hover:text-red-300">
                移除自定义音频
              </button>
            )}
          </div>

          <div className="flex flex-col gap-2">
            {stage === "idle" || stage === "done" ? (
              <button
                onClick={start}
                disabled={!song}
                className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-sm font-bold text-white shadow-lg shadow-fuchsia-500/25 transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
              >
                <Play className="h-4 w-4" fill="currentColor" aria-hidden="true" />
                开始渲染{song && song.duration ? `（约 ${Math.ceil(song.duration / 60)} 分钟）` : ""}
              </button>
            ) : (
              <button
                onClick={() => {
                  cancelRef.current = true;
                }}
                className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border border-red-400/40 text-sm font-bold text-red-300 transition-colors hover:bg-red-500/10"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                取消渲染
              </button>
            )}
            {stage === "done" && videoUrl && (
              <a
                href={videoUrl}
                download
                className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border border-emerald-400/40 text-sm font-bold text-emerald-300 transition-colors hover:bg-emerald-500/10"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                下载 MP4
              </a>
            )}
          </div>

          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 text-[11.5px] leading-relaxed text-zinc-500">
            <p className="mb-1 flex items-center gap-1.5 font-medium text-zinc-400">
              <Film className="h-3.5 w-3.5" aria-hidden="true" /> 说明
            </p>
            <p>
              网易云 / QQ / 酷狗歌词为逐字 karaoke 高亮（原文渐变填充 + 罗马音 / 译文副行），其他渠道为整行进度填充；
              歌词预先排版（自动换行 + 词级时间轴），渲染在前端逐帧绘制（30fps JPEG）按 30 帧批量上传，服务端 ffmpeg 合成。长歌曲渲染耗时较长，请保持页面在前台。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 绘图工具 ---------------- */

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
