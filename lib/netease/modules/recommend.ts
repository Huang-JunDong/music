import type { NcmQuery, NcmRequestFn } from '../types';
/* recommend.ts — 功能家族合并文件（25 个接口，由 439 个独立模块合并生成） */
/* ---------- banner  (/banner) ---------- */
/* 自动转换自 api-enhanced module/banner.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */
// 首页轮播图

import { createOption } from "../option";

export const banner = (query: NcmQuery, request: NcmRequestFn) => {
  const type =
    ({
      0: 'pc',
      1: 'android',
      2: 'iphone',
      3: 'ipad',
    } as Record<string | number, string>)[query.type || 0] || 'pc'
  return request(
    `/api/v2/banner/get`,
    { clientType: type },
    createOption(query),
  )
}

/* ---------- calendar  (/calendar) ---------- */

/* 自动转换自 api-enhanced module/calendar.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const calendar = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    startTime: query.startTime || Date.now(),
    endTime: query.endTime || Date.now(),
  }
  return request(`/api/mcalendar/detail`, data, createOption(query, 'weapi'))
}

/* ---------- history_recommend_songs  (/history/recommend/songs) ---------- */

/* 自动转换自 api-enhanced module/history_recommend_songs.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 历史每日推荐歌曲

export const history_recommend_songs = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(
    `/api/discovery/recommend/songs/history/recent`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- history_recommend_songs_detail  (/history/recommend/songs/detail) ---------- */

/* 自动转换自 api-enhanced module/history_recommend_songs_detail.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 历史每日推荐歌曲详情

export const history_recommend_songs_detail = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    date: query.date || '',
  }
  return request(
    `/api/discovery/recommend/songs/history/detail`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- homepage_block_page  (/homepage/block/page) ---------- */

/* 自动转换自 api-enhanced module/homepage_block_page.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 首页-发现 block page

// 这个接口为移动端接口，首页-发现页，数据结构可以参考 https://github.com/hcanyz/flutter-netease-music-api/blob/master/lib/src/api/uncategorized/bean.dart#L259 HomeBlockPageWrap

// query.refresh 是否刷新数据

export const homepage_block_page = (query: NcmQuery, request: NcmRequestFn) => {
  const data = { refresh: query.refresh || false, cursor: query.cursor }
  return request(`/api/homepage/block/page`, data, createOption(query, 'weapi'))
}

/* ---------- homepage_dragon_ball  (/homepage/dragon/ball) ---------- */

/* 自动转换自 api-enhanced module/homepage_dragon_ball.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 首页-发现 dragon ball

// 这个接口为移动端接口，首页-发现页（每日推荐、歌单、排行榜 那些入口）

// 数据结构可以参考 https://github.com/hcanyz/flutter-netease-music-api/blob/master/lib/src/api/uncategorized/bean.dart#L290 HomeDragonBallWrap

// !需要登录或者游客登录，非登录返回 []

export const homepage_dragon_ball = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}

  return request(`/api/homepage/dragon/ball/static`, data, createOption(query))
}

/* ---------- hot_topic  (/hot/topic) ---------- */

/* 自动转换自 api-enhanced module/hot_topic.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

//热门话题

export const hot_topic = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 20,
    offset: query.offset || 0,
  }
  return request(`/api/act/hot`, data, createOption(query, 'weapi'))
}

/* ---------- personalized  (/personalized) ---------- */

/* 自动转换自 api-enhanced module/personalized.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 推荐歌单

export const personalized = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 30,
    // offset: query.offset || 0,
    total: true,
    n: 1000,
  }
  return request(
    `/api/personalized/playlist`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- personalized_djprogram  (/personalized/djprogram) ---------- */

/* 自动转换自 api-enhanced module/personalized_djprogram.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 推荐电台

export const personalized_djprogram = (query: NcmQuery, request: NcmRequestFn) => {
  return request(
    `/api/personalized/djprogram`,
    {},
    createOption(query, 'weapi'),
  )
}

/* ---------- personalized_mv  (/personalized/mv) ---------- */

/* 自动转换自 api-enhanced module/personalized_mv.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 推荐MV

export const personalized_mv = (query: NcmQuery, request: NcmRequestFn) => {
  return request(`/api/personalized/mv`, {}, createOption(query, 'weapi'))
}

/* ---------- personalized_newsong  (/personalized/newsong) ---------- */

/* 自动转换自 api-enhanced module/personalized_newsong.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 推荐新歌

export const personalized_newsong = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    type: 'recommend',
    limit: query.limit || 10,
    areaId: query.areaId || 0,
  }
  return request(
    `/api/personalized/newsong`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- personalized_privatecontent  (/personalized/privatecontent) ---------- */

/* 自动转换自 api-enhanced module/personalized_privatecontent.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 独家放送

export const personalized_privatecontent = (query: NcmQuery, request: NcmRequestFn) => {
  return request(
    `/api/personalized/privatecontent`,
    {},
    createOption(query, 'weapi'),
  )
}

/* ---------- personalized_privatecontent_list  (/personalized/privatecontent/list) ---------- */

