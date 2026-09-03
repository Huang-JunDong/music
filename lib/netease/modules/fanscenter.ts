import type { NcmQuery, NcmRequestFn } from '../types';
/* fanscenter.ts — 功能家族合并文件（5 个接口，由 439 个独立模块合并生成） */
/* ---------- fanscenter_basicinfo_age_get  (/fanscenter/basicinfo/age/get) ---------- */
/* 自动转换自 api-enhanced module/fanscenter_basicinfo_age_get.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */
// 粉丝年龄比例

import { createOption } from "../option";

export const fanscenter_basicinfo_age_get = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(`/api/fanscenter/basicinfo/age/get`, data, createOption(query))
}

/* ---------- fanscenter_basicinfo_gender_get  (/fanscenter/basicinfo/gender/get) ---------- */

/* 自动转换自 api-enhanced module/fanscenter_basicinfo_gender_get.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 粉丝性别比例

export const fanscenter_basicinfo_gender_get = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(
    `/api/fanscenter/basicinfo/gender/get`,
    data,
    createOption(query),
  )
}

/* ---------- fanscenter_basicinfo_province_get  (/fanscenter/basicinfo/province/get) ---------- */

/* 自动转换自 api-enhanced module/fanscenter_basicinfo_province_get.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 粉丝省份比例

export const fanscenter_basicinfo_province_get = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(
    `/api/fanscenter/basicinfo/province/get`,
    data,
    createOption(query),
  )
}

/* ---------- fanscenter_overview_get  (/fanscenter/overview/get) ---------- */

/* 自动转换自 api-enhanced module/fanscenter_overview_get.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 粉丝数量

export const fanscenter_overview_get = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(`/api/fanscenter/overview/get`, data, createOption(query))
}

/* ---------- fanscenter_trend_list  (/fanscenter/trend/list) ---------- */

/* 自动转换自 api-enhanced module/fanscenter_trend_list.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 粉丝来源

export const fanscenter_trend_list = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    startTime: query.startTime || Date.now() - 7 * 24 * 3600 * 1000,
    endTime: query.endTime || Date.now(),
    type: query.type || 0, //新增关注:0 新增取关:1
  }
  return request(`/api/fanscenter/trend/list`, data, createOption(query))
}
