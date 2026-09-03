import type { NcmQuery, NcmRequestFn } from '../types';
/* broadcast.ts — 功能家族合并文件（5 个接口，由 439 个独立模块合并生成） */
/* ---------- broadcast_category_region_get  (/broadcast/category/region/get) ---------- */
/* 自动转换自 api-enhanced module/broadcast_category_region_get.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */
// 广播电台 - 分类/地区信息

import { createOption } from "../option";

export const broadcast_category_region_get = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(
    `/api/voice/broadcast/category/region/get`,
    data,
    createOption(query),
  )
}

/* ---------- broadcast_channel_collect_list  (/broadcast/channel/collect/list) ---------- */

/* 自动转换自 api-enhanced module/broadcast_channel_collect_list.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 广播电台 - 我的收藏

export const broadcast_channel_collect_list = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    contentType: 'BROADCAST',
    limit: query.limit || '99999',
    timeReverseOrder: 'true',
    startDate: '4762584922000',
  }
  return request(`/api/content/channel/collect/list`, data, createOption(query))
}

/* ---------- broadcast_channel_currentinfo  (/broadcast/channel/currentinfo) ---------- */

/* 自动转换自 api-enhanced module/broadcast_channel_currentinfo.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 广播电台 - 电台信息

export const broadcast_channel_currentinfo = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    channelId: query.id,
  }
  return request(
    `/api/voice/broadcast/channel/currentinfo`,
    data,
    createOption(query),
  )
}

/* ---------- broadcast_channel_list  (/broadcast/channel/list) ---------- */

/* 自动转换自 api-enhanced module/broadcast_channel_list.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 广播电台 - 全部电台

export const broadcast_channel_list = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    categoryId: query.categoryId || '0',
    regionId: query.regionId || '0',
    limit: query.limit || '20',
    lastId: query.lastId || '0',
    score: query.score || '-1',
  }
  return request(`/api/voice/broadcast/channel/list`, data, createOption(query))
}

/* ---------- broadcast_sub  (/broadcast/sub) ---------- */

/* 自动转换自 api-enhanced module/broadcast_sub.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 广播电台 - 收藏/取消收藏电台

export const broadcast_sub = (query: NcmQuery, request: NcmRequestFn) => {
  query.t = query.t == 1 ? 'false' : 'true'
  const data = {
    contentType: 'BROADCAST',
    contentId: query.id,
    cancelCollect: query.t,
  }
  return request(`/api/content/interact/collect`, data, createOption(query))
}
