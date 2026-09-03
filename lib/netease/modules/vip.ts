import type { NcmQuery, NcmRequestFn } from '../types';
/* vip.ts — 功能家族合并文件（13 个接口，由 439 个独立模块合并生成） */
/* ---------- vip_growthpoint  (/vip/growthpoint) ---------- */
/* 自动转换自 api-enhanced module/vip_growthpoint.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */
// 会员成长值

import { createOption } from "../option";

export const vip_growthpoint = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(
    `/api/vipnewcenter/app/level/growhpoint/basic`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- vip_growthpoint_details  (/vip/growthpoint/details) ---------- */

/* 自动转换自 api-enhanced module/vip_growthpoint_details.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 会员成长值领取记录

export const vip_growthpoint_details = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 20,
    offset: query.offset || 0,
  }
  return request(
    `/api/vipnewcenter/app/level/growth/details`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- vip_growthpoint_get  (/vip/growthpoint/get) ---------- */

/* 自动转换自 api-enhanced module/vip_growthpoint_get.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 领取会员成长值

export const vip_growthpoint_get = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    taskIds: query.ids,
  }
  return request(
    `/api/vipnewcenter/app/level/task/reward/get`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- vip_growthpoint_getall  (/vip/growthpoint/getall) ---------- */

/* 自动转换自 api-enhanced module/vip_growthpoint_getall.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 一键领取所有会员成长值

export const vip_growthpoint_getall = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(
    `/api/vipnewcenter/app/level/task/reward/getall`,
    data,
    createOption(query, 'xeapi'),
  )
}

/* ---------- vip_info  (/vip/info) ---------- */

/* 自动转换自 api-enhanced module/vip_info.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 获取 VIP 信息

export const vip_info = (query: NcmQuery, request: NcmRequestFn) => {
  return request(
    `/api/music-vip-membership/front/vip/info`,
    {
      userId: query.uid || '',
    },
    createOption(query, 'weapi'),
  )
}

/* ---------- vip_info_v2  (/vip/info/v2) ---------- */

/* 自动转换自 api-enhanced module/vip_info_v2.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 获取 VIP 信息

export const vip_info_v2 = (query: NcmQuery, request: NcmRequestFn) => {
  return request(
    `/api/music-vip-membership/client/vip/info`,
    {
      userId: query.uid || '',
    },
    createOption(query, 'weapi'),
  )
}

/* ---------- vip_sign  (/vip/sign) ---------- */

/* 自动转换自 api-enhanced module/vip_sign.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 黑胶乐签打卡

export const vip_sign = async (query: NcmQuery, request: NcmRequestFn) => {
  const results: Record<string, any> = {}

  const taskSign = await request(
    '/api/vip-center-bff/task/sign',
    {},
    createOption(query, 'weapi'),
  )
  results.taskSign = taskSign.body

  const checkinDetail = await request(
    '/api/vipnewcenter/app/level/user/checkin/history/detail',
    {
      signDayTime: Date.now(),
      type: 1,
    },
    createOption(query, 'eapi'),
  )
  results.checkinDetail = checkinDetail.body

  // 两个接口都返回 code=200 即视为打卡成功
  const signed =
    Number(results.taskSign?.code) === 200 &&
    Number(results.checkinDetail?.code) === 200

  return {
    body: {
      code: 200,
      ...results,
      signed,
      message: signed ? '黑胶乐签打卡成功' : '黑胶乐签打卡失败',
    },
    cookie: taskSign.cookie,
    status: 200,
  }
}

/* ---------- vip_sign_detail  (/vip/sign/detail) ---------- */

/* 自动转换自 api-enhanced module/vip_sign_detail.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 黑胶乐签打卡详情

export const vip_sign_detail = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    signDayTime: query.timestamp,
    type: '1',
  }
  return request(
    `/api/vipnewcenter/app/level/user/checkin/history/detail`,
    data,
    createOption(query, 'eapi'),
  )
}

/* ---------- vip_sign_history  (/vip/sign/history) ---------- */

/* 自动转换自 api-enhanced module/vip_sign_history.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 黑胶乐签打卡历史 / 状态查询

// 支持传入 type=0（用户信息栏）或 type=1（黑胶乐签）

export const vip_sign_history = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    type: query.type || '0',
  }
  return request(
    `/api/vipnewcenter/app/minidesk/music/sign/pc`,
    data,
    createOption(query, 'eapi'),
  )
}

/* ---------- vip_sign_info  (/vip/sign/info) ---------- */

/* 自动转换自 api-enhanced module/vip_sign_info.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 黑胶乐签未来签到信息

export const vip_sign_info = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(
    `/api/vipnewcenter/app/user/sign/info`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- vip_tasks  (/vip/tasks) ---------- */

/* 自动转换自 api-enhanced module/vip_tasks.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 会员任务

export const vip_tasks = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(
    `/api/vipnewcenter/app/level/task/list`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- vip_tasks_v1  (/vip/tasks/v1) ---------- */

/* 自动转换自 api-enhanced module/vip_tasks_v1.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 会员任务 - 新版

export const vip_tasks_v1 = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    taskType: 'app_vip_task_center',
    userId: query.id,
  }
  return request(
    `/api/middle/vip/mission/user/progress/list`,
    data,
    createOption(query, 'xeapi'),
  )
}

/* ---------- vip_timemachine  (/vip/timemachine) ---------- */

/* 自动转换自 api-enhanced module/vip_timemachine.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 黑胶时光机

export const vip_timemachine = (query: NcmQuery, request: NcmRequestFn) => {
  const data: Record<string, any> = {}
  if (query.startTime && query.endTime) {
    data.startTime = query.startTime
    data.endTime = query.endTime
    data.type = 1
    data.limit = query.limit || 60
  }
  return request(
    `/api/vipmusic/newrecord/weekflow`,
    data,
    createOption(query, 'weapi'),
  )
}
