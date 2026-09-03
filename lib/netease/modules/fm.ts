import type { NcmQuery, NcmRequestFn } from '../types';
/* fm.ts — 功能家族合并文件（3 个接口，由 439 个独立模块合并生成） */
/* ---------- fm_trash  (/fm_trash) ---------- */
/* 自动转换自 api-enhanced module/fm_trash.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */
// 垃圾桶

import { createOption } from "../option";

export const fm_trash = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    songId: query.id,
    alg: 'RT',
    time: query.time || 25,
  }
  return request(`/api/radio/trash/add`, data, createOption(query, 'weapi'))
}

/* ---------- personal_fm  (/personal_fm) ---------- */

/* 自动转换自 api-enhanced module/personal_fm.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 私人FM

export const personal_fm = (query: NcmQuery, request: NcmRequestFn) => {
  return request(`/api/v1/radio/get`, {}, createOption(query, 'weapi'))
}

/* ---------- personal_fm_mode  (/personal/fm/mode) ---------- */

/* 自动转换自 api-enhanced module/personal_fm_mode.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 私人FM - 模式选择

export const personal_fm_mode = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    mode: query.mode,
    subMode: query.submode,
    limit: query.limit || 3,
  }
  return request(`/api/v1/radio/get`, data, createOption(query))
}
