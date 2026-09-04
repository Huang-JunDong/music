import { NextRequest, NextResponse } from "next/server";
import { resetPassword } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/password/reset {username, reset_token, new_password, confirm_password} — 令牌重置密码 */
export async function POST(req: NextRequest) {
  let body: { username?: string; reset_token?: string; new_password?: string; confirm_password?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const username = String(body?.username ?? "");
  const token = String(body?.reset_token ?? "").trim();
  const password = String(body?.new_password ?? "");
  const confirm = String(body?.confirm_password ?? "");
  if (!username || !token) {
    return NextResponse.json({ error: "缺少用户名或重置令牌" }, { status: 400 });
  }
  if (password !== confirm) {
    return NextResponse.json({ error: "两次输入的密码不一致" }, { status: 400 });
  }
  const result = resetPassword(username, token, password);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "重置失败" }, { status: 400 });
  }
  return NextResponse.json({ status: "ok" });
}
