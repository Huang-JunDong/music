/**
 * QIMEI 设备标识申请 — 移植自 .ref/QQMusicApi qqmusic_api/utils/qimei.py。
 * RSA(PKCS1v15) 加密 AES 密钥 → AES-128-CBC 加密 payload → MD5 签名 →
 * POST https://api.tencentmusic.com/tme/trpc/proxy 获取 q16/q36，缓存 24h（存于设备文件）。
 */
import { createCipheriv, createHash, publicEncrypt, constants as cryptoConstants } from "node:crypto";

import type { QQDevice } from "./device";
import { applyQimei, getDevice } from "./device";
import { md5Hex } from "./utils";
import { NetworkError } from "./errors";
import { getProfile } from "./versioning";

const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDEIxgwoutfwoJxcGQeedgP7FG9qaIuS0qzfR8gWkrkTZKM2iWHn2ajQpBRZjMSoSf6+KJGvar2ORhBfpDXyVtZCKpqLQ+FLkpncClKVIrBwv6PHyUvuCb0rIarmgDnzkfQAqVufEtR64iazGDKatvJ9y6B9NMbHddGSAUmRTCrHQIDAQAB
-----END PUBLIC KEY-----`;
const SECRET = "ZdJqM15EeO2zWc08";
const APP_KEY = "0AND0HD6FE4HY80F";
const CHANNEL_ID = "10003505";
const PACKAGE_ID = "com.tencent.qqmusic";
const HEX_CHARS = "0123456789abcdef";

const randHexChars = (n: number) =>
  Array.from({ length: n }, () => HEX_CHARS[Math.floor(Math.random() * HEX_CHARS.length)]).join("");

export interface QimeiResult {
  q16: string;
  q36: string;
}

let memoryCache: QimeiResult | null = null;
let inflight: Promise<QimeiResult> | null = null;

function aesEncrypt(key: Buffer, content: Buffer): Buffer {
  // 对齐 Python：手工 PKCS7 填充 + AES-CBC(key 同时作为 IV) NoPadding
  const padSize = 16 - (content.length % 16);
  const padded = Buffer.concat([content, Buffer.alloc(padSize, padSize)]);
  const cipher = createCipheriv("aes-128-cbc", key, key);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]);
}

function rsaEncrypt(content: Buffer): Buffer {
  return publicEncrypt(
    { key: PUBLIC_KEY_PEM, padding: cryptoConstants.RSA_PKCS1_PADDING },
    content,
  );
}

function randomBeaconId(): string {
  const timeMonth = new Date().toISOString().slice(0, 7) + "-01";
  const rand1 = 100000 + Math.floor(Math.random() * 900000);
  const rand2 = 100000000 + Math.floor(Math.random() * 900000000);
  const fixedIdx = new Set([1, 2, 13, 14, 17, 18, 21, 22, 25, 26, 29, 30, 33, 34, 37, 38]);
  const parts: string[] = [];
  for (let i = 1; i <= 40; i++) {
    if (fixedIdx.has(i)) parts.push(`k${i}:${timeMonth}${rand1}.${rand2}`);
    else if (i === 3) parts.push("k3:0000000000000000");
    else if (i === 4) parts.push(`k4:${randHexChars(16).slice(0, 15).replace(/0/g, "1")}`);
    else parts.push(`k${i}:${Math.floor(Math.random() * 10000)}`);
  }
  return parts.join(";");
}

function randomPayload(device: QQDevice, version: string, sdkVersion: string): Record<string, unknown> {
  const fixedRand = Math.floor(Math.random() * 14401);
  const upTime = new Date(Date.now() - fixedRand * 1000).toISOString().replace("T", " ").slice(0, 19);
  const reserved = {
    harmony: "0",
    clone: "0",
    containe: "",
    oz: "UhYmelwouA+V2nPWbOvLTgN2/m8jwGB+yUB5v9tysQg=",
    oo: "Xecjt+9S1+f8Pz2VLSxgpw==",
    kelong: "0",
    uptimes: upTime,
    multiUser: "0",
    bod: device.brand,
    dv: device.device,
    firstLevel: "",
    manufact: device.brand,
    name: device.model,
    host: "se.infra",
    kernel: device.proc_version,
  };
  return {
    androidId: device.android_id,
    platformId: 1,
    appKey: APP_KEY,
    appVersion: version,
    beaconIdSrc: randomBeaconId(),
    brand: device.brand,
    channelId: CHANNEL_ID,
    cid: "",
    imei: device.imei,
    imsi: "",
    mac: "",
    model: device.model,
    networkType: "unknown",
    oaid: "",
    osVersion: `Android ${device.version.release},level ${device.version.sdk}`,
    qimei: "",
    qimei36: "",
    sdkVersion,
    targetSdkVersion: "33",
    audit: "",
    userId: "{}",
    packageId: PACKAGE_ID,
    deviceType: "Phone",
    sdkName: "",
    reserved: JSON.stringify(reserved),
  };
}

async function requestQimei(device: QQDevice): Promise<QimeiResult> {
  const profile = getProfile("android");
  const version = profile.qimeiAppVersion ?? "14.9.0.8";
  const sdkVersion = profile.qimeiSdkVersion ?? "1.2.13.6";
  const payload = randomPayload(device, version, sdkVersion);
  const cryptKey = randHexChars(16);
  const nonce = randHexChars(16);
  const ts = Math.floor(Date.now() / 1000);

  const key = rsaEncrypt(Buffer.from(cryptKey, "utf-8")).toString("base64");
  const params = aesEncrypt(Buffer.from(cryptKey, "utf-8"), Buffer.from(JSON.stringify(payload), "utf-8")).toString("base64");
  const extra = `{"appKey":"${APP_KEY}"}`;
  const reqSign = md5Hex(key, params, String(ts * 1000), nonce, SECRET, extra);

  const headers: Record<string, string> = {
    Host: "api.tencentmusic.com",
    method: "GetQimei",
    service: "trpc.tme_datasvr.qimeiproxy.QimeiProxy",
    appid: "qimei_qq_android",
    sign: md5Hex(`qimei_qq_androidpzAuCmaFAaFaHrdakPjLIEqKrGnSOOvH`, String(ts)),
    "user-agent": "QQMusic",
    timestamp: String(ts),
  };
  const body = {
    app: 0,
    os: 1,
    qimeiParams: { key, params, time: String(ts), nonce, sign: reqSign, extra },
  };

  const res = await fetch("https://api.tencentmusic.com/tme/trpc/proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new NetworkError(`QIMEI HTTP ${res.status}`);
  const outer = (await res.json()) as { data?: string };
  const inner = JSON.parse(outer.data ?? "{}") as { data?: { q16?: string; q36?: string } };
  const qimeiData = inner.data ?? {};
  if (!qimeiData.q16 || !qimeiData.q36) {
    throw new NetworkError(`QIMEI response missing required fields: ${JSON.stringify(qimeiData)}`);
  }
  return { q16: qimeiData.q16, q36: qimeiData.q36 };
}

/** 获取（并缓存）当前设备 QIMEI；24h 过期自动重新申请，进程内合并并发请求 */
export async function ensureQimei(): Promise<QimeiResult> {
  const device = getDevice();
  const now = Math.floor(Date.now() / 1000);
  const expired = device.qimei_save_time === null || now - device.qimei_save_time >= 86400;
  if (!expired && memoryCache) return memoryCache;
  if (!expired && device.qimei && device.qimei36) {
    memoryCache = { q16: device.qimei, q36: device.qimei36 };
    return memoryCache;
  }
  if (!inflight) {
    inflight = requestQimei(device)
      .then((result) => {
        memoryCache = result;
        try {
          applyQimei(result.q16 || "", result.q36 || "");
        } catch {
          /* 保存失败不影响本次结果 */
        }
        return result;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export { createHash };
