/**
 * Web 鉴权 — 移植 internal/web/auth.go：
 * - 管理员账号存储（web_settings 表 auth 键：username / scrypt 密码哈希 / 会话密钥）
 * - 会话 Cookie：`base64url(JSON{u,iat,n}) + "." + base64url(HMAC-SHA256)`，7 天有效，iat 容忍 ±2min
 * - 防爆破：按 `username|ip` 记失败次数，指数退避 1s<<min(n-1,6)，上限 60s
 * - setup token：未初始化管理员时生成 24 字节 base64url 令牌并打印 stdout（consumeSetupToken 一次性）
 * - MUSIC_DL_DISABLE_AUTH=1 等价 Go 桌面模式 DisableAuth（全部放行）
 *
 * 注：Go 用 bcrypt；Node 侧采用内建 crypto.scrypt（格式 `scrypt$salt$hash`），
 * 强度对齐（N=16384），无需第三方依赖。
 */
import crypto from "node:crypto";
import { getDB } from "./store";

export const SESSION_COOKIE = "music_dl_session";
const SESSION_TTL_SECONDS = 7 * 24 * 3600;
const CLOCK_SKEW_SECONDS = 120;
const MAX_LOCK_SECONDS = 60;

interface AuthRecord {
  username: string;
  passwordHash: string;
  sessionSecret: string; // base64
}

interface AuthState {
  record: AuthRecord | null;
  setupToken: string | null;
  setupTokenUsed: boolean;
  failures: Map<string, { count: number; lockedUntil: number }>;
}

const globalAuth = globalThis as unknown as { __musicDlAuth?: AuthState };

function authState(): AuthState {
  if (!globalAuth.__musicDlAuth) {
    globalAuth.__musicDlAuth = {
      record: null,
      setupToken: null,
      setupTokenUsed: false,
      failures: new Map(),
    };
  }
  return globalAuth.__musicDlAuth;
}

export function authDisabled(): boolean {
  return (process.env.MUSIC_DL_DISABLE_AUTH ?? "").trim() === "1";
}

