import type { NcmQuery, NcmRequestFn } from '../types';
/* album.ts — 功能家族合并文件（15 个接口，由 439 个独立模块合并生成） */
/* ---------- album  (/album) ---------- */
/* 自动转换自 api-enhanced module/album.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */
// 专辑内容

import { createOption } from "../option";

export const album = (query: NcmQuery, request: NcmRequestFn) => {
  return request(`/api/v1/album/${query.id}`, {}, createOption(query, 'weapi'))
}

/* ---------- album_detail  (/album/detail) ---------- */

/* 自动转换自 api-enhanced module/album_detail.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 数字专辑详情

export const album_detail = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
  }
  return request(
    `/api/vipmall/albumproduct/detail`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- album_detail_dynamic  (/album/detail/dynamic) ---------- */

/* 自动转换自 api-enhanced module/album_detail_dynamic.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 专辑动态信息

export const album_detail_dynamic = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
  }
  return request(
    `/api/album/detail/dynamic`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- album_list  (/album/list) ---------- */

/* 自动转换自 api-enhanced module/album_list.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 数字专辑-新碟上架

export const album_list = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 30,
    offset: query.offset || 0,
    total: true,
    area: query.area || 'ALL', //ALL:全部,ZH:华语,EA:欧美,KR:韩国,JP:日本
    type: query.type,
  }
  return request(
    `/api/vipmall/albumproduct/list`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- album_list_style  (/album/list/style) ---------- */

/* 自动转换自 api-enhanced module/album_list_style.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 数字专辑-语种风格馆

export const album_list_style = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 10,
    offset: query.offset || 0,
    total: true,
    area: query.area || 'Z_H', //Z_H:华语,E_A:欧美,KR:韩国,JP:日本
  }
  return request(
    `/api/vipmall/appalbum/album/style`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- album_new  (/album/new) ---------- */

/* 自动转换自 api-enhanced module/album_new.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 全部新碟

export const album_new = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 30,
    offset: query.offset || 0,
    total: true,
    area: query.area || 'ALL', //ALL:全部,ZH:华语,EA:欧美,KR:韩国,JP:日本
  }
  return request(`/api/album/new`, data, createOption(query, 'weapi'))
}

/* ---------- album_newest  (/album/newest) ---------- */

/* 自动转换自 api-enhanced module/album_newest.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 最新专辑

export const album_newest = (query: NcmQuery, request: NcmRequestFn) => {
  return request(`/api/discovery/newAlbum`, {}, createOption(query, 'weapi'))
}

/* ---------- album_privilege  (/album/privilege) ---------- */

/* 自动转换自 api-enhanced module/album_privilege.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 获取专辑歌曲的音质

export const album_privilege = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
  }
  return request(`/api/album/privilege`, data, createOption(query))
}

/* ---------- album_songsaleboard  (/album/songsaleboard) ---------- */

/* 自动转换自 api-enhanced module/album_songsaleboard.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 数字专辑&数字单曲-榜单

export const album_songsaleboard = (query: NcmQuery, request: NcmRequestFn) => {
  let data: Record<string, any> = {
    albumType: query.albumType || 0, //0为数字专辑,1为数字单曲
  }
  const type = query.type || 'daily' // daily,week,year,total
  if (type === 'year') {
    data = {
      ...data,
      year: query.year,
    }
  }
  return request(
    `/api/feealbum/songsaleboard/${type}/type`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- album_sub  (/album/sub) ---------- */

/* 自动转换自 api-enhanced module/album_sub.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 收藏/取消收藏专辑

export const album_sub = (query: NcmQuery, request: NcmRequestFn) => {
  query.t = query.t == 1 ? 'sub' : 'unsub'
  const data = {
    id: query.id,
  }
  return request(`/api/album/${query.t}`, data, createOption(query, 'weapi'))
}

/* ---------- album_sublist  (/album/sublist) ---------- */

/* 自动转换自 api-enhanced module/album_sublist.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 已收藏专辑列表

export const album_sublist = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 25,
    offset: query.offset || 0,
    total: true,
  }
  return request(`/api/album/sublist`, data, createOption(query, 'weapi'))
}

/* ---------- digitalAlbum_detail  (/digitalAlbum/detail) ---------- */

/* 自动转换自 api-enhanced module/digitalAlbum_detail.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 数字专辑详情

export const digitalAlbum_detail = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
  }
  return request(
    `/api/vipmall/albumproduct/detail`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- digitalAlbum_ordering  (/digitalAlbum/ordering) ---------- */

/* 自动转换自 api-enhanced module/digitalAlbum_ordering.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 购买数字专辑

export const digitalAlbum_ordering = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    business: 'Album',
    paymentMethod: query.payment,
    digitalResources: JSON.stringify([
      {
        business: 'Album',
        resourceID: query.id,
        quantity: query.quantity,
      },
    ]),
    from: 'web',
  }
  return request(
    `/api/ordering/web/digital`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- digitalAlbum_purchased  (/digitalAlbum/purchased) ---------- */

/* 自动转换自 api-enhanced module/digitalAlbum_purchased.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 我的数字专辑

export const digitalAlbum_purchased = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 30,
    offset: query.offset || 0,
    total: true,
  }
  return request(
    `/api/digitalAlbum/purchased`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- digitalAlbum_sales  (/digitalAlbum/sales) ---------- */

/* 自动转换自 api-enhanced module/digitalAlbum_sales.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 数字专辑销量

export const digitalAlbum_sales = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    albumIds: query.ids,
  }
  return request(
    `/api/vipmall/albumproduct/album/query/sales`,
    data,
    createOption(query, 'weapi'),
  )
}
