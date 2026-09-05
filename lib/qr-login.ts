/**
 * 扫码登录辅助 — 凭证组装与轮询分发（从 app/api/qr_login/[source]/route.ts 下沉，审核整改 P3-04 薄路由）。
 */
import { getProvider } from "@/lib/registry";
import { checkWXQRLogin } from "@/lib/providers/qq";
import type { QRLoginResult } from "@/lib/types";

/** 组装 cookie 串：优先 cookie 字段，否则按 key 排序拼接 cookies map */
export function qrLoginCookieString(result: QRLoginResult): string {
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

/** 轮询扫码结果：qq_wx 走微信通道，其余走 provider（无能力则抛 unsupported） */
export async function resolveQRLogin(source: string, key: string): Promise<QRLoginResult> {
  if (source === "qq_wx") {
    return checkWXQRLogin(key);
  }
  const provider = getProvider(source);
  if (!provider?.checkQRLogin) {
    throw new Error("unsupported qr login source");
  }
  return provider.checkQRLogin(key);
}
