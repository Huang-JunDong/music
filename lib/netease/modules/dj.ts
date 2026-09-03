import type { NcmQuery, NcmRequestFn } from '../types';
/* dj.ts — 功能家族合并文件（30 个接口，由 439 个独立模块合并生成） */
/* ---------- djRadio_top  (/djRadio/top) ---------- */
/* 自动转换自 api-enhanced module/djRadio_top.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */
//电台排行榜获取

import { createOption } from "../option";
import { toBoolean } from "../utils";

export const djRadio_top = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    djRadioId: query.djRadioId || null, // 电台id
    sortIndex: query.sortIndex || 1, // 排序 1:播放数 2:点赞数 3：评论数 4：分享数 5：收藏数
    dataGapDays: query.dataGapDays || 7, // 天数 7:一周 30:一个月 90:三个月
    dataType: query.dataType || 3, // 未知
  }
  return request(
    '/api/expert/worksdata/works/top/get',
    data,
    createOption(query),
  )
}

/* ---------- dj_banner  (/dj/banner) ---------- */

/* 自动转换自 api-enhanced module/dj_banner.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 电台banner

export const dj_banner = (query: NcmQuery, request: NcmRequestFn) => {
  return request(`/api/djradio/banner/get`, {}, createOption(query, 'weapi'))
}

/* ---------- dj_category_excludehot  (/dj/category/excludehot) ---------- */

/* 自动转换自 api-enhanced module/dj_category_excludehot.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 电台非热门类型

export const dj_category_excludehot = (query: NcmQuery, request: NcmRequestFn) => {
  return request(
    `/api/djradio/category/excludehot`,
    {},
    createOption(query, 'weapi'),
  )
}

/* ---------- dj_category_recommend  (/dj/category/recommend) ---------- */

/* 自动转换自 api-enhanced module/dj_category_recommend.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 电台推荐类型

export const dj_category_recommend = (query: NcmQuery, request: NcmRequestFn) => {
  return request(
    `/api/djradio/home/category/recommend`,
    {},
    createOption(query, 'weapi'),
  )
}

/* ---------- dj_catelist  (/dj/catelist) ---------- */

/* 自动转换自 api-enhanced module/dj_catelist.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 电台分类列表

export const dj_catelist = (query: NcmQuery, request: NcmRequestFn) => {
  return request(`/api/djradio/category/get`, {}, createOption(query, 'weapi'))
}

/* ---------- dj_detail  (/dj/detail) ---------- */

/* 自动转换自 api-enhanced module/dj_detail.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 电台详情

export const dj_detail = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.rid,
  }
  return request(`/api/djradio/v2/get`, data, createOption(query, 'weapi'))
}

/* ---------- dj_difm_all_style_channel  (/dj/difm/all/style/channel) ---------- */

/* 自动转换自 api-enhanced module/dj_difm_all_style_channel.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// DIFM电台 - 分类

export const dj_difm_all_style_channel = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    sources: query.sources || '[0]',
  }
  return request(`/api/dj/difm/all/style/channel/v2`, data, createOption(query))
}

/* ---------- dj_difm_channel_subscribe  (/dj/difm/channel/subscribe) ---------- */

/* 自动转换自 api-enhanced module/dj_difm_channel_subscribe.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// DIFM电台 - 收藏频道

export const dj_difm_channel_subscribe = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
  }
  return request(`/api/dj/difm/channel/subscribe`, data, createOption(query))
}

/* ---------- dj_difm_channel_unsubscribe  (/dj/difm/channel/unsubscribe) ---------- */

/* 自动转换自 api-enhanced module/dj_difm_channel_unsubscribe.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// DIFM电台 - 取消收藏频道

export const dj_difm_channel_unsubscribe = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
  }
  return request(`/api/dj/difm/channel/unsubscribe`, data, createOption(query))
}

/* ---------- dj_difm_playing_tracks_list  (/dj/difm/playing/tracks/list) ---------- */

