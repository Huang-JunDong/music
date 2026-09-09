import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { checkWriteGuard } from "@/lib/write-guard";
import {
  clearPlayHistory,
  isValidHistorySid,
  listPlayHistory,
  recordPlayHistory,
  sanitizePlayHistoryBody,
} from "@/lib/play-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 请求体上限（字节，审核整改 P3-6：按 UTF-8 实际字节数而非 UTF-16 码元数判定） */
const MAX_REQUEST_BYTES = 64 * 1024;

/**
 * 匿名历史会话 Cookie（审核整改 P1-1）：HttpOnly + SameSite=Lax + 有限 Max-Age，
 * 值为服务端签发的随机 UUID，不含任何个人信息；听歌记录按此会话键隔离，访客互不可见。
 */
const HISTORY_SID_COOKIE = "music_dl_hist_sid";
const HISTORY_SID_MAX_AGE = 60 * 60 * 24 * 180;

function readSid(req: NextRequest): string | null {
  const v = req.cookies.get(HISTORY_SID_COOKIE)?.value;
  return isValidHistorySid(v) ? v : null;
}

/**
 * GET /api/history — 当前会话最近 100 条播放历史（Song 形状，最新在前）。
 * 免登录：仅返回本浏览器 sid 维度数据（无 sid 返回空列表，sid 由首次 POST 签发），
 * 多用户部署下不泄露他人听歌记录。
 */
export async function GET(req: NextRequest) {
  const sid = readSid(req);
  return NextResponse.json({ songs: sid ? listPlayHistory(sid) : [] });
}

/**
 * POST /api/history — 记录一次播放到当前会话（fire-and-forget，前端静默失败）。
 * 免登录 + 同源 XHR 守卫（对齐 /api/local_music/auto_cache）：写入仅归属本浏览器 sid，
 * 不污染其他会话；首次写入时签发 HttpOnly 匿名 sid Cookie。
 */
export async function POST(req: NextRequest) {
  const guarded = checkWriteGuard(req);
  if (guarded) return guarded;

  let parsed: unknown;
  try {
    const raw = await req.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: "request too large" }, { status: 413 });
    }
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const body = sanitizePlayHistoryBody(parsed);
  if (!body) {
    return NextResponse.json({ error: "missing or invalid id/source" }, { status: 400 });
  }

  const existing = readSid(req);
  const sessionKey = existing ?? randomUUID();
  recordPlayHistory(sessionKey, body);
  const res = NextResponse.json({ status: "ok" });
  if (!existing) {
    /* R2 复审加固：HTTPS 部署下附 secure 标志（防中间人读取会话键）；
     * 本地/内网 HTTP 部署不加（加了 Cookie 不落，功能不可用） */
    const secure = req.nextUrl.protocol === "https:";
    res.cookies.set(HISTORY_SID_COOKIE, sessionKey, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: HISTORY_SID_MAX_AGE,
      ...(secure ? { secure: true } : {}),
    });
  }
  return res;
}

/**
 * DELETE /api/history — 清空当前会话的播放历史。
 * 会话隔离（P1-1 整改）后清的是本浏览器自己的数据，不再需要管理员权限——
 * 免登录 + CSRF 守卫即可，对齐标准第 3 章"提供删除我的数据"能力；
 * sid 失效后的残留数据由服务端保留期（90 天）兜底清理。
 */
export async function DELETE(req: NextRequest) {
  const guarded = checkWriteGuard(req);
  if (guarded) return guarded;
  const sid = readSid(req);
  if (sid) clearPlayHistory(sid);
  return NextResponse.json({ status: "ok" });
}
