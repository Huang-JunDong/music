import type { NcmQuery, NcmRequestFn } from '../types';
/* playlist.ts — 功能家族合并文件（30 个接口，由 439 个独立模块合并生成） */
/* ---------- playlist_category_list  (/playlist/category/list) ---------- */
/* 自动转换自 api-enhanced module/playlist_category_list.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */
// 歌单分类列表

import { createOption } from "../option";
import uploadPlugin from "../plugins/upload";
import { APP_CONF } from "../config";
import { logger } from "../logger";
import axios from "../axios-compat";

export const playlist_category_list = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    cat: query.cat || '全部',
    limit: query.limit || 24,
    newStyle: true,
  }
  return request(`/api/playlist/category/list`, data, createOption(query))
}

/* ---------- playlist_catlist  (/playlist/catlist) ---------- */

/* 自动转换自 api-enhanced module/playlist_catlist.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 全部歌单分类

export const playlist_catlist = (query: NcmQuery, request: NcmRequestFn) => {
  return request(`/api/playlist/catalogue`, {}, createOption(query, 'eapi'))
}

/* ---------- playlist_cover_update  (/playlist/cover/update) ---------- */

/* 自动转换自 api-enhanced module/playlist_cover_update.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const playlist_cover_update = async (query: NcmQuery, request: NcmRequestFn) => {
  if (!query.imgFile) {
    return {
      status: 400,
      body: {
        code: 400,
        msg: 'imgFile is required',
      },
    }
  }
  const uploadInfo = await uploadPlugin(query, request)
  const res = await request(
    `/api/playlist/cover/update`,
    {
      id: query.id,
      coverImgId: uploadInfo.imgId,
    },
    createOption(query, 'weapi'),
  )
  return {
    status: 200,
    body: {
      code: 200,
      data: {
        ...uploadInfo,
        ...res.body,
      },
    },
  }
}

/* ---------- playlist_create  (/playlist/create) ---------- */

/* 自动转换自 api-enhanced module/playlist_create.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 创建歌单

export const playlist_create = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    name: query.name,
    privacy: query.privacy || '0', // 0 普通歌单, 10 隐私歌单
    type: query.type || 'NORMAL', // 默认 NORMAL, VIDEO 视频歌单, SHARED 共享歌单
  }
  return request(`/api/playlist/create`, data, createOption(query, 'weapi'))
}

/* ---------- playlist_delete  (/playlist/delete) ---------- */

/* 自动转换自 api-enhanced module/playlist_delete.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 删除歌单

export const playlist_delete = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    ids: '[' + query.id + ']',
  }
  return request(`/api/playlist/remove`, data, createOption(query, 'weapi'))
}

/* ---------- playlist_desc_update  (/playlist/desc/update) ---------- */

/* 自动转换自 api-enhanced module/playlist_desc_update.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 更新歌单描述

export const playlist_desc_update = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
    desc: query.desc,
  }
  return request(`/api/playlist/desc/update`, data, createOption(query))
}

/* ---------- playlist_detail  (/playlist/detail) ---------- */

/* 自动转换自 api-enhanced module/playlist_detail.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌单详情

export const playlist_detail = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
    n: 100000,
    s: query.s || 8,
  }
  return request(`/api/v6/playlist/detail`, data, createOption(query))
}

/* ---------- playlist_detail_dynamic  (/playlist/detail/dynamic) ---------- */

/* 自动转换自 api-enhanced module/playlist_detail_dynamic.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌单动态信息

export const playlist_detail_dynamic = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
    n: 100000,
    s: query.s || 8,
  }
  return request(`/api/playlist/detail/dynamic`, data, createOption(query))
}

/* ---------- playlist_detail_rcmd_get  (/playlist/detail/rcmd/get) ---------- */

/* 自动转换自 api-enhanced module/playlist_detail_rcmd_get.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 相关歌单推荐

export const playlist_detail_rcmd_get = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    scene: 'playlist_head',
    playlistId: query.id,
    newStyle: 'true',
  }
  return request(`/api/playlist/detail/rcmd/get`, data, createOption(query))
}

/* ---------- playlist_highquality_tags  (/playlist/highquality/tags) ---------- */

