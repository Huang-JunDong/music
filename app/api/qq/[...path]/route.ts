/**
 * /api/qq/[...path] — QQ 音乐 API 网关（对齐 .ref/QQMusicApi web 服务）
 * 路由表见 lib/qq/registry.ts（14 模块 / 105+ 端点，路径 1:1 对齐参考仓库 snake_case）。
 *
 * 对齐参考仓库 web/src/routing/executor.py 行为：
 *  - 标准响应包装 ApiResponse：成功 `{code:0, msg:"ok", data}`；bool 结果 true→data:null / false→`{code:-1,msg:"操作失败"}`；
 *    错误 `{code:-1, msg}` + 相应 HTTP 状态码（ErrorResponse 结构）
 *  - 响应映射：response_model 的顶层 jsonpath 提取（lib/qq/response-map.ts），字段命名与参考 Web 层一致
 *  - 凭证过期自动刷新重试：COOKIE_OR_DEFAULT / OPTIONAL 路由遇 CredentialExpiredError（1000/104400/104401）
 *    先 refresh_credential 落库再重试一次；仍失败返回 401
 *  - GET 按 cacheSec 分级短缓存（PUBLIC_60/300/600，LRU 上限 2048）
 *  - 登录成功（扫码/验证码/刷新）自动把 Credential 写回 SQLite（source="qq"）
 */
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { checkWriteGuard } from "@/lib/write-guard";
import { QQClient, CredentialInvalidError } from "@/lib/qq/client";
import {
  MethodMismatchError,
  matchRoute,
  routeInventory,
  type QqRouteContext,
} from "@/lib/qq/registry";
import { CredentialExpiredError, LoginError, NetworkError, RateLimitedError } from "@/lib/qq/errors";
import { loadCredential, saveCredential } from "@/lib/qq/credential";
import { applyResponseMap, wrapSuccess } from "@/lib/qq/response-map";
import { refreshCredential } from "@/lib/qq/modules/login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET 短缓存（对齐参考仓库 PUBLIC_60/300/600；上限 2048 条 LRU） */
const CACHE_MAX = 2048;
const apiCache = new Map<string, { body: unknown; at: number; ttl: number }>();

function cacheGet(key: string): unknown | null {
  const hit = apiCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > hit.ttl * 1000) {
    apiCache.delete(key);
    return null;
  }
  apiCache.delete(key);
  apiCache.set(key, hit);
  return hit.body;
}

function cacheSet(key: string, body: unknown, ttl: number): void {
  if (apiCache.size >= CACHE_MAX) {
    const oldest = apiCache.keys().next().value;
    if (oldest !== undefined) apiCache.delete(oldest);
  }
  apiCache.set(key, { body, at: Date.now(), ttl });
}

/** 错误响应（对齐 error_response：ErrorResponse 仅 code/msg，配合 HTTP 状态码） */
function errorResponse(statusCode: number, msg: string, headers?: RecordInit): NextResponse {
  return NextResponse.json({ code: -1, msg }, { status: statusCode, headers });
}

type RecordInit = Record<string, string>;

/** 弱 ETag（对齐参考 web 层 W/"..." 形态） */
function weakEtag(body: unknown): string {
  return `W/"${createHash("sha1").update(JSON.stringify(body)).digest("base64url").slice(0, 16)}"`;
}

