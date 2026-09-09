/**
 * 播放历史持久化（会话隔离，审核整改 P1-1）— 列布局对齐 saved_songs（song_id/source/extra/name/artist/cover/duration），
 * added_at 换 played_at。每浏览器会话（music_dl_hist_sid，HttpOnly 匿名随机标识，服务端签发）各自独立：
 * 同源同曲去重置顶、单会话上限 100 条，会话间互不可见、互不污染（听歌记录属个人信息，禁止跨会话回放）。
 * sid Cookie 过期后的残留数据由写入路径的保留期清理（90 天）兜底回收。
 */
import type Database from "better-sqlite3";
import { getDB } from "./store";
import type { Song } from "./types";

/** 单会话历史上限（与前端 store history slice(0, 100) 一致） */
export const PLAY_HISTORY_LIMIT = 100;

/** 历史保留期（天）：sid 失效后孤儿数据的兜底清理（隐私最小化，审核 P1-1 配套） */
export const PLAY_HISTORY_RETENTION_DAYS = 90;

interface PlayHistoryRow {
  id: number;
  session_key: string;
  song_id: string;
  source: string;
  extra: string;
  name: string;
  artist: string;
  cover: string;
  duration: number;
  played_at: string;
}

/** POST /api/history 的 body（对齐 apiAddSongToCollection 的字段口径） */
export interface PlayHistoryInput {
  id?: string;
  source?: string;
  name?: string;
  artist?: string;
  album?: string;
  album_id?: string;
  cover?: string;
  duration?: number;
  link?: string;
  size?: number;
  bitrate?: number;
  ext?: string;
  extra?: unknown;
}

/** sid 格式（randomUUID 小写输出；白名单防任意字符串充当会话键） */
const HISTORY_SID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 会话键合法性校验（纯函数） */
export function isValidHistorySid(v: unknown): v is string {
  return typeof v === "string" && HISTORY_SID_RE.test(v);
}

/**
 * POST body 规整（纯函数，审核整改 P2-1）：
 * id/source 非字符串或 trim 后为空 → null（路由层 400）；
 * 其余字段类型非法时静默归默认，杜绝 `(123).trim()` / NaN 绑定 better-sqlite3 抛错致 500。
 */
export function sanitizePlayHistoryBody(raw: unknown): PlayHistoryInput | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id.trim() : "";
  const source = typeof r.source === "string" ? r.source.trim() : "";
  if (!id || !source) return null;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const positiveNum = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
  const extra: Record<string, string> = {};
  if (r.extra && typeof r.extra === "object" && !Array.isArray(r.extra)) {
    for (const [k, v] of Object.entries(r.extra as Record<string, unknown>)) {
      if (typeof v === "string") extra[k] = v;
    }
  }
  return {
    id,
    source,
    name: str(r.name).trim(),
    artist: str(r.artist).trim(),
    album: str(r.album),
    album_id: str(r.album_id) || undefined,
    cover: str(r.cover),
    duration: positiveNum(r.duration),
    link: str(r.link),
    size: positiveNum(r.size),
    bitrate: positiveNum(r.bitrate),
    ext: str(r.ext) || undefined,
    extra,
  };
}

/* 模块级语句缓存（审核整改 P3-2）：getDB 为进程单例，prepare 一次复用；
 * 局限登记（标准 5.10）：多实例部署时各进程独立缓存，模块加载不触 DB（惰性初始化）。 */
interface HistoryStatements {
  dedup: Database.Statement;
  insert: Database.Statement;
  trim: Database.Statement;
  sweep: Database.Statement;
  list: Database.Statement;
  clear: Database.Statement;
  record: (p: PendingRecord, sessionKey: string) => void;
}
let cachedStmts: HistoryStatements | null = null;

