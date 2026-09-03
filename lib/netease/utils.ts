/**
 * 基础工具 — 对齐 api-enhanced util/index.js
 * cookie 序列化 / 随机中国 IP（data/china_ip_ranges.txt）/ 设备 ID / chainId
 */
import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// 中国 IP 段（CIDR）加载
// ---------------------------------------------------------------------------

function ipToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  const a = (parts[0] << 24) >>> 0;
  const b = parts[1] << 16;
  const c = parts[2] << 8;
  const d = parts[3];
  return a + b + c + d;
}

function intToIp(int: number): string {
  return [(int >>> 24) & 0xff, (int >>> 16) & 0xff, (int >>> 8) & 0xff, int & 0xff].join(".");
}

interface IPRange {
  start: number;
  end: number;
  count: number;
  cidr: string;
}

function parseCIDR(cidr: string): IPRange {
  const [ipStr, prefixLengthStr] = cidr.split("/");
  const prefixLength = parseInt(prefixLengthStr, 10);
  const ipInt = ipToInt(ipStr);
  const mask = (0xffffffff << (32 - prefixLength)) >>> 0;
  const start = (ipInt & mask) >>> 0;
  const end = (start | (~mask >>> 0)) >>> 0;
  return { start, end, count: end - start + 1, cidr };
}

function loadChinaIPRanges(): IPRange[] & { totalCount?: number } {
  try {
    const filePath = path.join(process.cwd(), "data", "china_ip_ranges.txt");
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
    const arr: IPRange[] & { totalCount?: number } = [] as any;
    let total = 0;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const range = parseCIDR(line);
      arr.push(range);
      total += range.count;
    }
    arr.sort((a, b) => b.count - a.count);
    arr.totalCount = total;
    return arr;
  } catch (e) {
    logger.error("Failed to load china_ip_ranges.txt:", (e as Error).message);
    const arr: IPRange[] & { totalCount?: number } = [] as any;
    arr.totalCount = 0;
    return arr;
  }
}

const chinaIPRanges = loadChinaIPRanges();

// ---------------------------------------------------------------------------
// 导出工具
// ---------------------------------------------------------------------------

function getRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function toBoolean(val: unknown): boolean | string {
  if (typeof val === "boolean") return val;
  if (val === "") return val as string;
  return val === "true" || (val as string) == "1";
}

export function cookieToJson(cookie: string | undefined | null): Record<string, string> {
  if (!cookie) return {};
  const obj: Record<string, string> = {};
  for (const item of cookie.split(";")) {
    const arr = item.split("=");
    if (arr.length === 2) {
      obj[arr[0].trim()] = arr[1].trim();
    }
  }
  return obj;
}

export function cookieObjToString(cookie: Record<string, any>): string {
  return Object.keys(cookie)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(cookie[key])}`)
    .join("; ");
}

export function generateRandomChineseIP(): string {
  const total = chinaIPRanges.totalCount || 0;
  if (!total) {
    // 兜底：随机 116.x 前缀
    return `116.${getRandomInt(25, 94)}.${getRandomInt(1, 255)}.${getRandomInt(1, 255)}`;
  }
  let offset = Math.floor(Math.random() * total);
  let chosen = chinaIPRanges[chinaIPRanges.length - 1];
  for (const seg of chinaIPRanges) {
    if (offset < seg.count) {
      chosen = seg;
      break;
    }
    offset -= seg.count;
  }
  const segSize = chosen.end - chosen.start + 1;
  return intToIp(chosen.start + Math.floor(Math.random() * segSize));
}

export function generateDeviceId(): string {
  const hexChars = "0123456789ABCDEF";
  const chars: string[] = [];
  for (let i = 0; i < 52; i++) {
    chars.push(hexChars[Math.floor(Math.random() * hexChars.length)]);
  }
  return chars.join("");
}

function getCookieValue(cookieStr: string, name: string): string {
  if (!cookieStr) return "";
  const cookies = "; " + cookieStr;
  const parts = cookies.split("; " + name + "=");
  if (parts.length === 2) return parts.pop()!.split(";").shift() ?? "";
  return "";
}

export function generateChainId(cookie: string): string {
  const version = "v1";
  const randomNum = Math.floor(Math.random() * 1e6);
  const deviceId = getCookieValue(cookie, "sDeviceId") || "unknown-" + randomNum;
  return `${version}_${deviceId}_web_login_${Date.now()}`;
}
