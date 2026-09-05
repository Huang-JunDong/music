/**
 * 歌手模块 — 移植自 .ref/QQMusicApi qqmusic_api/modules/singer.py。
 */
import type { CgiInvokeOptions, Platform } from "../types";
import type { QQClient } from "../client";

export const AreaType = { ALL: -100, CHINA: 200, TAIWAN: 2, AMERICA: 5, JAPAN: 4, KOREA: 3 } as const;
export const GenreType = {
  ALL: -100, POP: 7, RAP: 3, CHINESE_STYLE: 19, ROCK: 4, ELECTRONIC: 2, FOLK: 8,
  R_AND_B: 11, ETHNIC: 37, LIGHT_MUSIC: 93, JAZZ: 14, CLASSICAL: 33, COUNTRY: 13, BLUES: 10,
} as const;
export const SexType = { ALL: -100, MALE: 0, FEMALE: 1, GROUP: 2 } as const;
export const IndexType = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, I: 9, J: 10, K: 11, L: 12, M: 13,
  N: 14, O: 15, P: 16, Q: 17, R: 18, S: 19, T: 20, U: 21, V: 22, W: 23, X: 24, Y: 25,
  Z: 26, ALL: -100, HASH: 27,
} as const;

/** 歌手主页 Tab（tab_id → 服务端 TabName） */
export const TabType: Record<string, { tabId: string; tabName: string }> = {
  WIKI: { tabId: "wiki", tabName: "IntroductionTab" },
  ALBUM: { tabId: "album", tabName: "AlbumTab" },
  COMPOSER: { tabId: "song_composing", tabName: "SongTab" },
  LYRICIST: { tabId: "song_lyric", tabName: "SongTab" },
  PRODUCER: { tabId: "producer", tabName: "SongTab" },
  ARRANGER: { tabId: "arranger", tabName: "SongTab" },
  MUSICIAN: { tabId: "musician", tabName: "SongTab" },
  SONG: { tabId: "song_sing", tabName: "SongTab" },
  VIDEO: { tabId: "video", tabName: "VideoTab" },
};

/** 枚举合法性校验（对齐 Python int(AreaType(area)) 的 ValueError 语义） */
function assertEnumValue(name: string, value: number | undefined, table: Record<string, number>): number {
  if (value === undefined || !Object.values(table).includes(value)) {
    throw new TypeError(`无效的 ${name}: ${String(value)}`);
  }
  return value;
}

/** 获取歌手列表（按地区/性别/风格） */
export async function getSingerList(
  client: QQClient,
  options?: CgiInvokeOptions & { area?: number; sex?: number; genre?: number },
) {
  return client.invoke(
    "music.musichallSinger.SingerList",
    "GetSingerList",
    {
      hastag: 0,
      area: assertEnumValue("area", options?.area ?? AreaType.ALL, AreaType),
      sex: assertEnumValue("sex", options?.sex ?? SexType.ALL, SexType),
      genre: assertEnumValue("genre", options?.genre ?? GenreType.ALL, GenreType),
    },
    options,
  );
}

/** 获取按首字母索引分页的歌手列表 */
export async function getSingerListIndex(
  client: QQClient,
  options?: CgiInvokeOptions & { area?: number; sex?: number; genre?: number; index?: number; page?: number; num?: number },
) {
  const page = options?.page ?? 1;
  const num = options?.num ?? 80;
  return client.invoke(
    "music.musichallSinger.SingerList",
    "GetSingerListIndex",
    {
      area: assertEnumValue("area", options?.area ?? AreaType.ALL, AreaType),
      sex: assertEnumValue("sex", options?.sex ?? SexType.ALL, SexType),
      genre: assertEnumValue("genre", options?.genre ?? GenreType.ALL, GenreType),
      index: assertEnumValue("index", options?.index ?? IndexType.ALL, IndexType),
      sin: (page - 1) * num,
      cur_page: page,
    },
    options,
  );
}

/** 获取歌手主页基本信息（Android 平台） */
export async function getInfo(client: QQClient, mid: string, options?: CgiInvokeOptions) {
  return client.invoke(
    "music.UnifiedHomepage.UnifiedHomepageSrv",
    "GetHomepageHeader",
    { SingerMid: mid },
    { ...options, platform: "android" as Platform },
  );
}

/** 获取歌手主页特定 Tab 的详情 */
export async function getTabDetail(
  client: QQClient,
  mid: string,
  tabType: string,
  options?: CgiInvokeOptions & { page?: number; num?: number },
) {
  const tab = TabType[tabType?.toUpperCase?.() ?? ""];
  if (!tab) throw new TypeError(`无效的 tab_type: ${String(tabType)}`); // 对齐 Python TabType 强类型枚举
  const page = options?.page ?? 1;
  return client.invoke(
    "music.UnifiedHomepage.UnifiedHomepageSrv",
    "GetHomepageTabDetail",
    {
      SingerMid: mid,
      IsQueryTabDetail: 1,
      TabID: tab.tabId,
      PageNum: page - 1,
      PageSize: options?.num ?? 10,
      Order: 0,
    },
    options,
  );
}

/** 获取歌手描述信息（多 MID 批量） */
export async function getDesc(
  client: QQClient,
  mids: string[],
  options?: CgiInvokeOptions & { exSinger?: boolean; wikiSinger?: boolean; groupSinger?: boolean; pic?: boolean; photos?: boolean },
) {
  return client.invoke(
    "music.musichallSinger.SingerInfoInter",
    "GetSingerDetail",
    {
      singer_mids: mids,
      group_singer: options?.groupSinger ?? true,
      wiki_singer: options?.wikiSinger ?? true,
      ex_singer: options?.exSinger ?? true,
      pic: options?.pic ?? true,
      photos: options?.photos ?? true,
    },
    options,
  );
}

/** 获取相似歌手列表 */
export async function getSimilar(client: QQClient, mid: string, number = 10, options?: CgiInvokeOptions) {
  return client.invoke(
    "music.SimilarSingerSvr",
    "GetSimilarSingerList",
    { singerMid: mid, number },
    options,
  );
}

/** 获取歌手的歌曲列表 */
export async function getSongsList(client: QQClient, mid: string, num = 10, page = 1, options?: CgiInvokeOptions) {
  return client.invoke(
    "musichall.song_list_server",
    "GetSingerSongList",
    { singerMid: mid, order: 1, number: num, begin: (page - 1) * num },
    options,
  );
}

/** 获取歌手的专辑列表 */
export async function getAlbumList(client: QQClient, mid: string, num = 10, page = 1, options?: CgiInvokeOptions) {
  return client.invoke(
    "music.musichallAlbum.AlbumListServer",
    "GetAlbumList",
    { singerMid: mid, order: 1, number: num, begin: (page - 1) * num },
    options,
  );
}

/** 获取歌手 MV 列表 */
export async function getMvList(client: QQClient, mid: string, num = 10, page = 1, options?: CgiInvokeOptions) {
  return client.invoke(
    "MvService.MvInfoProServer",
    "GetSingerMvList",
    { singermid: mid, order: 1, count: num, start: (page - 1) * num },
    options,
  );
}
