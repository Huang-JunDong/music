import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider, songFromParams } from "@/lib/registry";
import { checkWriteGuard } from "@/lib/write-guard";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 红心列表 60s 缓存（toggle 走 POST 乐观更新，列表仅首载/过期回源） */
const likeListCache = createTtlCache<Record<string, unknown>>(60_000, 10);

/**
 * GET /api/likes?source= → { ids: string[] }（未登录返回空数组）
 * POST /api/likes（JSON: source + song参数 + like）→ { ok: true }
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);
export const POST = (req: NextRequest) => withBrowserSourceSession(req, postHandler);

async function getHandler(req: NextRequest) {
  const source = (req.nextUrl.searchParams.get("source") ?? "").trim();
  if (!source) return NextResponse.json({ error: "Missing source" }, { status: 400 });
  const provider = getProvider(source);
  if (!provider?.getLikeList) {
    return NextResponse.json({ error: "该源不支持红心" }, { status: 400 });
  }

  const payload = await likeListCache.wrap(
    `${source}|${sourceCookieFingerprint(req)}`,
    async (): Promise<Record<string, unknown>> => {
      try {
        return { ids: await provider.getLikeList!() };
      } catch (err) {
        /* 网络失败返回空集且不缓存（未登录场景双源 provider 均已容错返回 []，此处 error 仅剩故障） */
        return { ids: [], error: err instanceof Error ? err.message : String(err) };
      }
    },
    (p) => !p.error,
  );
  return NextResponse.json(payload);
}

async function postHandler(req: NextRequest) {
  const guard = checkWriteGuard(req);
  if (guard) return guard;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  const song = songFromParams(new URLSearchParams(body as Record<string, string>));
  const like = body.like === true || body.like === "true";
  if (!song.id || !song.source) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }
  const provider = getProvider(song.source);
  if (!provider?.likeSong) {
    return NextResponse.json({ error: "该源不支持红心" }, { status: 400 });
  }

  try {
    await provider.likeSong!(song, like);
    /* 读己之写：立即失效该会话的红心列表缓存（乐观更新兜底之外消除 60s 陈旧窗口） */
    likeListCache.del(`${song.source}|${sourceCookieFingerprint(req)}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "操作失败" },
      { status: 502 },
    );
  }
}
