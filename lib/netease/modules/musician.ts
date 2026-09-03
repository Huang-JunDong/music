import type { NcmQuery, NcmRequestFn } from '../types';
/* musician.ts — 功能家族合并文件（8 个接口，由 439 个独立模块合并生成） */
/* ---------- musician_cloudbean  (/musician/cloudbean) ---------- */
/* 自动转换自 api-enhanced module/musician_cloudbean.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */
// 账号云豆数

import { createOption } from "../option";

export const musician_cloudbean = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(`/api/cloudbean/get`, data, createOption(query, 'weapi'))
}

/* ---------- musician_cloudbean_obtain  (/musician/cloudbean/obtain) ---------- */

/* 自动转换自 api-enhanced module/musician_cloudbean_obtain.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 领取云豆

export const musician_cloudbean_obtain = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    userMissionId: query.id,
    period: query.period,
  }
  return request(
    `/api/nmusician/workbench/mission/reward/obtain/new`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- musician_data_overview  (/musician/data/overview) ---------- */

/* 自动转换自 api-enhanced module/musician_data_overview.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 音乐人数据概况

export const musician_data_overview = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(
    `/api/creator/musician/statistic/data/overview/get`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- musician_play_trend  (/musician/play/trend) ---------- */

/* 自动转换自 api-enhanced module/musician_play_trend.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 音乐人歌曲播放趋势

export const musician_play_trend = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    startTime: query.startTime,
    endTime: query.endTime,
  }
  return request(
    `/api/creator/musician/play/count/statistic/data/trend/get`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- musician_sign  (/musician/sign) ---------- */

/* 自动转换自 api-enhanced module/musician_sign.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 音乐人签到

export const musician_sign = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(`/api/creator/user/access`, data, createOption(query, 'weapi'))
}

/* ---------- musician_tasks  (/musician/tasks) ---------- */

/* 自动转换自 api-enhanced module/musician_tasks.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 获取音乐人任务

export const musician_tasks = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(
    `/api/nmusician/workbench/mission/cycle/list`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- musician_tasks_new  (/musician/tasks/new) ---------- */

/* 自动转换自 api-enhanced module/musician_tasks_new.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 获取音乐人任务

export const musician_tasks_new = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(
    `/api/nmusician/workbench/mission/stage/list `,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- musician_vip_tasks  (/musician/vip/tasks) ---------- */

/* 自动转换自 api-enhanced module/musician_vip_tasks.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 获取音乐人任务

export const musician_vip_tasks = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(
    `/api/nmusician/workbench/special/right/vip/info`,
    data,
    createOption(query, 'eapi'),
  )
}
