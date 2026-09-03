import type { NcmQuery, NcmRequestFn } from '../types';
/* misc.ts — 功能家族合并文件（57 个接口，由 439 个独立模块合并生成） */
/* ---------- ad_get  (/ad/get) ---------- */
/* 自动转换自 api-enhanced module/ad_get.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */
// 获取广告

import { createOption } from "../option";
import { logger } from "../logger";
import { resourceTypeMap } from "../config";

export const ad_get = async (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    type_ids: query.type_ids || '["400002_0"]',
  }

  const option = createOption(query, 'xeapi', 'v3')

  const res = await request(`/api/ad/get`, data, option)
  const raw = res.body

  // 提取广告中的 req_id
  let reqId = ''
  try {
    if (raw?.ads) {
      const ad: any = Object.values(raw.ads)[0]
      // 逆向 v9.5.61：客户端从 ad.adExtMap["req_id"] 取 reqUid
      if (ad?.adExtMap) {
        if (typeof ad.adExtMap === 'string') {
          try {
            reqId = JSON.parse(ad.adExtMap).req_id || ''
          } catch (_) {}
        } else {
          reqId = ad.adExtMap.req_id || ''
        }
      }
      // 兜底：adLogId.requestId / ad.reqId / extJson.contextInfo.req_id
      if (!reqId && ad?.adLogId?.requestId) reqId = ad.adLogId.requestId
      if (!reqId && ad?.reqId) reqId = ad.reqId
      if (!reqId && ad?.extJson) {
        try {
          const ext = JSON.parse(ad.extJson)
          reqId = ext?.contextInfo?.req_id || ''
        } catch (_) {}
      }
    }
  } catch (_) {}

  return {
    status: 200,
    body: {
      code: 200,
      ads: raw?.ads || null,
      message: raw?.message || null,
      extra: { reqId },
    },
  }
}

/* ---------- ad_listening_rights  (/ad/listening/rights) ---------- */

/* 自动转换自 api-enhanced module/ad_listening_rights.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 获取免费听时长状态

export const ad_listening_rights = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    entrance: 'FREE_LISTEN_RN',
  }
  return request(
    `/api/ad/homepage/free/tab/extend/v2`,
    data,
    createOption(query, 'xeapi'),
  )
}

/* ---------- ad_listening_rights_gain  (/ad/listening/rights/gain) ---------- */

