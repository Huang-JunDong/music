import type { NcmQuery, NcmRequestFn } from '../types';
/* search.ts — 功能家族合并文件（9 个接口，由 439 个独立模块合并生成） */
/* ---------- cloudsearch  (/cloudsearch) ---------- */
/* 自动转换自 api-enhanced module/cloudsearch.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */
// 搜索

import { createOption } from "../option";

export const cloudsearch = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    s: query.keywords,
    type: query.type || 1, // 1: 单曲, 10: 专辑, 100: 歌手, 1000: 歌单, 1002: 用户, 1004: MV, 1006: 歌词, 1009: 电台, 1014: 视频
    limit: query.limit || 30,
    offset: query.offset || 0,
    total: true,
  }
  return request(`/api/cloudsearch/pc`, data, createOption(query))
}

/* ---------- search  (/search) ---------- */

/* 自动转换自 api-enhanced module/search.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 搜索

export const search = (query: NcmQuery, request: NcmRequestFn) => {
  if (query.type && query.type == '2000') {
    const data = {
      keyword: query.keywords,
      scene: 'normal',
      limit: query.limit || 30,
      offset: query.offset || 0,
    }
    return request(`/api/search/voice/get`, data, createOption(query))
  }
  const data = {
    s: query.keywords,
    type: query.type || 1, // 1: 单曲, 10: 专辑, 100: 歌手, 1000: 歌单, 1002: 用户, 1004: MV, 1006: 歌词, 1009: 电台, 1014: 视频
    limit: query.limit || 30,
    offset: query.offset || 0,
  }
  return request(`/api/search/get`, data, createOption(query))
}

/* ---------- search_default  (/search/default) ---------- */

/* 自动转换自 api-enhanced module/search_default.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 默认搜索关键词

export const search_default = (query: NcmQuery, request: NcmRequestFn) => {
  return request(`/api/search/defaultkeyword/get`, {}, createOption(query))
}

/* ---------- search_hot  (/search/hot) ---------- */

/* 自动转换自 api-enhanced module/search_hot.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 热门搜索

export const search_hot = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    type: 1111,
  }
  return request(`/api/search/hot`, data, createOption(query))
}

/* ---------- search_hot_detail  (/search/hot/detail) ---------- */

/* 自动转换自 api-enhanced module/search_hot_detail.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 热搜列表

export const search_hot_detail = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(`/api/hotsearchlist/get`, data, createOption(query, 'weapi'))
}

/* ---------- search_match  (/search/match) ---------- */

/* 自动转换自 api-enhanced module/search_match.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 本地歌曲匹配音乐信息

export const search_match = (query: NcmQuery, request: NcmRequestFn) => {
  let songs = [
    {
      title: query.title || '',
      album: query.album || '',
      artist: query.artist || '',
      duration: query.duration || 0,
      persistId: query.md5,
    },
  ]
  const data = {
    songs: JSON.stringify(songs),
  }
  return request(`/api/search/match/new`, data, createOption(query))
}

/* ---------- search_multimatch  (/search/multimatch) ---------- */

/* 自动转换自 api-enhanced module/search_multimatch.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 多类型搜索

export const search_multimatch = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    type: query.type || 1,
    s: query.keywords || '',
  }
  return request(
    `/api/search/suggest/multimatch`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- search_suggest  (/search/suggest) ---------- */

/* 自动转换自 api-enhanced module/search_suggest.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 搜索建议

export const search_suggest = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    s: query.keywords || '',
  }
  let type = query.type == 'mobile' ? 'keyword' : 'web'
  return request(
    `/api/search/suggest/` + type,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- search_suggest_pc  (/search/suggest/pc) ---------- */

/* 自动转换自 api-enhanced module/search_suggest_pc.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 搜索建议pc端

export const search_suggest_pc = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    keyword: query.keyword || '',
  }
  return request(
    `/api/search/pc/suggest/keyword/get`,
    data,
    createOption(query),
  )
}