/* 自动转换自 api-enhanced module/dj_difm_playing_tracks_list.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// DIFM电台 - 播放列表

export const dj_difm_playing_tracks_list = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 5,
    source: query.source || 0,
    channelId: query.channelId,
  }
  return request(`/api/dj/difm/playing/tracks/list`, data, createOption(query))
}

/* ---------- dj_difm_subscribe_channels_get  (/dj/difm/subscribe/channels/get) ---------- */

/* 自动转换自 api-enhanced module/dj_difm_subscribe_channels_get.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// DIFM电台 - 收藏列表

export const dj_difm_subscribe_channels_get = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    sources: query.sources || '[0]',
  }
  return request(
    `/api/dj/difm/subscribe/channels/get/v2`,
    data,
    createOption(query),
  )
}

/* ---------- dj_hot  (/dj/hot) ---------- */

/* 自动转换自 api-enhanced module/dj_hot.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 热门电台

export const dj_hot = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 30,
    offset: query.offset || 0,
  }
  return request(`/api/djradio/hot/v1`, data, createOption(query, 'weapi'))
}

/* ---------- dj_paygift  (/dj/paygift) ---------- */

/* 自动转换自 api-enhanced module/dj_paygift.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 付费电台

export const dj_paygift = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 30,
    offset: query.offset || 0,
    _nmclfl: 1,
  }
  return request(
    `/api/djradio/home/paygift/list`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- dj_personalize_recommend  (/dj/personalize/recommend) ---------- */

/* 自动转换自 api-enhanced module/dj_personalize_recommend.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 电台个性推荐

export const dj_personalize_recommend = (query: NcmQuery, request: NcmRequestFn) => {
  return request(
    `/api/djradio/personalize/rcmd`,
    {
      limit: query.limit || 6,
    },
    createOption(query, 'weapi'),
  )
}

/* ---------- dj_program  (/dj/program) ---------- */

/* 自动转换自 api-enhanced module/dj_program.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 电台节目列表

export const dj_program = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    radioId: query.rid,
    limit: query.limit || 30,
    offset: query.offset || 0,
    asc: toBoolean(query.asc),
  }
  return request(`/api/dj/program/byradio`, data, createOption(query, 'weapi'))
}

/* ---------- dj_program_detail  (/dj/program/detail) ---------- */

/* 自动转换自 api-enhanced module/dj_program_detail.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 电台节目详情

export const dj_program_detail = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
  }
  return request(`/api/dj/program/detail`, data, createOption(query, 'weapi'))
}

/* ---------- dj_program_toplist  (/dj/program/toplist) ---------- */

/* 自动转换自 api-enhanced module/dj_program_toplist.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 电台节目榜

export const dj_program_toplist = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 100,
    offset: query.offset || 0,
  }
  return request(`/api/program/toplist/v1`, data, createOption(query, 'weapi'))
}

/* ---------- dj_program_toplist_hours  (/dj/program/toplist/hours) ---------- */

/* 自动转换自 api-enhanced module/dj_program_toplist_hours.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 电台24小时节目榜

export const dj_program_toplist_hours = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 100,
    // 不支持 offset
  }
  return request(
    `/api/djprogram/toplist/hours`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- dj_radio_hot  (/dj/radio/hot) ---------- */

/* 自动转换自 api-enhanced module/dj_radio_hot.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 类别热门电台

export const dj_radio_hot = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    cateId: query.cateId,
    limit: query.limit || 30,
    offset: query.offset || 0,
  }
  return request(`/api/djradio/hot`, data, createOption(query, 'weapi'))
}

/* ---------- dj_recommend  (/dj/recommend) ---------- */

/* 自动转换自 api-enhanced module/dj_recommend.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 精选电台

export const dj_recommend = (query: NcmQuery, request: NcmRequestFn) => {
  return request(`/api/djradio/recommend/v1`, {}, createOption(query, 'weapi'))
}

/* ---------- dj_recommend_type  (/dj/recommend/type) ---------- */

