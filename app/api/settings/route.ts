import { NextRequest, NextResponse } from "next/server";
import { defaultWebSettings, publicWebSettings, saveWebSettings, type WebSettings } from "@/lib/store";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/settings — 脱敏后的 Web 设置（密码置空） */
export async function GET() {
  return NextResponse.json(publicWebSettings());
}

/** POST /api/settings — 合并保存（只接受已知字段且类型一致；响应脱敏，对齐 Go publicWebSettings） */
export async function POST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return NextResponse.json(denied.body, { status: denied.status });

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
