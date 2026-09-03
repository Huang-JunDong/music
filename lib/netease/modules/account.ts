import type { NcmQuery, NcmRequestFn } from '../types';
/* account.ts — 功能家族合并文件（27 个接口，由 439 个独立模块合并生成） */
/* ---------- activate_init_profile  (/activate/init/profile) ---------- */
/* 自动转换自 api-enhanced module/activate_init_profile.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */
// 初始化名字

import { createOption } from "../option";
import CryptoJS from "../crypto-js-compat";
import QRCode from "qrcode";
import { generateChainId } from "../utils";
import type { NcmModule, NcmResponse } from "../types";
import { registerAnonymousToken } from "../anonymous";
import { checktokenHandler } from "../checktoken";
import { registerXeapiKey } from "../xeapi-key";

export const activate_init_profile = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    nickname: query.nickname,
  }
  return request(`/api/activate/initProfile`, data, createOption(query))
}

/* ---------- captcha_safe_sent  (/captcha/safe/sent) ---------- */

/* 自动转换自 api-enhanced module/captcha_safe_sent.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 发送安全验证码

export const captcha_safe_sent = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    ctcode: query.ctcode || '86',
  }
  return request(
    `/api/sms/captcha/safe/sent`,
    data,
    createOption(query, 'eapi'),
  )
}

/* ---------- captcha_sent  (/captcha/sent) ---------- */

/* 自动转换自 api-enhanced module/captcha_sent.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 发送验证码

export const captcha_sent = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    ctcode: query.ctcode || '86',
    secrete: 'music_middleuser_pclogin',
    cellphone: query.phone,
  }
  return request(`/api/sms/captcha/sent`, data, createOption(query, 'weapi'))
}

/* ---------- captcha_sent_v1  (/captcha/sent/v1) ---------- */

/* 自动转换自 api-enhanced module/captcha_sent_v1.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 发送验证码

export const captcha_sent_v1 = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    ctcode: query.ctcode || '86',
    secrete: 'music_middleuser_pclogin',
    cellphone: query.phone,
    scene: '0',
  }
  return request(
    `/api/middle/captcha/sent/v1`,
    data,
    createOption(query, 'eapi'),
  )
}

/* ---------- captcha_verify  (/captcha/verify) ---------- */

/* 自动转换自 api-enhanced module/captcha_verify.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 校验验证码

export const captcha_verify = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    ctcode: query.ctcode || '86',
    cellphone: query.phone,
    captcha: query.captcha,
  }
  return request(`/api/sms/captcha/verify`, data, createOption(query, 'weapi'))
}

/* ---------- cellphone_existence_check  (/cellphone/existence/check) ---------- */

/* 自动转换自 api-enhanced module/cellphone_existence_check.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 检测手机号码是否已注册

export const cellphone_existence_check = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    cellphone: query.phone,
    countrycode: query.countrycode,
  }
  return request(
    `/api/cellphone/existence/check`,
    data,
    createOption(query, 'eapi'),
  )
}

/* ---------- countries_code_list  (/countries/code/list) ---------- */

/* 自动转换自 api-enhanced module/countries_code_list.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 国家编码列表

export const countries_code_list = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(`/api/lbs/countries/v1`, data, createOption(query))
}

/* ---------- login  (/login) ---------- */

/* 自动转换自 api-enhanced module/login.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 邮箱登录

export const login = async (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    type: '0',
    https: 'true',
    username: query.email,
    password: query.md5_password || CryptoJS.MD5(query.password).toString(),
    rememberLogin: 'true',
  }
  let result = await request(`/api/w/login`, data, createOption(query))
  if (result.body.code === 502) {
    return {
      status: 200,
      body: {
        msg: '账号或密码错误',
        code: 502,
        message: '账号或密码错误',
      },
    }
  }
  if (result.body.code === 200) {
    result = {
      status: 200,
      body: {
        ...JSON.parse(
          JSON.stringify(result.body).replace(
            /avatarImgId_str/g,
            'avatarImgIdStr',
          ),
        ),
        cookie: (result.cookie ?? []).join(';'),
      },
      cookie: result.cookie,
    }
  }
  return result
}

/* ---------- login_cellphone  (/login/cellphone) ---------- */

