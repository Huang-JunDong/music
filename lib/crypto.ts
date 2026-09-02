/**
 * 网易云音乐接口加密（从 go-music-dl / music-lib netease/crypto.go 移植）
 * 全部使用 Node 内置 crypto + BigInt，零第三方依赖
 */
import crypto from "node:crypto";

const LINUX_API_KEY_HEX = "7246674226682325323F5E6544673A51";
const WEAPI_NONCE = "0CoJUm6Qyw8W8jud";
const WEAPI_IV = "0102030405060708";
const WEAPI_PUB_KEY = "010001";
const WEAPI_MODULUS =
  "00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7";
const EAPI_KEY = "e82ckenh8dichen8";

function aesEcbEncrypt(data: Buffer, key: Buffer): Buffer {
  const cipher = crypto.createCipheriv(`aes-${key.length * 8}-ecb`, key, null);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

function aesCbcEncryptBase64(text: string, key: string, iv: string): string {
  const cipher = crypto.createCipheriv("aes-128-cbc", Buffer.from(key, "utf8"), Buffer.from(iv, "utf8"));
  return Buffer.concat([cipher.update(text, "utf8"), cipher.final()]).toString("base64");
}

function randomString(size: number): string {
  const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  const bytes = crypto.randomBytes(size);
  for (let i = 0; i < size; i++) {
    result += letters[bytes[i] % letters.length];
  }
  return result;
}

/** RSA 无填充模幂：text^pub % mod（与 Go big.Int.Exp 等价） */
function rsaModPow(secretKey: string, pubKey: string, modulus: string): string {
  const reversed = [...secretKey].reverse().join("");
  const biText = BigInt("0x" + Buffer.from(reversed, "utf8").toString("hex"));
  const biPub = BigInt("0x" + pubKey);
  const biMod = BigInt("0x" + modulus);

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

/** Linux forward API 加密（搜索用），返回大写 HEX */
export function encryptLinuxParams(data: string): string {
  const key = Buffer.from(LINUX_API_KEY_HEX, "hex");
  return aesEcbEncrypt(Buffer.from(data, "utf8"), key).toString("hex").toUpperCase();
}

/** WeApi 加密，返回表单 { params, encSecKey } */
export function encryptWeApi(text: string): { params: string; encSecKey: string } {
  const secKey = randomString(16);
  const encText = aesCbcEncryptBase64(aesCbcEncryptBase64(text, WEAPI_NONCE, WEAPI_IV), secKey, WEAPI_IV);
  const encSecKey = rsaModPow(secKey, WEAPI_PUB_KEY, WEAPI_MODULUS);
  return { params: encText, encSecKey };
}

/** EApi 加密（VIP 高音质用） */
export function encryptEApi(urlPath: string, payload: string): string {
  const path = urlPath.replace("/eapi/", "/api/");
  const digest = crypto
    .createHash("md5")
    .update(`nobody${path}use${payload}md5forencrypt`, "utf8")
    .digest("hex");
  const data = `${path}-36cd479b6b5-${payload}-36cd479b6b5-${digest}`;
  return aesEcbEncrypt(Buffer.from(data, "utf8"), Buffer.from(EAPI_KEY, "utf8")).toString("hex");
}

export function md5hex(input: string): string {
  return crypto.createHash("md5").update(input, "utf8").digest("hex");
}
