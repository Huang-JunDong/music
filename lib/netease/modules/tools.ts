import type { NcmQuery, NcmRequestFn } from '../types';
/* tools.ts — 功能家族合并文件（6 个接口，由 439 个独立模块合并生成） */
/* ---------- api  (/api) ---------- */
/* 自动转换自 api-enhanced module/api.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

import { cookieToJson } from "../utils";
import { createOption } from "../option";
import type { NcmModule } from "../types";
import uploadPlugin from "../plugins/upload";
import { eapiResDecrypt, eapiReqDecrypt, aesDecrypt, xeapiResDecrypt } from "../crypto";
import CryptoJS from "../crypto-js-compat";
import pkg from "../../../package.json";

export const api = (query: NcmQuery, request: NcmRequestFn) => {
  const uri = query.uri
  let data: any = {}
  try {
    data =
      typeof query.data === 'string' ? JSON.parse(query.data) : query.data || {}
    if (typeof data.cookie === 'string') {
      data.cookie = cookieToJson(data.cookie)
      query.cookie = data.cookie
    }
  } catch (e) {
    data = {}
  }

  const crypto = query.crypto || ''

  const res = request(uri, data, createOption(query, crypto))
  return res
}

/* ---------- avatar_upload  (/avatar/upload) ---------- */

/** 头像上传 — 对齐 api-enhanced module/avatar_upload.js */

const avatar_upload__handler: NcmModule = async (query: NcmQuery, request: NcmRequestFn) => {
  const uploadInfo = await uploadPlugin(query, request);
  const res = await request(
    `/api/user/avatar/upload/v1`,
    { imgid: uploadInfo.imgId },
    createOption(query),
  );
  return {
    status: 200,
    body: {
      code: 200,
      data: {
        ...uploadInfo,
        ...res.body,
      },
    },
  };
};

export const avatar_upload = avatar_upload__handler;

/* ---------- batch  (/batch) ---------- */

/* 自动转换自 api-enhanced module/batch.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 批量请求接口

export const batch = (query: NcmQuery, request: NcmRequestFn) => {
  const data: Record<string, any> = {}
  Object.keys(query).forEach((i) => {
    if (/^\/api\//.test(i)) {
      data[i] = query[i]
    }
  })
  return request(`/api/batch`, data, createOption(query))
}

/* ---------- decrypt  (/decrypt) ---------- */

/* 自动转换自 api-enhanced module/decrypt.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

const decrypt__linuxapiKey = 'rFgB&h#%2?^eDg:Q'

export const decrypt = async (query: NcmQuery, request: NcmRequestFn) => {
  const crypto = query.crypto || 'eapi'
  const data = query.data || query.hexString || ''
  const isReq = query.isReq !== 'false'

  if (!data) {
    return {
      status: 400,
      body: { code: 400, message: 'data is required' },
    }
  }

  try {
    let result
    switch (crypto) {
      case 'eapi': {
        const pureHex = data.replace(/\s/g, '')
        result = isReq ? eapiReqDecrypt(pureHex) : eapiResDecrypt(pureHex)
        break
      }

      case 'weapi': {
        if (isReq) {
          return {
            status: 400,
            body: {
              code: 400,
              message:
                'weapi 请求解密需要 RSA 私钥，暂不支持；仅支持 weapi 返回数据解密（e_r=true 时与 eapi 相同）',
            },
          }
        }
        const pureHex = data.replace(/\s/g, '')
        result = eapiResDecrypt(pureHex)
        break
      }

      case 'linuxapi': {
        if (isReq) {
          const pureHex = data.replace(/\s/g, '')
          const decrypted = aesDecrypt(pureHex, 'ecb', decrypt__linuxapiKey, '', 'hex')
          result = JSON.parse(decrypted.toString())
        } else {
          result = typeof data === 'string' ? JSON.parse(data) : data
        }
        break
      }

      case 'xeapi': {
        if (isReq) {
          return {
            status: 400,
            body: {
              code: 400,
              message:
                'xeapi 请求解密涉及 X25519 ECDH 密钥交换，流程复杂，暂不支持；仅支持 xeapi 返回数据解密',
            },
          }
        }
        const buf = Buffer.from(data, 'base64')
        result = xeapiResDecrypt(buf)
        break
      }

      case 'api': {
        result = typeof data === 'string' ? JSON.parse(data) : data
        break
      }

      default:
        return {
          status: 400,
          body: { code: 400, message: `未知加密方式: ${crypto}` },
        }
    }

    return {
      status: 200,
      body: { code: 200, data: result },
    }
  } catch (error: any) {
    return {
      status: 400,
      body: { code: 400, message: `解密失败: ${error.message}` },
    }
  }
}

/* ---------- eapi_decrypt  (/eapi/decrypt) ---------- */

/* 自动转换自 api-enhanced module/eapi_decrypt.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const eapi_decrypt = async (query: NcmQuery, request: NcmRequestFn) => {
  const hexString = query.hexString
  const isReq = query.isReq != 'false'
  if (!hexString) {
    return {
      status: 400,
      body: {
        code: 400,
        message: 'hex string is required',
      },
    }
  }
  // 去除空格
  let pureHexString = hexString.replace(/\s/g, '')
  return {
    status: 200,
    body: {
      code: 200,
      data: isReq
        ? eapiReqDecrypt(pureHexString)
        : eapiResDecrypt(pureHexString),
    },
  }
}

/* ---------- inner_version  (/inner/version) ---------- */

/* 自动转换自 api-enhanced module/inner_version.js（类型修正版） */

export const inner_version = async (query: NcmQuery, request: NcmRequestFn) => {
  return {
    code: 200,
    status: 200,
    body: {
      code: 200,
      data: {
        version: pkg.version,
      },
    },
    cookie: [],
  };
};
