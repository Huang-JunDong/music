/**
 * 视频歌词渲染会话 — 移植 internal/web/videogen.go（会话存内存，
 * ffmpeg 检测 where/which，拼帧 + 音频合成 mp4）。
 */
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ffmpegPath } from "./env";

export interface RenderSession {
  id: string;
  tempDir: string;
  /** multipart 上传的自定义音频绝对路径（无则用 song 在线下载） */
  customAudioPath: string;
  song: { id: string; source: string };
  audioUrl: string;
  frames: Buffer[];
  total: number;
  createdAt: number;
  lastActive: number;
}

interface VideogenState {
  sessions: Map<string, RenderSession>;
}

const g = globalThis as unknown as { __videogenState?: VideogenState };

function state(): VideogenState {
  if (!g.__videogenState) g.__videogenState = { sessions: new Map() };
  return g.__videogenState;
}

export function videosDir(): string {
  const dir = path.join(process.cwd(), "data", "videos");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getSession(sessionId: string): RenderSession | null {
  return state().sessions.get(sessionId ?? "") ?? null;
}

export function takeSession(sessionId: string): RenderSession | null {
  const sess = state().sessions.get(sessionId ?? "") ?? null;
  if (sess) state().sessions.delete(sessionId);
  return sess;
}

/** 会话与帧数上限（审核 5.4 / A-06：未授权可反复 init+frame，须防内存/磁盘耗尽） */
export const MAX_RENDER_SESSIONS = 32;
/** 3 分钟 @30fps 上限，超出视为异常请求（正常逐字歌词渲染远小于此） */
export const MAX_FRAMES_PER_SESSION = 5400;

export class VideogenSessionLimitError extends Error {
  constructor() {
    super(`too many active render sessions (max ${MAX_RENDER_SESSIONS})`);
    this.name = "VideogenSessionLimitError";
  }
}

export class VideogenFrameLimitError extends Error {
  constructor(max: number) {
    super(`frame limit exceeded: max ${max} frames per session`);
    this.name = "VideogenFrameLimitError";
  }
}

export function createSession(input: {
  songId: string;
  source: string;
  customAudioPath?: string;
  audioUrl?: string;
}): RenderSession {
  // 审核整改 A-06：入口惰性清理超时会话（原 cleanupOldSessions 为死代码，会话/帧永不释放）
  cleanupOldSessions();
  if (state().sessions.size >= MAX_RENDER_SESSIONS) {
    throw new VideogenSessionLimitError();
  }
  const sanitizedId = (input.songId ?? "").replace(/[|/:\\]/g, "-");
  const sessionId = `${input.source}_${sanitizedId}_${Math.floor(Date.now() / 1000)}`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `vg_render_${sessionId}_`));
  const now = Date.now();
  const session: RenderSession = {
    id: sessionId,
    tempDir,
    customAudioPath: input.customAudioPath ?? "",
    song: { id: input.songId, source: input.source },
    audioUrl: input.audioUrl ?? "",
    frames: [],
    total: 0,
    createdAt: now,
    lastActive: now,
  };
  state().sessions.set(sessionId, session);
  return session;
}

/** 按序追加帧（startIdx 必须等于当前总数，防止乱序/重复；总量上限防资源耗尽，审核 A-06） */
export function addFrames(session: RenderSession, frames: Buffer[], startIdx: number): Error | null {
  if (startIdx !== session.total) {
    return new Error(`frame batch out of order: got ${startIdx}, want ${session.total}`);
  }
  if (session.total + frames.length > MAX_FRAMES_PER_SESSION) {
    return new VideogenFrameLimitError(MAX_FRAMES_PER_SESSION);
  }
  for (const frame of frames) session.frames.push(frame);
  session.total += frames.length;
  session.lastActive = Date.now();
  return null;
}

