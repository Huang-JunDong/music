import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider, songFromParams } from "@/lib/registry";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";
import type { Song, SongWiki } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 百科 10min 缓存（低频变动）；键含歌曲全参数与凭证指纹 */
const wikiCache = createTtlCache<Record<string, unknown>>(600_000, 40);

/**
 * GET /api/song_wiki（song 参数集）→ { wiki }（P1 C1 播放页"百科"Tab 聚合）
 * 网易：song_wiki_info/summary 图文 + song_creators 名单 + song_music_detail 元信息 +
 *       song_red_count 精彩评论数 + song_copyright_rcmd 版权替代；
 * QQ：GetSongLabels 标签 + SongProducer 制作人 + GetOtherVersionSongs 其他版本 + 收藏数。
 * 各子段 allSettled 独立降级，单段失败不影响整体。
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);

async function getHandler(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const song = songFromParams(params);
  if (!song.id || !song.source) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }
  const provider = getProvider(song.source);
  if (!provider?.getSongWiki) {
    return NextResponse.json({ error: "该源不支持歌曲百科" }, { status: 400 });
  }

  const payload = await wikiCache.wrap(
    `${req.nextUrl.search}|${sourceCookieFingerprint(req)}`,
    async (): Promise<Record<string, unknown>> => {
      const [wikiRes, creatorsRes, metaRes, redRes, subRes, favRes] = await Promise.allSettled([
        provider.getSongWiki!(song),
        provider.getSongCreators?.(song) ?? Promise.resolve(undefined),
        provider.getSongMusicDetail?.(song) ?? Promise.resolve(undefined),
        provider.getSongRedCount?.(song) ?? Promise.resolve(undefined),
        provider.getCopyrightSubstitutes?.(song) ?? Promise.resolve(undefined),
        provider.getSongFavNum?.(song) ?? Promise.resolve(undefined),
      ]);
      if (wikiRes.status === "rejected") {
        return { error: wikiRes.reason instanceof Error ? wikiRes.reason.message : String(wikiRes.reason) };
      }
      const wiki = wikiRes.value as SongWiki;
      if (creatorsRes.status === "fulfilled" && creatorsRes.value?.length) wiki.creators = creatorsRes.value;
      if (metaRes.status === "fulfilled" && metaRes.value?.length) wiki.meta = metaRes.value;
      if (redRes.status === "fulfilled" && typeof redRes.value === "number") wiki.hot_comment_count = redRes.value;
      if (subRes.status === "fulfilled" && subRes.value?.length) wiki.substitutes = subRes.value;
      if (favRes.status === "fulfilled" && typeof favRes.value === "number") {
        wiki.meta = [...(wiki.meta ?? []), { label: "收藏数", value: favRes.value.toLocaleString("zh-CN") }];
      }
      /* P1 C3：QQ 评论总数徽标（GetCommentCount；网易由 song_red_count 承担） */
      if (wiki.hot_comment_count === undefined && provider.getSongCommentCount) {
        try {
          wiki.hot_comment_count = await provider.getSongCommentCount(song);
        } catch {
          /* ignore */
        }
      }
      return { wiki };
    },
    (p) => !p.error,
  );
  return NextResponse.json(payload);
}