/* 自动转换自 api-enhanced module/playlist_highquality_tags.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 精品歌单 tags

export const playlist_highquality_tags = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(
    `/api/playlist/highquality/tags`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- playlist_hot  (/playlist/hot) ---------- */

/* 自动转换自 api-enhanced module/playlist_hot.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 热门歌单分类

export const playlist_hot = (query: NcmQuery, request: NcmRequestFn) => {
  return request(`/api/playlist/hottags`, {}, createOption(query, 'weapi'))
}

/* ---------- playlist_import_name_task_create  (/playlist/import/name/task/create) ---------- */

/* 自动转换自 api-enhanced module/playlist_import_name_task_create.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌单导入 - 元数据/文字/链接导入

export const playlist_import_name_task_create = (query: NcmQuery, request: NcmRequestFn) => {
  let data: Record<string, any> = {
    importStarPlaylist: query.importStarPlaylist || false, // 导入我喜欢的音乐
  }

  if (query.local) {
    // 元数据导入
    let local = JSON.parse(query.local)
    let multiSongs = JSON.stringify(
      local.map(function (e: any) {
        return {
          songName: e.name,
          artistName: e.artist,
          albumName: e.album,
        }
      }),
    )
    data = {
      ...data,
      multiSongs: multiSongs,
    }
  } else {
    let playlistName = // 歌单名称
      query.playlistName || '导入音乐 '.concat(new Date().toLocaleString())
    let songs = ''
    if (query.text) {
      // 文字导入
      songs = JSON.stringify([
        {
          name: playlistName,
          type: '',
          url: encodeURI('rpc://playlist/import?text='.concat(query.text)),
        },
      ])
    }

    if (query.link) {
      // 链接导入
      let link = JSON.parse(query.link)
      songs = JSON.stringify(
        link.map(function (e: any) {
          return { name: playlistName, type: '', url: encodeURI(e) }
        }),
      )
    }
    data = {
      ...data,
      playlistName: playlistName,
      createBusinessCode: undefined,
      extParam: undefined,
      taskIdForLog: '',
      songs: songs,
    }
  }
  return request(
    `/api/playlist/import/name/task/create`,
    data,
    createOption(query),
  )
}

/* ---------- playlist_import_task_status  (/playlist/import/task/status) ---------- */

/* 自动转换自 api-enhanced module/playlist_import_task_status.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌单导入 - 任务状态

export const playlist_import_task_status = (query: NcmQuery, request: NcmRequestFn) => {
  return request(
    `/api/playlist/import/task/status/v2`,
    {
      taskIds: JSON.stringify([query.id]),
    },
    createOption(query),
  )
}

/* ---------- playlist_mylike  (/playlist/mylike) ---------- */

/* 自动转换自 api-enhanced module/playlist_mylike.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const playlist_mylike = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    time: query.time || '-1',
    limit: query.limit || '12',
  }
  return request(
    `/api/mlog/playlist/mylike/bytime/get`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- playlist_name_update  (/playlist/name/update) ---------- */

/* 自动转换自 api-enhanced module/playlist_name_update.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 更新歌单名

export const playlist_name_update = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
    name: query.name,
  }
  return request(`/api/playlist/update/name`, data, createOption(query))
}

/* ---------- playlist_order_update  (/playlist/order/update) ---------- */

/* 自动转换自 api-enhanced module/playlist_order_update.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 编辑歌单顺序

export const playlist_order_update = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    ids: query.ids,
  }
  return request(
    `/api/playlist/order/update`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- playlist_privacy  (/playlist/privacy) ---------- */

/* 自动转换自 api-enhanced module/playlist_privacy.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 公开隐私歌单

export const playlist_privacy = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
    privacy: 0,
  }
  return request(`/api/playlist/update/privacy`, data, createOption(query))
}

/* ---------- playlist_subscribe  (/playlist/subscribe) ---------- */

/* 自动转换自 api-enhanced module/playlist_subscribe.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 收藏与取消收藏歌单

export const playlist_subscribe = (query: NcmQuery, request: NcmRequestFn) => {
  const path = query.t == 1 ? 'subscribe' : 'unsubscribe'
  const data = {
    id: query.id,
    ...(query.t === 1
      ? { checkToken: query.checkToken || APP_CONF.checkToken }
      : {}),
  }
  query.checkToken = 'v2' // 强制开启checkToken
  return request(`/api/playlist/${path}`, data, createOption(query, 'eapi'))
}

/* ---------- playlist_subscribers  (/playlist/subscribers) ---------- */

