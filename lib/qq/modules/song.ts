/**
 * 歌曲模块 — 移植自 .ref/QQMusicApi qqmusic_api/modules/song.py。
 * 文件类型枚举（普通/加密/特殊/彩铃）、批量查询、vkey 直链、详情、相似/标签/相关歌单/MV/其他版本/制作人/曲谱/收藏数。
 */
import type { CgiInvokeOptions, Credential, Platform } from "../types";
import type { QQClient } from "../client";
import { getGuid } from "../utils";

/* ---------------- 歌曲文件类型（start_code + 扩展名） ---------------- */

export interface SongFileTypeDef {
  /** 编码前缀 */
  s: string;
  /** 文件后缀 */
  e: string;
}

export const SongFileType: Record<string, SongFileTypeDef> = {
  DTS_X: { s: "DT03", e: ".mp4" },
  MASTER: { s: "AI00", e: ".flac" },
  ATMOS_2: { s: "Q000", e: ".flac" },
  ATMOS_51: { s: "Q001", e: ".flac" },
  ATMOS_71: { s: "Q003", e: ".ogg" },
  ATMOS_DB: { s: "D004", e: ".mp4" },
  NAC: { s: "TL01", e: ".nac" },
  FLAC: { s: "F000", e: ".flac" },
  OGG_640: { s: "O801", e: ".ogg" },
  OGG_320: { s: "O800", e: ".ogg" },
  OGG_192: { s: "O600", e: ".ogg" },
  OGG_96: { s: "O400", e: ".ogg" },
  MP3_320: { s: "M800", e: ".mp3" },
  MP3_128: { s: "M500", e: ".mp3" },
  ACC_192: { s: "C600", e: ".m4a" },
  ACC_96: { s: "C400", e: ".m4a" },
  ACC_48: { s: "C200", e: ".m4a" },
};

export const EncryptedSongFileType: Record<string, SongFileTypeDef> = {
  DTS_X: { s: "DTM3", e: ".mmp4" },
  VINYL: { s: "V0M0", e: ".mflac" },
  MASTER: { s: "AIM0", e: ".mflac" },
  ATMOS_2: { s: "Q0M0", e: ".mflac" },
  ATMOS_51: { s: "Q0M1", e: ".mflac" },
  ATMOS_71: { s: "Q0M3", e: ".mgg" },
  ATMOS_DB: { s: "D0M4", e: ".mmp4" },
  NAC: { s: "TLM1", e: ".mnac" },
  FLAC: { s: "F0M0", e: ".mflac" },
  OGG_640: { s: "O8M1", e: ".mgg" },
  OGG_320: { s: "O8M0", e: ".mgg" },
  OGG_192: { s: "O6M0", e: ".mgg" },
  OGG_96: { s: "O4M0", e: ".mgg" },
};

export const SpecialSongFileType: Record<string, SongFileTypeDef> = {
  TRY: { s: "RS02", e: ".mp3" },
  TRY_OGG_640: { s: "O802", e: ".ogg" },
  ACCOM: { s: "O801", e: ".ogg" },
  MULTI: { s: "O601", e: ".ogg" },
  PIANO: { s: "AI01", e: ".ogg" },
  BAYIN: { s: "AI02", e: ".ogg" },
  GUZHENG: { s: "AI03", e: ".ogg" },
  QUDI: { s: "AI04", e: ".ogg" },
  HULUSI: { s: "AI05", e: ".ogg" },
  SUONA: { s: "AI06", e: ".ogg" },
  SHOUDIE: { s: "AI07", e: ".ogg" },
  GUITAR: { s: "AI08", e: ".ogg" },
  DRUMS: { s: "AI09", e: ".ogg" },
  KAZOO: { s: "A200", e: ".ogg" },
  THERAPY: { s: "AA01", e: ".ogg" },
};

export const RingSongFileType: Record<string, SongFileTypeDef> = {
  RING_128: { s: "R500", e: ".mp3" },
  RING_96: { s: "R400", e: ".m4a" },
  RING_48: { s: "R200", e: ".m4a" },
};