/* 自动转换自 api-enhanced module/ad_listening_rights_gain.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 看广告免费听歌 - 领取免费听权益

// 请求流程（基于逆向网易云音乐 v9.5.61 原生 Kotlin 源码，classes5/18/19.dex）：

// 1. 从广告平台拉广告 → 用户看完/点击广告 → 获取 ad 对象的 extJson.contextInfo.req_id 作为 reqUid

// 2. 调用本接口传入 reqUid 及相关权益参数，领取权益

// 3. 服务器返回 gainFlag 等标识，用于展示领取结果

//

// 调用链（逆向还原）：

//   AdDSLIncentiveVideoRightsHelper.requestRightsGainInner

//     → AdDSLUtils.requestRightGain(ad, exposeTime, clickTime, creativeType, cb)

//     → 构造 ListeningRightRequestParams（21 字段）→ JSON.stringify

//     → body = { "reqParam": "..." } → POST /api/ad/listening/rights/gain

//   （注意：客户端 AdDSLIncentiveVideoRightsHelper 写死 creativeType=36）

//

// 接口不只领取听歌时长，还包含"看视频得云贝"等权益：

//   rightsGainMethod=6 (LAXIN_EXPOSE_OR_DOWNLOAD 拉新曝光/下载分段权益) 时，

//   弹窗 AdLaxinSegmentedGuideDialog 展示 "获得X云贝"（2000 云贝等），

//   权益数值由广告下发的 AdLaxinSegmentedRightsGuidePopup.rightsValue 决定，

//   extraRightsType 作为权益类型随本接口上传。

//

// rightsGainMethod 枚举（h80/a）：

//   1=EXPOSE 曝光, 2=EXPOSE_CLICK 曝光+点击, 3=EXPOSE_DOWNLOAD 曝光+下载,

//   4=CLICK_STAY 点击+停留, 5=EXPOSURE_OR_CLICK_STAY 曝光或点击停留,

//   6=LAXIN_EXPOSE_OR_DOWNLOAD 拉新曝光/下载分段权益

// 安全 JSON 解析（字符串字段可能是 JSON 文本）

function ad_listening_rights_gain__safeParse(str: string, fallback: any): any {
  if (typeof str !== 'string') return fallback
  try {
    return JSON.parse(str)
  } catch (_) {
    return fallback
  }
}

export const ad_listening_rights_gain = async (query: NcmQuery, request: NcmRequestFn) => {
  const time = Date.now()

  // 从广告对象自动补齐请求字段。
  // 实测 v9.5.61 真实 API 返回（/ad/get）确认的字段路径：
  //   reqUid        = ad.extJson.contextInfo.req_id（真实响应中唯一存在）
  //   contextInfo   = ad.extJson.contextInfo（完整对象序列化）
  //   generalRightsInfo = ad.generalRightsInfo（字符串 JSON）
  //   creativeType  = ad.creativeType
  //   rightsGainMethod / extraRightsType / rightsGainDuration / rightsGainType /
  //   extraRightsGainMethod / extraRightsGainDuration / nextRightsGainDuration /
  //   rightsExtJson / source / rightsUpperLimit / qualified
  //                 = ad.generalRightsInfo（字符串）解析后取值
  //   （逆向类字段 adExtMap/adLogId/listeningRightHintInfo 真实响应中不存在，仅兜底）
  //   sniffTime     = method==3 或 6 时 currentTimeMillis
  let reqUid = query.reqUid || ''
  let contextInfo = query.contextInfo
  let creativeType = query.creativeType
  let generalRightsInfo = query.generalRightsInfo

  // 广告 hint 配置：仅当调用方未显式传参时用广告下发值兜底
  const hint: any = {}

  if (!reqUid || contextInfo === undefined || creativeType === undefined) {
    try {
      const adRes = await ad_get(
        { ...query, type_ids: query.type_ids || '["400002_0"]' },
        request,
      )
      const ad: any = Object.values(adRes?.body?.ads || {})[0]
      if (!ad) throw new Error('ads 为空（未登录或广告位无广告）')

      // reqUid：真实 API 返回中 req_id 在 ad.extJson.contextInfo.req_id（实测 v9.5.61）
      //   （逆向类字段 adExtMap/adLogId 在真实响应中不存在，仅作兜底）
      if (!reqUid) {
        const ext =
          typeof ad?.extJson === 'string'
            ? ad_listening_rights_gain__safeParse(ad.extJson, {})
            : ad?.extJson || {}
        const extMap =
          typeof ad?.adExtMap === 'string'
            ? ad_listening_rights_gain__safeParse(ad.adExtMap, {})
            : ad?.adExtMap
        reqUid =
          ext?.contextInfo?.req_id ||
          extMap?.req_id ||
          ad?.adLogId?.requestId ||
          ad?.reqId ||
          adRes?.body?.extra?.reqId ||
          ''
      }
      // contextInfo：真实 API 返回中在 ad.extJson.contextInfo（实测 v9.5.61）
      if (contextInfo === undefined) {
        const ext =
          typeof ad?.extJson === 'string'
            ? ad_listening_rights_gain__safeParse(ad.extJson, {})
            : ad?.extJson || {}
        const ci =
          ext?.contextInfo || ad?.adLogId?.contextInfo || ad?.showContext
        if (ci) {
          contextInfo = typeof ci === 'string' ? ci : JSON.stringify(ci)
        }
      }
      if (creativeType === undefined && ad?.creativeType !== undefined) {
        creativeType = ad.creativeType
      }
      if (generalRightsInfo === undefined && ad?.generalRightsInfo) {
        generalRightsInfo =
          typeof ad.generalRightsInfo === 'string'
            ? ad.generalRightsInfo
            : JSON.stringify(ad.generalRightsInfo)
      }
      // 缓存广告下发的领取配置（后续用于兜底）
      // 实测 v9.5.61：rightsGainMethod/rightsUpperLimit/qualified 等在
      //   ad.generalRightsInfo（字符串）里，ad.listeningRightHintInfo 真实响应中不存在
      const hintCfg =
        typeof ad?.listeningRightHintInfo === 'string'
          ? ad_listening_rights_gain__safeParse(ad.listeningRightHintInfo, {})
          : ad?.listeningRightHintInfo || {}
      const gri =
        typeof ad?.generalRightsInfo === 'string'
          ? ad_listening_rights_gain__safeParse(ad.generalRightsInfo, {})
          : ad?.generalRightsInfo || {}
      Object.assign(hint, hintCfg, gri)
      console.log(`自动获取 reqUid: ${reqUid}`)
    } catch (e) {
      // 获取广告失败，后续请求会因缺少 reqUid 被拒绝
    }
  }

  const rightsGainMethod = query.rightsGainMethod
    ? parseInt(query.rightsGainMethod)
    : hint.rightsGainMethod || 2

  const rightsParam: Record<string, any> = {
    // 必填: 广告请求 ID，自动从 ad_get 获取
    reqUid,

    // 曝光时间戳
    exposureTime: query.exposureTime ? parseInt(query.exposureTime) : time,

    // 当前登录用户 ID（原版客户端从 Profile.getUserId() 获取）
    userId: query.uid ? parseInt(query.uid) : undefined,

    // 点击时间戳
    clickTime: query.clickTime ? parseInt(query.clickTime) : time,

    // 额外权益类型（拉新分段权益等，决定发放云贝/时长/下载，来自广告配置）
    extraRightsType: query.extraRightsType
      ? parseInt(query.extraRightsType)
      : hint.extraRightsType !== undefined
        ? parseInt(hint.extraRightsType)
        : undefined,

    // 是否连续播放（默认 false）
    playContinuously: query.playContinuously ? true : false,

    // 来源标识（原版从 ad.listeningRightHintInfo.source 读取）
    source: query.source
      ? parseInt(query.source)
      : hint.source !== undefined
        ? parseInt(hint.source)
        : undefined,

    // 广告创意类型（激励视频场景=36，优先取 query / 广告对象）
    creativeType: creativeType !== undefined ? parseInt(creativeType) : 36,

    // 权益领取方式（1~6 枚举，见文件头注释）
    rightsGainMethod,

    // 权益扩展方式与时长
    extraRightsGainMethod: query.extraRightsGainMethod
      ? parseInt(query.extraRightsGainMethod)
      : hint.extraRightsGainMethod !== undefined
        ? parseInt(hint.extraRightsGainMethod)
        : undefined,
    extraRightsGainDuration: query.extraRightsGainDuration
      ? parseInt(query.extraRightsGainDuration)
      : hint.extraRightsGainDuration !== undefined
        ? parseInt(hint.extraRightsGainDuration)
        : undefined,
    nextRightsGainDuration: query.nextRightsGainDuration
      ? parseInt(query.nextRightsGainDuration)
      : hint.nextRightsGainDuration !== undefined
        ? parseInt(hint.nextRightsGainDuration)
        : undefined,

    // 权益类型（含 RIGHTS_GAIN_TYPE_CURRENT_DAY 等取值）
    rightsGainType: query.rightsGainType
      ? parseInt(query.rightsGainType)
      : hint.rightsGainType !== undefined
        ? parseInt(hint.rightsGainType)
        : undefined,

    // 权益时长
    rightsGainDuration: query.rightsGainDuration
      ? parseInt(query.rightsGainDuration)
      : hint.rightsGainDuration !== undefined
        ? parseInt(hint.rightsGainDuration)
        : undefined,

    // 领取步骤（UNGAIN/GAINING/GAIN_FINISHED 对应的值）
    gainMethodStep: query.gainMethodStep
      ? parseInt(query.gainMethodStep)
      : undefined,

    // 通用权益信息（ad.generalRightsInfo 序列化 JSON）
    generalRightsInfo,

    // 权益扩展信息
    rightsExtJson: query.rightsExtJson || hint.rightsExtJson || undefined,

    // 应用信息（下载类广告）
    appInfo: query.appInfo ? JSON.parse(query.appInfo) : undefined,

    // 广告上下文（ad.adLogId.contextInfo，客户端真实来源）
    contextInfo,

    // 应用是否已安装（下载类广告）
    installed: query.installed ? parseInt(query.installed) : undefined,

    // 嗅探时间：逆向确认（classes5.dex AdDSLUtils.requestRightGain）：
    //   rightsGainMethod==3(曝光+下载) 或 6(LAXIN) 时传 currentTimeMillis
    sniffTime:
      rightsGainMethod === 3 || rightsGainMethod === 6
        ? query.sniffTime
          ? parseInt(query.sniffTime)
          : time
        : undefined,
  }

  // 清理 undefined 字段
  Object.keys(rightsParam).forEach((key) => {
    if (rightsParam[key] === undefined) delete rightsParam[key]
  })

  // 将参数序列化为 reqParam 字符串 (与原生源码一致)
  const data = {
    reqParam: JSON.stringify(rightsParam),
  }

  const res = await request(
    `/api/ad/listening/rights/gain`,
    data,
    createOption(query, 'xeapi', 'v3'),
  )

  return {
    status: 200,
    body: {
      code: 200,
      data: res.body,
    },
  }
}

/* ---------- aidj_content_rcmd  (/aidj/content/rcmd) ---------- */

