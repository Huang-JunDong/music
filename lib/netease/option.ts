/** createOption — 对齐 api-enhanced util/option.js */
import { enableRandomCNIP, neteaseCookie } from "../env";
import type { NcmQuery, NcmRequestOption } from "./types";

/** 出站请求默认超时 15s（审核整改 A-01：禁止 0=无超时，禁止依赖 undici 300s 兜底） */
const DEFAULT_TIMEOUT_MS = 15_000;
/** 用户显式传 timeout 时的钳制区间上限（对齐 5.1：clamp 1-30000ms） */
const MAX_TIMEOUT_MS = 30_000;

export function resolveNcmTimeout(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(Math.round(n), 1), MAX_TIMEOUT_MS);
}

export function createOption(
  query: NcmQuery,
  crypto = "",
  checkToken: boolean | "v2" | "v3" = false,
): NcmRequestOption {
  return {
    crypto: query.crypto || crypto || "",
    cookie: query.cookie || neteaseCookie(),
    ua: query.ua || "",
    proxy: query.proxy,
    realIP: query.realIP,
    randomCNIP: enableRandomCNIP()
      ? !["false", false].includes(query.randomCNIP)
      : ["true", true].includes(query.randomCNIP),
    e_r: query.e_r || undefined,
    domain: query.domain || "",
    checkToken: query.checkToken || checkToken,
    headers: query.headers || {},
    timeout: resolveNcmTimeout(query.timeout),
  };
}