/** 全部文件类型联合清单（Web 层 file_type 参数合法值） */
export const ALL_SONG_FILE_TYPES: Record<string, SongFileTypeDef> = {
  ...Object.fromEntries(Object.entries(SongFileType).map(([k, v]) => [k, v])),
  ...Object.fromEntries(
    Object.entries(EncryptedSongFileType).map(([k, v]) => [`ENCRYPTED_${k}`, v]),
  ),
  ...Object.fromEntries(Object.entries(SpecialSongFileType).map(([k, v]) => [`SPECIAL_${k}`, v])),
  ...Object.fromEntries(Object.entries(RingSongFileType).map(([k, v]) => [`RING_${k}`, v])),
};

export function findSongFileType(key: string | undefined): SongFileTypeDef | null {
  if (!key) return null;
  return ALL_SONG_FILE_TYPES[key] ?? null;
}

/** 歌曲文件信息（getSongUrls 请求项） */
export interface SongFileInfo {
  mid: string;
  fileType?: SongFileTypeDef | null;
  songType?: number | null;
  mediaMid?: string | null;
}

/** 歌曲查询信息（querySong 请求项） */
export interface SongQueryInfo {
  id?: number | null;
  mid?: string | null;
  songType?: number | null;
}

// \p{Nd} 对齐 Python str.isdecimal()（接受全角等 Unicode 十进制数字）
const isDecimal = (v: string | number) => typeof v === "number" || /^\p{Nd}+$/u.test(String(v));

/* ---------------- API ---------------- */

/** 批量获取歌曲信息（music.trackInfo.UniformRuleCtrl.CgiGetTrackInfo） */
export async function querySong(client: QQClient, songInfo: SongQueryInfo[], options?: CgiInvokeOptions) {
  if (!songInfo?.length) throw new Error("song_info 不能为空");
  const ids: number[] = [];
  const mids: string[] = [];
  const types: number[] = [];
  for (const item of songInfo) {
    const hasId = item.id !== null && item.id !== undefined;
    const hasMid = item.mid !== null && item.mid !== undefined;
    if (hasId === hasMid) throw new Error("SongQueryInfo 必须提供 id 或 mid 且不能同时提供");
    if (hasId) ids.push(item.id!);
    else mids.push(item.mid!);
    types.push(item.songType ?? 0);
  }
  const param: Record<string, unknown> = {
    ctx: 0,
    client: 1,
    types,
    modify_stamp: types.map(() => 0),
  };
  if (ids.length) param.ids = ids;
  if (mids.length) param.mids = mids;
  return client.invoke("music.trackInfo.UniformRuleCtrl", "CgiGetTrackInfo", param, options);
}

/** 获取音频链接 CDN 信息（music.audioCdnDispatch.cdnDispatch.GetCdnDispatch） */
export async function getCdnDispatch(client: QQClient, options?: CgiInvokeOptions) {
  return client.invoke(
    "music.audioCdnDispatch.cdnDispatch",
    "GetCdnDispatch",
    { guid: getGuid(), uid: "0", use_new_domain: 1, use_ipv6: 1 },
    options,
  );
}

/** 获取歌曲文件链接（music.vkey.GetVkey.UrlGetVkey / 加密走 GetEVkey） */
export async function getSongUrls(
  client: QQClient,
  fileInfo: SongFileInfo[],
  fileType?: SongFileTypeDef | null,
  options?: CgiInvokeOptions & { credential?: Credential | null },
) {
  const defaultType = fileType ?? SongFileType.MP3_128;
  const encrypted = Object.values(EncryptedSongFileType).includes(defaultType);
  const [module, method] = encrypted
    ? ["music.vkey.GetEVkey", "CgiGetEVkey"]
    : ["music.vkey.GetVkey", "UrlGetVkey"];
  const credential = options?.credential ?? client.credential;
  const songmid: string[] = [];
  const filename: string[] = [];
  const songtype: number[] = [];
  for (const item of fileInfo) {
    songmid.push(item.mid);
    const t = item.fileType || defaultType;
    filename.push(
      item.mediaMid
        ? `${t.s}${item.mediaMid}${t.e}`
        : `${t.s}${item.mid}${item.mid}${t.e}`,
    );
    songtype.push(item.songType ?? 0);
  }
  return client.invoke(
    module,
    method,
    {
      // 对齐参考实现：直接取 str_musicid（无凭证时为空串，不做 "0" 兜底）
      uin: credential.str_musicid,
      filename,
      guid: getGuid(),
      songmid,
      songtype,
      ctx: 0,
    },
    options,
  );
}

