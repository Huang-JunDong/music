/**
 * 持久化存储层 — 对齐 Go 版 GORM/SQLite 模型（core/config_store.go + internal/web/collection.go + core/download_record.go + local_music_index.go）
 * 统一落在 ./data/app.db；cookies.json 保持与 Go 版一致单独存文件。
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { favoritesDbPath } from "./env";

const DATA_DIR = path.join(process.cwd(), "data");
export const DEFAULT_DOWNLOAD_DIR = path.join(DATA_DIR, "downloads");

let _db: Database.Database | null = null;

export function getDB(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  _db = new Database(path.join(DATA_DIR, "app.db"));
  _db.pragma("journal_mode = WAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      cover TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'manual',
      content_type TEXT NOT NULL DEFAULT 'playlist',
      source TEXT NOT NULL DEFAULT 'local',
      external_id TEXT NOT NULL DEFAULT '',
      link TEXT NOT NULL DEFAULT '',
      creator TEXT NOT NULL DEFAULT '',
      track_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS saved_songs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_id INTEGER NOT NULL,
      song_id TEXT NOT NULL,
      source TEXT NOT NULL,
      extra TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      artist TEXT NOT NULL DEFAULT '',
      cover TEXT NOT NULL DEFAULT '',
      duration INTEGER NOT NULL DEFAULT 0,
      added_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_col_song_src ON saved_songs(collection_id, song_id, source);
    CREATE TABLE IF NOT EXISTS download_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      artist TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_dl_records_created ON download_records(created_at);
    CREATE TABLE IF NOT EXISTS download_dedup (
      song_key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      artist TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS local_music_index (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      artist TEXT NOT NULL DEFAULT '',
      album TEXT NOT NULL DEFAULT '',
      rel_path TEXT NOT NULL DEFAULT '',
      ext TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      duration INTEGER NOT NULL DEFAULT 0,
      cover INTEGER NOT NULL DEFAULT 0,
      lyric INTEGER NOT NULL DEFAULT 0,
      modified_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS web_settings (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );
    /* 审核整改 A-25：local_music_index 排序列索引（ORDER BY modified_at DESC 高频路径） */
    CREATE INDEX IF NOT EXISTS idx_lmi_modified_at ON local_music_index (modified_at DESC);
    CREATE TABLE IF NOT EXISTS cookies (
      source TEXT PRIMARY KEY,
      cookie TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  migrateLegacyFavorites(_db);
  backfillCollectionDefaults(_db);
  return _db;
}

/* ---------------- legacy favorites.db 迁移 + backfill（对齐 Go InitDB） ---------------- */

function removeLegacyFavoritesFiles(legacyPath: string): void {
  for (const candidate of [legacyPath, `${legacyPath}-shm`, `${legacyPath}-wal`, `${legacyPath}-journal`]) {
    try {
      fs.rmSync(candidate, { force: true });
    } catch {
      /* ignore */
    }
  }
}

