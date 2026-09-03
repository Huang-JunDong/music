import type { NcmQuery, NcmRequestFn } from '../types';
/* song.ts — 功能家族合并文件（44 个接口，由 439 个独立模块合并生成） */
/* ---------- audio_match  (/audio/match) ---------- */
/* 自动转换自 api-enhanced module/audio_match.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

import axios from "../axios-compat";
import { createOption } from "../option";
import { APP_CONF } from "../config";
import type { NcmModule, NcmResponse } from "../types";
import { buildPlv, buildPld, buildRecords, extractContext, parseCookie, buildCookieStr, buildMetaJson, doUpload } from "../ncbl";
import { cookieToJson } from "../utils";
import { logger } from "../logger";
import { matchID } from "../unblock";

export const audio_match = async (query: NcmQuery, request: NcmRequestFn) => {
  const res = await axios.request({
    method: 'get',
    url: `https://interface.music.163.com/api/music/audio/match?sessionId=0123456789abcdef&algorithmCode=shazam_v2&duration=${
      query.duration
    }&rawdata=${encodeURIComponent(query.audioFP)}&times=1&decrypt=1`,
    data: null,
  })
  return {
    status: 200,
    body: {
      code: 200,
      data: res.data.data,
    },
  }
}

/* ---------- check_music  (/check/music) ---------- */

/* 自动转换自 api-enhanced module/check_music.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌曲可用性

export const check_music = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    ids: '[' + parseInt(query.id) + ']',
    br: parseInt(query.br || 999000),
  }
  return request(
    `/api/song/enhance/player/url`,
    data,
    createOption(query, 'weapi'),
  ).then((response) => {
    let playable = false
    if (response.body.code == 200) {
      if (response.body.data[0].code == 200) {
        playable = true
      }
    }
    if (playable) {
      response.body = { code: 200, success: true, message: 'ok' }
      return response
    } else {
      // response.status = 404
      response.body = { code: 200, success: false, message: '亲爱的,暂无版权' }
      return response
      // return Promise.reject(response)
    }
  })
}

/* ---------- like  (/like) ---------- */

/* 自动转换自 api-enhanced module/like.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 红心与取消红心歌曲

export const like = (query: NcmQuery, request: NcmRequestFn) => {
  query.like = query.like == 'false' ? false : true
  const data = {
    alg: 'itembased',
    trackId: query.id,
    like: query.like,
    time: '3',
  }
  return request(`/api/radio/like`, data, createOption(query, 'weapi'))
}

/* ---------- like_v1  (/like/v1) ---------- */

/* 自动转换自 api-enhanced module/like_v1.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 红心与取消红心歌曲- v1

export const like_v1 = (query: NcmQuery, request: NcmRequestFn) => {
  query.like = query.like == 'false' ? false : true
  const data = {
    alg: 'itembased',
    trackId: query.id,
    like: query.like,
    time: '3',
  }
  return request(`/api/v1/radio/like`, data, createOption(query, 'xeapi', 'v3'))
}

/* ---------- likelist  (/likelist) ---------- */

/* 自动转换自 api-enhanced module/likelist.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 喜欢的歌曲(无序)

export const likelist = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    uid: query.uid,
  }
  return request(`/api/song/like/get`, data, createOption(query))
}

/* ---------- lyric  (/lyric) ---------- */

/* 自动转换自 api-enhanced module/lyric.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌词

export const lyric = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
    tv: -1,
    lv: -1,
    rv: -1,
    kv: -1,
    _nmclfl: 1,
  }
  return request(`/api/song/lyric`, data, createOption(query))
}

/* ---------- lyric_new  (/lyric/new) ---------- */

/* 自动转换自 api-enhanced module/lyric_new.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 新版歌词 - 包含逐字歌词

export const lyric_new = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
    cp: false,
    tv: 0,
    lv: 0,
    rv: 0,
    kv: 0,
    yv: 0,
    ytv: 0,
    yrv: 0,
  }
  return request(`/api/song/lyric/v1`, data, createOption(query))
}

/* ---------- music_first_listen_info  (/music/first/listen/info) ---------- */

