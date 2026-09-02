/**
 * import_collection 元数据组装 — 移植 internal/web/music.go 的
 * importCollectionFromQuery / applyImportCollectionFallback / importCollectionHoverText。
 */
import type { Playlist } from "./types";

export interface ImportCollectionMeta {
  enabled: boolean;
  name: string;
  description: string;
  cover: string;
  creator: string;
  track_count: number;
  source: string;
  external_id: string;
  link: string;
  content_type: string;
  hover_text: string;
}

/** importCollectionHoverText 移植（server.go:161） */
export function importCollectionHoverText(contentType: string): string {
  if (contentType === "album") {
    return "导入到本地歌单列表，保存为外部导入专辑；仅保存元数据，不保存具体歌曲明细。";
  }
  return "导入到本地歌单列表，保存为外部导入歌单；仅保存元数据，不保存具体歌曲明细。";
}

/** importCollectionFromQuery 移植（music.go:26-65） */
export function importCollectionFromQuery(
  params: URLSearchParams,
  contentType: "playlist" | "album",
  source: string,
  externalID: string,
  fallbackLink: string,
  fallbackTrackCount: number,
): ImportCollectionMeta | undefined {
  const src = (source ?? "").trim();
  const extID = (externalID ?? "").trim();
  if (!src || !extID) return undefined;

  const name = (params.get("name") ?? "").trim() || (contentType === "album" ? "导入专辑" : "导入歌单");

  let trackCount = parseInt((params.get("track_count") ?? "").trim(), 10);
  if (!Number.isFinite(trackCount) || trackCount <= 0) trackCount = fallbackTrackCount;

  const link = (params.get("link") ?? "").trim() || fallbackLink;

  return {
    enabled: true,
    name,
    description: (params.get("description") ?? "").trim(),
    cover: (params.get("cover") ?? "").trim(),
    creator: (params.get("creator") ?? "").trim(),
    track_count: trackCount,
    source: src,
    external_id: extID,
    link,
    content_type: contentType,
    hover_text: importCollectionHoverText(contentType),
  };
}

/** applyImportCollectionFallback 移植（music.go:67-100） */
export function applyImportCollectionFallback(
  meta: ImportCollectionMeta | undefined,
  playlist: Playlist | undefined | null,
  fallbackTrackCount: number,
  fallbackLink: string,
): void {
  if (!meta || !playlist) return;

  if (!meta.name.trim() || meta.name === "导入歌单" || meta.name === "导入专辑") {
    const name = (playlist.name ?? "").trim();
    if (name) meta.name = name;
  }
  if (!meta.description.trim()) meta.description = (playlist.description ?? "").trim();
  if (!meta.cover.trim()) meta.cover = (playlist.cover ?? "").trim();
  if (!meta.creator.trim()) meta.creator = (playlist.creator ?? "").trim();
  if (meta.track_count <= 0) {
    meta.track_count = playlist.track_count > 0 ? playlist.track_count : fallbackTrackCount;
  }
  if (!meta.link.trim()) {
    meta.link = (playlist.link ?? "").trim() || fallbackLink;
  }
}
