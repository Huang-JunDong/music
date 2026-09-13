import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider } from "@/lib/registry";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";
import type { CountryCode } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 区号列表 24h 缓存（极低频） */
const countriesCache = createTtlCache<Record<string, unknown>>(86_400_000, 5);

/**
 * GET /api/countries → { countries }（P1 C6：网易 countries_code_list 国际区号，手机登录区号选择）
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);

async function getHandler(req: NextRequest) {
  const provider = getProvider("netease");
  if (!provider?.getCountryCodes) {
    /* 无网易能力时返回常用兜底区号，避免登录弹窗空数据 */
    return NextResponse.json({
      countries: [
        { code: "86", name: "China", zh_name: "中国大陆" },
        { code: "852", name: "Hong Kong", zh_name: "中国香港" },
        { code: "853", name: "Macao", zh_name: "中国澳门" },
        { code: "886", name: "Taiwan", zh_name: "中国台湾" },
        { code: "1", name: "United States", zh_name: "美国" },
        { code: "81", name: "Japan", zh_name: "日本" },
        { code: "82", name: "South Korea", zh_name: "韩国" },
        { code: "44", name: "United Kingdom", zh_name: "英国" },
      ] as CountryCode[],
    });
  }
  const payload = await countriesCache.wrap(`countries|${sourceCookieFingerprint(req)}`, async () => {
    try {
      return { countries: (await provider.getCountryCodes!()) as CountryCode[] };
    } catch {
      return { countries: [] as CountryCode[] };
    }
  });
  return NextResponse.json(payload);
}
