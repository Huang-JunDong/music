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

/** 业务错误对象判别：createRequest 对非 200 业务码 throw {status, body} 普通对象（见 request.ts） */
function isNcmBusinessError(err: unknown): err is NcmResponse {
  return (
    err !== null &&
    typeof err === "object" &&
    !("stack" in err) &&
    typeof (err as NcmResponse).status === "number" &&
    (err as NcmResponse).body !== undefined
  );
}

/**
 * 审核整改 B-01：把 {status, body} 业务错误对象转译为可读 Error ——
 * 301（未登录）映射"需要登录网易云账号"，其余取 body.msg 或 code 映射，
 * 避免 provider → 路由链路 `err.message` 渲染为 "[object Object]"；
 * status/body 保留为 Error 属性供调用方深检。透传路由不经此层，行为不变。
 */
function toReadableNcmError(err: NcmResponse): Error & { status: number; body: unknown } {
  const body = err.body as { code?: unknown; msg?: unknown } | undefined;
  /* 三审 R3：code 非数字时回退 err.status（防 "(code: NaN)" 文案） */
  const rawCode = Number(body?.code ?? err.status);
  const code = Number.isFinite(rawCode) ? rawCode : err.status;
  const rawMsg = body?.msg;
  const fallback = typeof rawMsg === "string" && rawMsg.trim() ? rawMsg : `网易接口错误 (code: ${code})`;
  const error = new Error(code === 301 ? "需要登录网易云账号" : fallback) as Error & {
    status: number;
    body: unknown;
  };
  error.status = err.status;
  error.body = err.body;
  return error;
}

/** 调用指定接口模块（自动注入已存储的 netease cookie）；body 泛型化便于消费方取字段 */
export async function invokeNcm<T = any>(name: string, params: NcmQuery = {}): Promise<NcmResponseOf<T>> {
  const entry = MODULES[name];
  if (!entry) {
    throw toReadableNcmError({ status: 404, body: { code: 404, msg: `module not found: ${name}` } });
  }
  const query: NcmQuery = { ...params };
  if (query.cookie === undefined || query.cookie === "") {
    const stored = getCookie("netease");
    if (stored) query.cookie = cookieToJson(stored);
  }
  try {
    return (await entry.module(query, createRequest)) as NcmResponseOf<T>;
  } catch (err) {
    if (isNcmBusinessError(err)) throw toReadableNcmError(err);
    throw err;
  }
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