/* 自动转换自 api-enhanced module/music_first_listen_info.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 回忆坐标

export const music_first_listen_info = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    songId: query.id,
  }
  return request(
    `/api/content/activity/music/first/listen/info`,
    data,
    createOption(query),
  )
}

/* ---------- playmode_intelligence_list  (/playmode/intelligence/list) ---------- */

/* 自动转换自 api-enhanced module/playmode_intelligence_list.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 智能播放

export const playmode_intelligence_list = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    songId: query.id,
    type: 'fromPlayOne',
    playlistId: query.pid,
    startMusicId: query.sid || query.id,
    count: query.count || 1,
  }
  return request(`/api/playmode/intelligence/list`, data, createOption(query))
}

/* ---------- playmode_song_vector  (/playmode/song/vector) ---------- */

/* 自动转换自 api-enhanced module/playmode_song_vector.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 云随机播放

export const playmode_song_vector = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    ids: query.ids,
  }
  return request(`/api/playmode/song/vector/get`, data, createOption(query))
}

/* ---------- relay_play_state_submit  (/relay/play/state/submit) ---------- */

/* 自动转换自 api-enhanced module/relay_play_state_submit.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 提交歌曲播放状态

const relay_play_state_submit__generateSessionId = () =>

  Array.from(
    { length: 12 },
    () =>
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)],
  ).join('')

export const relay_play_state_submit = (query: NcmQuery, request: NcmRequestFn) => {
  const {
    id,
    sessionId,
    progress = 0,
    playMode = 'list_loop',
    type = 'song',
  } = query

  if (!id) {
    return Promise.reject({
      status: 400,
      body: {
        code: 400,
        msg: '缺少必要参数：id',
      },
    })
  }

  const playStateSubmitReq = JSON.stringify({
    resource: {
      id: String(id),
      type: type,
    },
    progress: Number(progress) || 0,
    sessionId: sessionId || relay_play_state_submit__generateSessionId(),
    playMode: playMode,
  })

  const data = {
    playStateSubmitReq: playStateSubmitReq,
  }

  return request(
    '/api/relay/play/state/submit',
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- scrobble  (/scrobble) ---------- */

/* 自动转换自 api-enhanced module/scrobble.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 听歌打卡

const scrobble__DOMAIN = APP_CONF.clDomian

export const scrobble = async (query: NcmQuery, request: NcmRequestFn) => {
  // 注入 os=osx 的 cookie
  let cookie = query.cookie || ''
  if (typeof cookie === 'object') {
    cookie = Object.assign({ os: 'osx' }, cookie)
  } else if (typeof cookie === 'string') {
    if (cookie.indexOf('os=') > -1) {
      cookie = cookie.replace(/os=[^;]+/g, 'os=osx')
    } else {
      cookie = cookie + '; os=osx'
    }
  } else {
    cookie = 'os=osx'
  }
  query.cookie = cookie

  // 1) startplay → 进「最近播放」
  const startplayData = {
    logs: JSON.stringify([
      {
        action: 'startplay',
        json: {
          id: query.id,
          type: 'song',
          mainsite: '1',
          mainsiteWeb: '1',
          content: `id=${query.sourceid}`,
        },
      },
    ]),
  }

  // 2) play → 涨「听歌排行」计数
  const playData = {
    logs: JSON.stringify([
      {
        action: 'play',
        json: {
          download: 0,
          end: 'playend',
          id: query.id,
          sourceId: query.sourceid,
          time: query.time,
          type: 'song',
          wifi: 0,
          source: 'list',
          mainsite: '1',
          mainsiteWeb: '1',
          content: `id=${query.sourceid}`,
        },
      },
    ]),
  }

  const option = createOption(query, 'eapi')
  option.domain = scrobble__DOMAIN

  // 发送两次请求
  const res1 = await request(`/api/feedback/weblog`, startplayData, option)
  const res2 = await request(`/api/feedback/weblog`, playData, option)

  return {
    status: 200,
    body: {
      code: 200,
      data: 'success',
      details: {
        startplay: res1.body,
        play: res2.body,
      },
    },
  }
}

/* ---------- scrobble_v1  (/scrobble/v1) ---------- */