export function cleanupSession(session: RenderSession): void {
  try {
    fs.rmSync(session.tempDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

/** 清理超时会话（30 分钟；由 createSession 入口惰性触发，审核 A-06） */
export function cleanupOldSessions(maxIdleMs = 30 * 60_000): void {
  const now = Date.now();
  for (const [id, sess] of state().sessions) {
    if (now - sess.lastActive > maxIdleMs) {
      state().sessions.delete(id);
      cleanupSession(sess);
    }
  }
}

/** 优雅退出（审核 5.10 / A-19）：SIGTERM/SIGINT 时清空全部会话与临时目录 */
export function shutdownVideogen(): void {
  for (const sess of state().sessions.values()) cleanupSession(sess);
  state().sessions.clear();
}

/** 启动清扫：删除上次运行遗留的 vg_render_* 临时目录（含上传音频；审核 A-19） */
export function sweepAbandonedVideogenTempDirs(): void {
  const tmp = os.tmpdir();
  let entries: string[];
  try {
    entries = fs.readdirSync(tmp);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.startsWith("vg_render_")) continue;
    try {
      fs.rmSync(path.join(tmp, name), { recursive: true, force: true });
    } catch {
      /* 单个目录清理失败不阻断 */
    }
  }
}

/* ---------------- ffmpeg ---------------- */

let ffmpegCache: string | null | undefined;

function runCommand(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    // 审核整改 A-01：execFile 直传参数数组（不经 shell），彻底消除引号拼接命令注入面
    execFile(
      cmd,
      args,
      { windowsHide: true, timeout: 10_000 },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      },
    );
  });
}

/** 探测 ffmpeg（PATH 优先 → MUSIC_DL_FFMPEG → ffmpeg-static 兜底），结果进程内缓存 */
export async function resolveFFmpeg(): Promise<string | null> {
  if (ffmpegCache !== undefined) return ffmpegCache;
  try {
    const out = await runCommand(process.platform === "win32" ? "where" : "which", ["ffmpeg"]);
    const first = out.split(/\r?\n/).map((l) => l.trim()).find((l) => !!l);
    if (first) {
      ffmpegCache = first;
      return ffmpegCache;
    }
  } catch {
    /* fallthrough */
  }
  const envPath = ffmpegPath();
  if (envPath) {
    ffmpegCache = envPath;
    return ffmpegCache;
  }
  ffmpegCache = resolveFFmpegStaticFallback();
  return ffmpegCache;
}

function resolveFFmpegStaticFallback(): string | null {
  try {
    const staticFFmpeg = createRequire(import.meta.url)("ffmpeg-static") as string | undefined;
    if (staticFFmpeg && typeof staticFFmpeg === "string") return staticFFmpeg;
  } catch {
    /* not installed */
  }
  return null;
}

export interface RenderOptions {
  /** 无自定义音频时，下载音频字节（返回 Buffer） */
  fetchAudio?: () => Promise<Buffer>;
  framerate?: number;
  timeoutMs?: number;
}

/** 拼帧渲染 mp4：帧写临时目录 frame_%05d.jpg → ffmpeg 合成 → data/videos */
export async function renderVideo(
  session: RenderSession,
  options: RenderOptions,
): Promise<{ outName: string; filePath: string }> {
  const ffmpeg = await resolveFFmpeg();
  if (!ffmpeg) throw new FFmpegUnavailableError();

  if (session.frames.length === 0) throw new Error("no frames uploaded");

  // 写帧文件
  for (let i = 0; i < session.frames.length; i++) {
    fs.writeFileSync(path.join(session.tempDir, `frame_${String(i).padStart(5, "0")}.jpg`), session.frames[i]);
  }

  // 音频：自定义文件或在线下载
  let audioPath = "";
  if (session.customAudioPath && fs.existsSync(session.customAudioPath)) {
    audioPath = session.customAudioPath;
  } else if (options.fetchAudio) {
    const data = await options.fetchAudio();
    audioPath = path.join(session.tempDir, "audio.bin");
    fs.writeFileSync(audioPath, data);
  }

  const outName = `render_${session.id}_${Math.floor(Date.now() / 1000)}.mp4`;
  const outPath = path.join(videosDir(), outName);
  const framerate = options.framerate ?? 30;

  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-framerate",
    String(framerate),
    "-i",
    "frame_%05d.jpg",
  ];
  if (audioPath) args.push("-i", audioPath);
  args.push("-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p");
  if (audioPath) args.push("-c:a", "aac", "-b:a", "320k", "-shortest");
  args.push(outPath);

  await new Promise<void>((resolve, reject) => {
    // 审核整改 A-01：execFile 直传参数数组（不经 shell），配合 init 路由的输入白名单
    execFile(
      ffmpeg,
      args,
      { windowsHide: true, cwd: session.tempDir, timeout: options.timeoutMs ?? 180_000, maxBuffer: 8 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        if (err) {
          reject(new Error(`ffmpeg failed: ${String(stderr ?? err.message).trim().slice(0, 500)}`));
        } else {
          resolve();
        }
      },
    );
  });

  return { outName, filePath: outPath };
}

export class FFmpegUnavailableError extends Error {
  constructor() {
    super("ffmpeg unavailable");
    this.name = "FFmpegUnavailableError";
  }
}
