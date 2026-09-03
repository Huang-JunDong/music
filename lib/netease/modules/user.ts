import type { NcmQuery, NcmRequestFn } from '../types';
/* user.ts — 功能家族合并文件（30 个接口，由 439 个独立模块合并生成） */
/* ---------- device_kickoff  (/device/kickoff) ---------- */
/* 自动转换自 api-enhanced module/device_kickoff.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */
// 强制下线设备

import { createOption } from "../option";

export const device_kickoff = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    key: query.deviceKey,
    captcha: query.captcha || '',
  }
  return request(
    `/api/middle/user/security/device/kickoff`,
    data,
    createOption(query, 'eapi'),
  )
}

/* ---------- device_list  (/device/list) ---------- */

/* 自动转换自 api-enhanced module/device_list.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 登录设备列表

export const device_list = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    excStatus: '9',
  }
  return request(
    `/api/middle/user/device/list`,
    data,
    createOption(query, 'eapi'),
  )
}

/* ---------- get_userids  (/get/userids) ---------- */

/* 自动转换自 api-enhanced module/get_userids.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const get_userids = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    nicknames: query.nicknames,
  }
  return request(`/api/user/getUserIds`, data, createOption(query, 'weapi'))
}

/* ---------- user_account  (/user/account) ---------- */

/* 自动转换自 api-enhanced module/user_account.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const user_account = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(`/api/nuser/account/get`, data, createOption(query, 'weapi'))
}

/* ---------- user_audio  (/user/audio) ---------- */

/* 自动转换自 api-enhanced module/user_audio.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 用户创建的电台

export const user_audio = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    userId: query.uid,
  }
  return request(`/api/djradio/get/byuser`, data, createOption(query, 'weapi'))
}

/* ---------- user_cloud  (/user/cloud) ---------- */

/* 自动转换自 api-enhanced module/user_cloud.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 云盘数据

export const user_cloud = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 30,
    offset: query.offset || 0,
  }
  return request(`/api/v1/cloud/get`, data, createOption(query, 'weapi'))
}

/* ---------- user_cloud_del  (/user/cloud/del) ---------- */

/* 自动转换自 api-enhanced module/user_cloud_del.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 云盘歌曲删除

export const user_cloud_del = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    songIds: [query.id],
  }
  return request(`/api/cloud/del`, data, createOption(query, 'weapi'))
}

/* ---------- user_cloud_detail  (/user/cloud/detail) ---------- */

/* 自动转换自 api-enhanced module/user_cloud_detail.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 云盘数据详情

export const user_cloud_detail = (query: NcmQuery, request: NcmRequestFn) => {
  const id = query.id.replace(/\s/g, '').split(',')
  const data = {
    songIds: id,
  }
  return request(`/api/v1/cloud/get/byids`, data, createOption(query, 'weapi'))
}

/* ---------- user_comment_history  (/user/comment/history) ---------- */

/* 自动转换自 api-enhanced module/user_comment_history.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const user_comment_history = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    compose_reminder: 'true',
    compose_hot_comment: 'true',
    limit: query.limit || 10,
    user_id: query.uid,
    time: query.time || 0,
  }
  return request(
    `/api/comment/user/comment/history`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- user_detail  (/user/detail) ---------- */

/* 自动转换自 api-enhanced module/user_detail.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 用户详情

export const user_detail = async (query: NcmQuery, request: NcmRequestFn) => {
  const res = await request(
    `/api/v1/user/detail/${query.uid}`,
    {},
    createOption(query, 'weapi'),
  )
  const result = JSON.stringify(res).replace(
    /avatarImgId_str/g,
    'avatarImgIdStr',
  )
  return JSON.parse(result)
}

/* ---------- user_detail_new  (/user/detail/new) ---------- */

/* 自动转换自 api-enhanced module/user_detail_new.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 用户详情

export const user_detail_new = async (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    all: 'true',
    userId: query.uid,
  }
  const res = await request(
    `/api/w/v1/user/detail/${query.uid}`,
    data,
    createOption(query, 'eapi'),
  )
  // const result = JSON.stringify(res).replace(
  //   /avatarImgId_str/g,
  //   "avatarImgIdStr"
  // );
  // return JSON.parse(result);
  return res
}

/* ---------- user_dj  (/user/dj) ---------- */

/* 自动转换自 api-enhanced module/user_dj.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 用户电台节目

export const user_dj = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 30,
    offset: query.offset || 0,
  }
  return request(
    `/api/dj/program/${query.uid}`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- user_event  (/user/event) ---------- */

/* 自动转换自 api-enhanced module/user_event.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 用户动态

export const user_event = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    getcounts: true,
    time: query.lasttime ?? -1,
    limit: query.limit ?? 30,
    total: false,
    fromRN: 'true',
  }
  return request(`/api/event/get/${query.uid}`, data, createOption(query))
}

/* ---------- user_event_all  (/user/event/all) ---------- */