/* 自动转换自 api-enhanced module/dj_recommend_type.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 精选电台分类

/*
    有声书 10001
    知识技能 453050
    商业财经 453051
    人文历史 11
    外语世界 13
    亲子宝贝 14
    创作|翻唱 2001
    音乐故事 2
    3D|电子 10002
    相声曲艺 8
    情感调频 3
    美文读物 6
    脱口秀 5
    广播剧 7
    二次元 3001
    明星做主播 1
    娱乐|影视 4
    科技科学 453052
    校园|教育 4001
    旅途|城市 12
*/

export const dj_recommend_type = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    cateId: query.type,
  }
  return request(`/api/djradio/recommend`, data, createOption(query, 'weapi'))
}

/* ---------- dj_sub  (/dj/sub) ---------- */

/* 自动转换自 api-enhanced module/dj_sub.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 订阅与取消电台

export const dj_sub = (query: NcmQuery, request: NcmRequestFn) => {
  query.t = query.t == 1 ? 'sub' : 'unsub'
  const data = {
    id: query.rid,
  }
  return request(`/api/djradio/${query.t}`, data, createOption(query, 'weapi'))
}

/* ---------- dj_sublist  (/dj/sublist) ---------- */

/* 自动转换自 api-enhanced module/dj_sublist.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 订阅电台列表

export const dj_sublist = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 30,
    offset: query.offset || 0,
    total: true,
  }
  return request(`/api/djradio/get/subed`, data, createOption(query, 'weapi'))
}

/* ---------- dj_subscriber  (/dj/subscriber) ---------- */

/* 自动转换自 api-enhanced module/dj_subscriber.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 电台详情

export const dj_subscriber = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    time: query.time || '-1',
    id: query.id,
    limit: query.limit || '20',
    total: 'true',
  }
  return request(`/api/djradio/subscriber`, data, createOption(query, 'weapi'))
}

/* ---------- dj_today_perfered  (/dj/today/perfered) ---------- */

/* 自动转换自 api-enhanced module/dj_today_perfered.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 电台今日优选

export const dj_today_perfered = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    page: query.page || 0,
  }
  return request(
    `/api/djradio/home/today/perfered`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- dj_toplist  (/dj/toplist) ---------- */

/* 自动转换自 api-enhanced module/dj_toplist.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 新晋电台榜/热门电台榜

const dj_toplist_typeMap: Record<string, string> = {
  '0': '0',
  '1': '1',
  new: '0',
  hot: '1',
}

export const dj_toplist = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 100,
    offset: query.offset || 0,
    type: dj_toplist_typeMap[query.type || 'new'] || '0', //0为新晋,1为热门
  }
  return request(`/api/djradio/toplist`, data, createOption(query, 'weapi'))
}

/* ---------- dj_toplist_hours  (/dj/toplist/hours) ---------- */

/* 自动转换自 api-enhanced module/dj_toplist_hours.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 电台24小时主播榜

export const dj_toplist_hours = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 100,
    // 不支持 offset
  }
  return request(`/api/dj/toplist/hours`, data, createOption(query, 'weapi'))
}

/* ---------- dj_toplist_newcomer  (/dj/toplist/newcomer) ---------- */

/* 自动转换自 api-enhanced module/dj_toplist_newcomer.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 电台新人榜

export const dj_toplist_newcomer = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 100,
    offset: query.offset || 0,
  }
  return request(`/api/dj/toplist/newcomer`, data, createOption(query, 'weapi'))
}

/* ---------- dj_toplist_pay  (/dj/toplist/pay) ---------- */

/* 自动转换自 api-enhanced module/dj_toplist_pay.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 付费精品

export const dj_toplist_pay = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 100,
    // 不支持 offset
  }
  return request(`/api/djradio/toplist/pay`, data, createOption(query, 'weapi'))
}

/* ---------- dj_toplist_popular  (/dj/toplist/popular) ---------- */

/* 自动转换自 api-enhanced module/dj_toplist_popular.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 电台最热主播榜

export const dj_toplist_popular = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 100,
    // 不支持 offset
  }
  return request(`/api/dj/toplist/popular`, data, createOption(query, 'weapi'))
}
