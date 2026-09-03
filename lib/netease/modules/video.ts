import type { NcmQuery, NcmRequestFn } from '../types';
/* video.ts — 功能家族合并文件（22 个接口，由 439 个独立模块合并生成） */
/* ---------- mlog_music_rcmd  (/mlog/music/rcmd) ---------- */
/* 自动转换自 api-enhanced module/mlog_music_rcmd.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */
// 歌曲相关视频

import { createOption } from "../option";

export const mlog_music_rcmd = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.mvid || 0,
    type: 2,
    rcmdType: 20,
    limit: query.limit || 10,
    extInfo: JSON.stringify({ songId: query.songid }),
  }
  return request(`/api/mlog/rcmd/feed/list`, data, createOption(query))
}

/* ---------- mlog_to_video  (/mlog/to/video) ---------- */

/* 自动转换自 api-enhanced module/mlog_to_video.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 将mlog id转为video id

export const mlog_to_video = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    mlogId: query.id,
  }
  return request(
    `/api/mlog/video/convert/id`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- mlog_url  (/mlog/url) ---------- */

/* 自动转换自 api-enhanced module/mlog_url.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// mlog链接

export const mlog_url = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
    resolution: query.res || 1080,
    type: 1,
  }
  return request(`/api/mlog/detail/v1`, data, createOption(query, 'weapi'))
}

/* ---------- mv_all  (/mv/all) ---------- */

/* 自动转换自 api-enhanced module/mv_all.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 全部MV

export const mv_all = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    tags: JSON.stringify({
      地区: query.area || '全部',
      类型: query.type || '全部',
      排序: query.order || '上升最快',
    }),
    offset: query.offset || 0,
    total: 'true',
    limit: query.limit || 30,
  }
  return request(`/api/mv/all`, data, createOption(query))
}

/* ---------- mv_detail  (/mv/detail) ---------- */

/* 自动转换自 api-enhanced module/mv_detail.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// MV详情

export const mv_detail = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.mvid,
  }
  return request(`/api/v1/mv/detail`, data, createOption(query, 'weapi'))
}

/* ---------- mv_detail_info  (/mv/detail/info) ---------- */

/* 自动转换自 api-enhanced module/mv_detail_info.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// MV 点赞转发评论数数据

export const mv_detail_info = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    threadid: `R_MV_5_${query.mvid}`,
    composeliked: true,
  }
  return request(
    `/api/comment/commentthread/info`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- mv_exclusive_rcmd  (/mv/exclusive/rcmd) ---------- */

/* 自动转换自 api-enhanced module/mv_exclusive_rcmd.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 网易出品

export const mv_exclusive_rcmd = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    offset: query.offset || 0,
    limit: query.limit || 30,
  }
  return request(`/api/mv/exclusive/rcmd`, data, createOption(query))
}

/* ---------- mv_first  (/mv/first) ---------- */

/* 自动转换自 api-enhanced module/mv_first.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 最新MV

export const mv_first = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    // 'offset': query.offset || 0,
    area: query.area || '',
    limit: query.limit || 30,
    total: true,
  }
  return request(`/api/mv/first`, data, createOption(query))
}

/* ---------- mv_sub  (/mv/sub) ---------- */

/* 自动转换自 api-enhanced module/mv_sub.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 收藏与取消收藏MV

export const mv_sub = (query: NcmQuery, request: NcmRequestFn) => {
  query.t = query.t == 1 ? 'sub' : 'unsub'
  const data = {
    mvId: query.mvid,
    mvIds: '["' + query.mvid + '"]',
  }
  return request(`/api/mv/${query.t}`, data, createOption(query, 'weapi'))
}

/* ---------- mv_sublist  (/mv/sublist) ---------- */

/* 自动转换自 api-enhanced module/mv_sublist.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 已收藏MV列表

export const mv_sublist = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 25,
    offset: query.offset || 0,
    total: true,
  }
  return request(
    `/api/cloudvideo/allvideo/sublist`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- mv_url  (/mv/url) ---------- */