/** 听歌打卡 NCBL 加密版 — 对齐 api-enhanced module/scrobble_v1.js（仿桌面客户端 PLV/PLD 上报） */

const scrobble_v1__handler: NcmModule = async (query: NcmQuery) => {
  // --- 参数校验 ---
  const songId = Number(query.id);
  if (!songId || isNaN(songId)) {
    return { status: 400, body: { code: 400, msg: "缺少有效的 id (歌曲ID)" } };
  }
  const playTime = Number(query.time);
  if (isNaN(playTime) || playTime <= 0) {
    return { status: 400, body: { code: 400, msg: "缺少有效的 time (播放时长)" } };
  }
  const totalTime = Number(query.total) || playTime;
  const sourceId = String(query.sourceid || query.sourceId || "");
  const sourceName = query.source || "list";

  // --- 解析认证上下文 ---
  const rawCookie = query.cookie || "";
  const cookieObj = parseCookie(rawCookie);
  cookieObj.os = "pc";
  const ctx = extractContext(cookieObj);

  if (!ctx.auth.token && rawCookie) {
    const parsed = typeof rawCookie === "string" ? parseCookie(rawCookie) : rawCookie;
    ctx.auth.token = parsed.MUSIC_U || "";
  }

  if (!ctx.auth.token) {
    return { status: 401, body: { code: 401, msg: "缺少 MUSIC_U 鉴权令牌" } };
  }

  // --- 构建歌曲和来源 ---
  const song = {
    id: songId,
    name: query.name || "",
    artist: query.artist || "",
    bitrate: Number(query.bitrate) || 320,
    level: query.level || "exhigh",
    vip: query.vip === "true" || query.vip === true,
    time: totalTime,
  };
  const source = {
    id: sourceId || String(songId),
    type: "track",
    name: sourceName,
  };

  const metaJson = buildMetaJson(ctx);
  const cookieStr = buildCookieStr(ctx);

  const ts = Math.floor(Date.now() / 1000);
  const played = Math.min(playTime, totalTime);

  const plvBody = buildRecords([
    { time: ts, action: "_plv", data: buildPlv(ctx, song, source) },
  ]);
  const pldBody = buildRecords([
    { time: ts, action: "_pld", data: buildPld(ctx, song, source, played) },
  ]);

  try {
    const plv = await doUpload(ctx, metaJson, plvBody, cookieStr, "PLV");
    if (!plv.success) {
      const rateMsg =
        plv.respBody?.data?.rate != null ? ` (rate=${plv.respBody.data.rate})` : "";
      return {
        status: 200,
        body: { code: plv.respBody?.code || -1, msg: `PLV 上报失败${rateMsg}`, details: plv.respBody },
      };
    }

    const pld = await doUpload(ctx, metaJson, pldBody, cookieStr, "PLD");
    if (!pld.success) {
      return {
        status: 200,
        body: {
          code: pld.respBody?.code || -1,
          msg: "PLV 成功但 PLD 失败",
          details: { plv: plv.respBody, pld: pld.respBody },
        },
      };
    }

    return {
      status: 200,
      body: {
        code: 200,
        data: "scrobble_v1 上报成功",
        details: {
          plv: { fileName: plv.fileName, payloadSize: plv.payload.length },
          pld: { fileName: pld.fileName, payloadSize: pld.payload.length },
        },
      },
    };
  } catch (err) {
    return {
      status: 502,
      body: { code: 502, msg: `请求异常: ${(err as Error).message || err}` },
    } as NcmResponse;
  }
};

export const scrobble_v1 = scrobble_v1__handler;

/* ---------- simi_song  (/simi/song) ---------- */

/* 自动转换自 api-enhanced module/simi_song.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 相似歌曲

export const simi_song = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    songid: query.id,
    limit: query.limit || 50,
    offset: query.offset || 0,
  }
  return request(
    `/api/v1/discovery/simiSong`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- song_chorus  (/song/chorus) ---------- */