/* 自动转换自 api-enhanced module/personalized_privatecontent_list.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 独家放送列表

export const personalized_privatecontent_list = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    offset: query.offset || 0,
    total: 'true',
    limit: query.limit || 60,
  }
  return request(
    `/api/v2/privatecontent/list`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- recommend_resource  (/recommend/resource) ---------- */

/* 自动转换自 api-enhanced module/recommend_resource.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 每日推荐歌单

export const recommend_resource = (query: NcmQuery, request: NcmRequestFn) => {
  return request(
    `/api/v1/discovery/recommend/resource`,
    {},
    createOption(query, 'weapi'),
  )
}

/* ---------- recommend_songs  (/recommend/songs) ---------- */

/* 自动转换自 api-enhanced module/recommend_songs.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 每日推荐歌曲

export const recommend_songs = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    afresh: query.afresh,
  }
  return request(
    `/api/v3/discovery/recommend/songs`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- recommend_songs_dislike  (/recommend/songs/dislike) ---------- */

/* 自动转换自 api-enhanced module/recommend_songs_dislike.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 每日推荐歌曲-不感兴趣

export const recommend_songs_dislike = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    resId: query.id, // 日推歌曲id
    resType: 4,
    sceneType: 1,
  }
  return request(
    `/api/v2/discovery/recommend/dislike`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- top_album  (/top/album) ---------- */

/* 自动转换自 api-enhanced module/top_album.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 新碟上架

export const top_album = (query: NcmQuery, request: NcmRequestFn) => {
  const date = new Date()

  const data = {
    area: query.area || 'ALL', // //ALL:全部,ZH:华语,EA:欧美,KR:韩国,JP:日本
    limit: query.limit || 50,
    offset: query.offset || 0,
    type: query.type || 'new',
    year: query.year || date.getFullYear(),
    month: query.month || date.getMonth() + 1,
    total: false,
    rcmd: true,
  }
  return request(
    `/api/discovery/new/albums/area`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- top_artists  (/top/artists) ---------- */

/* 自动转换自 api-enhanced module/top_artists.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 热门歌手

export const top_artists = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 50,
    offset: query.offset || 0,
    total: true,
  }
  return request(`/api/artist/top`, data, createOption(query, 'weapi'))
}

/* ---------- top_list  (/top/list) ---------- */

/* 自动转换自 api-enhanced module/top_list.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 排行榜

export const top_list = (query: NcmQuery, request: NcmRequestFn) => {
  if (query.idx) {
    return Promise.resolve({
      status: 500,
      body: {
        code: 500,
        msg: '不支持此方式调用,只支持id调用',
      },
    })
  }

  const data = {
    id: query.id,
    n: '500',
    s: '0',
  }
  return request(`/api/playlist/v4/detail`, data, createOption(query))
}

/* ---------- top_mv  (/top/mv) ---------- */

/* 自动转换自 api-enhanced module/top_mv.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// MV排行榜

export const top_mv = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    area: query.area || '',
    limit: query.limit || 30,
    offset: query.offset || 0,
    total: true,
  }
  return request(`/api/mv/toplist`, data, createOption(query, 'weapi'))
}

/* ---------- top_song  (/top/song) ---------- */

/* 自动转换自 api-enhanced module/top_song.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 新歌速递

export const top_song = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    areaId: query.type || 0, // 全部:0 华语:7 欧美:96 日本:8 韩国:16
    // limit: query.limit || 100,
    // offset: query.offset || 0,
    total: true,
  }
  return request(
    `/api/v1/discovery/new/songs`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- toplist  (/toplist) ---------- */

/* 自动转换自 api-enhanced module/toplist.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 所有榜单介绍

export const toplist = (query: NcmQuery, request: NcmRequestFn) => {
  return request(`/api/toplist`, {}, createOption(query))
}

/* ---------- toplist_artist  (/toplist/artist) ---------- */

/* 自动转换自 api-enhanced module/toplist_artist.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌手榜

export const toplist_artist = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    type: query.type || 1,
    limit: 100,
    offset: 0,
    total: true,
  }
  return request(`/api/toplist/artist`, data, createOption(query, 'weapi'))
}

/* ---------- toplist_detail  (/toplist/detail) ---------- */

/* 自动转换自 api-enhanced module/toplist_detail.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 所有榜单内容摘要

export const toplist_detail = (query: NcmQuery, request: NcmRequestFn) => {
  return request(`/api/toplist/detail`, {}, createOption(query, 'weapi'))
}

/* ---------- toplist_detail_v2  (/toplist/detail/v2) ---------- */

/* 自动转换自 api-enhanced module/toplist_detail_v2.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 所有榜单内容摘要v2

export const toplist_detail_v2 = (query: NcmQuery, request: NcmRequestFn) => {
  return request(`/api/toplist/detail/v2`, {}, createOption(query, 'weapi'))
}