/* 自动转换自 api-enhanced module/aidj_content_rcmd.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 私人 DJ

// 实际请求参数如下, 部分内容省略, 敏感信息已进行混淆

// 可按需修改此 API 的代码

/* {"extInfo":"{\"lastRequestTimestamp\":1692358373509,\"lbsInfoList\":[{\"lat\":40.23076381,\"lon\":129.07545186,\"time\":1692358543},{\"lat\":40.23076381,\"lon\":129.07545186,\"time\":1692055283}],\"listenedTs\":false,\"noAidjToAidj\":true}","header":"{}"} */

export const aidj_content_rcmd = (query: NcmQuery, request: NcmRequestFn) => {
  var extInfo: Record<string, any> = {}
  if (query.latitude != undefined) {
    extInfo.lbsInfoList = [
      {
        lat: query.latitude,
        lon: query.longitude,
        time: Date.now() / 1000,
      },
    ]
  }
  extInfo.noAidjToAidj = false
  extInfo.lastRequestTimestamp = new Date().getTime()
  extInfo.listenedTs = false
  const data = {
    extInfo: JSON.stringify(extInfo),
  }
  // logger.info(data)
  return request(`/api/aidj/content/rcmd/info`, data, createOption(query))
}

/* ---------- chart_detail  (/chart/detail) ---------- */

