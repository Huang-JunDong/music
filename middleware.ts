import { NextRequest, NextResponse } from "next/server";

/**
 * 页面级登录守卫 — 未登录访问受保护页面时统一跳转 /login?next=…
 * - 放行策略（最大限度放开）：除 PROTECTED_PAGES 外的页面全部匿名可访问；
 *   API 不经此守卫（各路由自带 requireAuth / checkWriteGuard）。
 * - MUSIC_DL_DISABLE_AUTH=1 时全放行（对齐 lib/auth.ts authDisabled / Go 桌面模式）。
 * - Edge runtime 无法访问 SQLite 会话密钥，此处仅校验会话 Cookie 存在性；
 *   HMAC 签名校验由页面依赖的受保护 API（settings/cookies 等）完成，
 *   伪造 Cookie 至多看到空骨架页，拿不到任何数据。
 */
const PROTECTED_PAGES = ["/settings"];
/** 对齐 lib/auth.ts SESSION_COOKIE（Edge 无法 import 该模块：依赖 node:crypto + SQLite） */
const SESSION_COOKIE = "music_dl_session";

export function middleware(req: NextRequest) {
  if ((process.env.MUSIC_DL_DISABLE_AUTH ?? "").trim() === "1") {
    return NextResponse.next();
  }

  const { pathname } = req.nextUrl;
  const needsAuth = PROTECTED_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!needsAuth) return NextResponse.next();

  if (req.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();

  const login = new URL("/login", req.url);
  login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/settings/:path*"],
};