/* 自动转换自 api-enhanced module/playlist_subscribers.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌单收藏者

export const playlist_subscribers = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
    limit: query.limit || 20,
    offset: query.offset || 0,
  }
  return request(`/api/playlist/subscribers`, data, createOption(query))
}

/* ---------- playlist_tags_update  (/playlist/tags/update) ---------- */

/* 自动转换自 api-enhanced module/playlist_tags_update.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 更新歌单标签

export const playlist_tags_update = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
    tags: query.tags,
  }
  return request(`/api/playlist/tags/update`, data, createOption(query))
}

/* ---------- playlist_track_add  (/playlist/track/add) ---------- */

/* 自动转换自 api-enhanced module/playlist_track_add.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const playlist_track_add = async (query: NcmQuery, request: NcmRequestFn) => {
  query.ids = query.ids || ''
  const data = {
    id: query.pid,
    tracks: JSON.stringify(
      query.ids.split(',').map((item: string) => {
        return { type: 3, id: item }
      }),
    ),
  }
  logger.info(data)

  return request(`/api/playlist/track/add`, data, createOption(query, 'weapi'))
}

/* ---------- playlist_track_all  (/playlist/track/all) ---------- */

/* 自动转换自 api-enhanced module/playlist_track_all.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 通过传过来的歌单id拿到所有歌曲数据

// 支持传递参数limit来限制获取歌曲的数据数量 例如: /playlist/track/all?id=7044354223&limit=10

export const playlist_track_all = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
    n: 100000,
    s: query.s || 8,
  }
  //不放在data里面避免请求带上无用的数据
  let limit = parseInt(query.limit) || 1000
  let offset = parseInt(query.offset) || 0

  return request(`/api/v6/playlist/detail`, data, createOption(query)).then(
    (res) => {
      let trackIds = res.body.playlist.trackIds
      let idsData = {
        c:
          '[' +
          trackIds
            .slice(offset, offset + limit)
            .map((item: any) => '{"id":' + item.id + '}')
            .join(',') +
          ']',
      }

      return request(`/api/v3/song/detail`, idsData, createOption(query))
    },
  )
}

/* ---------- playlist_track_delete  (/playlist/track/delete) ---------- */

/* 自动转换自 api-enhanced module/playlist_track_delete.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 收藏单曲到歌单 从歌单删除歌曲

export const playlist_track_delete = async (query: NcmQuery, request: NcmRequestFn) => {
  query.ids = query.ids || ''
  const data = {
    id: query.id,
    tracks: JSON.stringify(
      query.ids.split(',').map((item: string) => {
        return { type: 3, id: item }
      }),
    ),
  }

  return request(
    `/api/playlist/track/delete`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- playlist_tracks  (/playlist/tracks) ---------- */

/* 自动转换自 api-enhanced module/playlist_tracks.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 收藏单曲到歌单 从歌单删除歌曲

export const playlist_tracks = async (query: NcmQuery, request: NcmRequestFn) => {
  //
  const tracks = query.tracks.split(',')
  const data = {
    op: query.op, // del,add
    pid: query.pid, // 歌单id
    trackIds: JSON.stringify(tracks), // 歌曲id
    imme: 'true',
  }

  try {
    const res = await request(
      `/api/playlist/manipulate/tracks`,
      data,
      createOption(query),
    )
    return {
      status: 200,
      body: {
        ...res,
      },
    }
  } catch (error: any) {
    if (error.body.code === 512) {
      return request(
        `/api/playlist/manipulate/tracks`,
        {
          op: query.op, // del,add
          pid: query.pid, // 歌单id
          trackIds: JSON.stringify([...tracks, ...tracks]),
          imme: 'true',
        },
        createOption(query),
      )
    } else {
      return {
        status: 200,
        body: error.body,
      }
    }
  }
}

/* ---------- playlist_update  (/playlist/update) ---------- */