/* 自动转换自 api-enhanced module/chart_detail.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 获取指定维度音乐排行榜详情

export const chart_detail = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    chartCode: query.chartCode,
    targetId: query.targetId,
    targetType: query.targetType,
  }
  return request(`/api/chart/detail`, data, createOption(query))
}

/* ---------- chart_song_detail  (/chart/song/detail) ---------- */

/* 自动转换自 api-enhanced module/chart_song_detail.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 获取指定维度音乐排行榜列表

export const chart_song_detail = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    chartCode: query.chartCode,
    targetId: query.targetId,
    targetType: query.targetType,
  }
  return request(`/api/chart/song/detail`, data, createOption(query))
}

/* ---------- creator_authinfo_get  (/creator/authinfo/get) ---------- */

/* 自动转换自 api-enhanced module/creator_authinfo_get.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 获取达人用户信息

export const creator_authinfo_get = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(`/api/user/creator/authinfo/get`, data, createOption(query))
}

/* ---------- lbs_city_code  (/lbs/city/code) ---------- */

/* 自动转换自 api-enhanced module/lbs_city_code.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 多级行政区划数据获取接口

export const lbs_city_code = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    bizCode: query.bizCode || '',
  }
  return request(`/api/lbs/city/code`, data, createOption(query))
}

/* ---------- middle_play_do_lottery  (/middle/play/do/lottery) ---------- */

/* 自动转换自 api-enhanced module/middle_play_do_lottery.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 云小编每日抽奖

//

// activityId:

// 默认 6501202

//

// drawCount:

// 默认 1

//

// checkToken:

// 易盾反作弊 Token

export const middle_play_do_lottery = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    activityId: query.activityId || '6501202',
    drawCount: query.drawCount || '1',
  }
  return request(
    `/api/middle/play/do/lottery`,
    data,
    createOption(query, 'eapi', 'v2'),
  )
}

/* ---------- middle_play_lottery_remain_chance  (/middle/play/lottery/remain/chance) ---------- */

/* 自动转换自 api-enhanced module/middle_play_lottery_remain_chance.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 云小编抽奖剩余次数查询

//

// activityId:

// 默认 6501202

export const middle_play_lottery_remain_chance = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    activityId: query.activityId || '6501202',
  }
  return request(
    `/api/middle/play/lottery/remain/chance`,
    data,
    createOption(query, 'eapi'),
  )
}

/* ---------- pl_count  (/pl/count) ---------- */

/* 自动转换自 api-enhanced module/pl_count.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 私信和通知接口

export const pl_count = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(`/api/pl/count`, data, createOption(query, 'weapi'))
}

/* ---------- program_recommend  (/program/recommend) ---------- */

/* 自动转换自 api-enhanced module/program_recommend.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 推荐节目

export const program_recommend = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    cateId: query.type,
    limit: query.limit || 10,
    offset: query.offset || 0,
  }
  return request(
    `/api/program/recommend/v1`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- radio_sport_get  (/radio/sport/get) ---------- */

/* 自动转换自 api-enhanced module/radio_sport_get.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 跑步漫游

export const radio_sport_get = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    bpm: query.bpm || 50,
  }
  return request(`/api/radio/sport/get`, data, createOption(query))
}

/* ---------- rep_ugc_activity_collect  (/rep/ugc/activity/collect) ---------- */

/* 自动转换自 api-enhanced module/rep_ugc_activity_collect.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 云小编领取任务积分

//

// activityId:

// 调用 rep/ugc/activity/get 获取

export const rep_ugc_activity_collect = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    activityId: query.activityId || '5001',
  }
  return request(
    `/api/rep/ugc/activity/collect`,
    data,
    createOption(query, 'eapi'),
  )
}

/* ---------- rep_ugc_activity_get  (/rep/ugc/activity/get) ---------- */

/* 自动转换自 api-enhanced module/rep_ugc_activity_get.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 云小编活动信息

export const rep_ugc_activity_get = (query: NcmQuery, request: NcmRequestFn) => {
  return request(`/api/rep/ugc/activity/get`, {}, createOption(query, 'eapi'))
}

/* ---------- rep_ugc_exam_info_get  (/rep/ugc/exam/info/get) ---------- */

