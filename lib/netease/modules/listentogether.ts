import type { NcmQuery, NcmRequestFn } from '../types';
/* listentogether.ts — 功能家族合并文件（9 个接口，由 439 个独立模块合并生成） */
/* ---------- listentogether_accept  (/listentogether/accept) ---------- */
/* 自动转换自 api-enhanced module/listentogether_accept.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

import { createOption } from "../option";

export const listentogether_accept = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    refer: 'inbox_invite',
    roomId: query.roomId,
    inviterId: query.inviterId,
  }
  return request(
    `/api/listen/together/play/invitation/accept`,
    data,
    createOption(query),
  )
}

/* ---------- listentogether_end  (/listentogether/end) ---------- */

/* 自动转换自 api-enhanced module/listentogether_end.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 一起听 结束房间

export const listentogether_end = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    roomId: query.roomId,
  }
  return request(`/api/listen/together/end/v2`, data, createOption(query))
}

/* ---------- listentogether_heatbeat  (/listentogether/heatbeat) ---------- */

/* 自动转换自 api-enhanced module/listentogether_heatbeat.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 一起听 发送心跳

export const listentogether_heatbeat = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    roomId: query.roomId,
    songId: query.songId,
    playStatus: query.playStatus,
    progress: query.progress,
  }
  return request(`/api/listen/together/heartbeat`, data, createOption(query))
}

/* ---------- listentogether_play_command  (/listentogether/play/command) ---------- */

/* 自动转换自 api-enhanced module/listentogether_play_command.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 一起听 发送播放状态

export const listentogether_play_command = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    roomId: query.roomId,
    commandInfo: JSON.stringify({
      commandType: query.commandType,
      progress: query.progress || 0,
      playStatus: query.playStatus,
      formerSongId: query.formerSongId,
      targetSongId: query.targetSongId,
      clientSeq: query.clientSeq,
    }),
  }
  return request(
    `/api/listen/together/play/command/report`,
    data,
    createOption(query),
  )
}

/* ---------- listentogether_room_check  (/listentogether/room/check) ---------- */

/* 自动转换自 api-enhanced module/listentogether_room_check.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 一起听 房间情况

export const listentogether_room_check = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    roomId: query.roomId,
  }
  return request(`/api/listen/together/room/check`, data, createOption(query))
}

/* ---------- listentogether_room_create  (/listentogether/room/create) ---------- */

/* 自动转换自 api-enhanced module/listentogether_room_create.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 一起听创建房间

export const listentogether_room_create = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    refer: 'songplay_more',
  }
  return request(`/api/listen/together/room/create`, data, createOption(query))
}

/* ---------- listentogether_status  (/listentogether/status) ---------- */

/* 自动转换自 api-enhanced module/listentogether_status.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 一起听状态

export const listentogether_status = (query: NcmQuery, request: NcmRequestFn) => {
  return request(
    `/api/listen/together/status/get`,
    {},
    createOption(query, 'weapi'),
  )
}

/* ---------- listentogether_sync_list_command  (/listentogether/sync/list/command) ---------- */

/* 自动转换自 api-enhanced module/listentogether_sync_list_command.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 一起听 更新播放列表

export const listentogether_sync_list_command = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    roomId: query.roomId,
    playlistParam: JSON.stringify({
      commandType: query.commandType,
      version: [
        {
          userId: query.userId,
          version: query.version,
        },
      ],
      anchorSongId: '',
      anchorPosition: -1,
      randomList: query.randomList.split(','),
      displayList: query.displayList.split(','),
    }),
  }
  return request(
    `/api/listen/together/sync/list/command/report`,
    data,
    createOption(query),
  )
}

/* ---------- listentogether_sync_playlist_get  (/listentogether/sync/playlist/get) ---------- */

/* 自动转换自 api-enhanced module/listentogether_sync_playlist_get.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 一起听 当前列表获取

export const listentogether_sync_playlist_get = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    roomId: query.roomId,
  }
  return request(
    `/api/listen/together/sync/playlist/get`,
    data,
    createOption(query),
  )
}
