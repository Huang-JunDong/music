/**
 * 网易云 API 统一入口
 * - invokeNcm(name, params)：进程内调用任意接口模块（provider / 服务端复用）
 * - mergeStoredCookie：把响应 Set-Cookie 合并回 SQLite（与 QR 登录存储闭环）
 */
import { createRequest } from "./request";
import { MODULES } from "./registry";
import { cookieToJson } from "./utils";
import { getCookie, setCookie } from "../cookies";
import type { NcmQuery, NcmResponse, NcmResponseOf } from "./types";

/** 调用指定接口模块（自动注入已存储的 netease cookie）；body 泛型化便于消费方取字段 */
export async function invokeNcm<T = any>(name: string, params: NcmQuery = {}): Promise<NcmResponseOf<T>> {
  const entry = MODULES[name];
  if (!entry) {
    throw { status: 404, body: { code: 404, msg: `module not found: ${name}` } };
  }
  const query: NcmQuery = { ...params };
  if (query.cookie === undefined || query.cookie === "") {
    const stored = getCookie("netease");
    if (stored) query.cookie = cookieToJson(stored);
  }
  return (await entry.module(query, createRequest)) as NcmResponseOf<T>;
}

/** 把接口返回的 Set-Cookie 数组合并回 SQLite 的 netease cookie（空值 = 删除） */
export function mergeStoredCookie(newCookies: string[]): string {
  const map = cookieToJson(getCookie("netease"));
  for (const raw of newCookies) {
    const [pair] = raw.split(";");
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const k = pair.slice(0, eq).trim();
    const v = pair.slice(eq + 1).trim();
    if (!k) continue;
    if (v === "") delete map[k];
    else map[k] = v;
  }
  const merged = Object.entries(map)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  if (merged.trim()) setCookie("netease", merged);
  else setCookie("netease", "");
  return merged;
}

export * from "./types";
export { MODULES, MODULE_COUNT, resolveRoute, CATEGORY_ORDER } from "./registry";
export { createRequest } from "./request";