/* 自动转换自 api-enhanced module/rep_ugc_exam_info_get.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 云小编考试状态

//

// examType:

// 1. 歌曲曲风审核: musicalStyleEnter

// 2. 歌曲语种审核: languageEnter

// 3. 歌曲原唱审核: oriSingerEnter

// 4. 情绪标签审核: emotionEnter

export const rep_ugc_exam_info_get = (query: NcmQuery, request: NcmRequestFn) => {
  if (!query.examType)
    return Promise.reject({
      status: 400,
      body: {
        code: 400,
        message: '参数不足',
      },
    })
  const data = {
    examType: query.examType,
  }
  return request(
    '/api/rep/ugc/exam/info/get',
    data,
    createOption(query, 'eapi'),
  )
}

/* ---------- rep_ugc_exam_question_single_get  (/rep/ugc/exam/question/single/get) ---------- */

/* 自动转换自 api-enhanced module/rep_ugc_exam_question_single_get.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 云小编考试取题

//

// examType:

// 1. 歌曲曲风审核: musicalStyleEnter

// 2. 歌曲语种审核: languageEnter

// 3. 歌曲原唱审核: oriSingerEnter

// 4. 情绪标签审核: emotionEnter

//

// taskId:

// 首次调用 rep/ugc/exam/start 获取，之后调用 rep/ugc/exam/info/get 获取

export const rep_ugc_exam_question_single_get = (query: NcmQuery, request: NcmRequestFn) => {
  if (!query.examType || !query.taskId)
    return Promise.reject({
      status: 400,
      body: {
        code: 400,
        message: '参数不足',
      },
    })
  const data = {
    examType: query.examType,
    taskId: query.taskId,
  }
  return request(
    '/api/rep/ugc/exam/question/single/get',
    data,
    createOption(query, 'eapi'),
  )
}

/* ---------- rep_ugc_exam_result_get  (/rep/ugc/exam/result/get) ---------- */

/* 自动转换自 api-enhanced module/rep_ugc_exam_result_get.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 云小编考试结果

//

// examType:

// 1. 歌曲曲风审核: musicalStyleEnter

// 2. 歌曲语种审核: languageEnter

// 3. 歌曲原唱审核: oriSingerEnter

// 4. 情绪标签审核: emotionEnter

//

// taskId:

// 首次调用 rep/ugc/exam/start 获取，之后调用 rep/ugc/exam/info/get 获取

export const rep_ugc_exam_result_get = (query: NcmQuery, request: NcmRequestFn) => {
  if (!query.examType || !query.taskId)
    return Promise.reject({
      status: 400,
      body: {
        code: 400,
        message: '参数不足',
      },
    })
  const data = {
    examType: query.examType,
    taskId: query.taskId,
  }
  return request(
    '/api/rep/ugc/exam/result/get',
    data,
    createOption(query, 'eapi'),
  )
}

/* ---------- rep_ugc_exam_start  (/rep/ugc/exam/start) ---------- */

/* 自动转换自 api-enhanced module/rep_ugc_exam_start.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 云小编考试开始

//

// examType:

// 1. 歌曲曲风审核: musicalStyleEnter

// 2. 歌曲语种审核: languageEnter

// 3. 歌曲原唱审核: oriSingerEnter

// 4. 情绪标签审核: emotionEnter

export const rep_ugc_exam_start = (query: NcmQuery, request: NcmRequestFn) => {
  if (!query.examType)
    return Promise.reject({
      status: 400,
      body: {
        code: 400,
        message: '参数不足',
      },
    })
  const data = {
    examType: query.examType,
  }
  return request('/api/rep/ugc/exam/start', data, createOption(query, 'eapi'))
}

/* ---------- rep_ugc_exam_submit  (/rep/ugc/exam/submit) ---------- */

/* 自动转换自 api-enhanced module/rep_ugc_exam_submit.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 云小编考试提交

//

// examType:

// 1. 歌曲曲风审核: musicalStyleEnter

// 2. 歌曲语种审核: languageEnter

// 3. 歌曲原唱审核: oriSingerEnter

// 4. 情绪标签审核: emotionEnter

//

// taskId:

// 首次调用 rep/ugc/exam/start 获取，之后调用 rep/ugc/exam/info/get 获取

//

// questionId:

// 调用 rep/ugc/exam/question/single/get 获取

//

// answer:

// A 对, B 错

export const rep_ugc_exam_submit = (query: NcmQuery, request: NcmRequestFn) => {
  if (!query.examType || !query.taskId || !query.questionId || !query.answer)
    return Promise.reject({
      status: 400,
      body: {
        code: 400,
        message: '参数不足',
      },
    })
  const data = {
    examType: query.examType,
    taskId: query.taskId,
    questionId: query.questionId,
    answer: query.answer,
  }
  return request('/api/rep/ugc/exam/submit', data, createOption(query, 'eapi'))
}

/* ---------- rep_ugc_user_collect-vip  (/rep/ugc/user/collect-vip) ---------- */

