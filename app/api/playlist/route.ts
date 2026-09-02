import { NextRequest, NextResponse } from "next/server";
import { getProvider } from "@/lib/registry";
import { GetOriginalLink } from "@/lib/original-link";
import { importCollectionFromQuery } from "@/lib/import-collection";
import type { Song } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/playlist?id=&source= → {playlist, songs, import_collection?}
 * playlist 元信息来自 query（name/cover/creator/track_count/description/link）；
 * 广场/搜索入口仅带 id+source，元信息缺失时并行 parsePlaylist 回填（失败不影响曲目）。
 * link 缺省用源原始链接规则；import_collection 对齐 Go importCollectionFromQuery。
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const id = params.get("id") ?? "";
  const source = params.get("source") ?? "";
  if (!id || !source) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }
  const provider = getProvider(source);
  if (!provider?.getPlaylistSongs) {
    return NextResponse.json({ error: "该源不支持查看歌单详情" }, { status: 400 });
  }

  const queryLink = (params.get("link") ?? "").trim();
  const link = queryLink || GetOriginalLink(source, id, "playlist");

  // 元信息缺失（封面/名称/创建者任一为空）时并行拉详情回填
  const metaMissing =
    !(params.get("name") ?? "").trim() ||
    !(params.get("cover") ?? "").trim() ||
    !(params.get("creator") ?? "").trim();
  const [songsResult, detailResult] = await Promise.allSettled([
    provider.getPlaylistSongs(id),
    metaMissing && provider.parsePlaylist ? provider.parsePlaylist(link) : Promise.resolve(null),
  ]);

  let songs: Song[] = [];
  let error = "";
  if (songsResult.status === "fulfilled") {
    songs = songsResult.value.map((s) => ({ ...s, source: s.source || source }));
  } else {
    const err = songsResult.reason;
    error = `获取歌单失败: ${err instanceof Error ? err.message : String(err)}`;
  }

  const detail = detailResult.status === "fulfilled" ? detailResult.value : null;
  const dp = detail?.playlist;
  // 曲目获取失败但详情解析成功时，用详情中的曲目兜底
  if (!songs.length && detail?.songs?.length) {
    songs = detail.songs.map((s) => ({ ...s, source: s.source || source }));
  }

  const playlist = {
    id,
    source,
    type: "playlist",
    name: (params.get("name") ?? "").trim() || dp?.name || "",
    description: (params.get("description") ?? "").trim() || dp?.description || "",
    cover: (params.get("cover") ?? "").trim() || dp?.cover || "",
    creator: (params.get("creator") ?? "").trim() || dp?.creator || "",
    play_count: dp?.play_count ?? 0,
    track_count: parseInt(params.get("track_count") ?? "", 10) || dp?.track_count || songs.length,
    link,
  };

  // 对齐 Go：query link 优先于 GetOriginalLink 作为导入回退 link
  const importCollection = importCollectionFromQuery(
    params,
    "playlist",
    source,
    id,
    link,
    songs.length,
  );

  const payload: Record<string, unknown> = { playlist, songs };
  if (importCollection) payload.import_collection = importCollection;
  if (error) payload.error = error;
  return NextResponse.json(payload);
}
