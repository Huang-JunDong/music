/** Cookie 管理 — 对齐 core.CM（CookieManager）：SQLite 持久化（app.db cookies 表）+ 旧 cookies.json 迁移（对齐 Go migrateLegacyCookies：保留原文件、表空才迁、DO UPDATE） */
import fs from "node:fs";
import path from "node:path";
import { getDB } from "./store";

const LEGACY_COOKIE_FILE = path.join(process.cwd(), "data", "cookies.json");

let migrated = false;

/** 启动后首次访问时迁移旧版 cookies.json（表非空则跳过；成功后保留原文件，与 Go 一致） */
function migrateLegacyCookieFile(): void {
  if (migrated) return;
  migrated = true;
  try {
    if (!fs.existsSync(LEGACY_COOKIE_FILE)) return;
    const legacy = JSON.parse(fs.readFileSync(LEGACY_COOKIE_FILE, "utf-8")) as Record<string, unknown>;
    const db = getDB();
    const count = (db.prepare("SELECT COUNT(*) AS c FROM cookies").get() as { c: number }).c;
    if (count > 0) return;

    const entries: { source: string; value: string }[] = [];
    for (const [k, v] of Object.entries(legacy)) {
      const source = (k ?? "").trim();
      const value = typeof v === "string" ? v.trim() : "";
      if (source && value) entries.push({ source, value });
    }
    if (!entries.length) return;

    const upsert = db.prepare(
      "INSERT INTO cookies (source, cookie, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(source) DO UPDATE SET cookie = excluded.cookie, updated_at = excluded.updated_at",
    );
    const tx = db.transaction(() => {
      for (const e of entries) upsert.run(e.source, e.value);
    });
    tx();
  } catch {
    /* 迁移失败不阻断：下次再试 */
  }
}

interface CookieRow {
  source: string;
  cookie: string;
}

function loadRows(): CookieRow[] {
  migrateLegacyCookieFile();
  return getDB().prepare("SELECT source, cookie FROM cookies").all() as CookieRow[];
}

export function getAllCookies(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of loadRows()) out[row.source] = row.cookie;
  return out;
}

export function getCookie(source: string): string {
  migrateLegacyCookieFile();
  const row = getDB()
    .prepare("SELECT cookie FROM cookies WHERE source = ?")
    .get((source ?? "").trim()) as { cookie: string } | undefined;
  return (row?.cookie ?? "").trim();
}

export function setAllCookies(map: Record<string, string>): void {
  migrateLegacyCookieFile();
  const db = getDB();
  const upsert = db.prepare(
    "INSERT INTO cookies (source, cookie, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(source) DO UPDATE SET cookie = excluded.cookie, updated_at = excluded.updated_at",
  );
  const remove = db.prepare("DELETE FROM cookies WHERE source = ?");
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(map)) {
      const key = (k ?? "").trim();
      if (!key) continue;
      const val = (v ?? "").trim();
      if (val) upsert.run(key, val);
      else remove.run(key);
    }
  });
  tx();
}

export function setCookie(source: string, value: string): void {
  setAllCookies({ [source]: value });
}
