import type { NcmQuery, NcmRequestFn } from '../types';
/* comment.ts — 功能家族合并文件（19 个接口，由 439 个独立模块合并生成） */
/* ---------- comment  (/comment) ---------- */
/* 自动转换自 api-enhanced module/comment.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */
// 发送与删除评论

import { resourceTypeMap } from "../config";
import { createOption } from "../option";

export const comment = (query: NcmQuery, request: NcmRequestFn) => {
  query.t = ({
    1: 'add',
    0: 'delete',
    2: 'reply',
  } as Record<string | number, string>)[query.t]
  query.type = resourceTypeMap[query.type]
  const data: Record<string, any> = {
    threadId: query.type + query.id,
  }

  if (query.type == 'A_EV_2_') {
    data.threadId = query.threadId
  }
  if (query.t == 'add') data.content = query.content
  else if (query.t == 'delete') data.commentId = query.commentId
  else if (query.t == 'reply') {
    data.commentId = query.commentId
    data.content = query.content
  }
  return request(
    `/api/resource/comments/${query.t}`,
    data,
    createOption(query, 'eapi', 'v2'),
  )
}

/* ---------- comment_add  (/comment/add) ---------- */

/* 自动转换自 api-enhanced module/comment_add.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 发送评论

export const comment_add = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    threadId: resourceTypeMap[query.type] + query.id,
    content: query.content,
    resourceType: '0',
    expressionPicId: '-1',
    bubbleId: '-1',
  }
  return request(
    `/api/resource/comments/add`,
    data,
    createOption(query, 'xeapi', 'v3'),
  )
}

/* ---------- comment_album  (/comment/album) ---------- */

/* 自动转换自 api-enhanced module/comment_album.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 专辑评论

export const comment_album = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    rid: query.id,
    limit: query.limit || 20,
    offset: query.offset || 0,
    beforeTime: query.before || 0,
  }
  return request(
    `/api/v1/resource/comments/R_AL_3_${query.id}`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- comment_delete  (/comment/delete) ---------- */

/* 自动转换自 api-enhanced module/comment_delete.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 删除评论

export const comment_delete = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    commentId: query.cid,
    threadId: resourceTypeMap[query.type] + query.id,
  }
  return request(
    `/api/resource/comments/delete`,
    data,
    createOption(query, 'xeapi'),
  )
}

/* ---------- comment_dj  (/comment/dj) ---------- */

/* 自动转换自 api-enhanced module/comment_dj.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 电台评论

export const comment_dj = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    rid: query.id,
    limit: query.limit || 20,
    offset: query.offset || 0,
    beforeTime: query.before || 0,
  }
  return request(
    `/api/v1/resource/comments/A_DJ_1_${query.id}`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- comment_event  (/comment/event) ---------- */

/* 自动转换自 api-enhanced module/comment_event.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 获取动态评论

export const comment_event = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 20,
    offset: query.offset || 0,
    beforeTime: query.before || 0,
  }
  return request(
    `/api/v1/resource/comments/${query.threadId}`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- comment_floor  (/comment/floor) ---------- */

/* 自动转换自 api-enhanced module/comment_floor.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const comment_floor = (query: NcmQuery, request: NcmRequestFn) => {
  query.type = resourceTypeMap[query.type]
  const data = {
    parentCommentId: query.parentCommentId,
    threadId: query.type + query.id,
    time: query.time || -1,
    limit: query.limit || 20,
  }
  return request(
    `/api/resource/comment/floor/get`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- comment_hot  (/comment/hot) ---------- */

/* 自动转换自 api-enhanced module/comment_hot.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 热门评论

export const comment_hot = (query: NcmQuery, request: NcmRequestFn) => {
  query.type = resourceTypeMap[query.type]
  const data = {
    rid: query.id,
    limit: query.limit || 20,
    offset: query.offset || 0,
    beforeTime: query.before || 0,
  }
  return request(
    `/api/v1/resource/hotcomments/${query.type}${query.id}`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- comment_hug_list  (/comment/hug/list) ---------- */

/* 自动转换自 api-enhanced module/comment_hug_list.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const comment_hug_list = (query: NcmQuery, request: NcmRequestFn) => {
  query.type = resourceTypeMap[query.type || 0]
  const threadId = query.type + query.sid
  const data = {
    targetUserId: query.uid,
    commentId: query.cid,
    cursor: query.cursor || '-1',
    threadId: threadId,
    pageNo: query.page || 1,
    idCursor: query.idCursor || -1,
    pageSize: query.pageSize || 100,
  }
  return request(
    `/api/v2/resource/comments/hug/list`,
    data,
    createOption(query),
  )
}

/* ---------- comment_info_list  (/comment/info/list) ---------- */

