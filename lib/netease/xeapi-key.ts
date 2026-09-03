/**
 * xeapi 公钥注册 — 对齐 api-enhanced module/register_xeapikey.js + util/xeapiKey.js
 * 公钥内存缓存；GetXeapiPublicKey 供 request.ts xeapi 分支使用
 */
import axiosLike from "./axios-compat";
import { APP_CONF } from "./config";
import { xeapiSign, xeapiDecryptPublicKey } from "./crypto";
import { ncmGlobals } from "./global-state";

export interface XeapiPublicKeyState {
  version: string;
  publicKey: string;
  sk?: string;
  [key: string]: any;
}

let cachedPublicKey: XeapiPublicKeyState | null = null;

const generateNonce = (): string => {
  let nonce = "";
  for (let i = 0; i < 16; i++) {
    nonce += Math.floor(Math.random() * 10).toString();
  }
  return nonce;
};

/** register_xeapikey 模块主体（可独立作为 /register/xeapikey 调用） */
export async function registerXeapiKey(query: { deviceId?: string; currentKeyVersion?: string } = {}) {
  const nonce = generateNonce();
  const timestamp = String(Date.now());
  const deviceId = query.deviceId || ncmGlobals.deviceId || "";
  const currentKeyVersion = query.currentKeyVersion || "";

  const data: Record<string, string> = {
    appVersion: "9.5.61",
    currentKeyVersion,
    deviceId,
    nonce,
    os: "android",
    requestType: "active",
    signature: xeapiSign(timestamp, nonce),
    t1: "",
    t2: "",
    timestamp,
    uid: "",
  };

  const res = await axiosLike.post(
    APP_CONF.apiDomain + "/api/gorilla/anti/crawler/security/key/get",
    new URLSearchParams(data).toString(),
    {
      headers: {
        "User-Agent":
          "NeteaseMusic/9.5.61.260802021928(9005061);Dalvik/2.1.0 (Linux; U; Android 12; HBN-AL00 Build/cd737a2.0)",
        Cookie: deviceId ? `deviceId=${encodeURIComponent(deviceId)}` : "",
      },
      timeout: 10000,
    },
  );

  if (
    !res.data ||
    res.data.code !== 200 ||
    !res.data.data ||
    !res.data.data.encryptedData
  ) {
    throw new Error("xeapi public key request failed");
  }
  if (
    !res.data.data.signature ||
    xeapiSign(res.data.data.timestamp, nonce) !== res.data.data.signature
  ) {
    throw new Error("xeapi public key response signature mismatch");
  }

  const publicKey = xeapiDecryptPublicKey(res.data.data.encryptedData);
  if (!publicKey.sk) {
    throw new Error("xeapi public key response missing sk");
  }
  return { status: 200, body: { ...publicKey, deviceId }, cookie: [] };
}

/** 获取（并缓存）xeapi 公钥 — 对齐 util/xeapiKey.js getXeapiPublicKey */
export async function getXeapiPublicKey(
  currentPublicKey: Partial<XeapiPublicKeyState> = {},
  deviceId = "",
): Promise<XeapiPublicKeyState> {
  const result = await registerXeapiKey({
    deviceId,
    currentKeyVersion: (currentPublicKey as any).version || "",
  });
  const publicKey = result.body;
  if (!publicKey.sk && currentPublicKey.sk) {
    publicKey.sk = currentPublicKey.sk;
  }
  if (!publicKey.sk) {
    throw new Error("xeapi public key response missing sk");
  }
  cachedPublicKey = publicKey;
  return publicKey;
}

export function getCachedXeapiPublicKey(): XeapiPublicKeyState | null {
  return cachedPublicKey;
}

export function setCachedXeapiPublicKey(key: XeapiPublicKeyState | null): void {
  cachedPublicKey = key;
}
