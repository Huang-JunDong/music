import { NextRequest, NextResponse } from "next/server";
import { defaultWebSettings, publicPlayerSettings, publicWebSettings, saveWebSettings, type WebSettings } from "@/lib/store";
import { requireAuth } from "@/lib/auth";
import { checkWriteGuard } from "@/lib/write-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/settings — 软鉴权分层（审核整改 A-12，保持"免登录听音乐"核心链路）：
 * 未登录 → 仅返回播放器行为子集（publicPlayerSettings，200，避免 401 踢登录破坏播放器）；
 * 已登录 → 返回完整脱敏设置（publicWebSettings，密码置空）。
 */
export async function GET(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) {
    // partial: true 标记降级响应——前端据此提示"登录已过期"，避免把缺失字段
    // 静默渲染成默认值（用户会误以为已保存的设置"丢失"）
    return NextResponse.json({ ...publicPlayerSettings(), partial: true });
  }
  return NextResponse.json(publicWebSettings());
}

/** POST /api/settings — 合并保存（只接受已知字段且类型一致；响应脱敏，对齐 Go publicWebSettings） */
export async function POST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return NextResponse.json(denied.body, { status: denied.status });
  const guarded = checkWriteGuard(req);
  if (guarded) return guarded;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const defaults = defaultWebSettings();
  const patch: Partial<WebSettings> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (!(key in defaults)) continue;
    const expected = defaults[key as keyof WebSettings];
    if (typeof expected === "boolean" && typeof value === "boolean") {
      (patch as Record<string, unknown>)[key] = value;
    } else if (typeof expected === "number" && typeof value === "number" && Number.isFinite(value)) {
      (patch as Record<string, unknown>)[key] = value;
    } else if (typeof expected === "string" && typeof value === "string") {
      (patch as Record<string, unknown>)[key] = value;
    }
  }

  saveWebSettings(patch);
  return NextResponse.json(publicWebSettings());
}
