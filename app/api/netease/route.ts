/** GET /api/netease — 439 个接口分组清单（控制台数据源）· 免登录 */
import { NextRequest, NextResponse } from "next/server";
import { MODULES, CATEGORY_ORDER, MODULE_COUNT } from "@/lib/netease/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const grouped: Record<string, { name: string; route: string }[]> = {};
  for (const cat of CATEGORY_ORDER) grouped[cat] = [];
  for (const entry of Object.values(MODULES)) {
    (grouped[entry.category] ??= []).push({ name: entry.name, route: entry.route });
  }
  return NextResponse.json({ count: MODULE_COUNT, categories: grouped });
}
