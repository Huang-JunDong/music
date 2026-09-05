/**
 * /api/netease/[...path] — api-enhanced server.js 的 Next.js 复刻
 * 路由规则 1:1：文件名下划线转斜杠（daily_signin / fm_trash / personal_fm 三个特殊路由原样）
 * 支持 query / JSON body / multipart 文件上传（imgFile、songFile 字段自动转 {name,data,mimetype}）
 * 未显式传 cookie 时自动注入 SQLite 存储的 netease cookie；响应 Set-Cookie 自动合并回存储
 * 免登录（最大限度放开）；GET 缓存 key 附带生效 cookie 指纹（显式 cookie 请求不缓存）
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveRoute, MODULES, MODULE_COUNT } from "@/lib/netease/registry";
import { createRequest } from "@/lib/netease/request";
import { cookieToJson, generateRandomChineseIP } from "@/lib/netease/utils";
import { ncmGlobals } from "@/lib/netease/global-state";
import { mergeStoredCookie } from "@/lib/netease";
import { getCookie, createSourceSessionStore, runWithSourceSession } from "@/lib/cookies";
import { browserSourceCookies, requestIsHttps, srcSessionSetCookie } from "@/lib/source-session";
import { enableGeneralUnblock, enableProxy, proxyUrl } from "@/lib/env";
import { md5hex } from "@/lib/crypto";
import { logger } from "@/lib/netease/logger";
import { matchID } from "@/lib/netease/unblock";
import type { NcmQuery, NcmResponse } from "@/lib/netease/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET 200 响应 2 分钟缓存 — 对齐源 server.js apicache('2 minutes')：
 * 相同 url 两分钟内直接回放（防网易 IP 高频）；POST / 非 200 / 302 / 文件上传不缓存。
 * 上限 2048 条防膨胀；登录态相关响应（Set-Cookie 含 MUSIC_U）不缓存。
 */
const API_CACHE_TTL = 2 * 60 * 1000;
const API_CACHE_MAX = 2048;
const apiCache = new Map<string, { body: any; status: number; at: number }>();

function cacheGet(key: string) {
  const hit = apiCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > API_CACHE_TTL) {
    apiCache.delete(key);
    return null;
  }
  // 审核整改 A-27：命中重插实现 LRU 淘汰（原插入序 FIFO 命中率次优）
  apiCache.delete(key);
  apiCache.set(key, hit);
  return hit;
}

function cacheSet(key: string, body: any, status: number) {
  if (apiCache.size >= API_CACHE_MAX) {
    const oldest = apiCache.keys().next().value;
    if (oldest !== undefined) apiCache.delete(oldest);
  }
  apiCache.set(key, { body, status, at: Date.now() });
}

function hasLoginCookie(cookies: unknown): boolean {
  return Array.isArray(cookies) && cookies.some((c: string) => /MUSIC_U=/.test(c));
}

interface ParsedBody {
  fields: Record<string, any>;
}

/** 审核整改 A-10：multipart 单文件大小上限 */
const MAX_UPLOAD_FILE_BYTES = 100 * 1024 * 1024;

class UploadTooLargeError extends Error {
  constructor(field: string) {
    super(`file too large: ${field} (max 100MB)`);
    this.name = "UploadTooLargeError";
  }
}

async function parseBody(req: NextRequest): Promise<ParsedBody> {
  const fields: Record<string, any> = {};
  const contentType = req.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("application/json")) {
      const json = await req.json();
      if (json && typeof json === "object") {
        Object.assign(fields, json as Record<string, any>);
      }
    } else if (
      contentType.includes("multipart/form-data") ||
      contentType.includes("application/x-www-form-urlencoded")
    ) {
      const form = await req.formData();
      for (const [key, value] of form.entries()) {
        if (typeof value === "string") {
          fields[key] = value;
        } else {
          // File → { name, data:Buffer, mimetype, size }（对齐 express-fileupload req.files）
          // 审核整改 A-10：单文件大小上限（超限 413 而非整读进内存；云盘歌曲上传最大几十 MB）
          if (value.size > MAX_UPLOAD_FILE_BYTES) {
            throw new UploadTooLargeError(key);
          }
          const buf = Buffer.from(await value.arrayBuffer());
          fields[key] = {
            name: value.name || "file",
            data: buf,
            mimetype: value.type || undefined,
            size: buf.length,
          };
        }
      }
    }
  } catch (err) {
    // 审核整改 A-10：大小超限必须冒泡为 413，其余解析失败按空 body 处理
    if (err instanceof UploadTooLargeError) throw err;
    /* body 解析失败按空处理 */
  }
  return { fields };
}