/* 自动转换自 api-enhanced module/user_event_all.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 获取当前登录用户可被上游枚举的全部动态

const user_event_all__PAGE_SIZE = 100

const user_event_all__MAX_PAGES = 1000

const user_event_all__errorResponse = (message: string, cookie: string[] = []) => ({
  status: 502,
  body: {
    code: 502,
    message,
  },
  cookie,
})

export const user_event_all = async (query: NcmQuery, request: NcmRequestFn) => {
  const accountResult = await user_account(query, request)
  const uid =
    accountResult.body?.account?.id || accountResult.body?.profile?.userId

  if (!uid) {
    if (
      accountResult.status !== 200 ||
      (accountResult.body?.code && accountResult.body.code !== 200)
    ) {
      return accountResult
    }

    return {
      status: 401,
      body: {
        code: 401,
        message: 'A valid login cookie is required',
      },
      cookie: accountResult.cookie || [],
    }
  }

  const cookies = [...(accountResult.cookie || [])]
  const events = []
  const eventIds = new Set()
  const cursors = new Set()
  let lasttime = -1
  let more = true
  let pageCount = 0
  let size = null

  while (more) {
    pageCount += 1

    const pageResult = await user_event(
      {
        ...query,
        uid,
        lasttime,
        limit: user_event_all__PAGE_SIZE,
      },
      request,
    )

    cookies.push(...(pageResult.cookie || []))

    if (pageResult.status !== 200 || pageResult.body?.code !== 200) {
      return {
        ...pageResult,
        cookie: cookies,
      }
    }

    if (pageCount === 1) {
      const reportedSize = pageResult.body.size
      const numericSize = Number(reportedSize)
      size =
        reportedSize != null && Number.isFinite(numericSize)
          ? numericSize
          : null
    }

    for (const event of pageResult.body.events || []) {
      if (event?.id == null) {
        events.push(event)
        continue
      }

      const eventId = String(event.id)
      if (!eventIds.has(eventId)) {
        eventIds.add(eventId)
        events.push(event)
      }
    }

    more = Boolean(pageResult.body.more)
    lasttime = pageResult.body.lasttime

    if (more) {
      const cursor = String(lasttime ?? '')
      if (!cursor || cursors.has(cursor)) {
        return user_event_all__errorResponse(
          'Upstream event pagination cursor stalled',
          cookies,
        )
      }
      cursors.add(cursor)
    }

    if (more && pageCount >= user_event_all__MAX_PAGES) {
      return user_event_all__errorResponse(
        `Upstream event pagination exceeded ${user_event_all__MAX_PAGES} pages`,
        cookies,
      )
    }
  }

  const retrievedCount = events.length
  const unavailableCount =
    size == null ? null : Math.max(size - retrievedCount, 0)

  return {
    status: 200,
    body: {
      code: 200,
      events,
      size,
      retrievedCount,
      unavailableCount,
      sizeMismatch: size == null ? null : size !== retrievedCount,
      pageCount,
      more: false,
      lasttime: lasttime ?? null,
    },
    cookie: cookies,
  }
}

/* ---------- user_follow_mixed  (/user/follow/mixed) ---------- */

/* 自动转换自 api-enhanced module/user_follow_mixed.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 当前账号关注的用户/歌手

export const user_follow_mixed = (query: NcmQuery, request: NcmRequestFn) => {
  const size = query.size || 30
  const cursor = query.cursor || 0
  const scene = query.scene || 0 // 0: 所有关注 1: 关注的歌手 2: 关注的用户
  const data = {
    authority: 'false',
    page: JSON.stringify({
      size: size,
      cursor: cursor,
    }),
    scene: scene,
    size: size,
    sortType: '0',
  }
  return request(
    `/api/user/follow/users/mixed/get/v2`,
    data,
    createOption(query),
  )
}

/* ---------- user_followeds  (/user/followeds) ---------- */

/* 自动转换自 api-enhanced module/user_followeds.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 关注TA的人(粉丝)

export const user_followeds = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    userId: query.uid,
    time: '0',
    limit: query.limit || 20,
    offset: query.offset || 0,
    getcounts: 'true',
  }
  return request(
    `/api/user/getfolloweds/${query.uid}`,
    data,
    createOption(query),
  )
}

/* ---------- user_follows  (/user/follows) ---------- */

/* 自动转换自 api-enhanced module/user_follows.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// TA关注的人(关注)

export const user_follows = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    offset: query.offset || 0,
    limit: query.limit || 30,
    order: true,
  }
  return request(
    `/api/user/getfollows/${query.uid}`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- user_level  (/user/level) ---------- */

