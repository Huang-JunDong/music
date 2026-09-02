import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/healthz — 存活探针 */
export async function GET() {
  return NextResponse.json({ app: "music-dl-next", status: "ok" });
}
