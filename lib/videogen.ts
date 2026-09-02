/**
 * 视频歌词渲染会话 — 移植 internal/web/videogen.go（会话存内存，
 * ffmpeg 检测 where/which，拼帧 + 音频合成 mp4）。
 */
import { exec } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

export function createSession(input: {
  songId: string;
  source: string;
  customAudioPath?: string;
  audioUrl?: string;
}): RenderSession {
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

/** 按序追加帧（startIdx 必须等于当前总数，防止乱序/重复） */
export function addFrames(session: RenderSession, frames: Buffer[], startIdx: number): Error | null {
  if (startIdx !== session.total) {
    return new Error(`frame batch out of order: got ${startIdx}, want ${session.total}`);
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

/** 清理超时会话（30 分钟） */
export function cleanupOldSessions(maxIdleMs = 30 * 60_000): void {
  const now = Date.now();
  for (const [id, sess] of state().sessions) {
    if (now - sess.lastActive > maxIdleMs) {
      state().sessions.delete(id);
      cleanupSession(sess);
    }
  }
}

/* ---------------- ffmpeg ---------------- */

let ffmpegCache: string | null | undefined;

function runCommand(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(
      [cmd, ...args.map((a) => `"${a}"`)].join(" "),
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
  const envPath = (process.env.MUSIC_DL_FFMPEG ?? "").trim();
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
    exec(
      [ffmpeg, ...args.map((a) => `"${a}"`)].join(" "),
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
