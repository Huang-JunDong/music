/** GET /api/qq — QQ 音乐 API 全量接口分组清单（控制台数据源，14 模块 105+ 端点） */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { routeInventory } from "@/lib/qq/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // 鉴权：接口清单同样置于登录态之后（避免未授权探测全量路由面）
  const denied = requireAuth(req);
  if (denied) return NextResponse.json(denied.body, { status: denied.status });

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