/* 自动转换自 api-enhanced module/song_chorus.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 副歌时间

export const song_chorus = (query: NcmQuery, request: NcmRequestFn) => {
  return request(
    `/api/song/chorus`,
    {
      ids: JSON.stringify([query.id]),
    },
    createOption(query),
  )
}

/* ---------- song_cloud_download  (/song/cloud/download) ---------- */

/* 自动转换自 api-enhanced module/song_cloud_download.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 从云盘获取歌曲下载链接

export const song_cloud_download = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    songId: query.id,
  }
  return request(`/api/cloud/dowonload`, data, createOption(query, 'eapi'))
}

/* ---------- song_copyright_rcmd  (/song/copyright/rcmd) ---------- */

/* 自动转换自 api-enhanced module/song_copyright_rcmd.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 灰色歌曲的其他版本推荐

export const song_copyright_rcmd = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    songid: query.songid || query.id,
  }
  return request(`/api/song/copyright/rcmd`, data, createOption(query, 'eapi'))
}

/* ---------- song_creators  (/song/creators) ---------- */

/* 自动转换自 api-enhanced module/song_creators.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌曲创作者信息

export const song_creators = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    songId: query.id,
  }
  return request(`/api/song/creators`, data, createOption(query))
}

/* ---------- song_detail  (/song/detail) ---------- */

/* 自动转换自 api-enhanced module/song_detail.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌曲详情

export const song_detail = (query: NcmQuery, request: NcmRequestFn) => {
  // 歌曲数量不要超过1000
  query.ids = query.ids.split(/\s*,\s*/)
  const data = {
    c: '[' + query.ids.map((id: string) => '{"id":' + id + '}').join(',') + ']',
  }
  return request(`/api/v3/song/detail`, data, createOption(query, 'weapi'))
}

/* ---------- song_downlist  (/song/downlist) ---------- */

/* 自动转换自 api-enhanced module/song_downlist.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 会员下载歌曲记录

export const song_downlist = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || '20',
    offset: query.offset || '0',
    total: 'true',
  }
  return request(`/api/member/song/downlist`, data, createOption(query))
}

/* ---------- song_download_url  (/song/download/url) ---------- */

/* 自动转换自 api-enhanced module/song_download_url.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 获取客户端歌曲下载链接

export const song_download_url = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
    br: parseInt(query.br || 999000),
  }
  return request(`/api/song/enhance/download/url`, data, createOption(query))
}

/* ---------- song_download_url_v1  (/song/download/url/v1) ---------- */

/* 自动转换自 api-enhanced module/song_download_url_v1.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 获取客户端歌曲下载链接 - v1

// 此版本不再采用 br 作为音质区分的标准

// 而是采用 standard, exhigh, lossless, hires, jyeffect(高清臻音), vivid(臻音全景声), jymaster(超清母带), sky(沉浸环绕声) 进行音质判断

export const song_download_url_v1 = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
    immerseType: 'c51',
    level: query.level,
  }
  const options = createOption(query)
  if (query.level === 'vivid') {
    const cookie = options.cookie
    options.cookie = {
      ...(typeof cookie === 'string' ? cookieToJson(cookie) : cookie),
      os: 'android',
      appver: '9.5.61',
    }
  }
  return request(`/api/song/enhance/download/url/v1`, data, options)
}

/* ---------- song_dynamic_cover  (/song/dynamic/cover) ---------- */

/* 自动转换自 api-enhanced module/song_dynamic_cover.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌曲动态封面

export const song_dynamic_cover = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    songId: query.id,
  }
  return request(`/api/songplay/dynamic-cover`, data, createOption(query))
}

/* ---------- song_like  (/song/like) ---------- */

/* 自动转换自 api-enhanced module/song_like.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 喜欢歌曲

export const song_like = (query: NcmQuery, request: NcmRequestFn) => {
  const like = query.like !== 'false'
  const data = {
    trackId: query.id,
    userid: query.uid,
    like: like,
  }
  return request(`/api/song/like`, data, createOption(query))
}

/* ---------- song_like_check  (/song/like/check) ---------- */

