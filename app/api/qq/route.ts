/** GET /api/qq — QQ 音乐 API 全量接口分组清单（控制台数据源，14 模块 105+ 端点）· 免登录 */
import { NextRequest, NextResponse } from "next/server";
import { routeInventory } from "@/lib/qq/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const inventory = routeInventory();
  const categories: Record<
    string,
    { id: string; name: string; route: string; method: string; summary: string; auth: string }[]
  > = {};
  for (const r of inventory.routes) {
    (categories[r.module] ??= []).push({
      id: r.id,
      name: r.id.split(".")[1] ?? r.id,
      route: r.path,
      method: r.method,
      summary: r.summary,
      auth: r.auth,
    });
  }
  return NextResponse.json({ count: inventory.count, categories });
}
