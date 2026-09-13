import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession, srcSessionSetCookie, requestIsHttps } from "@/lib/source-session";
import { getProvider } from "@/lib/registry";
import { checkWriteGuard } from "@/lib/write-guard";
import { rateLimit, requestIP } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/account（P1 C6 账号管理增强）
 * { action: "refresh", source: "netease"|"qq" } → { ok }（网易 login_refresh · QQ refreshCredential）
 * { action: "anonymous" } → { ok, cookie }（网易匿名注册兜底凭证，写入浏览器会话）
 * { action: "check_expired", source: "qq" } → { expired: boolean }
 * 频控：写操作 6 次/分钟/IP。
 */
export const POST = (req: NextRequest) => withBrowserSourceSession(req, postHandler);

async function postHandler(req: NextRequest) {
  const guard = checkWriteGuard(req);
  if (guard) return guard;
  if (!rateLimit(`account-action:${requestIP(req)}`, 6, 60_000)) {
    return NextResponse.json({ error: "操作过于频繁，请稍后再试" }, { status: 429 });
  }

  let body: { action?: string; source?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* ignore */
  }
  const action = (body.action ?? "").trim();
  const source = (body.source ?? "netease").trim();

  try {
    if (action === "refresh") {
      const provider = getProvider(source);
      const fn = source === "qq" ? provider?.refreshCredential : provider?.refreshLogin;
      if (!fn) return NextResponse.json({ error: `该源不支持凭证续期` }, { status: 400 });
      await fn.call(provider);
      return NextResponse.json({ ok: true });
    }
    if (action === "check_expired") {
      const provider = getProvider(source);
      if (!provider?.checkCredentialExpired) return NextResponse.json({ expired: false });
      const expired = await provider.checkCredentialExpired();
      return NextResponse.json({ expired });
    }
    if (action === "anonymous") {
      /* 审核登记 C-03：匿名注册面向访客开放（产品设计上无需站点登录，为无凭证访客提供
         浏览器级兜底会话）；滥用防护依赖 6 次/分钟/IP 频控 + 上游注册开销可控。
         如需进一步收紧可叠加 requireAuth（多用户部署时建议）。 */
      const provider = getProvider("netease");
      if (!provider?.registerAnonymous) {
        return NextResponse.json({ error: "匿名注册仅支持网易云音乐" }, { status: 400 });
      }
      const cookie = await provider.registerAnonymous();
      const res = NextResponse.json({ ok: true });
      /* 匿名凭证写入浏览器源会话（与扫码登录同通道，90 天） */
      res.headers.append("Set-Cookie", srcSessionSetCookie("netease", cookie, requestIsHttps(req)));
      return res;
    }
    return NextResponse.json({ error: "无效的 action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "操作失败" }, { status: 502 });
  }
}