/* 自动转换自 api-enhanced module/login_cellphone.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 手机登录

export const login_cellphone = async (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    type: '1',
    https: 'true',
    phone: query.phone,
    countrycode: query.countrycode || '86',
    captcha: query.captcha,
    [query.captcha ? 'captcha' : 'password']: query.captcha
      ? query.captcha
      : query.md5_password || CryptoJS.MD5(query.password).toString(),
    remember: 'true',
    secureCaptcha: query.sca || '',
  }
  let result = await request(
    `/api/w/login/cellphone`,
    data,
    createOption(query, 'weapi'),
  )

  if (result.body.code === 200) {
    result = {
      status: 200,
      body: {
        ...JSON.parse(
          JSON.stringify(result.body).replace(
            /avatarImgId_str/g,
            'avatarImgIdStr',
          ),
        ),
        cookie: (result.cookie ?? []).join(';'),
      },
      cookie: result.cookie,
    }
  }
  return result
}

/* ---------- login_qr_check  (/login/qr/check) ---------- */

/* 自动转换自 api-enhanced module/login_qr_check.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const login_qr_check = async (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    key: query.key,
    type: 3,
  }
  try {
    let result = await request(
      `/api/login/qrcode/client/login`,
      data,
      createOption(query),
    )
    result = {
      status: 200,
      body: {
        ...result.body,
        cookie: (result.cookie ?? []).join(';'),
      },
      cookie: result.cookie,
    }
    return result
  } catch {
    // 上游非 2xx：返回空体降级（catch 作用域内无 result，不可引用）
    return {
      status: 200,
      body: {},
      cookie: [],
    }
  }
}

/* ---------- login_qr_create  (/login/qr/create) ---------- */

/* 自动转换自 api-enhanced module/login_qr_create.js（类型修正版） */

export const login_qr_create = async (query: NcmQuery) => {
  const platform = query.platform || "pc";
  const cookie = query.cookie || "";

  // 构建基础URL
  let url = `https://music.163.com/login?codekey=${query.key}`;

  // 如果是web平台，则添加chainId参数
  if (platform === "web") {
    const chainId = generateChainId(cookie);
    url += `&chainId=${chainId}`;
  }

  return {
    code: 200,
    status: 200,
    body: {
      code: 200,
      data: {
        qrurl: url,
        qrimg: query.qrimg ? await QRCode.toDataURL(url) : "",
      },
    },
    cookie: [],
  };
};

/* ---------- login_qr_key  (/login/qr/key) ---------- */

/* 自动转换自 api-enhanced module/login_qr_key.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const login_qr_key = async (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    type: 3,
  }
  const result = await request(
    `/api/login/qrcode/unikey`,
    data,
    createOption(query),
  )
  return {
    status: 200,
    body: {
      data: result.body,
      code: 200,
    },
    cookie: result.cookie,
  }
}

/* ---------- login_refresh  (/login/refresh) ---------- */

/* 自动转换自 api-enhanced module/login_refresh.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 登录刷新

export const login_refresh = async (query: NcmQuery, request: NcmRequestFn) => {
  let result = await request(
    `/api/login/token/refresh`,
    {},
    createOption(query),
  )
  if (result.body.code === 200) {
    result = {
      status: 200,
      body: {
        ...result.body,
        cookie: (result.cookie ?? []).join(';'),
      },
      cookie: result.cookie,
    }
  }
  return result
}

/* ---------- login_status  (/login/status) ---------- */

/* 自动转换自 api-enhanced module/login_status.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const login_status = async (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  let result = await request(
    `/api/w/nuser/account/get`,
    data,
    createOption(query, 'weapi'),
  )
  if (result.body.code === 200) {
    result = {
      status: 200,
      body: {
        data: {
          ...result.body,
        },
      },
      cookie: result.cookie,
    }
  }
  return result
}

/* ---------- logout  (/logout) ---------- */

/* 自动转换自 api-enhanced module/logout.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 退出登录

export const logout = (query: NcmQuery, request: NcmRequestFn) => {
  return request(`/api/logout`, {}, createOption(query))
}

/* ---------- nickname_check  (/nickname/check) ---------- */

/* 自动转换自 api-enhanced module/nickname_check.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const nickname_check = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    nickname: query.nickname,
  }
  return request(`/api/nickname/duplicated`, data, createOption(query, 'weapi'))
}

/* ---------- rebind  (/rebind) ---------- */

/* 自动转换自 api-enhanced module/rebind.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 更换手机

export const rebind = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    captcha: query.captcha,
    phone: query.phone,
    oldcaptcha: query.oldcaptcha,
    ctcode: query.ctcode || '86',
  }
  return request(
    `/api/user/replaceCellphone`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- register_anonimous  (/register/anonimous) ---------- */

/** 获取游客 cookie — 对齐 api-enhanced module/register_anonimous.js（xeapi 注册 + cookie 拼接） */