/* 自动转换自 api-enhanced module/user_level.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 类别热门电台

export const user_level = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(`/api/user/level`, data, createOption(query, 'weapi'))
}

/* ---------- user_medal  (/user/medal) ---------- */

/* 自动转换自 api-enhanced module/user_medal.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 用户徽章

export const user_medal = (query: NcmQuery, request: NcmRequestFn) => {
  return request(
    `/api/medal/user/page`,
    {
      uid: query.uid,
    },
    createOption(query),
  )
}

/* ---------- user_mutualfollow_get  (/user/mutualfollow/get) ---------- */

/* 自动转换自 api-enhanced module/user_mutualfollow_get.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 用户是否互相关注

export const user_mutualfollow_get = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    friendid: query.uid,
  }
  return request(`/api/user/mutualfollow/get`, data, createOption(query))
}

/* ---------- user_playlist  (/user/playlist) ---------- */

/* 自动转换自 api-enhanced module/user_playlist.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 用户歌单

export const user_playlist = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    uid: query.uid,
    limit: query.limit || 30,
    offset: query.offset || 0,
    includeVideo: true,
  }
  return request(`/api/user/playlist`, data, createOption(query, 'weapi'))
}

/* ---------- user_playlist_collect  (/user/playlist/collect) ---------- */

/* 自动转换自 api-enhanced module/user_playlist_collect.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 获取用户的收藏歌单列表

export const user_playlist_collect = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || '100',
    offset: query.offset || '0',
    userId: query.uid,
    isWebview: 'true',
    includeRedHeart: 'true',
    includeTop: 'true',
  }
  return request(`/api/user/playlist/collect`, data, createOption(query))
}

/* ---------- user_playlist_create  (/user/playlist/create) ---------- */

/* 自动转换自 api-enhanced module/user_playlist_create.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 获取用户的创建歌单列表

export const user_playlist_create = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || '100',
    offset: query.offset || '0',
    userId: query.uid,
    isWebview: 'true',
    includeRedHeart: 'true',
    includeTop: 'true',
  }
  return request(`/api/user/playlist/create`, data, createOption(query))
}

/* ---------- user_record  (/user/record) ---------- */

/* 自动转换自 api-enhanced module/user_record.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 听歌排行

export const user_record = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    uid: query.uid,
    type: query.type || 0, // 1: 最近一周, 0: 所有时间
  }
  return request(`/api/v1/play/record`, data, createOption(query, 'weapi'))
}

/* ---------- user_social_status  (/user/social/status) ---------- */

/* 自动转换自 api-enhanced module/user_social_status.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 用户状态

export const user_social_status = (query: NcmQuery, request: NcmRequestFn) => {
  return request(
    `/api/social/user/status`,
    {
      visitorId: query.uid,
    },
    createOption(query),
  )
}

/* ---------- user_social_status_edit  (/user/social/status/edit) ---------- */

/* 自动转换自 api-enhanced module/user_social_status_edit.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 用户状态 - 编辑

export const user_social_status_edit = (query: NcmQuery, request: NcmRequestFn) => {
  return request(
    `/api/social/user/status/edit`,
    {
      content: JSON.stringify({
        type: query.type,
        iconUrl: query.iconUrl,
        content: query.content,
        actionUrl: query.actionUrl,
      }),
    },
    createOption(query),
  )
}

/* ---------- user_social_status_rcmd  (/user/social/status/rcmd) ---------- */

/* 自动转换自 api-enhanced module/user_social_status_rcmd.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 用户状态 - 相同状态的用户

export const user_social_status_rcmd = (query: NcmQuery, request: NcmRequestFn) => {
  return request(`/api/social/user/status/rcmd`, {}, createOption(query))
}

/* ---------- user_social_status_support  (/user/social/status/support) ---------- */

/* 自动转换自 api-enhanced module/user_social_status_support.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 用户状态 - 支持设置的状态

export const user_social_status_support = (query: NcmQuery, request: NcmRequestFn) => {
  return request(`/api/social/user/status/support`, {}, createOption(query))
}

/* ---------- user_subcount  (/user/subcount) ---------- */

/* 自动转换自 api-enhanced module/user_subcount.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 收藏计数

export const user_subcount = (query: NcmQuery, request: NcmRequestFn) => {
  return request(`/api/subcount`, {}, createOption(query, 'weapi'))
}

/* ---------- user_update  (/user/update) ---------- */

/* 自动转换自 api-enhanced module/user_update.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 编辑用户信息

export const user_update = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    // avatarImgId: '0',
    birthday: query.birthday,
    city: query.city,
    gender: query.gender,
    nickname: query.nickname,
    province: query.province,
    signature: query.signature,
  }
  return request(`/api/user/profile/update`, data, createOption(query))
}
