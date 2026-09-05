/**
 * 浏览器级音源账号会话 — 多用户场景：每个访客可扫码登录"自己的"网易云/QQ 等账号，
 * 凭证存浏览器 Cookie（music_dl_src_<source>，HttpOnly），随同源请求自动携带；
 * 服务端经 lib/cookies.ts 的请求级会话（runWithSourceSession）使其优先于全局存储。
 */
import type { NextRequest } from "next/server";
import { createSourceSessionStore, runWithSourceSession } from "./cookies";

export const SRC_SESSION_COOKIE_PREFIX = "music_dl_src_";

/** 允许携带浏览器音源凭证的源白名单（qq_wx 扫码结果归并到 qq 名下；对齐 lib/providers 各源 getCookie 消费面） */
export const SRC_SESSION_SOURCES = ["netease", "qq", "kugou", "soda", "migu", "kuwo", "bilibili"] as const;

/** 会话 Cookie 有效期：90 天（音源 cookie 本身约 1~3 个月，过期重新扫码） */
const SRC_SESSION_MAX_AGE = 90 * 24 * 3600;

export function srcSessionCookieName(source: string): string {
  return SRC_SESSION_COOKIE_PREFIX + source;
}

/** qr_login 的 source 归并为凭证存储源名（qq_wx → qq，对齐服务端存储约定） */
export function srcSessionSource(source: string): string {
  return source === "qq_wx" ? "qq" : source;
}

/** 从请求头提取浏览器自带的全部音源凭证（白名单源；空值视为未登录不携带） */
export function browserSourceCookies(req: NextRequest | Request): Record<string, string> {
  const header = req.headers.get("cookie") ?? "";
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const c = part.trim();
    if (!c.startsWith(SRC_SESSION_COOKIE_PREFIX)) continue;
    const rest = c.slice(SRC_SESSION_COOKIE_PREFIX.length);
    const eq = rest.indexOf("=");
    if (eq <= 0) continue;
    const source = rest.slice(0, eq).trim();
    if (!(SRC_SESSION_SOURCES as readonly string[]).includes(source)) continue;
    try {
      const value = decodeURIComponent(rest.slice(eq + 1).trim());
      if (value) out[source] = value;
    } catch {
      /* 非法编码忽略 */
    }
  }
  return out;
}

/** 请求是否经 https（协议或反代 x-forwarded-proto 首段）——https 下凭证 Cookie 必须附 Secure（审核整改 P2-02） */
export function requestIsHttps(req: NextRequest | Request): boolean {
  const fwd = req.headers.get("x-forwarded-proto");
  if (fwd) return fwd.split(",")[0].trim().toLowerCase() === "https";
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

/** 音源凭证下发到浏览器的 Set-Cookie 头（HttpOnly；值 encodeURIComponent 编码；https 部署附 Secure） */
export function srcSessionSetCookie(source: string, value: string, secure = false): string {
  return `${srcSessionCookieName(source)}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SRC_SESSION_MAX_AGE}${secure ? "; Secure" : ""}`;
}

/** 清除浏览器音源凭证（退出"我的账号"） */
export function srcSessionClearCookie(source: string): string {
  return `${srcSessionCookieName(source)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/* ---------------- API 路由统一包装 ---------------- */

type RouteHandler = (req: NextRequest) => Promise<Response>;

/**
 * 音源功能路由统一包装：请求期间浏览器自带凭证优先于全局存储（provider 零改动）；
 * 会话中被改道的写入（如凭证刷新）自动以 Set-Cookie 回写该浏览器。
 * 无浏览器凭证时 values 为空，行为与不包装完全一致（游客/全局兜底）。
 */
export function withBrowserSourceSession(
  req: NextRequest,
  handler: RouteHandler,
  opts?: { suppressWrites?: boolean },
): Promise<Response> {
  const browser = browserSourceCookies(req);
  const session = createSourceSessionStore(browser, opts?.suppressWrites ?? false);
  const secure = requestIsHttps(req);
  return runWithSourceSession(session, async () => {
    const res = await handler(req);
    for (const [source, value] of session.pendingWrites) {
      res.headers.append("Set-Cookie", value ? srcSessionSetCookie(source, value, secure) : srcSessionClearCookie(source));
    }
    return res;
  });
}