/* ---------------- 密码（scrypt） ---------------- */

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  try {
    const salt = Buffer.from(parts[1], "base64url");
    const expected = Buffer.from(parts[2], "base64url");
    const actual = crypto.scryptSync(password, salt, expected.length, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/* ---------------- 存取（web_settings.auth） ---------------- */

function loadRecord(): AuthRecord | null {
  const state = authState();
  if (state.record) return state.record;
  try {
    const row = getDB().prepare("SELECT v FROM web_settings WHERE k = 'auth'").get() as
      | { v: string }
      | undefined;
    if (row) {
      const parsed = JSON.parse(row.v) as AuthRecord;
      if (parsed?.username && parsed?.passwordHash && parsed?.sessionSecret) {
        state.record = parsed;
        return parsed;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function saveRecord(record: AuthRecord): void {
  const state = authState();
  state.record = record;
  getDB()
    .prepare("INSERT INTO web_settings (k, v) VALUES ('auth', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v")
    .run(JSON.stringify(record));
}

export function hasAdmin(): boolean {
  return loadRecord() !== null;
}

/* ---------------- setup token ---------------- */

/** ensureSetupToken：未初始化时生成并打印 stdout（对齐 Go 启动打印） */
export function ensureSetupToken(): string {
  const state = authState();
  if (hasAdmin()) return "";
  if (!state.setupToken || state.setupTokenUsed) {
    state.setupToken = crypto.randomBytes(24).toString("base64url");
    state.setupTokenUsed = false;
    // eslint-disable-next-line no-console
    console.log(`Web setup token: ${state.setupToken}`);
  }
  return state.setupToken;
}

function consumeSetupToken(token: string): boolean {
  const state = authState();
  if (!state.setupToken || state.setupTokenUsed) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(state.setupToken);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  state.setupTokenUsed = true;
  return true;
}

/* ---------------- 会话 ---------------- */

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sessionPayload(username: string): { u: string; iat: number; n: number } {
  // nonce 用 48 位随机数（crypto.randomInt 上限 2^48，readUIntBE 避免越界）
  const nonce = crypto.randomBytes(6).readUIntBE(0, 6);
  return { u: username, iat: Math.floor(Date.now() / 1000), n: nonce };
}

function signSession(payload: string, secret: Buffer): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function issueSessionCookie(username: string): string {
  const record = loadRecord();
  if (!record) return "";
  const payload = b64url(JSON.stringify(sessionPayload(username)));
  const sig = signSession(payload, Buffer.from(record.sessionSecret, "base64"));
  return `${payload}.${sig}`;
}

function verifySessionCookie(cookie: string | null | undefined): string | null {
  if (!cookie) return null;
  const record = loadRecord();
  if (!record) return null;
  const dot = cookie.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = cookie.slice(0, dot);
  const sig = cookie.slice(dot + 1);
  const expected = signSession(payload, Buffer.from(record.sessionSecret, "base64"));
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      u?: string;
      iat?: number;
      n?: number;
    };
    if (!decoded.u || typeof decoded.iat !== "number" || typeof decoded.n !== "number") return null;
    const now = Math.floor(Date.now() / 1000);
    if (now - decoded.iat > SESSION_TTL_SECONDS) return null;
    if (Math.abs(now - decoded.iat) < -CLOCK_SKEW_SECONDS) return null; // 未来时间容忍 2 分钟
    if (decoded.u !== record.username) return null;
    return decoded.u;
  } catch {
    return null;
  }
}

/* ---------------- 防爆破 ---------------- */

function attemptKey(username: string, ip: string): string {
  return `${username.toLowerCase()}|${ip}`;
}

function lockRemaining(key: string): number {
  const state = authState();
  const entry = state.failures.get(key);
  if (!entry) return 0;
  const remaining = Math.ceil((entry.lockedUntil - Date.now()) / 1000);
  if (remaining <= 0) return 0;
  return remaining;
}

function recordFailure(key: string): number {
  const state = authState();
  const entry = state.failures.get(key) ?? { count: 0, lockedUntil: 0 };
  entry.count += 1;
  const shift = Math.min(entry.count - 1, 6);
  const lockSec = Math.min(1 << shift, MAX_LOCK_SECONDS);
  entry.lockedUntil = Date.now() + lockSec * 1000;
  state.failures.set(key, entry);
  return lockSec;
}

function clearFailures(key: string): void {
  authState().failures.delete(key);
}

/* ---------------- 对外 API ---------------- */

export function clientIP(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}

export function setupAdmin(token: string, username: string, password: string): { ok: boolean; error?: string } {
  if (hasAdmin()) return { ok: false, error: "管理员账号已初始化" };
  if (!consumeSetupToken(token)) return { ok: false, error: "初始化令牌无效或已使用" };
  const user = (username ?? "").trim();
  if (!user) return { ok: false, error: "用户名不能为空" };
  if (password.length < 6) return { ok: false, error: "密码至少 6 位" };
  saveRecord({
    username: user,
    passwordHash: hashPassword(password),
    sessionSecret: crypto.randomBytes(32).toString("base64"),
  });
  return { ok: true };
}

export function login(
  username: string,
  password: string,
  ip: string,
): { ok: boolean; username?: string; error?: string; retryAfter?: number } {
  const record = loadRecord();
  if (!record) return { ok: false, error: "请先初始化管理员账号" };
  const key = attemptKey(username ?? "", ip);
  const locked = lockRemaining(key);
  if (locked > 0) {
    return { ok: false, error: `尝试过于频繁，请 ${locked} 秒后重试`, retryAfter: locked };
  }
  const user = (username ?? "").trim();
  const ok = user.toLowerCase() === record.username.toLowerCase() && verifyPassword(password ?? "", record.passwordHash);
  if (!ok) {
    const lock = recordFailure(key);
    return { ok: false, error: `用户名或密码错误（连续失败将临时锁定，当前 ${lock}s）`, retryAfter: lock };
  }
  clearFailures(key);
  return { ok: true, username: record.username };
}

/** authRequired 等价守卫：返回 null=放行，否则返回 401 响应 */
export function requireAuth(req: Request): NextResponse401 | null {
  if (authDisabled()) return null;
  if (!hasAdmin()) {
    ensureSetupToken();
    return {
      status: 401,
      body: { error: "请先初始化管理员账号", setupRequired: true },
    };
  }
  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  const value = match ? decodeURIComponent(match.slice(SESSION_COOKIE.length + 1)) : null;
  const username = verifySessionCookie(value);
  if (!username) {
    return { status: 401, body: { error: "请先登录", loginRequired: true } };
  }
  return null;
}

export interface NextResponse401 {
  status: 401;
  body: Record<string, unknown>;
}

export function sessionCookieHeader(value: string, path = "/"): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  return parts.join("; ");
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function currentUsername(req: Request): string | null {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  const value = match ? decodeURIComponent(match.slice(SESSION_COOKIE.length + 1)) : null;
  return verifySessionCookie(value);
}
