import type { NcmQuery, NcmRequestFn } from '../types';
/* listening.ts — 功能家族合并文件（17 个接口，由 439 个独立模块合并生成） */
/* ---------- daily_signin  (/daily_signin) ---------- */
/* 自动转换自 api-enhanced module/daily_signin.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */
// 签到
/*
    0为安卓端签到 3点经验, 1为网页签到,2点经验
    签到成功 {'android': {'point': 3, 'code': 200}, 'web': {'point': 2, 'code': 200}}
    重复签到 {'android': {'code': -2, 'msg': '重复签到'}, 'web': {'code': -2, 'msg': '重复签到'}}
    未登录 {'android': {'code': 301}, 'web': {'code': 301}}
*/

import { createOption } from "../option";

export const daily_signin = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    type: query.type || 0,
  }
  return request(`/api/point/dailyTask`, data, createOption(query))
}

/* ---------- listen_data_realtime_report  (/listen/data/realtime/report) ---------- */

/* 自动转换自 api-enhanced module/listen_data_realtime_report.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 听歌足迹 - 本周/本月收听时长

export const listen_data_realtime_report = (query: NcmQuery, request: NcmRequestFn) => {
  return request(
    `/api/content/activity/listen/data/realtime/report`,
    {
      type: query.type || 'week', //周 week 月 month
    },
    createOption(query),
  )
}

/* ---------- listen_data_report  (/listen/data/report) ---------- */

/* 自动转换自 api-enhanced module/listen_data_report.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 听歌足迹 - 周/月/年收听报告

export const listen_data_report = (query: NcmQuery, request: NcmRequestFn) => {
  return request(
    `/api/content/activity/listen/data/report`,
    {
      type: query.type || 'week', //周 week 月 month 年 year
      endTime: query.endTime, // 不填就是本周/月的
    },
    createOption(query),
  )
}

/* ---------- listen_data_song_play_rank  (/listen/data/song/play/rank) ---------- */

/* 自动转换自 api-enhanced module/listen_data_song_play_rank.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 听歌足迹 - 歌曲播放排行 (Top20)

export const listen_data_song_play_rank = (query: NcmQuery, request: NcmRequestFn) => {
  return request(
    `/api/content/activity/listen/data/song/play/rank`,
    {
      type: query.type || 'month', //周 week 月 month
      endTime: query.endTime, // 不填就是本周/月的
    },
    createOption(query),
  )
}

/* ---------- listen_data_today_song  (/listen/data/today/song) ---------- */

/* 自动转换自 api-enhanced module/listen_data_today_song.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 听歌足迹 - 今日收听

export const listen_data_today_song = (query: NcmQuery, request: NcmRequestFn) => {
  return request(
    `/api/content/activity/listen/data/today/song/play/rank`,
    {},
    createOption(query),
  )
}

/* ---------- listen_data_total  (/listen/data/total) ---------- */

/* 自动转换自 api-enhanced module/listen_data_total.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 听歌足迹 - 总收听时长

export const listen_data_total = (query: NcmQuery, request: NcmRequestFn) => {
  return request(
    `/api/content/activity/listen/data/total`,
    {},
    createOption(query),
  )
}

/* ---------- listen_data_year_report  (/listen/data/year/report) ---------- */

/* 自动转换自 api-enhanced module/listen_data_year_report.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 听歌足迹 - 年度听歌足迹

export const listen_data_year_report = (query: NcmQuery, request: NcmRequestFn) => {
  return request(
    `/api/content/activity/listen/data/year/report`,
    {},
    createOption(query),
  )
}

/* ---------- recent_listen_list  (/recent/listen/list) ---------- */

/* 自动转换自 api-enhanced module/recent_listen_list.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 最近听歌列表

export const recent_listen_list = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(`/api/pc/recent/listen/list`, data, createOption(query))
}

/* ---------- record_recent_album  (/record/recent/album) ---------- */

/* 自动转换自 api-enhanced module/record_recent_album.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const record_recent_album = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 100,
  }
  return request(
    `/api/play-record/album/list`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- record_recent_dj  (/record/recent/dj) ---------- */

/* 自动转换自 api-enhanced module/record_recent_dj.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const record_recent_dj = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 100,
  }
  return request(
    `/api/play-record/djradio/list`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- record_recent_playlist  (/record/recent/playlist) ---------- */

/* 自动转换自 api-enhanced module/record_recent_playlist.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const record_recent_playlist = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 100,
  }
  return request(
    `/api/play-record/playlist/list`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- record_recent_song  (/record/recent/song) ---------- */

/* 自动转换自 api-enhanced module/record_recent_song.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const record_recent_song = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 100,
  }
  return request(
    `/api/play-record/song/list`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- record_recent_video  (/record/recent/video) ---------- */

/* 自动转换自 api-enhanced module/record_recent_video.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const record_recent_video = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 100,
  }
  return request(
    `/api/play-record/newvideo/list`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- record_recent_voice  (/record/recent/voice) ---------- */

/* 自动转换自 api-enhanced module/record_recent_voice.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const record_recent_voice = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 100,
  }
  return request(
    `/api/play-record/voice/list`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- sign_happy_info  (/sign/happy/info) ---------- */

/* 自动转换自 api-enhanced module/sign_happy_info.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const sign_happy_info = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(`/api/sign/happy/info`, data, createOption(query, 'weapi'))
}

/* ---------- signin_progress  (/signin/progress) ---------- */

/* 自动转换自 api-enhanced module/signin_progress.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 签到进度

export const signin_progress = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    moduleId: query.moduleId || '1207signin-1207signin',
  }
  return request(
    `/api/act/modules/signin/v2/progress`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- summary_annual  (/summary/annual) ---------- */

/* 自动转换自 api-enhanced module/summary_annual.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 年度听歌报告2017-2023

export const summary_annual = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  const key =
    ['2017', '2018', '2019'].indexOf(query.year) > -1 ? 'userdata' : 'data'
  return request(
    `/api/activity/summary/annual/${query.year}/${key}`,
    data,
    createOption(query),
  )
}
