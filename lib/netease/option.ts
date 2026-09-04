/** createOption — 对齐 api-enhanced util/option.js */
import { enableRandomCNIP, neteaseCookie } from "../env";
import type { NcmQuery, NcmRequestOption } from "./types";

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
    timeout: Number(query.timeout) || 0,
  };
}
