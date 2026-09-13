import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider } from "@/lib/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/report?source=&section=&type=&date=
 * section: annual 年度报告(网易) | stats 听歌画像(双源) | record 播放排行(网易) | history 历史每日推荐(网易)
 * 报告为个人数据：不缓存（防跨账号串档）；按 section 独立加载，单段失败不影响其余。
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);

async function getHandler(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  /* 审核整改 C-01：source 白名单化（原样透传任意字符串） */
  const source = params.get("source") === "qq" ? "qq" : "netease";
  const section = params.get("section") ?? "stats";
  const date = (params.get("date") ?? "").trim();
  const provider = getProvider(source);

  try {
    switch (section) {
      case "annual": {
        if (!provider?.getAnnualReport) throw new Error("该源不支持年度报告");
        return NextResponse.json({ sections: await provider.getAnnualReport() });
      }
      case "stats": {
        if (!provider?.getListenStats) throw new Error("该源不支持听歌画像");
        return NextResponse.json({ stats: await provider.getListenStats() });
      }
      case "record": {
        if (!provider?.getUserPlayRecord) throw new Error("该源不支持播放排行");
        const type = params.get("type") === "0" ? 0 : 1;
        const list = await provider.getUserPlayRecord(type);
        return NextResponse.json({ items: list, record_type: type });
      }
      case "history": {
        if (!provider?.getHistoryDailyRecommends) throw new Error("该源不支持历史每日推荐");
        return NextResponse.json({ days: await provider.getHistoryDailyRecommends(date || undefined) });
      }
      default:
        return NextResponse.json({ error: "无效的 section" }, { status: 400 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    /* 对齐 /api/recent 约定：未登录返回 200 + need_login（前端渲染登录引导而非错误卡，
       也避免浏览器控制台 502 噪音） */
    if (/登录/.test(msg)) return NextResponse.json({ need_login: true });
    /* 活动型时效（年度报告非活动期）属预期状态而非网关故障：200 + error 字段 */
    if (/暂未生成|时效/.test(msg)) return NextResponse.json({ error: msg });
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