/* 自动转换自 api-enhanced module/rep_ugc_user_collect-vip.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 云小编领取一日会员

//

// 注：前提条件见 rep/ugc/user/vip

export const rep_ugc_user_collect_vip = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    activityId: query.activityId || '5001',
  }
  return request(
    `/api/rep/ugc/user/collect-vip`,
    data,
    createOption(query, 'eapi'),
  )
}

/* ---------- rep_ugc_user_get  (/rep/ugc/user/get) ---------- */

/* 自动转换自 api-enhanced module/rep_ugc_user_get.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 云小编获取用户详情

export const rep_ugc_user_get = (query: NcmQuery, request: NcmRequestFn) => {
  return request(`/api/rep/ugc/user/get`, {}, createOption(query, 'eapi'))
}

/* ---------- rep_ugc_user_sign  (/rep/ugc/user/sign) ---------- */

/* 自动转换自 api-enhanced module/rep_ugc_user_sign.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 云小编每日签到

export const rep_ugc_user_sign = (query: NcmQuery, request: NcmRequestFn) => {
  return request(`/api/rep/ugc/user/sign`, {}, createOption(query, 'eapi'))
}

/* ---------- rep_ugc_user_vip  (/rep/ugc/user/vip) ---------- */

/* 自动转换自 api-enhanced module/rep_ugc_user_vip.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 云小编查询会员任务状态

//

// 状态 (data.status)

// 10: 用户积分达50，可免费领取1日黑胶会员

// 20: 用户积分已达50，可免费领取1日黑胶会员

// 30: 已领取1日黑胶会员，明天再来吧~

export const rep_ugc_user_vip = (query: NcmQuery, request: NcmRequestFn) => {
  return request(`/api/rep/ugc/user/vip`, {}, createOption(query, 'eapi'))
}

/* ---------- resource_like  (/resource/like) ---------- */

/* 自动转换自 api-enhanced module/resource_like.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 点赞与取消点赞资源

export const resource_like = (query: NcmQuery, request: NcmRequestFn) => {
  query.t = query.t == 1 ? 'like' : 'unlike'
  query.type = resourceTypeMap[query.type]
  const data = {
    threadId: query.type + query.id,
  }
  if (query.type === 'A_EV_2_') {
    data.threadId = query.threadId
  }
  return request(`/api/resource/${query.t}`, data, createOption(query, 'weapi'))
}

/* ---------- sati_resource_list  (/sati/resource/list) ---------- */

/* 自动转换自 api-enhanced module/sati_resource_list.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 助眠解压 - 获取标签下资源列表

export const sati_resource_list = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    tag: query.tag,
    firstQuery: false,
  }

  return request(`/api/voice/sati/resource/list`, data, createOption(query))
}

/* ---------- sati_resource_list_more  (/sati/resource/list/more) ---------- */

/* 自动转换自 api-enhanced module/sati_resource_list_more.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 助眠解压 - 查看同类推荐

export const sati_resource_list_more = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
  }
  return request(
    `/api/voice/sati/resource/list/more/v1`,
    data,
    createOption(query),
  )
}

/* ---------- sati_resource_sub  (/sati/resource/sub) ---------- */

/* 自动转换自 api-enhanced module/sati_resource_sub.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 助眠解压 - 收藏

export const sati_resource_sub = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
    cancel: query.cancel || false,
  }
  return request(`/api/voice/sati/resource/sub`, data, createOption(query))
}

/* ---------- sati_resource_sub_list  (/sati/resource/sub/list) ---------- */

/* 自动转换自 api-enhanced module/sati_resource_sub_list.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 助眠解压 - 收藏列表

export const sati_resource_sub_list = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(`/api/voice/sati/resource/sub/list`, data, createOption(query))
}

/* ---------- sati_tag_list  (/sati/tag/list) ---------- */

/* 自动转换自 api-enhanced module/sati_tag_list.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 助眠解压 - 标签列表

export const sati_tag_list = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(`/api/voice/sati/tag/list`, data, createOption(query))
}

/* ---------- sati_timescene_resources_get  (/sati/timescene/resources/get) ---------- */

/* 自动转换自 api-enhanced module/sati_timescene_resources_get.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 助眠解压 - 特定时间场景下的推荐资源

export const sati_timescene_resources_get = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    firstQuery: false,
  }
  return request(
    `/api/voice/sati/timescene/resources/get`,
    data,
    createOption(query),
  )
}

/* ---------- setting  (/setting) ---------- */

/* 自动转换自 api-enhanced module/setting.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 设置

export const setting = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(`/api/user/setting`, data, createOption(query, 'weapi'))
}

/* ---------- sheet_list  (/sheet/list) ---------- */

