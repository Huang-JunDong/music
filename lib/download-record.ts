/**
 * 下载记录 / 去重 — 移植 core/download_record.go（基于 store.ts 的
 * download_records + download_dedup 表）。
 * song_key 对齐 Go SongKey：`artist - name`，cleanText 后空值回退 "Unknown"，保留大小写。
 */
import { getDB } from "./store";

export const DOWNLOAD_STATUS_SUCCESS = "success";
export const DOWNLOAD_STATUS_SKIPPED = "skipped";
export const DOWNLOAD_STATUS_FAILED = "failed";

export interface DownloadRecordRow {
  id: number;
  name: string;
  artist: string;
  source: string;
  status: string;
  error: string;
  created_at: string;
}

function stripControl(value: string): string {
  let out = "";
  for (const ch of value ?? "") {
    const code = ch.charCodeAt(0);
    if (code >= 0x20 && code !== 0x7f) out += ch;
  }
  return out;
}

function cleanText(value: string): string {
  return stripControl(value ?? "").trim();
}

/** 稳定去重键（对齐 Go SongKey：`artist - name`，空值回退 Unknown，保留大小写） */
export function songKey(name: string, artist: string): string {
  const n = cleanText(name) || "Unknown";
  const a = cleanText(artist) || "Unknown";
  return `${a} - ${n}`;
}

export function saveDownloadDedupEntry(name: string, artist: string): void {
  const n = cleanText(name);
  const a = cleanText(artist);
  getDB()
    .prepare(
      "INSERT OR IGNORE INTO download_dedup (song_key, name, artist) VALUES (?,?,?)",
    )
    .run(songKey(n, a), n, a);
}

/** 写入一条下载记录；status=success 时同时写入去重表 */
export function saveDownloadRecord(
  name: string,
  artist: string,
  source: string,
  status: string,
  error = "",
): void {
  const n = cleanText(name);
  const a = cleanText(artist);
  const db = getDB();
  const tx = db.transaction(() => {
    db.prepare(
      "INSERT INTO download_records (name, artist, source, status, error) VALUES (?,?,?,?,?)",
    ).run(n, a, cleanText(source), status, cleanText(error).slice(0, 1000));
    if (status === DOWNLOAD_STATUS_SUCCESS) {
      db.prepare(
        "INSERT OR IGNORE INTO download_dedup (song_key, name, artist) VALUES (?,?,?)",
      ).run(songKey(n, a), n, a);
    }
  });
  tx();
}

export function loadDownloadDedupSet(): Set<string> {
  const db = getDB();
  let rows = db.prepare("SELECT song_key FROM download_dedup").all() as {
    song_key: string;
  }[];
  // 首次回填迁移（对齐 Go LoadDownloadDedupSet）：去重表为空时把 success 历史行按新键迁入
  if (rows.length === 0) {
    const history = db
      .prepare("SELECT name, artist FROM download_records WHERE status = ?")
      .all(DOWNLOAD_STATUS_SUCCESS) as { name: string; artist: string }[];
    if (history.length > 0) {
      const tx = db.transaction(() => {
        const insert = db.prepare(
          "INSERT OR IGNORE INTO download_dedup (song_key, name, artist) VALUES (?,?,?)",
        );
        for (const h of history) {
          const n = cleanText(h.name);
          const a = cleanText(h.artist);
          insert.run(songKey(n, a), n, a);
        }
      });
      tx();
      rows = db.prepare("SELECT song_key FROM download_dedup").all() as { song_key: string }[];
    }
  }
  const set = new Set<string>();
  for (const row of rows) {
    const key = cleanText(row.song_key);
    if (key) set.add(key);
  }
  return set;
}

export function isSongDownloaded(name: string, artist: string, set: Set<string>): boolean {
  if (!set) return false;
  return set.has(songKey(name, artist));
}

export function getDownloadRecordPage(
  page: number,
  pageSize: number,
  status?: string,
): { records: DownloadRecordRow[]; total: number } {
  if (page < 1) page = 1;
  if (pageSize <= 0) pageSize = 20;
  if (pageSize > 200) pageSize = 200;

  const VALID_STATUS = ["success", "skipped", "failed"];
  const filter = status && VALID_STATUS.includes(status) ? status : "";

  const db = getDB();
  const total = (
    db
      .prepare(
        filter
          ? "SELECT COUNT(*) AS c FROM download_records WHERE status = ?"
          : "SELECT COUNT(*) AS c FROM download_records",
      )
      .get(...(filter ? [filter] : [])) as { c: number }
  ).c;
  const records = db
    .prepare(
      filter
        ? "SELECT id, name, artist, source, status, error, created_at FROM download_records WHERE status = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?"
        : "SELECT id, name, artist, source, status, error, created_at FROM download_records ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
    )
    .all(...(filter ? [filter, pageSize, (page - 1) * pageSize] : [pageSize, (page - 1) * pageSize])) as DownloadRecordRow[];
  return { records, total };
}

export function clearDownloadRecords(): void {
  getDB().prepare("DELETE FROM download_records").run();
}
