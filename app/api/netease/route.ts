/** GET /api/netease — 439 个接口分组清单（控制台数据源） */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { MODULES, CATEGORY_ORDER, MODULE_COUNT } from "@/lib/netease/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // 鉴权：接口清单同样置于登录态之后（避免未授权探测全量路由面）
  const denied = requireAuth(req);
  if (denied) return NextResponse.json(denied.body, { status: denied.status });

  const grouped: Record<string, { name: string; route: string }[]> = {};
  for (const cat of CATEGORY_ORDER) grouped[cat] = [];
  for (const entry of Object.values(MODULES)) {
    (grouped[entry.category] ??= []).push({ name: entry.name, route: entry.route });
  }
  return NextResponse.json({ count: MODULE_COUNT, categories: grouped });
}
