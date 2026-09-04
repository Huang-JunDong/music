import { NextRequest, NextResponse } from "next/server";
import { clientIP, requestPasswordReset } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/password/forgot {username} — 申请密码重置：
 * 生成一次性重置令牌（15 分钟有效）并打印服务端 stdout（带外分发，对齐 setup token 模式），
 * 响应不区分"用户名是否存在"以外的信息，防止用户名枚举。
 */
export async function POST(req: NextRequest) {
  let body: { username?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const result = requestPasswordReset(String(body?.username ?? ""), clientIP(req));
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "申请失败" }, { status: 429 });
  }
  return NextResponse.json({
    status: "ok",
    hint: "重置令牌已打印在服务端启动/运行日志（stdout）中，15 分钟内有效，请据此完成重置",
  });
}