/* 自动转换自 api-enhanced module/song_like_check.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌曲是否喜爱

export const song_like_check = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    trackIds: query.ids,
  }
  return request(`/api/song/like/check`, data, createOption(query))
}

/* ---------- song_lyrics_mark  (/song/lyrics/mark) ---------- */

/* 自动转换自 api-enhanced module/song_lyrics_mark.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌词摘录 - 歌词摘录信息

export const song_lyrics_mark = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    songId: query.id,
  }
  return request(`/api/song/play/lyrics/mark/song`, data, createOption(query))
}

/* ---------- song_lyrics_mark_add  (/song/lyrics/mark/add) ---------- */

/* 自动转换自 api-enhanced module/song_lyrics_mark_add.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌词摘录 - 添加/修改摘录歌词

export const song_lyrics_mark_add = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    songId: query.id,
    markId: query.markId || '',
    data: query.data || '[]',
    // "[{\"translateType\":1,\"startTimeStamp\":800,\"translateLyricsText\":\"让我逃走吧、声音已经枯萎\",\"originalLyricsText\":\"逃がしてくれって声を枯らした\"},{\"translateType\":1,\"startTimeStamp\":4040,\"translateLyricsText\":\"我的愿望究竟会实现吗\",\"originalLyricsText\":\"あたしの願いなど叶うでしょうか\"}]"
  }
  return request(`/api/song/play/lyrics/mark/add`, data, createOption(query))
}

/* ---------- song_lyrics_mark_del  (/song/lyrics/mark/del) ---------- */

/* 自动转换自 api-enhanced module/song_lyrics_mark_del.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌词摘录 - 删除摘录歌词

export const song_lyrics_mark_del = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    markIds: query.id,
  }
  return request(`/api/song/play/lyrics/mark/del`, data, createOption(query))
}

/* ---------- song_lyrics_mark_user_page  (/song/lyrics/mark/user/page) ---------- */

/* 自动转换自 api-enhanced module/song_lyrics_mark_user_page.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌词摘录 - 我的歌词本

export const song_lyrics_mark_user_page = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 10,
    offset: query.offset || 0,
  }
  return request(
    `/api/song/play/lyrics/mark/user/page`,
    data,
    createOption(query),
  )
}

/* ---------- song_monthdownlist  (/song/monthdownlist) ---------- */

/* 自动转换自 api-enhanced module/song_monthdownlist.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 会员本月下载歌曲记录

export const song_monthdownlist = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || '20',
    offset: query.offset || '0',
    total: 'true',
  }
  return request(`/api/member/song/monthdownlist`, data, createOption(query))
}

/* ---------- song_music_detail  (/song/music/detail) ---------- */

/* 自动转换自 api-enhanced module/song_music_detail.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌曲音质详情

export const song_music_detail = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    songId: query.id,
  }
  return request(`/api/song/music/detail/get`, data, createOption(query))
}

/* ---------- song_order_update  (/song/order/update) ---------- */

/* 自动转换自 api-enhanced module/song_order_update.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 更新歌曲顺序

export const song_order_update = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    pid: query.pid,
    trackIds: query.ids,
    op: 'update',
  }

  return request(`/api/playlist/manipulate/tracks`, data, createOption(query))
}

/* ---------- song_purchased  (/song/purchased) ---------- */

/* 自动转换自 api-enhanced module/song_purchased.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 已购单曲

export const song_purchased = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 20,
    offset: query.offset || 0,
  }
  return request(
    `/api/single/mybought/song/list`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- song_red_count  (/song/red/count) ---------- */

/* 自动转换自 api-enhanced module/song_red_count.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌曲红心数量

export const song_red_count = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    songId: query.id,
  }
  return request(`/api/song/red/count`, data, createOption(query))
}

/* ---------- song_simi_get  (/song/simi/get) ---------- */

/* 自动转换自 api-enhanced module/song_simi_get.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 插播相似歌曲

export const song_simi_get = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    positionCode: 'toolBarRcmdSong',
    resourceId: query.id,
    resourceType: 'song',
  }
  return request(
    `/api/link/position/show/resource`,
    data,
    createOption(query, 'eapi'),
  )
}

/* ---------- song_singledownlist  (/song/singledownlist) ---------- */