const register_anonimous__handler: NcmModule = async (query: NcmQuery, request: NcmRequestFn) => {
  let result = await registerAnonymousToken(request, query);
  if (result.body.code === 200) {
    result = {
      status: 200,
      body: {
        ...result.body,
        cookie: result.cookie.join(";"),
      },
      cookie: result.cookie,
    };
  }
  return result;
};

export const register_anonimous = register_anonimous__handler;

/* ---------- register_cellphone  (/register/cellphone) ---------- */

/* 自动转换自 api-enhanced module/register_cellphone.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 注册账号

export const register_cellphone = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    captcha: query.captcha,
    phone: query.phone,
    password: CryptoJS.MD5(query.password).toString(),
    nickname: query.nickname,
    countrycode: query.countrycode || '86',
    force: 'false',
  }
  return request(`/api/w/register/cellphone`, data, createOption(query))
}

/* ---------- register_checktoken_v2  (/register/checktoken/v2) ---------- */

/** 易盾反作弊 token v2 — 对齐 api-enhanced module/register_checktoken_v2.js（jsdom 可选，未安装降级空 token） */

const register_checktoken_v2__handler: NcmModule = async () => checktokenHandler("v2");

export const register_checktoken_v2 = register_checktoken_v2__handler;

/* ---------- register_checktoken_v3  (/register/checktoken/v3) ---------- */

/** 易盾反作弊 token v3 — 对齐 api-enhanced module/register_checktoken_v3.js（直接 HTTP 获取） */

const register_checktoken_v3__handler: NcmModule = async () => checktokenHandler("v3");

export const register_checktoken_v3 = register_checktoken_v3__handler;

/* ---------- register_xeapikey  (/register/xeapikey) ---------- */

/** xeapi 公钥注册 — 对齐 api-enhanced module/register_xeapikey.js */

const register_xeapikey__handler: NcmModule = async (query: NcmQuery) => {
  return registerXeapiKey({
    deviceId: query.deviceId,
    currentKeyVersion: query.currentKeyVersion,
  });
};

export const register_xeapikey = register_xeapikey__handler;

/* ---------- user_binding  (/user/binding) ---------- */

/* 自动转换自 api-enhanced module/user_binding.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const user_binding = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {}
  return request(
    `/api/v1/user/bindings/${query.uid}`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- user_bindingcellphone  (/user/bindingcellphone) ---------- */

/* 自动转换自 api-enhanced module/user_bindingcellphone.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const user_bindingcellphone = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    phone: query.phone,
    countrycode: query.countrycode || '86',
    captcha: query.captcha,
    password: query.password ? CryptoJS.MD5(query.password).toString() : '',
  }
  return request(
    `/api/user/bindingCellphone`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- user_replacephone  (/user/replacephone) ---------- */

/* 自动转换自 api-enhanced module/user_replacephone.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const user_replacephone = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    phone: query.phone,
    captcha: query.captcha,
    oldcaptcha: query.oldcaptcha,
    countrycode: query.countrycode || '86',
  }
  return request(
    `/api/user/replaceCellphone`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- verify_getQr  (/verify/getQr) ---------- */

/* 自动转换自 api-enhanced module/verify_getQr.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const verify_getQr = async (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    verifyConfigId: query.vid,
    verifyType: query.type,
    token: query.token,
    params: JSON.stringify({
      event_id: query.evid,
      sign: query.sign,
    }),
    size: 150,
  }

  const res = await request(
    `/api/frontrisk/verify/getqrcode`,
    data,
    createOption(query, 'weapi'),
  )
  const result = `https://st.music.163.com/encrypt-pages?qrCode=${
    res.body.data.qrCode
  }&verifyToken=${query.token}&verifyId=${query.vid}&verifyType=${
    query.type
  }&params=${JSON.stringify({
    event_id: query.evid,
    sign: query.sign,
  })}`
  return {
    status: 200,
    body: {
      code: 200,
      data: {
        qrCode: res.body.data.qrCode,
        qrurl: result,
        qrimg: await QRCode.toDataURL(result),
      },
    },
  }
}

/* ---------- verify_qrcodestatus  (/verify/qrcodestatus) ---------- */

/* 自动转换自 api-enhanced module/verify_qrcodestatus.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const verify_qrcodestatus = async (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    qrCode: query.qr,
  }
  const res = await request(
    `/api/frontrisk/verify/qrcodestatus`,
    data,
    createOption(query, 'weapi'),
  )
  return res
}