function stmts(): HistoryStatements {
  if (!cachedStmts) {
    const db = getDB();
    const s = {
      dedup: db.prepare("DELETE FROM play_history WHERE session_key = ? AND song_id = ? AND source = ?"),
      insert: db.prepare(
        `INSERT INTO play_history (session_key, song_id, source, extra, name, artist, cover, duration, played_at)
         VALUES (?,?,?,?,?,?,?,?, datetime('now'))`,
      ),
      trim: db.prepare(
        `DELETE FROM play_history WHERE session_key = ? AND id NOT IN
           (SELECT id FROM play_history WHERE session_key = ? ORDER BY id DESC LIMIT ?)`,
      ),
      sweep: db.prepare(`DELETE FROM play_history WHERE played_at < datetime('now', ?)`),
      list: db.prepare("SELECT * FROM play_history WHERE session_key = ? ORDER BY id DESC LIMIT ?"),
      clear: db.prepare("DELETE FROM play_history WHERE session_key = ?"),
    };
    cachedStmts = {
      ...s,
      record: db.transaction((p: PendingRecord, sessionKey: string) => {
        s.dedup.run(sessionKey, p.id, p.source);
        s.insert.run(sessionKey, p.id, p.source, p.extraStr, p.name, p.artist, p.cover, p.duration);
        s.trim.run(sessionKey, sessionKey, PLAY_HISTORY_LIMIT);
        s.sweep.run(`-${PLAY_HISTORY_RETENTION_DAYS} days`);
      }),
    };
  }
  return cachedStmts;
}

interface PendingRecord {
  id: string;
  source: string;
  extraStr: string;
  name: string;
  artist: string;
  cover: string;
  duration: number;
}

/** 记录一次播放到指定会话：同源同曲去重置顶（事务内 DELETE→INSERT），超上限裁最旧，顺带清理超保留期数据 */
export function recordPlayHistory(sessionKey: string, song: PlayHistoryInput): void {
  if (!isValidHistorySid(sessionKey)) return;
  const id = (song.id ?? "").trim();
  const source = (song.source ?? "").trim();
  if (!id || !source) return;

  /* extra：源特有元数据 + 恢复播放所需字段（album/link 等），JSON 编码（对齐 saved_songs.extra） */
  const extraObj: Record<string, unknown> = {};
  if (song.extra && typeof song.extra === "object" && !Array.isArray(song.extra)) {
    for (const [k, v] of Object.entries(song.extra as Record<string, unknown>)) {
      if (typeof v === "string") extraObj[k] = v;
    }
  }
  for (const key of ["album", "album_id", "link", "ext"] as const) {
    const v = song[key];
    if (typeof v === "string" && v) extraObj[key] = v;
  }
  for (const key of ["size", "bitrate"] as const) {
    const v = song[key];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) extraObj[key] = Math.trunc(v);
  }
  let extraStr = "";
  try {
    extraStr = JSON.stringify(extraObj);
  } catch {
    extraStr = "";
  }

  const st = stmts();
  st.record(
    {
      id,
      source,
      extraStr,
      name: typeof song.name === "string" ? song.name.trim() : "",
      artist: typeof song.artist === "string" ? song.artist.trim() : "",
      cover: typeof song.cover === "string" ? song.cover : "",
      duration: Math.trunc(song.duration ?? 0) || 0,
    },
    sessionKey,
  );
}

/** 指定会话的最近历史（最新在前，Song 形状，可直接回填前端 store） */
export function listPlayHistory(sessionKey: string): Song[] {
  if (!isValidHistorySid(sessionKey)) return [];
  const rows = stmts().list.all(sessionKey, PLAY_HISTORY_LIMIT) as PlayHistoryRow[];
  return rows.map((row) => {
    const extra = decodeExtraMap(row.extra);
    const song: Song = {
      id: row.song_id,
      source: row.source,
      name: row.name ?? "",
      artist: row.artist ?? "",
      album: extra.album ?? "",
      album_id: extra.album_id || undefined,
      duration: row.duration ?? 0,
      size: Number(extra.size ?? 0) || 0,
      bitrate: Number(extra.bitrate ?? 0) || 0,
      cover: row.cover ?? "",
      link: extra.link ?? "",
      ext: extra.ext,
      extra: Object.keys(extra).length ? extra : undefined,
    };
    return song;
  });
}

/** 清空指定会话的播放历史（不影响其他会话） */
export function clearPlayHistory(sessionKey: string): void {
  if (!isValidHistorySid(sessionKey)) return;
  stmts().clear.run(sessionKey);
}

/** extra JSON → string map（纯函数；容错：非对象/解析失败返回空；数值字符串化） */
export function decodeExtraMap(raw: string): Record<string, string> {
  const text = (raw ?? "").trim();
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
      else if (typeof v === "number" && Number.isFinite(v)) out[k] = String(v);
    }
    return out;
  } catch {
    return {};
  }
}