/* 自动转换自 api-enhanced module/song_singledownlist.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 已购买单曲

export const song_singledownlist = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || '20',
    offset: query.offset || '0',
    total: 'true',
  }
  return request(`/api/member/song/singledownlist`, data, createOption(query))
}

/* ---------- song_url  (/song/url) ---------- */

/* 自动转换自 api-enhanced module/song_url.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌曲链接

export const song_url = async (query: NcmQuery, request: NcmRequestFn) => {
  const ids = String(query.id).split(',')
  const data = {
    ids: JSON.stringify(ids),
    br: parseInt(query.br || 999000),
  }
  const res = await request(
    `/api/song/enhance/player/url`,
    data,
    createOption(query),
  )
  // 根据id排序
  const result = res.body.data
  result.sort((a: any, b: any) => {
    return ids.indexOf(String(a.id)) - ids.indexOf(String(b.id))
  })
  return {
    status: 200,
    body: {
      code: 200,
      data: result,
    },
  }
}

/* ---------- song_url_match  (/song/url/match) ---------- */

/* 自动转换自 api-enhanced module/song_url_match.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 网易云歌曲解灰(适配SPlayer的UNM-Server)

// 支持qq音乐、酷狗音乐、酷我音乐、咪咕音乐、第三方网易云API等等(来自GD音乐台)

export const song_url_match = async (query: NcmQuery, request: NcmRequestFn) => {
  try {
    const result = await matchID(query.id, query.source)
    const proxy = process.env.PROXY_URL
    logger.info('开始解灰', query.id, result)
    const useProxy = process.env.ENABLE_PROXY || 'false'
    if (result.data.url && result.data.url.includes('kuwo')) {
      result.proxyUrl =
        useProxy === 'true' ? proxy + result.data.url : result.data.url
    }
    return {
      status: 200,
      body: {
        code: 200,
        data: result.data.url,
        proxyUrl: result.proxyUrl || '',
      },
    }
  } catch (e: any) {
    return {
      status: 500,
      body: {
        code: 500,
        msg: e.message || 'unblock error',
        data: [],
      },
    }
  }
}

/* ---------- song_url_ncmget  (/song/url/ncmget) ---------- */

/* 自动转换自 api-enhanced module/song_url_ncmget.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 夹带私货的东西就不要放在这里了

export const song_url_ncmget = async (query: NcmQuery, request: NcmRequestFn) => {
  return { status: 200, body: { code: 200, data: [] } }
}

/* ---------- song_url_v1  (/song/url/v1) ---------- */

/* 自动转换自 api-enhanced module/song_url_v1.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌曲链接 - v1

// 此版本不再采用 br 作为音质区分的标准

// 而是采用 standard, exhigh, lossless, hires, jyeffect(高清臻音), vivid(臻音全景声), jymaster(超清母带), sky(沉浸环绕声) 进行音质判断

// 当unblock为true时, 会尝试使用unblockmusic-utils进行解锁, 同时音质设置不会生效, 但仍然为必须传入参数

// 当level为sky时, 可通过 immerseType 选择沉浸声类型, 支持 c512(新版c51类型)、ste2(新版环绕立体声类型)、aac2(新版aac类型)、c51(c51类型)、ste(环绕立体声类型)、aac(aac类型), 默认为 c51

export const song_url_v1 = async (query: NcmQuery, request: NcmRequestFn) => {
  const data: Record<string, any> = {
    ids: '[' + query.id + ']',
    level: query.level,
    encodeType: 'flac',
  }
  const options = createOption(query, 'xeapi')
  if (query.unblock === 'true') {
    try {
      const result = await matchID(query.id, query.source)
      logger.info('Starting unblock(uses modules unblock):', query.id, result)
      const useProxy = process.env.ENABLE_PROXY || 'false'
      let proxyUrl = ''
      if (result.data.url && result.data.url.includes('kuwo')) {
        proxyUrl =
          useProxy === 'true' && process.env.PROXY_URL
            ? process.env.PROXY_URL + result.data.url
            : result.data.url
      }
      return {
        status: 200,
        body: {
          code: 200,
          msg: 'Warning: Customizing unblock sources is not supported on this endpoint. Please use `/song/url/match` instead.',
          data: [
            {
              id: Number(query.id),
              url: result.data.url,
              type: 'flac',
              level: query.level,
              freeTrialInfo: 'null',
              fee: 0,
              proxyUrl: proxyUrl || '',
            },
          ],
        },
        cookie: [],
      }
    } catch (e) {
      console.error('Error in unblocking music:', e)
    }
  }
  if (data.level == 'sky') {
    data.immerseType = query.immerseType || 'c51'
  }
  if (data.level == 'vivid') {
    data.encodeType = 'mp3'
    const cookie = options.cookie
    options.cookie = {
      ...(typeof cookie === 'string' ? cookieToJson(cookie) : cookie),
      os: 'android',
      appver: '9.5.61',
    }
  }
  return request(`/api/song/enhance/player/url/v1`, data, options)
}

/* ---------- song_url_v1_302  (/song/url/v1/302) ---------- */

