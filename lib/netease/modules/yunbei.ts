import type { NcmQuery, NcmRequestFn } from '../types';
/* yunbei.ts — 功能家族合并文件（14 个接口，由 439 个独立模块合并生成） */
/* ---------- yunbei  (/yunbei) ---------- */
/* 自动转换自 api-enhanced module/yunbei.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

import { createOption } from "../option";

export const yunbei = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  // /api/point/today/get
  return request(`/api/point/signed/get`, data, createOption(query, 'weapi'))
}

/* ---------- yunbei_expense  (/yunbei/expense) ---------- */

/* 自动转换自 api-enhanced module/yunbei_expense.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const yunbei_expense = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 10,
    offset: query.offset || 0,
  }
  return request(`/api/point/expense`, data, createOption(query))
}

/* ---------- yunbei_info  (/yunbei/info) ---------- */

/* 自动转换自 api-enhanced module/yunbei_info.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const yunbei_info = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(`/api/v1/user/info`, data, createOption(query, 'weapi'))
}

/* ---------- yunbei_rcmd_song  (/yunbei/rcmd/song) ---------- */

/* 自动转换自 api-enhanced module/yunbei_rcmd_song.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 云贝推歌

export const yunbei_rcmd_song = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    songId: query.id,
    reason: query.reason || '好歌献给你',
    scene: '',
    fromUserId: -1,
    yunbeiNum: query.yunbeiNum || 10,
  }
  return request(
    `/api/yunbei/rcmd/song/submit`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- yunbei_rcmd_song_history  (/yunbei/rcmd/song/history) ---------- */

/* 自动转换自 api-enhanced module/yunbei_rcmd_song_history.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 云贝推歌历史记录

export const yunbei_rcmd_song_history = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    page: JSON.stringify({
      size: query.size || 20,
      cursor: query.cursor || '',
    }),
  }
  return request(
    `/api/yunbei/rcmd/song/history/list`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- yunbei_receipt  (/yunbei/receipt) ---------- */

/* 自动转换自 api-enhanced module/yunbei_receipt.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const yunbei_receipt = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 10,
    offset: query.offset || 0,
  }
  return request(`/api/point/receipt`, data, createOption(query))
}

/* ---------- yunbei_sign  (/yunbei/sign) ---------- */

/* 自动转换自 api-enhanced module/yunbei_sign.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const yunbei_sign = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(
    `/api/pointmall/user/sign`,
    data,
    createOption(query, 'xeapi', 'v3'),
  )
}

/* ---------- yunbei_task_finish  (/yunbei/task/finish) ---------- */

/* 自动转换自 api-enhanced module/yunbei_task_finish.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const yunbei_task_finish = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    userTaskId: query.userTaskId,
    depositCode: query.depositCode || '0',
  }
  return request(
    `/api/usertool/task/point/receive`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- yunbei_task_finish_v1  (/yunbei/task/finish/v1) ---------- */

/* 自动转换自 api-enhanced module/yunbei_task_finish_v1.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 云贝广告任务 - 完成任务领取云贝

// 逆向来源: 云贝任务中心 H5 (st.music.163.com/yunbei-listen) main.js

// POST /api/ad/power/yunbei/distribution/create

// 参数: yunbeiAmount (单次可得云贝, 客户端从 list 接口的 singleAmount 取值, 当前为 150)

// 返回: true (领取成功)

//

// 实测验证 (2026-08-05):

//   - 仅传 yunbeiAmount 即可成功领取, 无需真实听歌/看视频

//   - 单日上限 10 次 × 150 云贝 = 1500 云贝/天

//   - 超限返回 code:400 "单日完成任务数已达上限"

//   - 无频率限制, 800ms 间隔连续调用均成功

//

// 建议: 领取前先调 yunbei_ad_task_list 查询 times, 达到 10 次即停止

export const yunbei_task_finish_v1 = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    yunbeiAmount: query.yunbeiAmount || 150,
  }
  return request(
    `/api/ad/power/yunbei/distribution/create`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- yunbei_task_list_v1  (/yunbei/task/list/v1) ---------- */

/* 自动转换自 api-enhanced module/yunbei_task_list_v1.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 云贝广告任务 - 查询今日任务状态

// 逆向来源: 云贝任务中心 H5 (st.music.163.com/yunbei-listen) main.js

// GET /api/ad/power/yunbei/distribution/list

// 返回: { times: 今日已完成次数, amount: 今日累计云贝, singleAmount: 单次可得云贝 }

// 注意: 单日上限 10 次, 单次 150 云贝 (每天最多 1500)

export const yunbei_task_list_v1 = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(
    `/api/ad/power/yunbei/distribution/list`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- yunbei_task_recommend_song  (/yunbei/task/recommend/song) ---------- */

/* 自动转换自 api-enhanced module/yunbei_task_recommend_song.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 云贝广告任务 - 获取推荐歌曲

// 逆向来源: 云贝任务中心 H5 (st.music.163.com/yunbei-listen) main.js

// POST /api/ad/power/yunbei/distribution/recommend/song

// 参数: offset (默认 0), limit (默认 10, 客户端一次 10 首)

// 返回: 推荐歌曲数组 [{ songId, songName, artistName, albumUrl, songChorusStartTime, likeFlag, alg }]

// 注意: alg 均为 alg_payrec_yunBei_*, 为"听歌得云贝"任务专属推荐

export const yunbei_task_recommend_song = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    offset: query.offset || 0,
    limit: query.limit || 10,
  }
  return request(
    `/api/ad/power/yunbei/distribution/recommend/song`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- yunbei_tasks  (/yunbei/tasks) ---------- */

/* 自动转换自 api-enhanced module/yunbei_tasks.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const yunbei_tasks = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(
    `/api/usertool/task/list/all`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- yunbei_tasks_todo  (/yunbei/tasks/todo) ---------- */

/* 自动转换自 api-enhanced module/yunbei_tasks_todo.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const yunbei_tasks_todo = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(
    `/api/usertool/task/todo/query`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- yunbei_today  (/yunbei/today) ---------- */

/* 自动转换自 api-enhanced module/yunbei_today.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const yunbei_today = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(`/api/point/today/get`, data, createOption(query, 'weapi'))
}
