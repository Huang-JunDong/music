/**
 * 搜索模块 — 移植自 .ref/QQMusicApi qqmusic_api/modules/search.py。
 */
import type { CgiInvokeOptions, Platform } from "../types";
import type { QQClient } from "../client";
import { getSearchID } from "../utils";

/** 搜索类型枚举 */
export const SearchType = {
  SONG: 0,
  SINGER: 1,
  ALBUM: 2,
  SONGLIST: 3,
  MV: 4,
  LYRIC: 7,
  USER: 8,
  RINGTONE: 10,
  AUDIO_ALBUM: 15,
  AUDIO: 18,
} as const;

export type SearchTypeValue = (typeof SearchType)[keyof typeof SearchType];

/** 搜索筛选器 */
export interface SearchSelector {
  type: number;
  name: string;
  id: string;
}

/** 获取热搜词列表 */
export async function getHotkey(client: QQClient, options?: CgiInvokeOptions) {
  return client.invoke(
    "music.musicsearch.HotkeyService",
    "GetHotkeyForQQMusicMobile",
    { search_id: getSearchID() },
    options,
  );
}

/** 搜索词补全建议 */
export async function complete(client: QQClient, keyword: string, options?: CgiInvokeOptions) {
  return client.invoke(
    "music.smartboxCgi.SmartBoxCgi",
    "GetSmartBoxResult",
    { search_id: getSearchID(), query: keyword, num_per_page: 0, page_idx: 0 },
    options,
  );
}

/** 快速搜索（HTTP 直连 smartbox） */
export async function quickSearch(client: QQClient, keyword: string, options?: CgiInvokeOptions) {
  const res = await client.raw({
    method: "GET",
    url: "https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg",
    params: { key: keyword },
  });
  if (res.status !== 200) throw new Error(`quick_search HTTP ${res.status}`);
  return res.json();
}

/** 综合搜索（page_start = 上一页分页游标 JSON 对象） */
export async function generalSearch(
  client: QQClient,
  keyword: string,
  options?: CgiInvokeOptions & { page?: number; num?: number; searchid?: string | null; pageStart?: Record<string, unknown> | null; highlight?: boolean },
) {
  const param: Record<string, unknown> = {
    searchid: options?.searchid || getSearchID(),
    search_type: 100,
    page_num: options?.num ?? 15,
    query: keyword,
    page_id: options?.page ?? 1,
    highlight: options?.highlight ?? true,
    grp: true,
  };
  if (options?.pageStart != null) param.page_start = options.pageStart; // 对齐 Python `is not None`
  return client.invoke("music.adaptor.SearchAdaptor", "do_search_v2", param, options);
}

/** 类型搜索（固定 Android 平台；selectors = 搜索筛选器） */
export async function searchByType(
  client: QQClient,
  keyword: string,
  options?: CgiInvokeOptions & {
    searchType?: number;
    num?: number;
    page?: number;
    selectors?: SearchSelector[] | null;
    searchid?: string | null;
    highlight?: boolean;
  },
) {
  const selectors = options?.selectors ?? [];
  const searchType = options?.searchType ?? SearchType.SONG;
  if (!(Object.values(SearchType) as number[]).includes(searchType)) {
    // 对齐 Python int(SearchType(search_type))：非法值抛错
    throw new TypeError(`无效的 search_type: ${String(options?.searchType)}`);
  }
  return client.invoke(
    "music.search.SearchCgiService",
    "DoSearchForQQMusicMobile",
    {
      searchid: options?.searchid || getSearchID(),
      query: keyword,
      search_type: searchType,
      num_per_page: options?.num ?? 10,
      page_num: options?.page ?? 1,
      highlight: options?.highlight ?? true,
      grp: true,
      selectors: selectors ? Object.fromEntries(selectors.map((s) => [String(s.type), String(s.id)])) : {},
      vec_selectors: selectors ?? [],
    },
    { ...options, platform: "android" as Platform },
  );
}
