import type { NcmQuery, NcmRequestFn } from '../types';
/* social.ts — 功能家族合并文件（16 个接口，由 439 个独立模块合并生成） */
/* ---------- event  (/event) ---------- */
/* 自动转换自 api-enhanced module/event.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */
// 获取动态列表

import { createOption } from "../option";

export const event = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    pagesize: query.pagesize || 20,
    lasttime: query.lasttime || -1,
  }
  return request(`/api/v1/event/get`, data, createOption(query, 'weapi'))
}

/* ---------- event_del  (/event/del) ---------- */

/* 自动转换自 api-enhanced module/event_del.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 删除动态

export const event_del = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.evId,
  }
  return request(`/api/event/delete`, data, createOption(query, 'weapi'))
}

/* ---------- event_forward  (/event/forward) ---------- */

/* 自动转换自 api-enhanced module/event_forward.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 转发动态

export const event_forward = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    forwards: query.forwards,
    id: query.evId,
    eventUserId: query.uid,
  }
  return request(`/api/event/forward`, data, createOption(query))
}

/* ---------- event_privacy  (/event/privacy) ---------- */

/* 自动转换自 api-enhanced module/event_privacy.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 修改本人动态的可见权限

const event_privacy__PRIVACY_VALUES = new Set([0, 1, 2, 6])

export const event_privacy = (query: NcmQuery, request: NcmRequestFn) => {
  const eventId = String(query.evId ?? '').trim()
  const rawPrivacy = String(query.privacy ?? '').trim()
  const privacy = Number(rawPrivacy)

  if (
    !eventId ||
    !rawPrivacy ||
    !Number.isInteger(privacy) ||
    !event_privacy__PRIVACY_VALUES.has(privacy)
  ) {
    return Promise.resolve({
      status: 400,
      body: {
        code: 400,
        message: 'evId is required and privacy must be one of 0, 1, 2, 6',
      },
      cookie: [],
    })
  }

  const data = {
    eventId,
    privacy,
  }

  return request(`/api/event/privacy/op`, data, createOption(query))
}

/* ---------- follow  (/follow) ---------- */

/* 自动转换自 api-enhanced module/follow.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 关注与取消关注用户

export const follow = (query: NcmQuery, request: NcmRequestFn) => {
  query.t = query.t == 1 ? 'follow' : 'delfollow'
  return request(
    `/api/user/${query.t}/${query.id}`,
    {},
    createOption(query, 'weapi'),
  )
}

/* ---------- msg_comments  (/msg/comments) ---------- */

/* 自动转换自 api-enhanced module/msg_comments.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 评论

export const msg_comments = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    beforeTime: query.before || '-1',
    limit: query.limit || 30,
    total: 'true',
    uid: query.uid,
  }

  return request(
    `/api/v1/user/comments/${query.uid}`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- msg_forwards  (/msg/forwards) ---------- */

/* 自动转换自 api-enhanced module/msg_forwards.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// @我

export const msg_forwards = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    offset: query.offset || 0,
    limit: query.limit || 30,
    total: 'true',
  }
  return request(`/api/forwards/get`, data, createOption(query, 'weapi'))
}

/* ---------- msg_notices  (/msg/notices) ---------- */

/* 自动转换自 api-enhanced module/msg_notices.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 通知

export const msg_notices = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 30,
    time: query.lasttime || -1,
  }
  return request(`/api/msg/notices`, data, createOption(query, 'weapi'))
}

/* ---------- msg_private  (/msg/private) ---------- */

/* 自动转换自 api-enhanced module/msg_private.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 私信

export const msg_private = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    offset: query.offset || 0,
    limit: query.limit || 30,
    total: 'true',
  }
  return request(`/api/msg/private/users`, data, createOption(query, 'weapi'))
}

/* ---------- msg_private_history  (/msg/private/history) ---------- */

/* 自动转换自 api-enhanced module/msg_private_history.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 私信内容

export const msg_private_history = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    userId: query.uid,
    limit: query.limit || 30,
    time: query.before || 0,
    total: 'true',
  }
  return request(`/api/msg/private/history`, data, createOption(query, 'weapi'))
}

/* ---------- msg_recentcontact  (/msg/recentcontact) ---------- */

/* 自动转换自 api-enhanced module/msg_recentcontact.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 最近联系

export const msg_recentcontact = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(
    `/api/msg/recentcontact/get`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- send_album  (/send/album) ---------- */

/* 自动转换自 api-enhanced module/send_album.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 私信专辑

export const send_album = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
    msg: query.msg || '',
    type: 'album',
    userIds: '[' + query.user_ids + ']',
  }
  return request(`/api/msg/private/send`, data, createOption(query))
}

/* ---------- send_playlist  (/send/playlist) ---------- */

/* 自动转换自 api-enhanced module/send_playlist.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 私信歌单

export const send_playlist = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.playlist,
    type: 'playlist',
    msg: query.msg,
    userIds: '[' + query.user_ids + ']',
  }
  return request(`/api/msg/private/send`, data, createOption(query))
}

/* ---------- send_song  (/send/song) ---------- */

/* 自动转换自 api-enhanced module/send_song.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 私信歌曲

export const send_song = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
    msg: query.msg || '',
    type: 'song',
    userIds: '[' + query.user_ids + ']',
  }
  return request(`/api/msg/private/send`, data, createOption(query))
}

/* ---------- send_text  (/send/text) ---------- */

/* 自动转换自 api-enhanced module/send_text.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 私信

export const send_text = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    type: 'text',
    msg: query.msg,
    userIds: '[' + query.user_ids + ']',
  }
  return request(`/api/msg/private/send`, data, createOption(query))
}

/* ---------- share_resource  (/share/resource) ---------- */

/* 自动转换自 api-enhanced module/share_resource.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 分享歌曲到动态

export const share_resource = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    type: query.type || 'song', // song,playlist,mv,djprogram,djradio,noresource
    msg: query.msg || '',
    id: query.id || '',
  }
  return request(
    `/api/share/friends/resource`,
    data,
    createOption(query, 'xeapi', 'v3'),
  )
}
