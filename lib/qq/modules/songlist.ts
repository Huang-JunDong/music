/**
 * 歌单模块 — 移植自 .ref/QQMusicApi qqmusic_api/modules/songlist.py。
 */
import type { CgiInvokeOptions } from "../types";
import type { QQClient } from "../client";
import { CgiApiError } from "../errors";

function buildSonglistOperParam(
  dirid: number,
  songInfo: [number, number][],
  tid: number,
): Record<string, unknown> {
  return {
    dirId: dirid,
    tid,
    bFmtUtf8: true,
    v_songInfo: songInfo.map(([songId, songType]) => ({ songId, songType })),
  };
}

/** 获取歌单详细信息和歌曲原始数据 */
export async function getDetail(
  client: QQClient,
  songlistId: number,
  options?: CgiInvokeOptions & { dirid?: number; num?: number; page?: number; onlysong?: boolean; tag?: boolean; userinfo?: boolean },
) {
  const dirid = options?.dirid ?? 0;
  const num = options?.num ?? 10;
  const page = options?.page ?? 1;
  return client.invoke(
    "music.srfDissInfo.DissInfo",
    "CgiGetDiss",
    {
      disstid: songlistId,
      dirid,
      tag: options?.tag ?? true,
      song_begin: num * (page - 1),
      song_num: num,
      userinfo: options?.userinfo ?? true,
      orderlist: true,
      onlysonglist: options?.onlysong ?? false,
    },
    options,
  );
}

/** 创建歌单（重名歌单服务端自动加时间戳） */
export async function create(client: QQClient, dirname: string, options?: CgiInvokeOptions) {
  return client.invoke(
    "music.musicasset.PlaylistBaseWrite",
    "AddPlaylist",
    { dirName: dirname },
    { requireLogin: true, ...options },
  );
}

/** 删除歌单（删除不存在歌单返回 dirid=0） */
export async function del(client: QQClient, dirid: number, options?: CgiInvokeOptions) {
  return client.invoke(
    "music.musicasset.PlaylistBaseWrite",
    "DelPlaylist",
    { dirId: dirid },
    { requireLogin: true, ...options },
  );
}

/** 添加歌曲到歌单（songInfo 每项为 [song_id, song_type]；80092=歌曲已存在） */
export async function addSongs(
  client: QQClient,
  dirid: number,
  songInfo: [number, number][],
  options?: CgiInvokeOptions & { tid?: number },
) {
  try {
    const data = await client.invoke(
      "music.musicasset.PlaylistDetailWrite",
      "AddSonglist",
      buildSonglistOperParam(dirid, songInfo, options?.tid ?? 0),
      { requireLogin: true, preserveBool: true, ...options },
    );
    return (data as Record<string, unknown>)?.retCode === 0;
  } catch (err) {
    if (err instanceof CgiApiError && err.code === 80092) return false;
    throw err;
  }
}

/** 删除歌单中的歌曲（80092=歌曲不存在） */
export async function delSongs(
  client: QQClient,
  dirid: number,
  songInfo: [number, number][],
  options?: CgiInvokeOptions & { tid?: number },
) {
  try {
    const data = await client.invoke(
      "music.musicasset.PlaylistDetailWrite",
      "DelSonglist",
      buildSonglistOperParam(dirid, songInfo ?? [], options?.tid ?? 0), // 对齐 Python `song_info or []` 空值保护
      { requireLogin: true, ...options },
    );
    return (data as Record<string, unknown>)?.retCode === 0;
  } catch (err) {
    if (err instanceof CgiApiError && err.code === 80092) return false;
    throw err;
  }
}

/** 收藏歌曲到"我喜欢"歌单（目录 ID 固定 201） */
export async function likeSong(client: QQClient, songInfo: [number, number][], options?: CgiInvokeOptions) {
  return addSongs(client, 201, songInfo, options);
}

/** 从"我喜欢"歌单移除歌曲 */
export async function unlikeSong(client: QQClient, songInfo: [number, number][], options?: CgiInvokeOptions) {
  return delSongs(client, 201, songInfo, options);
}
