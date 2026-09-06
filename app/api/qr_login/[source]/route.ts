import { NextRequest, NextResponse } from "next/server";
import { getProvider } from "@/lib/registry";
import { createWXQRLogin } from "@/lib/providers/qq";
import { setCookie, createSourceSessionStore, runWithSourceSession } from "@/lib/cookies";
import { authDisabled, currentUsername } from "@/lib/auth";
import { checkWriteGuard } from "@/lib/write-guard";
import { rateLimit, requestIP } from "@/lib/rate-limit";
import { qrLoginCookieString, resolveQRLogin } from "@/lib/qr-login";
import {
  browserSourceCookies,
  requestIsHttps,
  srcSessionClearCookie,
  srcSessionSetCookie,
  srcSessionSource,
} from "@/lib/source-session";
import type { QRLoginResult, QRLoginSession } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 扫码登录（免登录可用）— 多用户凭证策略：
 * - 匿名访客：凭证只写入其浏览器（Set-Cookie music_dl_src_<source>），
 *   服务器全局存储不被触碰（provider 内部写库被请求级会话抑制）；
 * - 管理员（已登录站点账号，或 MUSIC_DL_DISABLE_AUTH 桌面模式）：额外写入服务器全局存储（原设置页行为不变）。
 * - 凭证不经响应体回显（审核整改 P2-02）：服务端写库 + HttpOnly Set-Cookie 双通路覆盖全部场景。
 */

/** 创建扫码会话为上游重资源（二维码 + QQ MQTT 推送）：IP 级限流（审核整改 P2-01，对齐 cover_proxy 模式） */
const QR_CREATE_RATE_LIMIT = 10;
/** key 轮询触发上游查询：单弹窗 3s 轮询 ≈ 20/min，多标签页/多源留余量 */
const QR_POLL_RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;

/** cookie 存储用的源名（qq_wx 二维码也存到 qq 名下，对齐 Go）；凭证组装与轮询分发见 lib/qr-login.ts（审核整改 P3-04 下沉） */
function qrLoginCookieSource(source: string): string {
  return srcSessionSource(source);
}

/** GET /api/qr_login/[source]?status=1 — 查询浏览器是否已登录自己的音源账号 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ source: string }> }) {
  const { source } = await params;

  /* 状态查询：浏览器会话 Cookie 是否存在 */
  if (req.nextUrl.searchParams.get("status") === "1") {
    const cookieSource = qrLoginCookieSource(source);
    const browser = browserSourceCookies(req);
    return NextResponse.json({ source, cookie_source: cookieSource, logged_in: !!browser[cookieSource] });
  }

  const key = (req.nextUrl.searchParams.get("key") ?? "").trim();
  if (!key) {
    return NextResponse.json({ error: "missing qr login key" }, { status: 400 });
  }

  /* key 轮询触发上游查询：IP 级限流（P2-01；?status=1 纯本地查询不受限） */
  if (!rateLimit(`qrpoll:${requestIP(req)}`, QR_POLL_RATE_LIMIT, RATE_WINDOW_MS)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  /* 匿名会话抑制 provider 内部写库（QQ checkQRLogin 的 saveCredential 等）；
     管理员保持原行为（写全局）——桌面模式（DISABLE_AUTH）视同管理员，对齐 Go 单机行为；
     站点账号与会话见 lib/auth.ts */
  const isAdmin = authDisabled() || !!currentUsername(req);
  const session = createSourceSessionStore({}, !isAdmin);

  let result: QRLoginResult;
  try {
    result = await runWithSourceSession(session, () => resolveQRLogin(source, key));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  if (result && result.status === "success") {
    const cookie = qrLoginCookieString(result);
    if (cookie) {
      const cookieSource = qrLoginCookieSource(source);
      /* P2-02：凭证不经响应体回显——访客经 HttpOnly Set-Cookie 下发，管理员/桌面模式服务端直接写库；
         前端（设置页/我的账号页）不再经手明文凭证 */
      result.cookie = undefined;
      result.cookies = undefined;
      let saved: string = "browser";
      if (isAdmin) {
        try {
          setCookie(cookieSource, cookie);
          saved = "server+browser";
        } catch {
          /* 全局库写入失败降级为仅浏览器会话（该浏览器登录态不受影响） */
        }
      }
      result.extra = {
        ...(result.extra ?? {}),
        cookie_saved: saved,
        cookie_source: cookieSource,
      };
      const res = NextResponse.json(result);
      res.headers.append("Set-Cookie", srcSessionSetCookie(cookieSource, cookie, requestIsHttps(req)));
      return res;
    }
  }
  return NextResponse.json(result);
}

/** POST /api/qr_login/[source] — 创建扫码会话（qq_wx → 微信通道，对齐 GetQRLoginCreateFunc） */
export async function POST(req: NextRequest, { params }: { params: Promise<{ source: string }> }) {
  const guarded = checkWriteGuard(req);
  if (guarded) return guarded;

  /* 创建扫码会话为上游重资源（网易/QQ 二维码 + MQTT）：IP 级限流（P2-01） */
  if (!rateLimit(`qrcreate:${requestIP(req)}`, QR_CREATE_RATE_LIMIT, RATE_WINDOW_MS)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { source } = await params;
  try {
    let session: QRLoginSession;
    if (source === "qq_wx") {
      session = await createWXQRLogin();
    } else {
      const provider = getProvider(source);
      if (!provider?.createQRLogin) {
        return NextResponse.json({ error: "unsupported qr login source" }, { status: 404 });
      }
      session = await provider.createQRLogin();
    }
    return NextResponse.json({ ...session, source });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

/**
 * DELETE /api/qr_login/[source] — 退出"我的音源账号"
 * - 所有用户：清除浏览器会话凭证（music_dl_src_<source>）
 * - 管理员/桌面模式：登录时曾双写全局库（GET success 分支 setCookie），
 *   退出时对称删除该全局键，避免设置页"音源登录"残留已失效的已登录状态；
 *   访客不触碰全局库（维持原语义：全局 Cookie 由设置页管理）
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ source: string }> }) {
  const guarded = checkWriteGuard(req);
  if (guarded) return guarded;

  const { source } = await params;
  const cookieSource = qrLoginCookieSource(source);
  let globalCleared = false;
  if (authDisabled() || currentUsername(req)) {
    try {
      setCookie(cookieSource, ""); // 空值删键（setAllCookies 空串 → DELETE）
      globalCleared = true;
    } catch {
      /* 全局库删除失败不阻断浏览器凭证清除（设置页退出按钮可兜底） */
    }
  }
  const res = NextResponse.json({ status: "ok", cookie_source: cookieSource, global_cleared: globalCleared });
  res.headers.append("Set-Cookie", srcSessionClearCookie(cookieSource));
  return res;
}
