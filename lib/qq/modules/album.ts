/**
 * 专辑模块 — 移植自 .ref/QQMusicApi qqmusic_api/modules/album.py。
 */
import type { CgiInvokeOptions } from "../types";
import type { QQClient } from "../client";

// \p{Nd} 对齐 Python str.isdecimal()（接受全角等 Unicode 十进制数字）
const isDecimal = (v: string | number) => typeof v === "number" || /^\p{Nd}+$/u.test(String(v));

/** 获取专辑详细信息 */
export async function getDetail(client: QQClient, value: string | number, options?: CgiInvokeOptions) {
  const param: Record<string, unknown> = isDecimal(value)
    ? { albumId: Number(value) }
    : { albumMId: String(value) };
  return client.invoke("music.musichallAlbum.AlbumInfoServer", "GetAlbumDetail", param, options);
}

/** 获取专辑歌曲列表 */
export async function getSong(
  client: QQClient,
  value: string | number,
  num = 10,
  page = 1,
  options?: CgiInvokeOptions,
) {
  const param: Record<string, unknown> = { begin: num * (page - 1), num };
  if (isDecimal(value)) param.albumId = Number(value);
  else param.albumMid = String(value);
  return client.invoke("music.musichallAlbum.AlbumSongList", "GetAlbumSongList", param, options);
}

/** 获取新碟上架列表（area: 1=内地 2=港台 3=欧美 4=韩国 5=日本 6=其他） */
export async function getNewAlbum(client: QQClient, area = 1, num = 20, page = 1, options?: CgiInvokeOptions) {
  return client.invoke(
    "newalbum.NewAlbumServer",
    "get_new_album_info",
    { area, num, start: num * (page - 1) },
    options,
  );
}

/** 收藏专辑（支持单个或列表） */
export async function favAlbum(client: QQClient, albumId: number | number[], options?: CgiInvokeOptions) {
  const ids = Array.isArray(albumId) ? albumId : [albumId];
  return client.invoke(
    "music.musicasset.AlbumFavWrite",
    "FavAlbum",
    { v_albumId: ids },
    { requireLogin: true, ...options },
  );
}

/** 取消收藏专辑 */
export async function delFavAlbum(client: QQClient, albumId: number | number[], options?: CgiInvokeOptions) {
  const ids = Array.isArray(albumId) ? albumId : [albumId];
  return client.invoke(
    "music.musicasset.AlbumFavWrite",
    "CancelFavAlbum",
    { v_albumId: ids },
    { requireLogin: true, ...options },
  );
}