/** migrateLegacyFavorites 移植：collections 为空且 data/favorites.db 存在时整库导入 */
function migrateLegacyFavorites(db: Database.Database): void {
  const legacyPath = favoritesDbPath() || path.join(DATA_DIR, "favorites.db");
  const unifiedPath = path.join(DATA_DIR, "app.db");
  if (path.resolve(legacyPath) === path.resolve(unifiedPath)) return;
  if (!fs.existsSync(legacyPath)) return;

  const count = (db.prepare("SELECT COUNT(*) AS c FROM collections").get() as { c: number }).c;
  if (count > 0) return;

  let legacy: Database.Database;
  try {
    legacy = new Database(legacyPath, { readonly: true });
  } catch {
    return;
  }

  try {
    const hasCollections = legacy
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='collections'")
      .get();
    if (!hasCollections) return;

    const collections = legacy.prepare("SELECT * FROM collections ORDER BY id ASC").all() as Record<string, unknown>[];
    let savedSongs: Record<string, unknown>[] = [];
    const hasSavedSongs = legacy
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='saved_songs'")
      .get();
    if (hasSavedSongs) {
      savedSongs = legacy.prepare("SELECT * FROM saved_songs ORDER BY id ASC").all() as Record<string, unknown>[];
    }

    if (!collections.length && !savedSongs.length) {
      removeLegacyFavoritesFiles(legacyPath);
      return;
    }

    const insertTx = db.transaction(() => {
      if (collections.length) {
        // 审核整改 A-25：legacy 表头列名白名单过滤后再拼接（防 legacy 文件被替换成注入面）
        const LEGACY_COLLECTION_COLS = new Set([
          "id", "name", "description", "cover", "kind", "content_type", "source",
          "external_id", "link", "creator", "track_count", "created_at",
        ]);
        const cols = Object.keys(collections[0]).filter((c) => LEGACY_COLLECTION_COLS.has(c));
        if (cols.length) {
          const placeholders = cols.map(() => "?").join(",");
          const stmt = db.prepare(`INSERT INTO collections (${cols.join(",")}) VALUES (${placeholders})`);
          for (const row of collections) stmt.run(...cols.map((c) => row[c]));
        }
      }
      if (savedSongs.length) {
        const stmt = db.prepare(
          `INSERT OR IGNORE INTO saved_songs (collection_id, song_id, source, extra, name, artist, cover, duration, added_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        );
        for (const row of savedSongs) {
          stmt.run(
            row["collection_id"] ?? 0,
            String(row["song_id"] ?? ""),
            String(row["source"] ?? ""),
            String(row["extra"] ?? ""),
            String(row["name"] ?? ""),
            String(row["artist"] ?? ""),
            String(row["cover"] ?? ""),
            Number(row["duration"] ?? 0) || 0,
            String(row["added_at"] ?? ""),
          );
        }
      }
    });
    insertTx();
    removeLegacyFavoritesFiles(legacyPath);
  } catch {
    /* 迁移失败不阻断启动 */
  } finally {
    legacy.close();
  }
}

/** backfillCollectionDefaults 移植：kind/content_type/source 空值回填默认 */
function backfillCollectionDefaults(db: Database.Database): void {
  db.prepare("UPDATE collections SET kind = 'manual' WHERE kind = '' OR kind IS NULL").run();
  db.prepare("UPDATE collections SET content_type = 'playlist' WHERE content_type = '' OR content_type IS NULL").run();
  db.prepare("UPDATE collections SET source = 'local' WHERE source = '' OR source IS NULL").run();
}

/* ---------------- WebSettings（对齐 core.WebSettings） ---------------- */

export interface WebSettings {
  embedDownload: boolean;
  downloadToLocal: boolean;
  downloadDir: string;
  downloadFilenameTemplate: string;
  webdavEnabled: boolean;
  webdavUrl: string;
  webdavUsername: string;
  webdavPassword: string;
  webdavDir: string;
  disableFloatingLyrics: boolean;
  webPageSize: number;
  cliPageSize: number;
  downloadConcurrency: number;
  autoSwitchInvalidSources: boolean;
  autoCacheOnPlay: boolean;
  vgChangeCover: boolean;
  vgChangeAudio: boolean;
  vgChangeLyric: boolean;
  vgExportVideo: boolean;
}

export const DEFAULT_WEB_PAGE_SIZE = 200;
export const DEFAULT_CLI_PAGE_SIZE = 20;
export const DEFAULT_DOWNLOAD_CONCURRENCY = 3;
export const DEFAULT_WEBDAV_DIR = "music-dl";
export const DEFAULT_FILENAME_TEMPLATE = "{artist} - {name}";

export function defaultWebSettings(): WebSettings {
  return normalizeWebSettings({
    // 对齐功能语义：默认关闭嵌入（流式下载更快、支持 Range）；开启后由 ffmpeg 写入封面/歌词
    embedDownload: false,
    downloadToLocal: false,
    downloadDir: DEFAULT_DOWNLOAD_DIR,
    downloadFilenameTemplate: DEFAULT_FILENAME_TEMPLATE,
    webdavEnabled: false,
    webdavUrl: "",
    webdavUsername: "",
    webdavPassword: "",
    webdavDir: "",
    disableFloatingLyrics: false,
    webPageSize: DEFAULT_WEB_PAGE_SIZE,
    cliPageSize: DEFAULT_CLI_PAGE_SIZE,
    downloadConcurrency: DEFAULT_DOWNLOAD_CONCURRENCY,
    autoSwitchInvalidSources: true,
    autoCacheOnPlay: false,
    vgChangeCover: false,
    vgChangeAudio: false,
    vgChangeLyric: false,
    vgExportVideo: false,
  });
}

/** normalizeWebSettings 移植：trim/空回填/webdavDir 去斜杠回填 music-dl/concurrency 夹紧 1–5 */
export function normalizeWebSettings(s: WebSettings): WebSettings {
  const next = { ...s };
  next.downloadDir = (next.downloadDir ?? "").trim() || DEFAULT_DOWNLOAD_DIR;
  next.downloadFilenameTemplate =
    (next.downloadFilenameTemplate ?? "").trim() || DEFAULT_FILENAME_TEMPLATE;
  next.webdavUrl = (next.webdavUrl ?? "").trim();
  next.webdavUsername = (next.webdavUsername ?? "").trim();
  next.webdavDir = (next.webdavDir ?? "").trim().replace(/^\/+|\/+$/g, "") || DEFAULT_WEBDAV_DIR;
  if (!(next.webPageSize > 0)) next.webPageSize = DEFAULT_WEB_PAGE_SIZE;
  if (!(next.cliPageSize > 0)) next.cliPageSize = DEFAULT_CLI_PAGE_SIZE;
  if (!(next.downloadConcurrency > 0)) next.downloadConcurrency = DEFAULT_DOWNLOAD_CONCURRENCY;
  next.downloadConcurrency = Math.min(5, Math.max(1, Math.trunc(next.downloadConcurrency)));
  return next;
}

export function getWebSettings(): WebSettings {
  const db = getDB();
  const row = db.prepare("SELECT v FROM web_settings WHERE k = 'settings'").get() as { v: string } | undefined;
  if (!row) return defaultWebSettings();
  try {
    return normalizeWebSettings({ ...defaultWebSettings(), ...JSON.parse(row.v) });
  } catch {
    return defaultWebSettings();
  }
}

export function saveWebSettings(next: Partial<WebSettings>): WebSettings {
  const prev = getWebSettings();
  const merged = { ...prev, ...next };
  // WebDAV 密码为空时保留旧值（对齐 Go SaveWebSettings：避免脱敏 GET 回存清空密码）
  if (!(merged.webdavPassword ?? "").trim()) {
    merged.webdavPassword = prev.webdavPassword ?? "";
  }
  const normalized = normalizeWebSettings(merged);
  getDB()
    .prepare("INSERT INTO web_settings (k, v) VALUES ('settings', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v")
    .run(JSON.stringify(normalized));
  return normalized;
}

/** 脱敏版（对齐 Go publicWebSettings：密码置空） */
export function publicWebSettings(): WebSettings {
  const s = getWebSettings();
  return { ...s, webdavPassword: "" };
}

/**
 * 未登录可读的播放器相关子集（审核整改 A-12 软鉴权配套）：
 * 仅暴露免登录听歌链路必需的行为开关，剔除 webdavUrl/Username、downloadDir
 * 等服务器内部配置（防侦察面）。
 */
export function publicPlayerSettings(): Partial<WebSettings> {
  const s = getWebSettings();
  return {
    embedDownload: s.embedDownload,
    disableFloatingLyrics: s.disableFloatingLyrics,
    webPageSize: s.webPageSize,
    cliPageSize: s.cliPageSize,
    downloadConcurrency: s.downloadConcurrency,
    autoSwitchInvalidSources: s.autoSwitchInvalidSources,
    autoCacheOnPlay: s.autoCacheOnPlay,
    vgChangeCover: s.vgChangeCover,
    vgChangeAudio: s.vgChangeAudio,
    vgChangeLyric: s.vgChangeLyric,
    vgExportVideo: s.vgExportVideo,
  };
}

/** 下载目录（带兜底） */
export function downloadDir(): string {
  const dir = (getWebSettings().downloadDir || "").trim();
  return dir || DEFAULT_DOWNLOAD_DIR;
}