/* 自动转换自 api-enhanced module/song_url_v1_302.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 获取客户端歌曲下载链接 - v1

// 此版本不再采用 br 作为音质区分的标准

// 而是采用 standard, exhigh, lossless, hires, jyeffect(高清臻音), vivid(臻音全景声), jymaster(超清母带), sky(沉浸环绕声) 进行音质判断

export const song_url_v1_302 = async (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
    immerseType: 'c51',
    level: query.level,
  }
  const options = createOption(query)
  if (query.level === 'vivid') {
    const cookie = options.cookie
    options.cookie = {
      ...(typeof cookie === 'string' ? cookieToJson(cookie) : cookie),
      os: 'android',
      appver: '9.5.61',
    }
  }
  const response = await request(
    `/api/song/enhance/download/url/v1`,
    data,
    options,
  )
  let url = response?.body?.data?.url || response?.body?.data?.[0]?.url

  if (!url) {
    const fallbackData: Record<string, any> = {
      ids: `[${query.id}]`,
      level: query.level,
      encodeType: 'flac',
    }
    if (query.level === 'sky') {
      fallbackData.immerseType = 'c51'
    }
    if (query.level === 'vivid') {
      fallbackData.encodeType = 'mp3'
    }
    const fallback = await request(
      `/api/song/enhance/player/url/v1`,
      fallbackData,
      options,
    )
    url = fallback?.body?.data?.[0]?.url

    if (!url) {
      return fallback
    }

    return {
      status: 302,
      body: '',
      cookie: fallback.cookie || [],
      redirectUrl: url,
    }
  }

  return {
    status: 302,
    body: '',
    cookie: response.cookie || [],
    redirectUrl: url,
  }
}

/* ---------- song_wiki_info  (/song/wiki/info) ---------- */

/* 自动转换自 api-enhanced module/song_wiki_info.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌曲百科

export const song_wiki_info = (query: NcmQuery, request: NcmRequestFn) => {
  const extJson = {
    states: {
      playingResource: {
        current: query.id,
        scene: 'songWiki',
      },
    },
  }
  const data = {
    extJson: JSON.stringify(extJson),
    positionCode: 'songWikiMainPosition',
  }
  return request(
    `/api/link/page/parent/relation/construct/info`,
    data,
    createOption(query, 'eapi'),
  )
}

/* ---------- song_wiki_summary  (/song/wiki/summary) ---------- */

/* 自动转换自 api-enhanced module/song_wiki_summary.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 音乐百科基础信息

export const song_wiki_summary = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    songId: query.id,
  }
  return request(`/api/song/play/about/block/page`, data, createOption(query))
}

/* ---------- weblog  (/weblog) ---------- */

/* 自动转换自 api-enhanced module/weblog.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 操作记录

export const weblog = (query: NcmQuery, request: NcmRequestFn) => {
  return request(
    `/api/feedback/weblog`,
    query.data || {},
    createOption(query, 'weapi'),
  )
}
