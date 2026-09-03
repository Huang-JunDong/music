import type { NcmQuery, NcmRequestFn } from '../types';
/* artist.ts — 功能家族合并文件（19 个接口，由 439 个独立模块合并生成） */
/* ---------- artist_album  (/artist/album) ---------- */
/* 自动转换自 api-enhanced module/artist_album.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */
// 歌手专辑列表

import { createOption } from "../option";

export const artist_album = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 30,
    offset: query.offset || 0,
    total: true,
  }
  return request(
    `/api/artist/albums/${query.id}`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- artist_desc  (/artist/desc) ---------- */

/* 自动转换自 api-enhanced module/artist_desc.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌手介绍

export const artist_desc = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
  }
  return request(`/api/artist/introduction`, data, createOption(query, 'weapi'))
}

/* ---------- artist_detail  (/artist/detail) ---------- */

/* 自动转换自 api-enhanced module/artist_detail.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const artist_detail = (query: NcmQuery, request: NcmRequestFn) => {
  return request(
    `/api/artist/head/info/get`,
    {
      id: query.id,
    },
    createOption(query),
  )
}

/* ---------- artist_detail_dynamic  (/artist/detail/dynamic) ---------- */

/* 自动转换自 api-enhanced module/artist_detail_dynamic.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌手动态信息

export const artist_detail_dynamic = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
  }
  return request(`/api/artist/detail/dynamic`, data, createOption(query))
}

/* ---------- artist_fans  (/artist/fans) ---------- */

/* 自动转换自 api-enhanced module/artist_fans.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌手粉丝

export const artist_fans = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
    limit: query.limit || 20,
    offset: query.offset || 0,
  }
  return request(`/api/artist/fans/get`, data, createOption(query, 'weapi'))
}

/* ---------- artist_follow_count  (/artist/follow/count) ---------- */

/* 自动转换自 api-enhanced module/artist_follow_count.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌手粉丝数量

export const artist_follow_count = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
  }
  return request(
    `/api/artist/follow/count/get`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- artist_list  (/artist/list) ---------- */

/* 自动转换自 api-enhanced module/artist_list.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌手分类

/* 
    type 取值
    1:男歌手
    2:女歌手
    3:乐队

    area 取值
    -1:全部
    7华语
    96欧美
    8:日本
    16韩国
    0:其他

    initial 取值 a-z/A-Z
*/

export const artist_list = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    initial: isNaN(query.initial)
      ? (query.initial || '').toUpperCase().charCodeAt() || undefined
      : query.initial,
    offset: query.offset || 0,
    limit: query.limit || 30,
    total: true,
    type: query.type || '1',
    area: query.area,
  }
  return request(`/api/v1/artist/list`, data, createOption(query, 'weapi'))
}

/* ---------- artist_mv  (/artist/mv) ---------- */

/* 自动转换自 api-enhanced module/artist_mv.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌手相关MV

export const artist_mv = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    artistId: query.id,
    limit: query.limit,
    offset: query.offset,
    total: true,
  }
  return request(`/api/artist/mvs`, data, createOption(query, 'weapi'))
}

/* ---------- artist_new_mv  (/artist/new/mv) ---------- */

/* 自动转换自 api-enhanced module/artist_new_mv.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const artist_new_mv = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 20,
    startTimestamp: query.before || Date.now(),
  }
  return request(
    `/api/sub/artist/new/works/mv/list`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- artist_new_song  (/artist/new/song) ---------- */

/* 自动转换自 api-enhanced module/artist_new_song.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const artist_new_song = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 20,
    startTimestamp: query.before || Date.now(),
  }
  return request(
    `/api/sub/artist/new/works/song/list`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- artist_new_song_mv_list_v2  (/artist/new/song/mv/list/v2) ---------- */

/* 自动转换自 api-enhanced module/artist_new_song_mv_list_v2.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 获取关注歌手的新歌曲和 MV

export const artist_new_song_mv_list_v2 = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    startTimestamp: query.startTimestamp || query.before || Date.now(),
    sourceType: query.sourceType || 1,
    limit: query.limit || 10,
    firstRequest: query.firstRequest ?? true,
  }
  return request(
    `/api/sub/artist/new/works/song-mv/list/v2`,
    data,
    createOption(query, 'eapi'),
  )
}

/* ---------- artist_new_song_playall  (/artist/new/song/playall) ---------- */

/* 自动转换自 api-enhanced module/artist_new_song_playall.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 获取所有关注歌手最近的 50 首新歌

export const artist_new_song_playall = (query: NcmQuery, request: NcmRequestFn) => {
  return request(
    `/api/sub/artist/new/works/song/playall`,
    {},
    createOption(query, 'eapi'),
  )
}

/* ---------- artist_songs  (/artist/songs) ---------- */

/* 自动转换自 api-enhanced module/artist_songs.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const artist_songs = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
    private_cloud: 'true',
    work_type: 1,
    order: query.order || 'hot', //hot,time
    offset: query.offset || 0,
    limit: query.limit || 100,
  }
  return request(`/api/v1/artist/songs`, data, createOption(query))
}

/* ---------- artist_sub  (/artist/sub) ---------- */

/* 自动转换自 api-enhanced module/artist_sub.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 收藏与取消收藏歌手

export const artist_sub = (query: NcmQuery, request: NcmRequestFn) => {
  query.t = query.t == 1 ? 'sub' : 'unsub'
  const data = {
    artistId: query.id,
    artistIds: '[' + query.id + ']',
  }
  return request(`/api/artist/${query.t}`, data, createOption(query, 'weapi'))
}

/* ---------- artist_sublist  (/artist/sublist) ---------- */

/* 自动转换自 api-enhanced module/artist_sublist.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 关注歌手列表

export const artist_sublist = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 25,
    offset: query.offset || 0,
    total: true,
  }
  return request(`/api/artist/sublist`, data, createOption(query, 'weapi'))
}

/* ---------- artist_top_song  (/artist/top/song) ---------- */

/* 自动转换自 api-enhanced module/artist_top_song.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌手热门 50 首歌曲

export const artist_top_song = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
  }
  return request(`/api/artist/top/song`, data, createOption(query, 'weapi'))
}

/* ---------- artist_video  (/artist/video) ---------- */

/* 自动转换自 api-enhanced module/artist_video.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌手相关视频

export const artist_video = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    artistId: query.id,
    page: JSON.stringify({
      size: query.size || 10,
      cursor: query.cursor || 0,
    }),
    tab: 0,
    order: query.order || 0,
  }
  return request(`/api/mlog/artist/video`, data, createOption(query, 'weapi'))
}

/* ---------- artists  (/artists) ---------- */

/* 自动转换自 api-enhanced module/artists.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌手单曲

export const artists = (query: NcmQuery, request: NcmRequestFn) => {
  return request(`/api/v1/artist/${query.id}`, {}, createOption(query, 'weapi'))
}

/* ---------- simi_artist  (/simi/artist) ---------- */

/* 自动转换自 api-enhanced module/simi_artist.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 相似歌手

export const simi_artist = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    artistid: query.id,
  }
  return request(
    `/api/discovery/simiArtist`,
    data,
    createOption(query, 'weapi'),
  )
}
