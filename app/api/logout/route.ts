import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { clearSessionCookieHeader } from "@/lib/auth";
import { getProvider } from "@/lib/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/logout — 清会话 Cookie（对齐 Go POST /logout）
 * 并尽力注销上游源账号（网易 logout · QQ login/Logout），失败不阻塞本地登出；
 * 源站凭证若由会话隔离存储，随会话清理一并失效。
 */
export const POST = (req: NextRequest) => withBrowserSourceSession(req, postHandler);

async function postHandler() {
  const upstream: Record<string, string> = {};
  await Promise.allSettled(
    (["netease", "qq"] as const).map(async (source) => {
      const provider = getProvider(source);
      if (!provider?.logout) return;
      try {
        await provider.logout();
        upstream[source] = "ok";
      } catch (err) {
        /* 未登录/网络故障等：本地登出不受影响 */
        upstream[source] = err instanceof Error ? err.message : "failed";
      }
    }),
  );

  const res = NextResponse.json({ status: "ok", upstream });
  res.headers.set("Set-Cookie", clearSessionCookieHeader());
  return res;
}