/* 自动转换自 api-enhanced module/playlist_update.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 编辑歌单

export const playlist_update = (query: NcmQuery, request: NcmRequestFn) => {
  query.desc = query.desc || ''
  query.tags = query.tags || ''
  const data = {
    '/api/playlist/desc/update': `{"id":${query.id},"desc":"${query.desc}"}`,
    '/api/playlist/tags/update': `{"id":${query.id},"tags":"${query.tags}"}`,
    '/api/playlist/update/name': `{"id":${query.id},"name":"${query.name}"}`,
  }
  return request(`/api/batch`, data, createOption(query))
}

/* ---------- playlist_update_playcount  (/playlist/update/playcount) ---------- */

/* 自动转换自 api-enhanced module/playlist_update_playcount.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌单打卡

export const playlist_update_playcount = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
  }
  return request(`/api/playlist/update/playcount`, data, createOption(query))
}

/* ---------- playlist_video_recent  (/playlist/video/recent) ---------- */

/* 自动转换自 api-enhanced module/playlist_video_recent.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const playlist_video_recent = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(
    `/api/playlist/video/recent`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- related_playlist  (/related/playlist) ---------- */

/* 自动转换自 api-enhanced module/related_playlist.js（类型修正版） */

// 相关歌单

export const related_playlist = async (query: NcmQuery, request: NcmRequestFn) => {
  const res = await axios.request({
    method: "GET",
    url: `https://music.163.com/playlist?id=${encodeURIComponent(query.id)}`,
  });
  try {
    const pattern =
      /<div class="cver u-cover u-cover-3">[\s\S]*?<img src="([^"]+)">[\s\S]*?<a class="sname f-fs1 s-fc0" href="([^"]+)"[^>]*>([^<]+?)<\/a>[\s\S]*?<a class="nm nm f-thide s-fc3" href="([^"]+)"[^>]*>([^<]+?)<\/a>/g;
    let result;
    const playlists = [];
    while ((result = pattern.exec(res.data)) != null) {
      playlists.push({
        creator: {
          userId: result[4].slice("/user/home?id=".length),
          nickname: result[5],
        },
        coverImgUrl: result[1].slice(0, -"?param=50y50".length),
        name: result[3],
        id: result[2].slice("/playlist?id=".length),
      });
    }
    return {
      status: 200,
      body: { code: 200, playlists },
      cookie: [],
    };
  } catch (err: any) {
    throw {
      status: 500,
      body: { code: 500, msg: String(err?.message ?? err) },
      cookie: [],
    };
  }
};

/* ---------- top_playlist  (/top/playlist) ---------- */

/* 自动转换自 api-enhanced module/top_playlist.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 分类歌单

export const top_playlist = async (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    cat: query.cat || '全部', // 全部,华语,欧美,日语,韩语,粤语,小语种,流行,摇滚,民谣,电子,舞曲,说唱,轻音乐,爵士,乡村,R&B/Soul,古典,民族,英伦,金属,朋克,蓝调,雷鬼,世界音乐,拉丁,另类/独立,New Age,古风,后摇,Bossa Nova,清晨,夜晚,学习,工作,午休,下午茶,地铁,驾车,运动,旅行,散步,酒吧,怀旧,清新,浪漫,性感,伤感,治愈,放松,孤独,感动,兴奋,快乐,安静,思念,影视原声,ACG,儿童,校园,游戏,70后,80后,90后,网络歌曲,KTV,经典,翻唱,吉他,钢琴,器乐,榜单,00后
    order: query.order || 'hot', // hot,new
    limit: query.limit || 50,
    offset: query.offset || 0,
    total: true,
  }
  const res = await request(
    `/api/playlist/list`,
    data,
    createOption(query, 'weapi'),
  )
  const result = JSON.stringify(res).replace(
    /avatarImgId_str/g,
    'avatarImgIdStr',
  )
  return JSON.parse(result)
}

/* ---------- top_playlist_highquality  (/top/playlist/highquality) ---------- */

/* 自动转换自 api-enhanced module/top_playlist_highquality.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 精品歌单

export const top_playlist_highquality = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    cat: query.cat || '全部', // 全部,华语,欧美,韩语,日语,粤语,小语种,运动,ACG,影视原声,流行,摇滚,后摇,古风,民谣,轻音乐,电子,器乐,说唱,古典,爵士
    limit: query.limit || 50,
    lasttime: query.before || 0, // 歌单updateTime
    total: true,
  }
  return request(
    `/api/playlist/highquality/list`,
    data,
    createOption(query, 'weapi'),
  )
}