/* 自动转换自 api-enhanced module/sheet_list.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 乐谱列表

export const sheet_list = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
    abTest: query.ab || 'b',
  }
  return request(`/api/music/sheet/list/v1`, data, createOption(query))
}

/* ---------- sheet_preview  (/sheet/preview) ---------- */

/* 自动转换自 api-enhanced module/sheet_preview.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 乐谱预览

export const sheet_preview = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
  }
  return request(`/api/music/sheet/preview/info`, data, createOption(query))
}

/* ---------- simi_playlist  (/simi/playlist) ---------- */

/* 自动转换自 api-enhanced module/simi_playlist.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 相似歌单

export const simi_playlist = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    songid: query.id,
    limit: query.limit || 50,
    offset: query.offset || 0,
  }
  return request(
    `/api/discovery/simiPlaylist`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- simi_user  (/simi/user) ---------- */

/* 自动转换自 api-enhanced module/simi_user.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 相似用户

export const simi_user = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    songid: query.id,
    limit: query.limit || 50,
    offset: query.offset || 0,
  }
  return request(`/api/discovery/simiUser`, data, createOption(query, 'weapi'))
}

/* ---------- starpick_comments_summary  (/starpick/comments/summary) ---------- */

/* 自动转换自 api-enhanced module/starpick_comments_summary.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 云村星评馆 - 简要评论列表

export const starpick_comments_summary = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    cursor: JSON.stringify({
      offset: 0,
      blockCodeOrderList: ['HOMEPAGE_BLOCK_NEW_HOT_COMMENT'],
      refresh: true,
    }),
  }
  return request(`/api/homepage/block/page`, data, createOption(query))
}

/* ---------- style_album  (/style/album) ---------- */

/* 自动转换自 api-enhanced module/style_album.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 曲风-专辑

export const style_album = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    cursor: query.cursor || 0,
    size: query.size || 20,
    tagId: query.tagId,
    sort: query.sort || 0,
  }
  return request(
    `/api/style-tag/home/album`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- style_artist  (/style/artist) ---------- */

/* 自动转换自 api-enhanced module/style_artist.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 曲风-歌手

export const style_artist = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    cursor: query.cursor || 0,
    size: query.size || 20,
    tagId: query.tagId,
    sort: 0,
  }
  return request(
    `/api/style-tag/home/artist`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- style_detail  (/style/detail) ---------- */

/* 自动转换自 api-enhanced module/style_detail.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 曲风详情

export const style_detail = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    tagId: query.tagId,
  }
  return request(`/api/style-tag/home/head`, data, createOption(query, 'weapi'))
}

/* ---------- style_list  (/style/list) ---------- */

/* 自动转换自 api-enhanced module/style_list.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 曲风列表

export const style_list = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(`/api/tag/list/get`, data, createOption(query, 'weapi'))
}

/* ---------- style_playlist  (/style/playlist) ---------- */

/* 自动转换自 api-enhanced module/style_playlist.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 曲风-歌单

export const style_playlist = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    cursor: query.cursor || 0,
    size: query.size || 20,
    tagId: query.tagId,
    sort: 0,
  }
  return request(
    `/api/style-tag/home/playlist`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- style_preference  (/style/preference) ---------- */

/* 自动转换自 api-enhanced module/style_preference.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 曲风偏好

export const style_preference = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(
    `/api/tag/my/preference/get`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- style_song  (/style/song) ---------- */

/* 自动转换自 api-enhanced module/style_song.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 曲风-歌曲

export const style_song = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    cursor: query.cursor || 0,
    size: query.size || 20,
    tagId: query.tagId,
    sort: query.sort || 0,
  }
  return request(`/api/style-tag/home/song`, data, createOption(query, 'weapi'))
}

/* ---------- thinktank_audit_resource_detail  (/thinktank/audit/resource/detail) ---------- */

/* 自动转换自 api-enhanced module/thinktank_audit_resource_detail.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 云小编获取任务

//

// type:

// 1: 歌曲曲风审核 musicalStyleEnter

// 2: 歌曲语种审核 languageEnter

// 3: 歌曲原唱审核 oriSingerEnter

// 4: 情绪标签审核 emotionEnter

export const thinktank_audit_resource_detail = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    type: query.type || '4',
  }
  return request(
    `/api/thinktank/audit/resource/detail`,
    data,
    createOption(query, 'eapi'),
  )
}

/* ---------- thinktank_audit_resource_update  (/thinktank/audit/resource/update) ---------- */