function clientIP(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (xff) return xff.replace(/^::ffff:/, "");
  return "";
}

/** 对齐源 server.js：https 下补 SameSite=None; Secure（修 CORS SameSite），http 原样回写。
 *  安全增强（审核 2.2）：统一加 HttpOnly —— 登录态由服务端 SQLite 管理，前端无需 JS 读取这些 Cookie */
function appendSetCookies(res: NextResponse, cookies: string[], req: NextRequest): void {
  const isHttps = requestIsHttps(req); // 审核整改 P2-02：与 srcSessionSetCookie 统一判定（含多级反代 proto 首段）
  for (const cookie of cookies) {
    res.headers.append(
      "Set-Cookie",
      isHttps
        ? `${cookie}; HttpOnly; SameSite=None; Secure`
        : `${cookie}; Path=/; HttpOnly; SameSite=Lax`,
    );
  }
}

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  /* 多用户：浏览器自带 netease 凭证优先于全局；自带时上游 Set-Cookie 刷新改道回写浏览器 */
  const browser = browserSourceCookies(req);
  const session = createSourceSessionStore(browser, "netease" in browser);
  const secure = requestIsHttps(req);
  return runWithSourceSession(session, async () => {
    const res = await handleNetease(req, ctx);
    const refreshed = session.pendingWrites.get("netease");
    if (refreshed) res.headers.append("Set-Cookie", srcSessionSetCookie("netease", refreshed, secure));
    return res;
  });
}

