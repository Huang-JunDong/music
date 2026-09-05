/**
 * 封面 URL 体系 — 移植自 .ref/QQMusicApi qqmusic_api/models/base.py。
 * photo_new 规则：https://y.gtimg.cn/music/photo_new/{kind}{sizeSeg}M000{mid}.jpg
 *  - T001 = 歌手头像，T002 = 专辑封面
 *  - 六档尺寸 150/300/500/800/1200/1500
 *  - mid 缺失时回退 pmid；Song 级封面按 专辑 → 首个可用歌手 回退链
 */

export type CoverSize = 150 | 300 | 500 | 800 | 1200 | 1500;

export const COVER_SIZES: readonly CoverSize[] = [150, 300, 500, 800, 1200, 1500];

const PHOTO_NEW_SIZE_SEGMENTS: Record<CoverSize, string> = {
  150: "R150x150",
  300: "R300x300",
  500: "R500x500",
  800: "R800x800",
  1200: "R1200x1200",
  1500: "R1500x1500",
};

/** 按 photo_new 规则拼接封面链接（mid 空白返回空串；非法尺寸抛错，对齐 ValueError） */
export function buildPhotoNewCoverUrl(kind: "T001" | "T002", mid: string, size: CoverSize = 300): string {
  const normalizedMid = (mid ?? "").trim();
  if (!normalizedMid) return "";
  const segment = PHOTO_NEW_SIZE_SEGMENTS[size];
  if (!segment) throw new Error("not supported size");
  return `https://y.gtimg.cn/music/photo_new/${kind}${segment}M000${normalizedMid}.jpg`;
}

/** 歌手摘要（宽松字段：兼容上游 singerPmid/pic_mid 等命名） */
export interface CoverSingerLike {
  mid?: string | null;
  pmid?: string | null;
  singerMid?: string | null;
  singerPmid?: string | null;
  pic_mid?: string | null;
}

/** 专辑摘要（pmid 兼容 logo 命名） */
export interface CoverAlbumLike {
  mid?: string | null;
  pmid?: string | null;
  albumMid?: string | null;
  albumMID?: string | null;
  logo?: string | null;
}

/** 歌手封面（T001，mid 或 pmid 回退） */
export function singerCoverUrl(singer: CoverSingerLike, size: CoverSize = 300): string {
  const mid = String(singer.mid ?? singer.singerMid ?? "") || String(singer.pmid ?? singer.singerPmid ?? singer.pic_mid ?? "");
  return buildPhotoNewCoverUrl("T001", mid, size);
}

/** 专辑封面（T002，mid 或 pmid 回退） */
export function albumCoverUrl(album: CoverAlbumLike, size: CoverSize = 300): string {
  const mid = String(album.mid ?? album.albumMid ?? album.albumMID ?? "") || String(album.pmid ?? album.logo ?? "");
  return buildPhotoNewCoverUrl("T002", mid, size);
}

/** 歌曲封面回退链：专辑封面 → 首个可用歌手封面 → 空串 */
export function songCoverUrl(
  song: { album?: CoverAlbumLike | null; singer?: CoverSingerLike[] | null },
  size: CoverSize = 300,
): string {
  const album = song.album;
  if (album) {
    const albumMid = String(album.mid ?? album.albumMid ?? album.albumMID ?? "");
    const albumPmid = String(album.pmid ?? album.logo ?? "");
    if (albumMid || albumPmid) return albumCoverUrl(album, size);
  }
  for (const singer of song.singer ?? []) {
    const mid = String(singer.mid ?? singer.singerMid ?? "");
    const pmid = String(singer.pmid ?? singer.singerPmid ?? singer.pic_mid ?? "");
    if (mid || pmid) return singerCoverUrl(singer, size);
  }
  return "";
}