/** 获取歌曲详细信息（Web 平台，music.pf_song_detail_svr.get_song_detail_yqq） */
export async function getDetail(client: QQClient, value: string | number, options?: CgiInvokeOptions) {
  const param = isDecimal(value) ? { song_id: Number(value) } : { song_mid: String(value) };
  return client.invoke("music.pf_song_detail_svr", "get_song_detail_yqq", param, {
    ...options,
    platform: "web" as Platform, // 固定平台不可被调用方覆盖（对齐参考实现）
  });
}

/** 获取相似歌曲 */
export async function getSimilarSong(client: QQClient, songid: number, options?: CgiInvokeOptions) {
  return client.invoke("music.recommend.TrackRelationServer", "GetSimilarSongs", { songid }, options);
}

/** 获取歌曲标签 */
export async function getLabels(client: QQClient, songid: number, options?: CgiInvokeOptions) {
  return client.invoke("music.recommend.TrackRelationServer", "GetSongLabels", { songid }, options);
}

/** 获取歌曲相关歌单（last = 上次请求的相关歌单 ID 列表，用于换一批） */
export async function getRelatedSonglist(
  client: QQClient,
  songid: number,
  last?: number[] | null,
  options?: CgiInvokeOptions,
) {
  return client.invoke(
    "music.recommend.TrackRelationServer",
    "GetRelatedPlaylist",
    { songid, vecPlaylist: last ?? [] },
    options,
  );
}

/** 获取歌曲相关 MV */
export async function getRelatedMv(client: QQClient, songid: number, lastMvid?: string | null, options?: CgiInvokeOptions) {
  return client.invoke("MvService.MvInfoProServer", "GetSongRelatedMv", {
    songid: String(songid),
    songtype: 1,
    lastmvid: lastMvid || 0,
  }, options);
}

/** 获取歌曲其他版本 */
export async function getOtherVersion(client: QQClient, value: string | number, options?: CgiInvokeOptions) {
  const param = isDecimal(value) ? { songid: Number(value) } : { songmid: String(value) };
  return client.invoke("music.musichallSong.OtherVersionServer", "GetOtherVersionSongs", param, options);
}

/** 获取歌曲制作人信息 */
export async function getProducer(client: QQClient, value: string | number, options?: CgiInvokeOptions) {
  const param = isDecimal(value) ? { songid: Number(value) } : { songmid: String(value) };
  return client.invoke("music.sociality.KolWorksTag", "SongProducer", param, options);
}

/** 检查歌曲是否有曲谱 */
export async function hasSheet(client: QQClient, mid: string, options?: CgiInvokeOptions) {
  return client.invoke(
    "music.mir.SheetMusicSvr",
    "HasSheetMusic",
    { songMid: mid },
    {
      overrideComm: true,
      comm: { g_tk: 5381, uin: "", format: "json", inCharset: "utf-8", outCharset: "utf-8", notice: 0, needNewCode: 1 },
      ...options,
    },
  );
}

/** 获取歌曲相关曲谱（ttype: 0=用户上传 1=引擎/AI 2=虫虫钢琴） */
export async function getSheet(client: QQClient, mid: string, ttype = 0, options?: CgiInvokeOptions) {
  const commonComm = {
    g_tk: 5381,
    uin: "",
    format: "json",
    inCharset: "utf-8",
    outCharset: "utf-8",
    notice: 0,
    needNewCode: 1,
  };
  if (ttype === 2) {
    return client.invoke(
      "music.mir.SheetMusicSvr",
      "GetChongChongSheetMusic",
      { songMid: mid, begin: 0, end: 100, scoreType: -1, ttype: 1 },
      {
        overrideComm: true,
        comm: { ...commonComm, platform: "h5" },
        sign: true,
        allowErrorCodes: [10007],
        parseOnAllow: true,
        ...options,
      },
    );
  }
  const scoreType = ttype === 1 ? -473 : -1;
  return client.invoke(
    "music.mir.SheetMusicSvr",
    "GetMoreSheetMusic",
    { songMid: mid, begin: 0, end: 100, scoreType, ttype },
    {
      overrideComm: true,
      comm: commonComm,
      allowErrorCodes: [10007],
      parseOnAllow: true,
      ...options,
    },
  );
}

/** 获取歌曲收藏数量 */
export async function getFavNum(client: QQClient, songIds: number[], options?: CgiInvokeOptions) {
  return client.invoke("music.musicasset.SongFavRead", "GetSongFansNumberById", { v_songId: songIds }, options);
}
