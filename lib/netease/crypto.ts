/**
 * 网易云全量加密实现 — 对齐 api-enhanced util/crypto.js
 * weapi / linuxapi / eapi / xeapi，全部基于 Node 内置 crypto + zlib，零第三方依赖
 */
import crypto from "node:crypto";
import zlib from "node:zlib";

const iv = "0102030405060708";
const presetKey = "0CoJUm6Qyw8W8jud";
const linuxapiKey = "rFgB&h#%2?^eDg:Q";
const base62 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const eapiKey = "e82ckenh8dichen8";
const xeapiStaticKey = Buffer.from(
  "ab1d5a430f6bb04a3f01e81ddd72bd916d5ce591248ac128714806d7f8fb1b84",
  "hex",
);
const xeapiSignKey =
  "mUHCwVNWJbunMqAHf5MImuirT6plvs6VSFW62MGHstFQxhBGdEoIhLItH3djc4+FB/OKty3+lL2rGeoFBpVe5g==";
const x25519SpkiPrefix = Buffer.from("302a300506032b656e032100", "hex");

// ---------------------------------------------------------------------------
// AES（对齐 CryptoJS.AES：CBC/ECB + PKCS7，base64 / 大写 hex 输出）
// ---------------------------------------------------------------------------

function aesEncrypt(text: string, mode: string, key: string, ivStr: string, format = "base64"): string {
  const keyBuf = Buffer.from(key, "utf8");
  const algo = `aes-${keyBuf.length * 8}-${mode.toLowerCase()}` as const;
  const cipher = crypto.createCipheriv(
    algo,
    keyBuf,
    mode.toLowerCase() === "cbc" ? Buffer.from(ivStr, "utf8") : null,
  );
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return format === "base64" ? enc.toString("base64") : enc.toString("hex").toUpperCase();
}

/** AES 解密（WordArray 兼容返回，供 decrypt 模块 toString(CryptoJS.enc.Utf8) 使用） */
export function aesDecrypt(
  ciphertext: string,
  mode: string,
  key: string,
  ivStr: string,
  format = "base64",
): { toString: (enc?: { stringify: (b: Buffer) => string }) => string; buf: Buffer } {
  const buf = aesDecryptToBuffer(ciphertext, mode, key, ivStr, format);
  return {
    buf,
    toString: (enc?: { stringify: (b: Buffer) => string }) =>
      enc ? enc.stringify(buf) : buf.toString("utf8"),
  };
}

function aesDecryptToBuffer(ciphertext: string, mode: string, key: string, ivStr: string, format = "base64"): Buffer {
  const keyBuf = Buffer.from(key, "utf8");
  const algo = `aes-${keyBuf.length * 8}-${mode.toLowerCase()}` as const;
  const decipher = crypto.createDecipheriv(
    algo,
    keyBuf,
    mode.toLowerCase() === "cbc" ? Buffer.from(ivStr, "utf8") : null,
  );
  const input = format === "base64" ? Buffer.from(ciphertext, "base64") : Buffer.from(ciphertext, "hex");
  return Buffer.concat([decipher.update(input), decipher.final()]);
}

/** RSA 无填充模幂（对齐 forge NONE padding：text^pub % mod，hex 输出） */
function rsaModPowHex(str: string): string {
  const biText = BigInt("0x" + Buffer.from(str, "utf8").toString("hex"));
  const biPub = 0x10001n;
  const biMod = BigInt(
    "0x00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7",
  );
  let result = 1n;
  let base = biText % biMod;
  let exp = biPub;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % biMod;
    base = (base * base) % biMod;
    exp >>= 1n;
  }
  return result.toString(16).padStart(256, "0");
}

// ---------------------------------------------------------------------------
// weapi / linuxapi / eapi
// ---------------------------------------------------------------------------