async function handleNetease(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  const routePath = "/" + (path ?? []).join("/");
  const entry = resolveRoute(routePath);
  if (!entry) {
    return NextResponse.json(
      { code: 404, msg: "Not Found", available: MODULE_COUNT, hint: "GET /api/netease 查看接口清单" },
      { status: 404 },
    );
  }

  // query 参数
  const query: NcmQuery = {};
  req.nextUrl.searchParams.forEach((v, k) => {
    query[k] = v;
  });

  // body（JSON / form / 文件）
  let fields: Record<string, any>;
  try {
    ({ fields } = await parseBody(req));
  } catch (err) {
    if (err instanceof UploadTooLargeError) {
      return NextResponse.json({ code: 413, msg: err.message }, { status: 413 });
    }
    throw err;
  }
  Object.assign(query, fields);

  // cookie：显式 cookie 参数 > SQLite 存储 > 请求头
  const hasExplicitCookie = query.cookie !== undefined;
  if (typeof query.cookie === "string") {
    query.cookie = cookieToJson(decodeURIComponent(query.cookie));
  } else {
    const stored = getCookie("netease");
    if (stored) {
      query.cookie = cookieToJson(stored);
    } else {
      const headerCookie = req.headers.get("cookie") ?? "";
      if (headerCookie) query.cookie = cookieToJson(headerCookie);
    }
  }

  // GET 2 分钟缓存命中（对齐源 apicache 的 url-key 语义；带 proxy 的请求跳过）
  // 会话隔离：key 附带生效 cookie 指纹，不同登录态各自缓存互不回放；
  // 显式传 cookie 的请求一律不读不写缓存，杜绝个性化响应跨用户污染。
  const cookieFingerprint = query.cookie ? md5hex(JSON.stringify(query.cookie)) : "anon";
  const cacheKey =
    req.method === "GET" && !hasExplicitCookie
      ? `${routePath}${req.nextUrl.search}#${cookieFingerprint}`
      : "";
  const cacheable = !!cacheKey && !query.proxy;
  if (cacheable) {
    const hit = cacheGet(cacheKey);
    if (hit) return NextResponse.json(hit.body, { status: hit.status });
  }

  // request 包装：注入 IP（randomCNIP → 进程级中国 IP；否则用客户端 IP）
  const ip = clientIP(req);
  const requestFn = (uri: string, data: any, options: any) => {
    const opts = { ...options };
    if (!opts.realIP) {
      opts.ip = opts.randomCNIP
        ? (ncmGlobals.cnIp ||= generateRandomChineseIP())
        : ip || (ncmGlobals.cnIp ||= generateRandomChineseIP());
    }
    return createRequest(uri, data, opts);
  };

  try {
    const moduleResponse = await entry.module(query, requestFn);
    logger.info(`Request Success: [${entry.name}] ${routePath}`);

    // 夹带私货部分（对齐源 server.js）：开启通用解锁且是获取歌曲 URL 的接口时尝试解锁
    if (routePath === "/song/url/v1" && enableGeneralUnblock()) {
      const song = moduleResponse.body?.data?.[0];
      if (
        song &&
        (song.freeTrialInfo !== null || !song.url || [1, 4].includes(song.fee))
      ) {
        logger.info("Starting unblock(uses general unblock):", query.id);
        const result = await matchID(query.id);
        song.url = result.data.url;
        song.freeTrialInfo = null;
        logger.info("Unblock success! url:", song.url);
      }
      if (song?.url && song.url.includes("kuwo")) {
        const proxy = proxyUrl();
        if (enableProxy() && proxy) {
          song.proxyUrl = proxy + song.url;
        }
      }
    }

    // 登录态闭环：响应携带 MUSIC_U 时合并回 SQLite；
    // 显式传 cookie 的请求视为临时身份，一律不写全局库（审核整改 P1-01：防任意访客覆盖全局兜底凭证；
    // 匿名访客带浏览器凭证时由请求级会话改道回写其浏览器，见 handle 包装）
    const setCookies = moduleResponse.cookie ?? [];
    if (!hasExplicitCookie && !query.noCookie && setCookies.some((c: string) => /MUSIC_U=/.test(c))) {
      try {
        mergeStoredCookie(setCookies);
      } catch {
        /* 存储失败不阻断响应 */
      }
    }

    if (moduleResponse.redirectUrl) {
      return NextResponse.redirect(moduleResponse.redirectUrl, moduleResponse.status || 302);
    }

    const okStatus = moduleResponse.status && moduleResponse.status > 0 ? moduleResponse.status : 200;
    // 仅 200 且无登录态写入时缓存（对齐 apicache 的 statusCode === 200 过滤）
    if (cacheable && okStatus === 200 && !hasLoginCookie(setCookies)) {
      cacheSet(cacheKey, moduleResponse.body, okStatus);
    }

    const res = NextResponse.json(moduleResponse.body, {
      status: okStatus,
    });
    if (!query.noCookie && Array.isArray(setCookies) && setCookies.length > 0) {
      appendSetCookies(res, setCookies, req);
    }
    return res;
  } catch (moduleResponse) {
    const err = moduleResponse as NcmResponse;
    // 日志脱敏（审核 3）：仅记录 code/msg 摘要，不落完整响应体（可含账号/私信等个人信息）
    const b = err.body as { code?: unknown; msg?: unknown } | string | undefined;
    const brief =
      b && typeof b === "object"
        ? { code: b.code, msg: typeof b.msg === "string" ? b.msg.slice(0, 200) : b.msg }
        : { summary: String(b).slice(0, 200) };
    logger.error(`Request Failed: [${routePath}]`, { status: err.status, ...brief });
    if (!err.body) {
      // 审核整改 A-24：上游模块异常且无响应体属上游故障，502 而非 404
      return NextResponse.json({ code: 502, data: null, msg: "Upstream Error" }, { status: 502 });
    }
    if ((err.body as any).code == "301" || (err.body as any).code === 301) {
      (err.body as any).msg = "需要登录";
    }
    if (!hasExplicitCookie && !query.noCookie && Array.isArray(err.cookie) && err.cookie.length > 0) {
      try {
        mergeStoredCookie(err.cookie);
      } catch {
        /* ignore */
      }
    }
    const res = NextResponse.json(err.body, {
      status: err.status && err.status > 0 ? err.status : 500,
    });
    if (!query.noCookie && Array.isArray(err.cookie) && err.cookie.length > 0) {
      appendSetCookies(res, err.cookie, req);
    }
    return res;
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const PATCH = handle;
