import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider } from "@/lib/registry";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const videoCache = createTtlCache<Record<string, unknown>>(300_000, 20);

/**
 * GET /api/video?source=&id=&r= → { video, url }（P1 C7：网易 video_detail(+info) + video_url 多分辨率）
 * 相关视频：?related=1 → { related: MvItem[] }（related_allvideo）
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);

async function getHandler(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const id = (params.get("id") ?? "").trim();
  if (!id) return NextResponse.json({ error: "缺少视频 id" }, { status: 400 });
  const resolution = Math.max(parseInt(params.get("r") ?? "1080", 10) || 1080, 240);
  const provider = getProvider("netease");
  if (!provider?.getVideoDetail || !provider?.getVideoUrl) {
    return NextResponse.json({ error: "视频播放仅支持网易云音乐" }, { status: 400 });
  }

  if (params.get("related") === "1") {
    if (!provider.getRelatedVideos) return NextResponse.json({ related: [] });
    try {
      return NextResponse.json({ related: await provider.getRelatedVideos(id) });
    } catch {
      return NextResponse.json({ related: [] });
    }
  }

  const payload = await videoCache.wrap(`video|${id}|${resolution}|${sourceCookieFingerprint(req)}`, async () => {
    const [detailRes, urlRes] = await Promise.allSettled([
      provider.getVideoDetail!(id),
      provider.getVideoUrl!(id, resolution),
    ]);
    const result: Record<string, unknown> = {};
    if (detailRes.status === "fulfilled") result.video = detailRes.value;
    else result.error = detailRes.reason instanceof Error ? detailRes.reason.message : String(detailRes.reason);
    if (urlRes.status === "fulfilled") result.url = urlRes.value;
    else if (!result.error) result.error = urlRes.reason instanceof Error ? urlRes.reason.message : "视频链接不可用";
    return result;
  }, (p) => !p.error);
  return NextResponse.json(payload);
}
