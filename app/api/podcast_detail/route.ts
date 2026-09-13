import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider } from "@/lib/registry";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 电台详情 5min；节目列表 60s（可变） */
const detailCache = createTtlCache<Record<string, unknown>>(300_000, 20);
const programCache = createTtlCache<Record<string, unknown>>(60_000, 60);

/**
 * GET /api/podcast_detail?id=&program_page=&program_limit= → { radio, programs, has_more, error? }
 * P1 B1：?program_id= → { program }（dj_program_detail 单节目完整详情/描述）
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);

function ncmProvider() {
  return getProvider("netease");
}

async function getHandler(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const id = (params.get("id") ?? "").trim();

  /* P1 B1：单节目详情（dj_program_detail） */
  const programId = (params.get("program_id") ?? "").trim();
  if (programId) {
    if (!ncmProvider()?.getDjProgramDetail) {
      return NextResponse.json({ error: "播客电台仅支持网易云音乐" }, { status: 400 });
    }
    try {
      return NextResponse.json({ program: await ncmProvider()!.getDjProgramDetail!(programId) });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
    }
  }

  if (!id) return NextResponse.json({ error: "缺少电台 id" }, { status: 400 });
  const programPage = Math.max(parseInt(params.get("program_page") ?? "1", 10) || 1, 1);
  const programLimit = Math.min(Math.max(parseInt(params.get("program_limit") ?? "30", 10) || 30, 1), 100);

  const provider = getProvider("netease");
  if (!provider?.getDjRadioDetail || !provider?.getDjPrograms) {
    return NextResponse.json({ error: "播客电台仅支持网易云音乐" }, { status: 400 });
  }

  const fp = sourceCookieFingerprint(req);
  const detailPayload = await detailCache.wrap(`podcast-detail|${id}|${fp}`, async () => {
    try {
      return { radio: await provider.getDjRadioDetail!(id) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }, (p) => !p.error);

  const programPayload = await programCache.wrap(`podcast-programs|${id}|${programPage}|${programLimit}|${fp}`, async () => {
    try {
      const r = await provider.getDjPrograms!(id, programPage, programLimit);
      return { programs: r.programs, programs_has_more: r.has_more };
    } catch (err) {
      return { programs_error: err instanceof Error ? err.message : String(err) };
    }
  }, (p) => !p.programs_error);

  return NextResponse.json({ ...detailPayload, ...programPayload });
}
