import { NextRequest, NextResponse } from "next/server";
import {
  authDisabled,
  clientIP,
  currentUsername,
  hasAdmin,
  issueSessionCookie,
  login,
  sessionCookieHeader,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/login — 登录状态查询（对齐 Go GET /login 的状态分流语义） */
export async function GET(req: NextRequest) {
  if (authDisabled()) {
    return NextResponse.json({ logged_in: true, auth_disabled: true, username: "local" });
  }
  if (!hasAdmin()) {
    return NextResponse.json({ logged_in: false, setup_required: true });
  }
  const username = currentUsername(req);
  return NextResponse.json({ logged_in: !!username, username: username ?? "" });
}

/** POST /api/login — 登录（防爆破指数退避，对齐 Go POST /login） */
export async function POST(req: NextRequest) {
  if (authDisabled()) {
    return NextResponse.json({ status: "ok", auth_disabled: true });
  }
  if (!hasAdmin()) {
    return NextResponse.json({ error: "请先初始化管理员账号", setup_required: true }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const username = String(body.username ?? "");
  const password = String(body.password ?? "");
  if (!username.trim() || !password) {
    return NextResponse.json({ error: "用户名和密码不能为空" }, { status: 400 });
  }

  const result = login(username, password, clientIP(req));
  if (!result.ok) {
    const status = result.retryAfter && result.retryAfter >= 30 ? 429 : 401;
    return NextResponse.json({ error: result.error }, { status });
  }

  const cookie = issueSessionCookie(result.username ?? "");
  const res = NextResponse.json({ status: "ok", username: result.username });
  if (cookie) res.headers.set("Set-Cookie", sessionCookieHeader(cookie));
  return res;
}
