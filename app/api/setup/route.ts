import { NextRequest, NextResponse } from "next/server";
import { authDisabled, ensureSetupToken, hasAdmin, setupAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/setup — 状态查询（对齐 Go GET /setup：已初始化时提示去登录）
 * 响应 { setup_required, token_printed }；token 本身打印在服务端 stdout（不回传，安全）。
 */
export async function GET() {
  if (authDisabled()) {
    return NextResponse.json({ setup_required: false, auth_disabled: true });
  }
  if (hasAdmin()) {
    return NextResponse.json({ setup_required: false });
  }
  ensureSetupToken();
  return NextResponse.json({ setup_required: true, token_hint: "setup token 已打印在服务端启动日志（stdout）" });
}

/**
 * POST /api/setup — 初始化管理员（对齐 Go POST /setup：token + 用户名 + 密码≥6 + 确认密码）
 * body: { setup_token, username, password, confirm_password }
 */
export async function POST(req: NextRequest) {
  if (authDisabled()) {
    return NextResponse.json({ error: "鉴权已禁用（桌面模式）" }, { status: 400 });
  }
  if (hasAdmin()) {
    return NextResponse.json({ error: "管理员账号已初始化，请直接登录" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const token = String(body.setup_token ?? body.token ?? "").trim();
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  const confirm = String(body.confirm_password ?? body.confirm ?? "");

  if (!token) return NextResponse.json({ error: "缺少初始化令牌（见服务端启动日志）" }, { status: 400 });
  if (password !== confirm) return NextResponse.json({ error: "两次输入的密码不一致" }, { status: 400 });

  const result = setupAdmin(token, username, password);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "初始化失败" }, { status: 400 });
  }
  return NextResponse.json({ status: "ok", username });
}
