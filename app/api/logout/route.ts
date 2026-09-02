import { NextResponse } from "next/server";
import { clearSessionCookieHeader } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/logout — 清会话 Cookie（对齐 Go POST /logout） */
export async function POST() {
  const res = NextResponse.json({ status: "ok" });
  res.headers.set("Set-Cookie", clearSessionCookieHeader());
  return res;
}
