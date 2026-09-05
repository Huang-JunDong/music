import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider, GetPlaylistCategorySourceNames, GetSourceDescription } from "@/lib/registry";
import { sourcesFromQuery } from "@/lib/web-core";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";
import type { PlaylistCategory } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 分类目录多源聚合：5min 缓存 + 并发去重，广场页反复进入零回源；仅缓存无失败的结果 */
const playlistCategoriesCache = createTtlCache<Record<string, unknown>>(300_000, 30);

/** 请求源与支持源求交集（空回退全部，对齐 playlistCategorySourcesFromQuery） */
function playlistCategorySourcesFromQuery(params: URLSearchParams): string[] {
  const supported = GetPlaylistCategorySourceNames();
  const requested = sourcesFromQuery(params).filter((s) => supported.includes(s));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const source of requested) {
    if (seen.has(source)) continue;
    seen.add(source);
    result.push(source);
  }
  return result.length ? result : supported;
}

function categoryPlaylistsURL(source: string, category: PlaylistCategory): string {
  const values = new URLSearchParams();
  values.set("source", source);
  if ((category.id ?? "").trim()) values.set("category_id", category.id.trim());
  if ((category.name ?? "").trim()) values.set("category_name", category.name.trim());
  return `/api/category_playlists?${values.toString()}`;
}

/**
 * GET /api/playlist_categories?sources= → {sources:[{source,name,count,groups}], error?}
 * 对齐 Go loadPlaylistCategoryPageSources：失败源不出现在 views 中，
 * 全部失败 → "没有可展示的歌单分类"；部分失败 → "部分来源分类加载失败：…"
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);

async function getHandler(req: NextRequest) {
  const sources = playlistCategorySourcesFromQuery(req.nextUrl.searchParams);

  const payload = await playlistCategoriesCache.wrap(
    `${sources.join(",")}|${sourceCookieFingerprint(req)}`,
    () => aggregateCategories(sources),
    (p) => !p.error,
  );
  return NextResponse.json(payload);
}

async function aggregateCategories(sources: string[]): Promise<Record<string, unknown>> {
  const results = await Promise.allSettled(
    sources.map(async (source) => {
      const provider = getProvider(source);
      if (!provider?.getPlaylistCategories) {
        throw new Error("该源不支持歌单分类");
      }
      const categories = await provider.getPlaylistCategories();
      if (!categories?.length) throw new Error("empty categories");
      return categories.map((c) => ({ ...c, source }));
    }),
  );

  const views: Record<string, unknown>[] = [];
  const failed: string[] = [];
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      failed.push(GetSourceDescription(sources[i]));
      return;
    }
    const source = sources[i];
    const groupIndex = new Map<string, number>();
    const groups: { name: string; categories: Record<string, unknown>[] }[] = [];
    for (const category of result.value) {
      const name = (category.name ?? "").trim();
      if (!name) continue;
      const groupName = (category.group ?? "").trim() || "其他";
      if (!groupIndex.has(groupName)) {
        groupIndex.set(groupName, groups.length);
        groups.push({ name: groupName, categories: [] });
      }
      groups[groupIndex.get(groupName)!].categories.push({
        id: (category.id ?? "").trim(),
        name,
        hot: !!category.hot,
        url: categoryPlaylistsURL(source, category),
        source,
      });
    }
    views.push({
      source,
      name: GetSourceDescription(source),
      count: groups.reduce((sum, g) => sum + g.categories.length, 0),
      groups,
    });
  });

  let error = "";
  if (views.length === 0) {
    error = "没有可展示的歌单分类";
  } else if (failed.length > 0) {
    error = `部分来源分类加载失败：${failed.join("、")}`;
  }

  const result: Record<string, unknown> = { sources: views };
  if (error) result.error = error;
  return result;
}