export function weapi(object: Record<string, any>): { params: string; encSecKey: string } {
  const text = JSON.stringify(object);
  let secretKey = "";
  for (let i = 0; i < 16; i++) {
    secretKey += base62.charAt(Math.round(Math.random() * 61));
  }
  return {
    params: aesEncrypt(aesEncrypt(text, "cbc", presetKey, iv), "cbc", secretKey, iv),
    encSecKey: rsaModPowHex(secretKey.split("").reverse().join("")),
  };
}

export function linuxapi(object: Record<string, any>): { eparams: string } {
  return { eparams: aesEncrypt(JSON.stringify(object), "ecb", linuxapiKey, "", "hex") };
}

export function eapi(url: string, object: Record<string, any> | string): { params: string } {
  const text = typeof object === "object" ? JSON.stringify(object) : object;
  const message = `nobody${url}use${text}md5forencrypt`;
  const digest = crypto.createHash("md5").update(message, "utf8").digest("hex");
  const data = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
  return { params: aesEncrypt(data, "ecb", eapiKey, "", "hex") };
}

export function eapiResDecrypt(encryptedParams: string, aeapi = false): any {
  try {
    const decrypted = aesDecryptToBuffer(encryptedParams, "ecb", eapiKey, "", "hex");
    if (aeapi) {
      const decompressed = zlib.gunzipSync(decrypted);
      return JSON.parse(decompressed.toString());
    }
    return JSON.parse(decrypted.toString("utf8"));
  } catch (error) {
    console.log(`eapiResDecrypt error:`, error);
    return null;
  }
}

export function eapiReqDecrypt(encryptedParams: string): { url: string; data: any } | null {
  const decryptedData = aesDecryptToBuffer(encryptedParams, "ecb", eapiKey, "", "hex").toString("utf8");
  const match = decryptedData.match(/(.*?)-36cd479b6b5-(.*?)-36cd479b6b5-(.*)/);
  if (match) {
    return { url: match[1], data: JSON.parse(match[2]) };
  }
  return null;
}

export function decrypt(cipher: string): string {
  return aesDecryptToBuffer(cipher, "ecb", eapiKey, "", "hex").toString("utf8");
}

// ---------------------------------------------------------------------------
// xeapi（X25519 + AES-GCM + AES-ECB 三层）
// ---------------------------------------------------------------------------