/* 自动转换自 api-enhanced module/mv_url.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// MV链接

export const mv_url = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
    r: query.r || 1080,
  }
  return request(
    `/api/song/enhance/play/mv/url`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- related_allvideo  (/related/allvideo) ---------- */

/* 自动转换自 api-enhanced module/related_allvideo.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 相关视频

export const related_allvideo = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
    type: /^\d+$/.test(query.id) ? 0 : 1,
  }
  return request(
    `/api/cloudvideo/v1/allvideo/rcmd`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- simi_mv  (/simi/mv) ---------- */

/* 自动转换自 api-enhanced module/simi_mv.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 相似MV

export const simi_mv = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    mvid: query.mvid,
  }
  return request(`/api/discovery/simiMV`, data, createOption(query, 'weapi'))
}

/* ---------- video_category_list  (/video/category/list) ---------- */

/* 自动转换自 api-enhanced module/video_category_list.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 视频分类列表

export const video_category_list = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    offset: query.offset || 0,
    total: 'true',
    limit: query.limit || 99,
  }
  return request(
    `/api/cloudvideo/category/list`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- video_detail  (/video/detail) ---------- */

/* 自动转换自 api-enhanced module/video_detail.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 视频详情

export const video_detail = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
  }
  return request(
    `/api/cloudvideo/v1/video/detail`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- video_detail_info  (/video/detail/info) ---------- */

/* 自动转换自 api-enhanced module/video_detail_info.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 视频点赞转发评论数数据

export const video_detail_info = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    threadid: `R_VI_62_${query.vid}`,
    composeliked: true,
  }
  return request(
    `/api/comment/commentthread/info`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- video_group  (/video/group) ---------- */

/* 自动转换自 api-enhanced module/video_group.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 视频标签/分类下的视频

export const video_group = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    groupId: query.id,
    offset: query.offset || 0,
    need_preview_url: 'true',
    total: true,
  }
  return request(
    `/api/videotimeline/videogroup/otherclient/get`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- video_group_list  (/video/group/list) ---------- */

/* 自动转换自 api-enhanced module/video_group_list.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 视频标签列表

export const video_group_list = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(
    `/api/cloudvideo/group/list`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- video_sub  (/video/sub) ---------- */

/* 自动转换自 api-enhanced module/video_sub.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 收藏与取消收藏视频

export const video_sub = (query: NcmQuery, request: NcmRequestFn) => {
  query.t = query.t == 1 ? 'sub' : 'unsub'
  const data = {
    id: query.id,
  }
  return request(
    `/api/cloudvideo/video/${query.t}`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- video_timeline_all  (/video/timeline/all) ---------- */

/* 自动转换自 api-enhanced module/video_timeline_all.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 全部视频列表

export const video_timeline_all = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    groupId: 0,
    offset: query.offset || 0,
    need_preview_url: 'true',
    total: true,
  }
  //   /api/videotimeline/otherclient/get
  return request(
    `/api/videotimeline/otherclient/get`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- video_timeline_recommend  (/video/timeline/recommend) ---------- */

/* 自动转换自 api-enhanced module/video_timeline_recommend.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 推荐视频

export const video_timeline_recommend = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    offset: query.offset || 0,
    filterLives: '[]',
    withProgramInfo: 'true',
    needUrl: '1',
    resolution: '480',
  }
  return request(`/api/videotimeline/get`, data, createOption(query, 'weapi'))
}

/* ---------- video_url  (/video/url) ---------- */

/* 自动转换自 api-enhanced module/video_url.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 视频链接

export const video_url = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    ids: '["' + query.id + '"]',
    resolution: query.res || 1080,
  }
  return request(`/api/cloudvideo/playurl`, data, createOption(query, 'weapi'))
}
