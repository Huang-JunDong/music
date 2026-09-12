import { NextRequest, NextResponse } from "next/server";
import { getProvider } from "@/lib/registry";
import { setCookie, createSourceSessionStore, runWithSourceSession } from "@/lib/cookies";
import { authDisabled, currentUsername } from "@/lib/auth";
import { checkWriteGuard } from "@/lib/write-guard";
import { rateLimit, requestIP } from "@/lib/rate-limit";
import { browserSourceCookies, requestIsHttps, srcSessionSetCookie, srcSessionSource } from "@/lib/source-session";
import { UpstreamError } from "@/lib/types";
import { LoginError } from "@/lib/qq/errors";

/** 上游业务拒绝（密码/验证码错误、账号受限等客户端可纠正）→ 400；网络/服务故障 → 502 */
function loginErrorStatus(err: unknown): number {
  return err instanceof UpstreamError || err instanceof LoginError ? 400 : 502;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 短信资源保护：验证码发送 3/min、登录尝试 10/min、档案探测 30/min（IP 级，对齐 qr_login 限流模式） */
const SEND_CODE_LIMIT = 3;
const LOGIN_LIMIT = 10;
const PROFILE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

/**
 * 手机号登录（免登录可用）— 凭证策略对齐 /api/qr_login：
 * - 匿名访客：凭证只写浏览器（HttpOnly music_dl_src_source）；
 * - 管理员/桌面模式：服务端全局库双写。
 * GET  /api/phone_login/[source]           → { logged_in, nickname?, avatar? }
 * POST /api/phone_login/[source] { phone, mode, password?/code?, country_code? } → { ok, saved }
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ source: string }> }) {
  /* 档案探测会触发上游 login_status 请求：IP 级限流防滥用（审核整改 P3-3） */
  if (!rateLimit(`phoneprofile:${requestIP(req)}`, PROFILE_LIMIT, RATE_WINDOW_MS)) {
    return NextResponse.json({ logged_in: false, error: "请求过于频繁" }, { status: 429 });
  }
  const { source } = await params;
  const provider = getProvider(srcSessionSource(source));
  if (!provider?.getLoginProfile) {
    return NextResponse.json({ logged_in: false });
  }
  const browser = browserSourceCookies(req);
  const session = createSourceSessionStore(browser, true);
  try {
    const profile = await runWithSourceSession(session, () => provider.getLoginProfile!());
    return NextResponse.json(profile);
  } catch {
    return NextResponse.json({ logged_in: false });
  }
}

interface PhoneLoginBody {
  phone?: string;
  mode?: string;
  password?: string;
  code?: string;
  country_code?: number;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ source: string }> }) {
  const guarded = checkWriteGuard(req);
  if (guarded) return guarded;

  const { source } = await params;
  const cookieSource = srcSessionSource(source);
  const provider = getProvider(cookieSource);
  if (!provider) {
    return NextResponse.json({ error: "unsupported source" }, { status: 404 });
  }

  let body: PhoneLoginBody = {};
  try {
    body = (await req.json()) as PhoneLoginBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const phone = (body.phone ?? "").replace(/\s|-/g, "");
  const mode = (body.mode ?? "").trim();
  const countryCode = Number(body.country_code ?? 86) || 86;
  if (!/^\d{5,15}$/.test(phone)) {
    return NextResponse.json({ error: "手机号格式不正确" }, { status: 400 });
  }

  const isAdmin = authDisabled() || !!currentUsername(req);

  if (mode === "send_code") {
    if (!provider.sendPhoneCode) {
      return NextResponse.json({ error: "该源不支持验证码登录" }, { status: 400 });
    }
    if (!rateLimit(`smscode:${requestIP(req)}`, SEND_CODE_LIMIT, RATE_WINDOW_MS)) {
      return NextResponse.json({ error: "发送过于频繁，请稍后再试" }, { status: 429 });
    }
    const browser = browserSourceCookies(req);
    const session = createSourceSessionStore(browser, true);
    try {
      await runWithSourceSession(session, () => provider.sendPhoneCode!(phone, countryCode));
      return NextResponse.json({ ok: true, sent: true });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "发送失败" },
        { status: loginErrorStatus(err) },
      );
    }
  }

  const isPassword = mode === "password";
  const isCode = mode === "code";
  if (!isPassword && !isCode) {
    return NextResponse.json({ error: "无效的 mode" }, { status: 400 });
  }
  if (!rateLimit(`phonelogin:${requestIP(req)}`, LOGIN_LIMIT, RATE_WINDOW_MS)) {
    return NextResponse.json({ error: "尝试过于频繁，请稍后再试" }, { status: 429 });
  }

  const fn = isPassword ? provider.loginByPhonePassword : provider.loginByPhoneCode;
  if (!fn) {
    return NextResponse.json(
      { error: isPassword ? "该源不支持密码登录（请用扫码或验证码）" : "该源不支持验证码登录" },
      { status: 400 },
    );
  }

  const browser = browserSourceCookies(req);
  const session = createSourceSessionStore(browser, !isAdmin);
  let cookie = "";
  try {
    cookie = await runWithSourceSession(session, () =>
      isPassword
        ? provider.loginByPhonePassword!(phone, (body.password ?? "").trim(), countryCode)
        : provider.loginByPhoneCode!(phone, (body.code ?? "").trim(), countryCode),
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "登录失败" },
      { status: loginErrorStatus(err) },
    );
  }
  if (!cookie.trim()) {
    return NextResponse.json({ error: "登录成功但未获取到凭证" }, { status: 502 });
  }

  let saved: string = "browser";
  if (isAdmin) {
    try {
      setCookie(cookieSource, cookie);
      saved = "server+browser";
    } catch {
      /* 全局库写入失败降级为仅浏览器会话 */
    }
  }
  const res = NextResponse.json({ ok: true, saved });
  /* 优先下发会话合并值（浏览器旧凭证 + 本次响应 Set-Cookie 并集，含 __csrf 等附属项——审核整改 P3-5） */
  const mergedCookie = session.pendingWrites.get(cookieSource) || cookie;
  res.headers.append("Set-Cookie", srcSessionSetCookie(cookieSource, mergedCookie, requestIsHttps(req)));
  return res;
}