/* 自动转换自 api-enhanced module/comment_info_list.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 评论统计数据

// type: 0=歌曲 1=MV 2=歌单 3=专辑 4=电台节目 5=视频 6=动态 7=电台

// ids: 资源 ID 列表，多个用逗号分隔，如 "123,456"

// 从 resourceTypeMap 的前缀值中提取网易云内部资源类型编号

// 例如 "R_SO_4_" -> "4", "A_DR_14_" -> "14"

const comment_info_list__resourceTypeIdMap = Object.fromEntries(
  Object.entries(resourceTypeMap).map(([key, prefix]) => [
    key,
    prefix.replace(/_$/, '').split('_').pop(),
  ]),
)

export const comment_info_list = (query: NcmQuery, request: NcmRequestFn) => {
  const ids = String(query.ids || query.id || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)

  return request(
    `/api/resource/commentInfo/list`,
    {
      resourceType: comment_info_list__resourceTypeIdMap[String(query.type || 0)],
      resourceIds: JSON.stringify(ids),
    },
    createOption(query, 'weapi'),
  )
}

/* ---------- comment_like  (/comment/like) ---------- */

/* 自动转换自 api-enhanced module/comment_like.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 点赞与取消点赞评论

export const comment_like = (query: NcmQuery, request: NcmRequestFn) => {
  query.t = query.t == 1 ? 'like' : 'unlike'
  query.type = resourceTypeMap[query.type]
  const data = {
    threadId: query.type + query.id,
    commentId: query.cid,
  }
  if (query.type == 'A_EV_2_') {
    data.threadId = query.threadId
  }
  return request(
    `/api/v1/comment/${query.t}`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- comment_music  (/comment/music) ---------- */

/* 自动转换自 api-enhanced module/comment_music.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌曲评论

export const comment_music = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    rid: query.id,
    limit: query.limit || 20,
    offset: query.offset || 0,
    beforeTime: query.before || 0,
  }
  return request(
    `/api/v1/resource/comments/R_SO_4_${query.id}`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- comment_mv  (/comment/mv) ---------- */

/* 自动转换自 api-enhanced module/comment_mv.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// MV评论

export const comment_mv = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    rid: query.id,
    limit: query.limit || 20,
    offset: query.offset || 0,
    beforeTime: query.before || 0,
  }
  return request(
    `/api/v1/resource/comments/R_MV_5_${query.id}`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- comment_new  (/comment/new) ---------- */

/* 自动转换自 api-enhanced module/comment_new.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 评论

export const comment_new = (query: NcmQuery, request: NcmRequestFn) => {
  query.type = resourceTypeMap[query.type]
  const threadId = query.type + query.id
  const pageSize = query.pageSize || 20
  const pageNo = query.pageNo || 1
  let sortType = Number(query.sortType) || 99
  if (sortType === 1) {
    sortType = 99
  }
  let cursor = ''
  switch (sortType) {
    case 99:
      cursor = String((pageNo - 1) * pageSize)
      break
    case 2:
      cursor = 'normalHot#' + (pageNo - 1) * pageSize
      break
    case 3:
      cursor = query.cursor || '0'
      break
    default:
      break
  }
  const data = {
    threadId: threadId,
    pageNo,
    showInner: query.showInner || true,
    pageSize,
    cursor: cursor,
    sortType: sortType, //99:按推荐排序,2:按热度排序,3:按时间排序
  }
  return request(`/api/v2/resource/comments`, data, createOption(query))
}

/* ---------- comment_playlist  (/comment/playlist) ---------- */

/* 自动转换自 api-enhanced module/comment_playlist.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌单评论

export const comment_playlist = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    rid: query.id,
    limit: query.limit || 20,
    offset: query.offset || 0,
    beforeTime: query.before || 0,
  }
  return request(
    `/api/v1/resource/comments/A_PL_0_${query.id}`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- comment_reply  (/comment/reply) ---------- */

/* 自动转换自 api-enhanced module/comment_reply.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 发送评论

export const comment_reply = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    threadId: resourceTypeMap[query.type] + query.id,
    commentId: query.cid,
    content: query.content,
    resourceType: '0',
  }
  return request(
    `/api/v1/resource/comments/reply`,
    data,
    createOption(query, 'xeapi', 'v3'),
  )
}

/* ---------- comment_report  (/comment/report) ---------- */

/* 自动转换自 api-enhanced module/comment_report.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 举报评论

export const comment_report = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    threadId: 'R_SO_4_' + query.id,
    commentId: query.cid,
    reason: query.reason,
  }
  return request(`/api/report/reportcomment`, data, createOption(query))
}

/* ---------- comment_video  (/comment/video) ---------- */

/* 自动转换自 api-enhanced module/comment_video.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 视频评论

export const comment_video = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    rid: query.id,
    limit: query.limit || 20,
    offset: query.offset || 0,
    beforeTime: query.before || 0,
  }
  return request(
    `/api/v1/resource/comments/R_VI_62_${query.id}`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- hug_comment  (/hug/comment) ---------- */

/* 自动转换自 api-enhanced module/hug_comment.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const hug_comment = (query: NcmQuery, request: NcmRequestFn) => {
  query.type = resourceTypeMap[query.type || 0]
  const threadId = query.type + query.sid
  const data = {
    targetUserId: query.uid,
    commentId: query.cid,
    threadId: threadId,
  }
  return request(
    `/api/v2/resource/comments/hug/listener`,
    data,
    createOption(query),
  )
}
