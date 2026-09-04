import { NextRequest, NextResponse } from "next/server";
import { changePassword, requireAuth, sessionCookieHeader } from "@/lib/auth";
import { checkWriteGuard } from "@/lib/write-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/password/change {old_password, new_password} — 已登录修改密码（成功下发新会话） */
export async function POST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return NextResponse.json(denied.body, { status: denied.status });
  const guarded = checkWriteGuard(req);
  if (guarded) return guarded;

  let body: { old_password?: string; new_password?: string; confirm_password?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const oldPassword = String(body?.old_password ?? "");
  const newPassword = String(body?.new_password ?? "");
  const confirm = String(body?.confirm_password ?? "");
  if (confirm && newPassword !== confirm) {
    return NextResponse.json({ error: "两次输入的密码不一致" }, { status: 400 });
  }
  const result = changePassword(oldPassword, newPassword);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "修改失败" }, { status: 400 });
  }
  const res = NextResponse.json({ status: "ok" });
  if (result.cookie) res.headers.set("Set-Cookie", sessionCookieHeader(result.cookie));
  return res;
}
