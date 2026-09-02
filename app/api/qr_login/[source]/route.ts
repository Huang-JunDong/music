import { NextRequest, NextResponse } from "next/server";
import { getProvider } from "@/lib/registry";
import { createWXQRLogin, checkWXQRLogin } from "@/lib/providers/qq";
import { setCookie } from "@/lib/cookies";
import { requireAuth } from "@/lib/auth";
import type { QRLoginResult, QRLoginSession } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** cookie 存储用的源名（qq_wx 二维码也存到 qq 名下，对齐 Go） */
function qrLoginCookieSource(source: string): string {
  return source === "qq_wx" ? "qq" : source;
}

/** 组装 cookie 串：优先 cookie 字段，否则按 key 排序拼接 cookies map */
function qrLoginCookieString(result: QRLoginResult): string {
  const direct = (result.cookie ?? "").trim();
  if (direct) return direct;
  const cookies = result.cookies ?? {};
  const keys = Object.keys(cookies)
    .filter((k) => k.trim())
    .sort();
  const parts: string[] = [];
  for (const key of keys) {
    const value = (cookies[key] ?? "").trim();
    if (value) parts.push(`${key}=${value}`);
  }
  return parts.join("; ");
}

/** POST /api/qr_login/[source] — 创建扫码会话（受保护；qq_wx → 微信通道，对齐 GetQRLoginCreateFunc） */
export async function POST(req: NextRequest, { params }: { params: Promise<{ source: string }> }) {
  const denied = requireAuth(req);
  if (denied) return NextResponse.json(denied.body, { status: denied.status });

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

/** GET /api/qr_login/[source]?key= — 轮询（受保护）；成功时 cookie 持久化，extra.cookie_saved=true */
export async function GET(req: NextRequest, { params }: { params: Promise<{ source: string }> }) {
  const denied = requireAuth(req);
  if (denied) return NextResponse.json(denied.body, { status: denied.status });

  const { source } = await params;
  const key = (req.nextUrl.searchParams.get("key") ?? "").trim();
  if (!key) {
    return NextResponse.json({ error: "missing qr login key" }, { status: 400 });
  }

  let result: QRLoginResult;
  try {
    if (source === "qq_wx") {
      result = await checkWXQRLogin(key);
    } else {
      const provider = getProvider(source);
      if (!provider?.checkQRLogin) {
        return NextResponse.json({ error: "unsupported qr login source" }, { status: 404 });
      }
      result = await provider.checkQRLogin(key);
    }
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
      result.cookie = cookie;
      setCookie(cookieSource, cookie);
      result.extra = {
        ...(result.extra ?? {}),
        cookie_saved: "true",
        cookie_source: cookieSource,
        cookie_length: String(cookie.length),
      };
    }
  }
  return NextResponse.json(result);
}
