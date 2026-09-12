import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider } from "@/lib/registry";
import { checkWriteGuard } from "@/lib/write-guard";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";
import type { CheckinStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 签到状态 30s 缓存（签到后前端本地翻转 + 短 TTL 自愈） */
const checkinCache = createTtlCache<Record<string, unknown>>(30_000, 10);

const KINDS = new Set(["daily", "yunbei", "vip"]);

/**
 * GET /api/checkin → { status: CheckinStatus }
 * POST /api/checkin（JSON: { kind: "daily"|"yunbei"|"vip" }）→ { ok }（网易账号登录态）
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);
export const POST = (req: NextRequest) => withBrowserSourceSession(req, postHandler);

async function getHandler(req: NextRequest) {
  const provider = getProvider("netease");
  if (!provider?.getCheckinStatus) {
    return NextResponse.json({ error: "签到仅支持网易云账号" }, { status: 400 });
  }
  const payload = await checkinCache.wrap(
    sourceCookieFingerprint(req),
    async (): Promise<Record<string, unknown>> => {
      try {
        return { status: (await provider.getCheckinStatus!()) as CheckinStatus };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
    (p) => !p.error,
  );
  return NextResponse.json(payload);
}

async function postHandler(req: NextRequest) {
  const guard = checkWriteGuard(req);
  if (guard) return guard;

  let body: { kind?: string } = {};
  try {
    body = (await req.json()) as { kind?: string };
  } catch {
    /* ignore */
  }
  const kind = (body.kind ?? "").trim();
  if (!KINDS.has(kind)) {
    return NextResponse.json({ error: "无效的签到类型" }, { status: 400 });
  }

  const provider = getProvider("netease");
  if (!provider?.doCheckin) {
    return NextResponse.json({ error: "签到仅支持网易云账号" }, { status: 400 });
  }

  try {
    await provider.doCheckin!(kind as "daily" | "yunbei" | "vip");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "签到失败" },
      { status: 502 },
    );
  }
}