/* 自动转换自 api-enhanced module/thinktank_audit_resource_update.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 云小编提交任务

//

// type:

// 1: 歌曲曲风审核 musicalStyleEnter

// 2: 歌曲语种审核 languageEnter

// 3: 歌曲原唱审核 oriSingerEnter

// 4: 情绪标签审核 emotionEnter

//

// taskId:

// 调用 thinktank/audit/resource/detail 获取

//

// judgement:

// 1: 同意, 2: 否决, 3: 跳过 (不算次数)

export const thinktank_audit_resource_update = (query: NcmQuery, request: NcmRequestFn) => {
  if (!query.taskId || !query.judgement)
    return Promise.reject({
      status: 400,
      body: {
        code: 400,
        message: '参数不足',
      },
    })
  const data = {
    type: query.type || '4',
    taskId: query.taskId,
    judgement: query.judgement,
  }
  return request(
    `/api/thinktank/audit/resource/update`,
    data,
    createOption(query, 'eapi'),
  )
}

/* ---------- threshold_detail_get  (/threshold/detail/get) ---------- */

/* 自动转换自 api-enhanced module/threshold_detail_get.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 获取达人达标信息

export const threshold_detail_get = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(
    `/api/influencer/web/apply/threshold/detail/get`,
    data,
    createOption(query),
  )
}

/* ---------- topic_detail  (/topic/detail) ---------- */

/* 自动转换自 api-enhanced module/topic_detail.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const topic_detail = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    actid: query.actid,
  }
  return request(`/api/act/detail`, data, createOption(query, 'weapi'))
}

/* ---------- topic_detail_event_hot  (/topic/detail/event/hot) ---------- */

/* 自动转换自 api-enhanced module/topic_detail_event_hot.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const topic_detail_event_hot = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    actid: query.actid,
  }
  return request(`/api/act/event/hot`, data, createOption(query, 'weapi'))
}

/* ---------- topic_sublist  (/topic/sublist) ---------- */

/* 自动转换自 api-enhanced module/topic_sublist.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 收藏的专栏

export const topic_sublist = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 50,
    offset: query.offset || 0,
    total: true,
  }
  return request(`/api/topic/sublist`, data, createOption(query, 'weapi'))
}

/* ---------- ugc_album_get  (/ugc/album/get) ---------- */

/* 自动转换自 api-enhanced module/ugc_album_get.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 专辑简要百科信息

export const ugc_album_get = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    albumId: query.id,
  }
  return request(`/api/rep/ugc/album/get`, data, createOption(query))
}

/* ---------- ugc_artist_get  (/ugc/artist/get) ---------- */

/* 自动转换自 api-enhanced module/ugc_artist_get.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌手简要百科信息

export const ugc_artist_get = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    artistId: query.id,
  }
  return request(`/api/rep/ugc/artist/get`, data, createOption(query))
}

/* ---------- ugc_artist_search  (/ugc/artist/search) ---------- */

/* 自动转换自 api-enhanced module/ugc_artist_search.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 搜索歌手

// 可传关键字或者歌手id

export const ugc_artist_search = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    keyword: query.keyword,
    limit: query.limit || 40,
  }
  return request(`/api/rep/ugc/artist/search`, data, createOption(query))
}

/* ---------- ugc_detail  (/ugc/detail) ---------- */

/* 自动转换自 api-enhanced module/ugc_detail.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 用户贡献内容

export const ugc_detail = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    auditStatus: query.auditStatus || '',
    //待审核:0 未采纳:-5 审核中:1 部分审核通过:4 审核通过:5
    //WAIT:0 REJECT:-5 AUDITING:1 PARTLY_APPROVED:4 PASS:5
    limit: query.limit || 10,
    offset: query.offset || 0,
    order: query.order || 'desc', //asc
    sortBy: query.sortBy || 'createTime',
    type: query.type || 1,
    //曲库纠错 ARTIST:1 ALBUM:2 SONG:3 MV:4 LYRIC:5 TLYRIC:6
    //曲库补充 ALBUM:101 MV:103
  }
  return request(`/api/rep/ugc/detail`, data, createOption(query, 'weapi'))
}

/* ---------- ugc_mv_get  (/ugc/mv/get) ---------- */

/* 自动转换自 api-enhanced module/ugc_mv_get.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// mv简要百科信息

export const ugc_mv_get = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    mvId: query.id,
  }
  return request(`/api/rep/ugc/mv/get`, data, createOption(query))
}

/* ---------- ugc_song_get  (/ugc/song/get) ---------- */

/* 自动转换自 api-enhanced module/ugc_song_get.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 歌曲简要百科信息

export const ugc_song_get = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    songId: query.id,
  }
  return request(`/api/rep/ugc/song/get`, data, createOption(query))
}

/* ---------- ugc_user_devote  (/ugc/user/devote) ---------- */

/* 自动转换自 api-enhanced module/ugc_user_devote.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 用户贡献条目、积分、云贝数量

export const ugc_user_devote = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(`/api/rep/ugc/user/devote`, data, createOption(query))
}
