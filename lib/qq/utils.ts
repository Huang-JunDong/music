/**
 * QQ 音乐 API 工具函数 — 移植自 .ref/QQMusicApi qqmusic_api/utils/common.py 与 algorithms/sign.py
 * 包含 hash33（g_tk / ptqrtoken）、zzc 签名（musics.fcg 签名请求）、searchID、bool→int 递归转换。
 */
import { createHash, randomUUID } from "node:crypto";

/** Hash33 算法：QQ 系 g_tk / ptqrtoken 计算（对齐 Python 无限精度最后取模 2^31 的语义） */
export function hash33(s: string, h = 0): number {
  for (const c of s) {
    h = (h * 33 + c.codePointAt(0)!) % 0x8000_0000;
  }
  return h & 0x7fff_ffff;
}

/** 32 位随机 GUID（小写 hex，无连字符） */
export function getGuid(): string {
  return randomUUID().replace(/-/g, "");
}

/** 随机 searchID（对齐 Python get_searchID） */
export function getSearchID(): string {
  const e = 1 + Math.floor(Math.random() * 20);
  const t = e * 18014398509481984;
  const n = Math.floor(Math.random() * 4194304) * 4294967296;
  const r = Math.round(Date.now()) % (24 * 60 * 60 * 1000);
  return String(t + n + r);
}

/** MD5 十六进制（可拼接多段） */
export function md5Hex(...parts: string[]): string {
  const h = createHash("md5");
  for (const p of parts) h.update(p, "utf-8");
  return h.digest("hex");
}

/** 递归将对象/数组中的 boolean 转为 0/1（QQ CGI 协议默认要求，preserveBool=true 的接口除外） */
export function boolToInt(data: unknown): unknown {
  if (typeof data === "boolean") return data ? 1 : 0;
  if (Array.isArray(data)) return data.map(boolToInt);
  if (data && typeof data === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) out[k] = boolToInt(v);
    return out;
  }
  return data;
}

/* ---------------- zzc 签名（musics.fcg） ---------------- */

const PART_1_INDEXES = [23, 14, 6, 36, 16, 7, 19];
const PART_2_INDEXES = [16, 1, 32, 12, 19, 27, 8, 5];
const SCRAMBLE_VALUES = [
  89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179,
];

/** 计算 QQ 音乐客户端请求的 zzc 签名（SHA1 + 索引取位 + XOR 干扰 + base64 去填充） */
export function zzcSign(payload: string): string {
  const hashHex = createHash("sha1").update(payload, "utf-8").digest("hex").toUpperCase();
  const part1 = PART_1_INDEXES.map((i) => hashHex[i]).join("");
  const part2 = PART_2_INDEXES.map((i) => hashHex[i]).join("");
  const part3 = Buffer.alloc(20);
  for (let i = 0; i < SCRAMBLE_VALUES.length; i++) {
    part3[i] = SCRAMBLE_VALUES[i] ^ parseInt(hashHex.slice(i * 2, i * 2 + 2), 16);
  }
  const b64Part = part3.toString("base64").replace(/[\\/+=]/g, "");
  return `zzc${part1}${b64Part}${part2}`.toLowerCase();
}