async function handle(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const denied = requireAuth(req);
  if (denied) return NextResponse.json(denied.body, { status: denied.status });

  // 写操作守卫（审核整改 P1-01）：POST/PUT/DELETE/PATCH 一律 XHR + 同源（CSRF 防护，对齐项目 A-15 基线）
  const guarded = checkWriteGuard(req);
  if (guarded) return guarded;

  const { path } = await ctx.params;
  const routePath = "/" + (path ?? []).join("/");

  // 清单接口由 GET /api/qq（app/api/qq/route.ts）承担；catch-all 至少一段路径

  let matched;
  try {
    matched = matchRoute(routePath, req.method);
  } catch (err) {
    if (err instanceof MethodMismatchError) {
      return errorResponse(405, err.message, { Allow: err.expected });
    }
    throw err;
  }
  if (!matched) {
    const count = routeInventory().count;
    return NextResponse.json(
      { code: -1, msg: `资源不存在（可用接口 ${count} 个，GET /api/qq 查看清单）` },
      { status: 404 },
    );
  }

  // 参数合并：path + query + body（对齐 collect_param_values）
  const params: Record<string, any> = { ...matched.pathParams };
  req.nextUrl.searchParams.forEach((v, k) => {
    params[k] = v;
  });
  let body: any = null;
  if (req.method !== "GET" && req.method !== "DELETE") {
    const contentType = req.headers.get("content-type") ?? "";
    try {
      if (contentType.includes("application/json")) {
        body = await req.json();
        if (body && typeof body === "object") Object.assign(params, body);
      } else if (
        contentType.includes("application/x-www-form-urlencoded") ||
        contentType.includes("multipart/form-data")
      ) {
        const form = await req.formData();
        for (const [k, v] of form.entries()) {
          if (typeof v === "string") params[k] = v;
        }
      }
    } catch {
      /* body 解析失败按空处理 */
    }
  }

  const client = new QQClient({ credential: loadCredential() });
  if (matched.def.auth === "required" && (!client.credential.musicid || !client.credential.musickey)) {
    return errorResponse(401, "未提供有效的登录凭证");
  }

  const cacheable = req.method === "GET" && matched.def.cacheSec;
  // 缓存键：query 参数排序后拼接（顺序无关，对齐参考实现的 path+参数排序哈希）
  const cacheKey = cacheable
    ? `${routePath}?${[...req.nextUrl.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("&")}`
    : "";
  if (cacheable && cacheKey) {
    const hit = cacheGet(cacheKey);
    if (hit !== null) {
      // 对齐参考 cached_response：附带剩余 TTL 的 Cache-Control + ETag/304 协商
      const res = NextResponse.json(hit as never);
      res.headers.set("Cache-Control", `public, max-age=${matched.def.cacheSec}`);
      res.headers.set("ETag", weakEtag(hit));
      if (req.headers.get("if-none-match") === res.headers.get("ETag")) {
        return new NextResponse(null, { status: 304, headers: { ETag: res.headers.get("ETag")!, "Cache-Control": res.headers.get("Cache-Control")! } });
      }
      return res;
    }
  }

  const routeCtx: QqRouteContext = { client, params, query: req.nextUrl.searchParams, body };

  /** 对齐 invoke_with_retry：凭证过期（有登录态时）自动刷新并重试一次 */
  const invoke = async (): Promise<unknown> => matched.def.handler(routeCtx);
  const invokeWithRetry = async (): Promise<unknown> => {
    try {
      return await invoke();
    } catch (err) {
      if (!(err instanceof CredentialExpiredError)) throw err;
      if (!client.credential.musicid || !client.credential.musickey) throw err;
      try {
        const refreshed = await refreshCredential(client, client.credential);
        saveCredential(refreshed);
        client.setCredential(refreshed);
      } catch {
        throw new CredentialExpiredError(0, null);
      }
      return await invoke(); // 刷新后仍失败 → CredentialExpiredError 冒泡由外层统一 401
    }
  };

  try {
    const raw = await invokeWithRetry();
    const mapped = applyResponseMap(matched.def.id, raw);
    const wrapped = wrapSuccess(mapped);
    if (cacheable && cacheKey) cacheSet(cacheKey, wrapped, matched.def.cacheSec!);
    const etag = weakEtag(wrapped);
    if (req.headers.get("if-none-match") === etag) {
      return new NextResponse(null, { status: 304, headers: { ETag: etag } });
    }
    const res = NextResponse.json(wrapped);
    res.headers.set("ETag", etag);
    if (cacheable) {
      res.headers.set("Cache-Control", `public, max-age=${matched.def.cacheSec}`);
    }
    return res;
  } catch (err) {
    if (err instanceof CredentialExpiredError || err instanceof CredentialInvalidError) {
      return errorResponse(401, err.message);
    }
    if (err instanceof RateLimitedError) {
      return errorResponse(429, err.message); // 对齐参考 web 层 Ratelimited → 429
    }
    if (err instanceof LoginError) {
      return errorResponse(400, `${err.message}（code=${err.code}）`); // 对齐参考 web 层 LoginError → 400
    }
    if (err instanceof NetworkError) {
      return errorResponse(502, `上游网络错误: ${err.message}`);
    }
    const message = (err as Error)?.message ?? String(err);
    // 参数校验类（对齐 HTTPException 422）
    const isValidationError = /必须|缺少|不能为空|数量必须一致|仅支持|无效的/.test(message);
    return errorResponse(isValidationError ? 422 : 500, message);
  }
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
export const PUT = handle;
export const PATCH = handle;
