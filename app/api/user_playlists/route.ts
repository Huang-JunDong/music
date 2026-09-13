import { NextRequest, NextResponse } from "next/server";
import { getProvider, GetSourceDescription } from "@/lib/registry";
import { filterAvailableSources, sourcesFromQuery, USER_PLAYLIST_SOURCE_NAMES } from "@/lib/web-core";
import { createSourceSessionStore, runWithSourceSession } from "@/lib/cookies";
import { browserSourceCookies, requestIsHttps, srcSessionSetCookie } from "@/lib/source-session";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";
import type { Playlist } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 个人歌单多源聚合：120s 短缓存 + 并发去重（歌单可变，TTL 取短）；
 *  仅缓存无失败 tab 的结果；key 含音源凭证指纹防跨账号串数据 */
const userPlaylistsCache = createTtlCache<Record<string, unknown>>(120_000, 30);

/**
 * GET /api/user_playlists?sources= → {tabs:[{source,name,count,playlists,error?}], error?}
 * （page=1,limit=50；汇总 error 对齐 Go loadPlaylistSourceTabs）
 * 免登录（最大限度放开）：直接消费服务端存储的第三方登录态 Cookie（个人歌单）；
 * 上游未配置 Cookie 时由各源自行报错（tab.error 呈现）。
 */
export async function GET(req: NextRequest) {
  /* 多用户：浏览器自带音源凭证（自己扫码登录的账号）优先，未带时回退服务器全局存储。
     抑制 provider 写库（免登录接口不触碰全局配置）；审核整改 P3-01：浏览器自带源的上游凭证刷新
     改道回写该浏览器（仅 values 内的源——该源生效凭证即访客自己的，回写安全；
     全局兜底凭证的刷新不外发浏览器，仍由 /api/netease、/api/qq 代理路径负责落库） */
  const session = createSourceSessionStore(browserSourceCookies(req), true);
  const secure = requestIsHttps(req);
  return runWithSourceSession(session, async () => {
    /* P1 A2：owner+tab 模式 = 他人主页歌单（单源；user_playlist_create/collect） */
    const ownerUid = (req.nextUrl.searchParams.get("owner") ?? "").trim();
    if (ownerUid) {
      const source = (req.nextUrl.searchParams.get("source") ?? "").trim();
      const tab = req.nextUrl.searchParams.get("tab") === "collected" ? "collected" : "created";
      const page = Math.max(parseInt(req.nextUrl.searchParams.get("page") ?? "1", 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10) || 50, 1), 100);
      /* 审核整改 R2-#9：网易 uid 数字校验（防 NaN 上送） */
      if (!/^\d+$/.test(ownerUid)) return NextResponse.json({ error: "owner 必须为数字 uid" }, { status: 400 });
      if (!source) return NextResponse.json({ error: "缺少 source 参数" }, { status: 400 });
      const provider = getProvider(source);
      /* 审核整改 R2-#6：能力缺失返回 400（原返回空数组，与"该用户无歌单"混同） */
      const fn = tab === "collected" ? provider?.getUserCollectedPlaylists : provider?.getUserCreatedPlaylists;
      if (!fn) return NextResponse.json({ error: "该源不支持他人主页歌单" }, { status: 400 });
      try {
        const playlists = await fn(ownerUid, page, limit);
        return NextResponse.json({ source, tab, playlists });
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : String(err) },
          { status: 502 },
        );
      }
    }

    const sources = filterAvailableSources(
      sourcesFromQuery(req.nextUrl.searchParams),
      USER_PLAYLIST_SOURCE_NAMES,
    );
    /* 缓存包装在音源会话内执行：miss 时正常回源（凭证刷新回写不受影响），
       命中时无 provider 调用、无 pendingWrites */
    const payload = await userPlaylistsCache.wrap(
      `${sources.join(",")}|${sourceCookieFingerprint(req)}`,
      () => aggregateUserPlaylists(sources),
      (p) => !p.error,
    );
    const res = NextResponse.json(payload);
    for (const [source, value] of session.pendingWrites) {
      if (!session.values.has(source) || !value) continue;
      res.headers.append("Set-Cookie", srcSessionSetCookie(source, value, secure));
    }
    return res;
  });
}

async function aggregateUserPlaylists(sources: string[]): Promise<Record<string, unknown>> {
  const results = await Promise.allSettled(
    sources.map(async (source) => {
      const provider = getProvider(source);
      if (!provider?.getUserPlaylists) {
        throw new Error("该源不支持个人歌单");
      }
      const playlists = await provider.getUserPlaylists(1, 50);
      return playlists.map((p) => ({ ...p, source })) as Playlist[];
    }),
  );

  const tabs = results.map((result, i) => {
    const source = sources[i];
    const tab: Record<string, unknown> = {
      source,
      name: GetSourceDescription(source),
    };
    if (result.status === "fulfilled") {
      tab.count = result.value.length;
      tab.playlists = result.value;
    } else {
      tab.count = 0;
      tab.playlists = [];
      tab.error = result.reason instanceof Error ? result.reason.message : String(result.reason);
    }
    return tab;
  });

  const failed = tabs.filter((t) => (t as { error?: string }).error).map((t) => (t as { name: string }).name);
  let error = "";
  if (failed.length === tabs.length && tabs.length > 0) {
    error = `全部来源加载失败：${failed.join("、")}`;
  } else if (failed.length > 0) {
    error = `部分来源加载失败：${failed.join("、")}`;
  }

  const payload: Record<string, unknown> = { tabs };
  if (error) payload.error = error;
  return payload;
}
