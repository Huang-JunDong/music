import { NextRequest, NextResponse } from "next/server";
import { UA_PC } from "@/lib/http";
import { downloadDisposition } from "@/lib/web-core";
import { checkSaveLocalGuard, saveWebAssetResponse, wantsSaveLocal } from "@/lib/write-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET/POST /api/download_cover?url=&name=&artist=&save_local=1 → 图片流（下载头）或落盘 JSON */
const COVER_TIMEOUT_MS = 10_000;
const MAX_COVER_BYTES = 8 * 1024 * 1024;

async function handle(req: NextRequest): Promise<NextResponse> {
  const params = req.nextUrl.searchParams;
  const url = params.get("url") ?? "";

  const guarded = checkSaveLocalGuard(req);
  if (guarded) return guarded;

  // 对齐 Go：url 为空时直接返回（无 body）
  if (!url) {
    return new NextResponse(null, { status: 200 });
  }

  let resp: Response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COVER_TIMEOUT_MS);
  try {
    resp = await fetch(url, {
      headers: { "User-Agent": UA_PC },
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    return new NextResponse("Upstream error", { status: 502 });
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    return new NextResponse("Upstream error", { status: 502 });
  }

  const filename = `${params.get("name") ?? ""} - ${params.get("artist") ?? ""}.jpg`;

  if (wantsSaveLocal(req)) {
    const data = Buffer.from(await resp.arrayBuffer());
    if (!data.length || data.length > MAX_COVER_BYTES) {
      return new NextResponse("Upstream error", { status: 502 });
    }
    return saveWebAssetResponse(filename, data);
  }

  return new NextResponse(resp.body, {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Disposition": downloadDisposition(filename),
    },
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