function aesEcbEncryptBuf(key: Buffer, plaintext: Buffer): Buffer {
  const cipher = crypto.createCipheriv(`aes-${key.length * 8}-ecb`, key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

function aesEcbDecryptBuf(key: Buffer, ciphertext: Buffer): Buffer {
  const decipher = crypto.createDecipheriv(`aes-${key.length * 8}-ecb`, key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function createX25519PublicKey(raw: Buffer): crypto.KeyObject {
  return crypto.createPublicKey({
    key: Buffer.concat([x25519SpkiPrefix, raw]),
    format: "der",
    type: "spki",
  });
}

function deriveX25519AesKey(sharedSecret: Buffer, ephemeralPublicKey: Buffer): Buffer {
  const prk = crypto
    .createHmac("sha256", Buffer.alloc(32))
    .update(sharedSecret.length ? sharedSecret : Buffer.alloc(32))
    .digest();
  return crypto
    .createHmac("sha256", prk)
    .update(Buffer.concat([ephemeralPublicKey, Buffer.from([1])]))
    .digest()
    .subarray(0, 16);
}

export function xeapiSign(timestamp: string | number, nonce: string): string {
  return crypto
    .createHmac("sha256", xeapiSignKey)
    .update(String(timestamp) + nonce)
    .digest("base64");
}

function xeapiMidTransform(ciphertext: Buffer): Buffer {
  const random = crypto.randomBytes(16);
  const xored = Buffer.alloc(ciphertext.length);
  for (let i = 0; i < ciphertext.length; i++) {
    xored[i] = ciphertext[i] ^ random[i & 0x0f];
  }
  const b64 = Buffer.from(xored.toString("base64"));
  const rot = b64.length ? (random[0] & 0x0f) % b64.length : 0;
  return Buffer.concat([random, b64.subarray(rot), b64.subarray(0, rot)]);
}

function xeapiEncryptS(dynamicKey: Buffer, publicKeyState: any, os: string): Buffer {
  const peerRaw = Buffer.from(publicKeyState.publicKey, "base64");
  const peerKey = createX25519PublicKey(peerRaw);
  const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
  const ephemeralRaw = Buffer.from(publicKey.export({ format: "der", type: "spki" })).subarray(-32);
  const sharedSecret = crypto.diffieHellman({ privateKey, publicKey: peerKey });
  const aesKey = deriveX25519AesKey(sharedSecret, ephemeralRaw);
  const ivBuf = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-128-gcm", aesKey, ivBuf);
  const plaintext = Buffer.from(
    `${dynamicKey.toString("base64")}|${os}|${publicKeyState.sk || ""}`,
  );
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([ephemeralRaw, ivBuf, encrypted, cipher.getAuthTag()]);
}

function buildXeapiPlaintext(uri: string, data: any, options: Record<string, any> = {}): string {
  const fields: Record<string, any> = {};
  const contentType =
    options.contentType || "application/x-www-form-urlencoded;charset=utf-8";
  const mediaType = contentType.split(";", 1)[0].toLowerCase();
  if (mediaType !== "application/x-www-form-urlencoded") {
    fields.contentType = contentType;
  }
  const method = (options.method || "POST").toUpperCase();
  if (method !== "POST") fields.method = method;

  const url = new URL(uri, "https://interface.music.163.com");
  if (url.search) fields.queryString = url.search.slice(1);

  if (data !== undefined && data !== null) {
    const bodyData = { ...data };
    delete bodyData.e_r;
    fields.body = Buffer.from(new URLSearchParams(bodyData).toString()).toString("base64");
  }

  fields.queryString = fields.queryString
    ? `${fields.queryString}&e_r=true`
    : "e_r=true";
  return JSON.stringify(fields);
}

export interface XeapiOptions {
  publicKeyState: any;
  sessionId?: string;
  sessionKey?: string;
  os?: string;
  contentType?: string;
  method?: string;
}

export function xeapi(uri: string, data: any, options: XeapiOptions): { B: string; S: string; R: string } {
  const publicKeyState = options.publicKeyState;
  if (!publicKeyState) {
    throw new Error("xeapi publicKeyState is required");
  }
  const activeSessionKey = options.sessionKey ? Buffer.from(String(options.sessionKey)) : null;
  const activeSessionId = options.sessionId || "";
  const dynamicKey = activeSessionKey || crypto.randomBytes(16);
  const plaintext = Buffer.from(buildXeapiPlaintext(uri, data, options as any));

  const b = aesEcbEncryptBuf(
    dynamicKey,
    xeapiMidTransform(aesEcbEncryptBuf(xeapiStaticKey, plaintext)),
  );
  const s = xeapiEncryptS(dynamicKey, publicKeyState, options.os || "android");
  const r = aesEcbEncryptBuf(
    xeapiStaticKey,
    Buffer.from(`${publicKeyState.version}|${activeSessionKey ? activeSessionId : ""}`),
  );

  return { B: b.toString("base64"), S: s.toString("base64"), R: r.toString("base64") };
}

export function xeapiResDecrypt(body: Buffer): any {
  const decrypted = aesEcbDecryptBuf(Buffer.from(eapiKey, "utf8"), body);
  const plaintext =
    decrypted[0] === 0x1f && decrypted[1] === 0x8b ? zlib.gunzipSync(decrypted) : decrypted;
  return JSON.parse(plaintext.toString());
}

export function xeapiDecryptPublicKey(encryptedData: string): any {
  return JSON.parse(aesEcbDecryptBuf(xeapiStaticKey, Buffer.from(encryptedData, "base64")).toString());
}

export function randomHexWordArray(bytes: number): string {
  return crypto.randomBytes(bytes).toString("hex");
}
