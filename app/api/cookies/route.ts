import { NextRequest, NextResponse } from "next/server";
import { getAllCookies, setAllCookies } from "@/lib/cookies";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/cookies — 返回全部源 cookie（受保护，对齐 Go configAPI） */
export async function GET(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return NextResponse.json(denied.body, { status: denied.status });
  return NextResponse.json(getAllCookies());
}

/** HEAD /api/cookies — 探活（对齐 Go 204） */
export async function HEAD() {
  return new NextResponse(null, { status: 204 });
}

/** POST /api/cookies — body 为 map，持久化（受保护；空值删键语义在 lib/cookies 内） */
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
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (typeof v === "string") map[k] = v;
  }
  setAllCookies(map);
  return NextResponse.json({ status: "ok" });
}
