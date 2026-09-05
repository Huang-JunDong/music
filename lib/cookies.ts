/** Cookie 管理 — 对齐 core.CM（CookieManager）：SQLite 持久化（app.db cookies 表）+ 旧 cookies.json 迁移（对齐 Go migrateLegacyCookies：保留原文件、表空才迁、DO UPDATE） */
import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { getDB } from "./store";

/* ---------------- 请求级音源凭证会话（多用户：浏览器自带凭证优先） ---------------- */

export interface SourceSessionStore {
  /** 覆盖值：source → cookie 串（仅浏览器自带凭证的源出现在 map 中） */
  values: Map<string, string>;
  /** true = 匿名/浏览器会话：setCookie 不落 SQLite，改记 pendingWrites（API 层回写浏览器） */
  suppressWrites: boolean;
  /** 被抑制的写入（source → 最后值；空串 = 清除） */
  pendingWrites: Map<string, string>;
}

const sourceSessionALS = new AsyncLocalStorage<SourceSessionStore>();

export function createSourceSessionStore(
  values: Record<string, string>,
  suppressWrites: boolean,
): SourceSessionStore {
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(values)) {
    const key = (k ?? "").trim();
    if (key && (v ?? "").trim()) map.set(key, v.trim());
  }
  return { values: map, suppressWrites, pendingWrites: new Map() };
}

/** 在请求级凭证会话内执行 fn：fn 内 getCookie 优先读会话覆盖值、setCookie 按 store 策略改道 */
export function runWithSourceSession<T>(store: SourceSessionStore, fn: () => T): T {
  return sourceSessionALS.run(store, fn);
}

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
  const session = sourceSessionALS.getStore();
  if (session) for (const [k, v] of session.values) out[k] = v;
  return out;
}

export function getCookie(source: string): string {
  const key = (source ?? "").trim();
  const session = sourceSessionALS.getStore();
  if (session?.values.has(key)) return session.values.get(key) ?? "";
  migrateLegacyCookieFile();
  const row = getDB()
    .prepare("SELECT cookie FROM cookies WHERE source = ?")
    .get(key) as { cookie: string } | undefined;
  return (row?.cookie ?? "").trim();
}

export function setAllCookies(map: Record<string, string>): void {
  /* 多用户写分流：浏览器自带凭证的源 / 显式抑制会话 → 写入改道浏览器（pendingWrites，由 API 层回写）；
     其余源正常落 SQLite（全局配置不受访客影响） */
  const session = sourceSessionALS.getStore();
  const toDB: Record<string, string> = {};
  let hasDB = false;
  for (const [k, v] of Object.entries(map)) {
    const key = (k ?? "").trim();
    if (!key) continue;
    const val = (v ?? "").trim();
    if (session && (session.values.has(key) || session.suppressWrites)) {
      session.pendingWrites.set(key, val);
    } else {
      toDB[key] = val;
      hasDB = true;
    }
  }
  if (!hasDB) return;
  map = toDB;
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
