/**
 * QQ 音乐 CGI 客户端 — 移植自 .ref/QQMusicApi qqmusic_api/core（client/api_context/request）。
 * 统一网关 u.y.qq.com/cgi-bin/musicu.fcg（签名走 musics.fcg），comm 公共参数构造、
 * Android session 维持、QIMEI 注入、错误码映射（2000 签名 / 2001 限流 / 1000·104400·104401 凭证过期）。
 * 客户端级令牌桶限流（10 req/s、容量 50）与连接重试（2 次、backoff 0.2），gather 批量并发/CGI 合并。
 */
import type { CgiInvokeOptions, Credential, Platform } from "./types";
import { emptyCredential, loadCredential } from "./credential";
import { getDevice, isSessionValid, saveDevice, type QQDevice } from "./device";
import { ensureQimei } from "./qimei";
import { buildComm, getUserAgent } from "./versioning";
import { boolToInt, zzcSign } from "./utils";
import { fetchWithRetry, NoopLimiter, TokenBucketLimiter, type Limiter } from "./rate-limit";
import {
  ApiDataError,
  CgiApiError,
  CredentialExpiredError,
  GlobalApiError,
  HTTPError,
  NetworkError,
  RateLimitedError,
  SignatureRequiredError,
} from "./errors";

const CGI_URL = "https://u.y.qq.com/cgi-bin/musicu.fcg";
const CGI_SIGN_URL = "https://u.y.qq.com/cgi-bin/musics.fcg";

export class CredentialInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialInvalidError";
  }
}

export interface RawHttpOptions {
  method?: string;
  url: string;
  params?: Record<string, string> | null;
  headers?: Record<string, string> | null;
  cookies?: Record<string, string> | null;
  json?: unknown;
  data?: Record<string, string> | null;
  credential?: Credential | null;
  redirect?: RequestRedirect;
  timeoutMs?: number;
}

export interface RawHttpResult {
  status: number;
  headers: Headers;
  text: string;
  bytes: Uint8Array;
  cookies: Record<string, string>;
  /** 请求超时（timeoutMs 到期）时为 true：此时 status=0 且各字段为空，调用方必须优先检查（P3-08 语义显式化） */
  timedOut?: boolean;
  json<T = any>(): T | null;
}

export interface QQClientOptions {
  credential?: Credential | null;
  platform?: Platform | null;
  /** 请求速率限制（请求/秒），0 关闭；默认 10（对齐 rate） */
  rate?: number;
  /** 令牌桶容量（突发请求数），默认 50 */
  capacity?: number;
  /** 连接建立失败重试次数，默认 2（对齐 connect_retries） */
  connectRetries?: number;
  /** 单个出站请求超时毫秒数，默认 15000（审核整改 P1-02：出站请求必有超时，10-15s 区间） */
  timeoutMs?: number;
}

/** CGI 批量请求描述符（gather 用，对齐 CgiRequest） */
export interface CgiGatherRequest {
  kind: "cgi";
  module: string;
  method: string;
  param: Record<string, unknown>;
  options?: CgiInvokeOptions;
}

/** HTTP 批量请求描述符（gather 用，对齐 HttpRequest） */
export interface HttpGatherRequest {
  kind: "http";
  options: RawHttpOptions;
}

export type GatherRequest = CgiGatherRequest | HttpGatherRequest;

/** CGI 分组键（对齐 CgiRequest._group_key：平台 + comm 排序项 + 覆盖标志 + 凭证键 + 签名） */
function cgiGroupKey(req: CgiGatherRequest, clientCredential: Credential): string {
  const platform = req.options?.platform ?? null;
  const credential = req.options?.credential ?? clientCredential;
  const comm = req.options?.comm ?? null;
  const commItems = comm
    ? Object.keys(comm)
        .sort()
        .map((k) => `${k}=${comm[k]}`)
        .join("&")
    : "";
  return JSON.stringify([platform, commItems, req.options?.overrideComm ?? false, credential.musicid, credential.musickey, req.options?.sign ?? false]);
}

/** 出站异常统一包装：超时给明确中文消息，其余转 NetworkError（审核整改 P1-02） */
function toNetworkError(err: unknown, timeoutMs: number): NetworkError {
  const name = (err as Error)?.name;
  if (name === "TimeoutError" || name === "AbortError") {
    return new NetworkError(`请求超时（${Math.round(timeoutMs / 1000)}s）`);
  }
  return new NetworkError(String((err as Error)?.message ?? err));
}

export class QQClient {
  credential: Credential;
  platform: Platform;
  private readonly limiter: Limiter;
  private readonly connectRetries: number;
  private readonly timeoutMs: number;
  /** session 刷新的 inflight 合并（对齐 anyio.Lock 双检锁：并发请求只触发一次 GetSession） */
  private sessionInflight: Promise<void> | null = null;

  constructor(options?: QQClientOptions) {
    this.credential = options?.credential ?? loadCredential() ?? emptyCredential();
    this.platform = options?.platform ?? "android";
    const rate = options?.rate ?? 10;
    this.limiter = rate > 0 ? new TokenBucketLimiter(rate, options?.capacity ?? 50) : new NoopLimiter();
    this.connectRetries = options?.connectRetries ?? 2;
    this.timeoutMs = options?.timeoutMs ?? 15_000;
  }

  /** 更新全局凭证 */
  setCredential(cred: Credential | null): void {
    this.credential = cred ?? emptyCredential();
  }

  private device(): QQDevice {
    return getDevice();
  }

  /** Android 平台 session 维持（24h 内复用，过期自动 GetSession 刷新并落盘；并发合并为单次请求） */
  async ensureAndroidSession(): Promise<void> {
    if (this.platform !== "android") return;
    const device = this.device();
    if (isSessionValid(device)) return;
    if (this.sessionInflight) return this.sessionInflight;
    this.sessionInflight = this.refreshAndroidSession().finally(() => {
      this.sessionInflight = null;
    });
    return this.sessionInflight;
  }

  private async refreshAndroidSession(): Promise<void> {
    const device = this.device();
    if (isSessionValid(device)) return;
    const comm = buildComm("android", this.credential, device, await ensureQimei(), device.open_udid);
    const payload = {
      comm,
      req_0: {
        module: "music.getSession.session",
        method: "GetSession",
        param: { uid: device.session_uid ?? "", vkey: 0, caller: 0 },
      },
    };
    await this.limiter.acquire();
    let res: Response;
    try {
      res = await fetchWithRetry(CGI_URL, {
        method: "POST",
        headers: { "User-Agent": getUserAgent("android", device), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      if (err instanceof NetworkError) throw err;
      throw toNetworkError(err, this.timeoutMs);
    }
    if (res.status !== 200) throw new HTTPError(`HTTP ${res.status}`, res.status);
    const resp = (await res.json()) as any;
    const session = resp?.req_0?.data?.session;
    if (!session?.uid || !session?.sid) throw new ApiDataError("获取 Android session 失败");
    device.session_uid = String(session.uid);
    device.session_sid = session.sid;
    device.session_vkey = session.vkey ?? null;
    device.session_save_time = Math.floor(Date.now() / 1000);
    saveDevice();
  }

  /** 构造 CGI 公共参数（comm），对齐 build_api_kwargs */
  private async buildCommFor(platform: Platform, opts: CgiInvokeOptions, device: QQDevice): Promise<Record<string, string | number | boolean>> {
    if (opts.overrideComm) {
      return { ...(opts.comm ?? {}) };
    }
    const comm = buildComm(
      platform,
      opts.credential ?? this.credential,
      device,
      platform === "android" ? await ensureQimei() : null,
      device.open_udid,
    );
    if (opts.comm) Object.assign(comm, opts.comm);
    return comm;
  }

  /**
   * 执行单个 CGI 请求并返回 req_0.data（默认）。
   * allowErrorCodes 命中时：parseOnAllow=true 返回 data，否则返回整个 req_0 原始对象。
   */
  async invoke<T = any>(module: string, method: string, param: Record<string, unknown>, options?: CgiInvokeOptions): Promise<T> {
    const opts = options ?? {};
    const credential = opts.credential ?? this.credential;
    if (opts.requireLogin && (!credential.musicid || !credential.musickey)) {
      throw new CredentialInvalidError("请求需要登录, 未提供有效的登录凭证");
    }
    const platform = opts.platform ?? this.platform;
    if (platform === "android") await this.ensureAndroidSession();

    const device = this.device();
    const comm = await this.buildCommFor(platform, opts, device);

    const finalParam = opts.preserveBool ? param : (boolToInt(param) as Record<string, unknown>);
    const payload: Record<string, unknown> = {
      comm,
      req_0: { module, method, param: finalParam },
    };

    let url = CGI_URL;
    const queryParams = new URLSearchParams();
    if (opts.sign) {
      url = CGI_SIGN_URL;
      queryParams.set("_", String(Date.now()));
      queryParams.set("sign", zzcSign(JSON.stringify(payload)));
    }

    await this.limiter.acquire();
    let res: Response;
    try {
      res = await fetchWithRetry(queryParams.toString() ? `${url}?${queryParams}` : url, {
        method: "POST",
        headers: {
          "User-Agent": getUserAgent(platform, device),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      if (err instanceof NetworkError) throw err;
      throw toNetworkError(err, this.timeoutMs);
    }
    if (res.status !== 200) throw new HTTPError(`HTTP 请求状态码异常: ${res.status}`, res.status);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new ApiDataError("响应内容非有效 JSON 格式");
    }
    return parseCgiResponse<T>(body, opts, 1)[0];
  }

  /** 原始 HTTP 请求：注入凭证 Cookie（uin/qqmusic_uin/qm_keyst/qqmusic_key）与 UA，返回 Set-Cookie 解析结果 */
  async raw(options: RawHttpOptions): Promise<RawHttpResult> {
    const credential = options.credential ?? this.credential;
    const cookies: Record<string, string> = {};
    if (credential.musicid) {
      cookies.uin = credential.str_musicid || String(credential.musicid);
      cookies.qqmusic_uin = credential.str_musicid || String(credential.musicid);
    }
    if (credential.musickey) {
      cookies.qm_keyst = credential.musickey;
      cookies.qqmusic_key = credential.musickey;
    }
    Object.assign(cookies, options.cookies ?? {});

    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (!headers["User-Agent"]) headers["User-Agent"] = getUserAgent("web", this.device());
    if (Object.keys(cookies).length) {
      headers.Cookie = Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    }

    let url = options.url;
    if (options.params && Object.keys(options.params).length) {
      const usp = new URLSearchParams();
      for (const [k, v] of Object.entries(options.params)) usp.set(k, v);
      url += (url.includes("?") ? "&" : "?") + usp.toString();
    }

    const fetchInit: RequestInit & { body?: BodyInit | null } = {
      method: options.method ?? "GET",
      headers,
      redirect: options.redirect ?? "follow",
    };
    if (options.json !== undefined && options.json !== null) {
      fetchInit.body = JSON.stringify(options.json);
      if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
    } else if (options.data && Object.keys(options.data).length) {
      fetchInit.body = new URLSearchParams(options.data).toString();
      if (!headers["Content-Type"]) headers["Content-Type"] = "application/x-www-form-urlencoded";
    }
    if (options.timeoutMs) {
      fetchInit.signal = AbortSignal.timeout(options.timeoutMs);
    }

    await this.limiter.acquire();
    let res: Response;
    try {
      res = await fetchWithRetry(url, fetchInit, { retries: this.connectRetries });
    } catch (err) {
      if ((err as Error)?.name === "TimeoutError" || (err as Error)?.name === "AbortError") {
        return { status: 0, headers: new Headers(), text: "", bytes: new Uint8Array(), cookies: {}, timedOut: true, json: () => null };
      }
      if (err instanceof NetworkError) throw err;
      throw new NetworkError(String((err as Error)?.message ?? err));
    }

    const setCookies: Record<string, string> = {};
    // Node undici：getSetCookie 返回逐条 Set-Cookie
    const rawCookies = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    for (const line of rawCookies) {
      const [pair] = line.split(";");
      const idx = pair.indexOf("=");
      if (idx > 0) setCookies[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }

    const buffer = new Uint8Array(await res.arrayBuffer());
    const text = new TextDecoder("utf-8").decode(buffer);
    return {
      status: res.status,
      headers: res.headers,
      text,
      bytes: buffer,
      cookies: setCookies,
      json<T = any>(): T | null {
        try {
          return JSON.parse(text) as T;
        } catch {
          return null;
        }
      },
    };
  }

  /**
   * 并发执行多个请求并按输入顺序返回结果（对齐 Client.gather）。
   * CGI 请求按分组键（平台/comm/凭证/签名）自动分组，组内按 batchSize 合并为
   * 一次 CGI 多参数调用（req_0..req_N）；HTTP 请求不合并直接并发。
   */
  async gather<T = any>(
    requests: GatherRequest[],
    options?: { batchSize?: number; returnExceptions?: boolean },
  ): Promise<(T | Error)[]> {
    const batchSize = options?.batchSize ?? 20;
    const returnExceptions = options?.returnExceptions ?? false;
    if (batchSize <= 0) throw new Error("batch_size 必须大于 0");
    if (requests.length === 0) return [];

    const MISSING = Symbol("missing");
    const results: (T | Error | symbol)[] = new Array(requests.length).fill(MISSING);

    const cgiTasks: Array<{ index: number; req: CgiGatherRequest }> = [];
    const httpTasks: Array<{ index: number; req: HttpGatherRequest }> = [];
    requests.forEach((req, index) => {
      if (req.kind === "cgi") cgiTasks.push({ index, req });
      else httpTasks.push({ index, req });
    });

    const runCgiGroup = async (group: Array<{ index: number; req: CgiGatherRequest }>) => {
      // requireLogin 逐项校验
      const executable: Array<{ index: number; req: CgiGatherRequest }> = [];
      for (const task of group) {
        const credential = task.req.options?.credential ?? this.credential;
        if (task.req.options?.requireLogin && (!credential.musicid || !credential.musickey)) {
          const exc = new CredentialInvalidError("请求需要登录, 未提供有效的登录凭证");
          if (returnExceptions) {
            results[task.index] = exc;
            continue;
          }
          throw exc;
        }
        executable.push(task);
      }

      // 组内按 batchSize 分块合并请求：先全部发起（组内并发），再统一拆包解析（对齐 _gather_cgi 的批量并发）
      const batches: Array<{ chunk: typeof executable; baseOpts: CgiInvokeOptions; platform: Platform; device: QQDevice; comm: Record<string, string | number | boolean> }> = [];
      for (let start = 0; start < executable.length; start += batchSize) {
        const chunk = executable.slice(start, start + batchSize);
        const baseReq = chunk[0].req;
        const baseOpts: CgiInvokeOptions = baseReq.options ?? {};
        const platform = baseOpts.platform ?? this.platform;
        if (platform === "android") {
          try {
            await this.ensureAndroidSession();
          } catch (exc) {
            if (!returnExceptions) throw exc;
            for (const item of chunk) results[item.index] = exc as Error;
            continue;
          }
        }
        const device = this.device();
        const comm = await this.buildCommFor(platform, baseOpts, device);
        batches.push({ chunk, baseOpts, platform, device, comm });
      }

      const batchResponses = await Promise.all(
        batches.map(async (batch) => {
          const { chunk, baseOpts, platform, device, comm } = batch;
          const payload: Record<string, unknown> = { comm };
          chunk.forEach((item, i) => {
            const opts = item.req.options ?? {};
            const finalParam = opts.preserveBool ? item.req.param : (boolToInt(item.req.param) as Record<string, unknown>);
            payload[`req_${i}`] = { module: item.req.module, method: item.req.method, param: finalParam };
          });

          let url = CGI_URL;
          const queryParams = new URLSearchParams();
          if (baseOpts.sign) {
            url = CGI_SIGN_URL;
            queryParams.set("_", String(Date.now()));
            queryParams.set("sign", zzcSign(JSON.stringify(payload)));
          }

          await this.limiter.acquire();
          let body: unknown;
          try {
            const res = await fetchWithRetry(queryParams.toString() ? `${url}?${queryParams}` : url, {
              method: "POST",
              headers: {
                "User-Agent": getUserAgent(platform, device),
                "Content-Type": "application/json",
              },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(this.timeoutMs),
            });
            if (res.status !== 200) throw new HTTPError(`HTTP 请求状态码异常: ${res.status}`, res.status);
            body = await res.json().catch(() => {
              throw new ApiDataError("响应内容非有效 JSON 格式");
            });
          } catch (exc) {
            const error = exc instanceof NetworkError ? exc : toNetworkError(exc, this.timeoutMs);
            return { batch, error };
          }
          return { batch, body };
        }),
      );

      for (const outcome of batchResponses) {
        const chunk = outcome.batch.chunk;
        if ("error" in outcome && outcome.error) {
          if (returnExceptions) {
            for (const item of chunk) results[item.index] = outcome.error;
            continue;
          }
          throw outcome.error;
        }
        // 拆包 + 逐请求解析（每个请求带自己的 allowErrorCodes/parseOnAllow）
        let parsed: unknown[];
        try {
          parsed = parseCgiResponse((outcome as { body: unknown }).body, chunk.map((item) => item.req.options ?? {}), chunk.length);
        } catch (exc) {
          if (returnExceptions) {
            for (const item of chunk) results[item.index] = exc as Error;
            continue;
          }
          throw exc;
        }
        chunk.forEach((item, i) => {
          results[item.index] = parsed[i] as T;
        });
      }
    };

    const runHttp = async (tasks: Array<{ index: number; req: HttpGatherRequest }>) => {
      await Promise.all(
        tasks.map(async (task) => {
          try {
            results[task.index] = (await this.raw(task.req.options)) as unknown as T;
          } catch (exc) {
            if (returnExceptions) results[task.index] = exc as Error;
            else throw exc;
          }
        }),
      );
    };

    // CGI 分组执行（组间并发）+ HTTP 并发
    const groups = new Map<string, Array<{ index: number; req: CgiGatherRequest }>>();
    for (const task of cgiTasks) {
      const key = cgiGroupKey(task.req, this.credential);
      const group = groups.get(key) ?? [];
      group.push(task);
      groups.set(key, group);
    }
    await Promise.all([...groups.values()].map((group) => runCgiGroup(group)).concat(httpTasks.length ? [runHttp(httpTasks)] : []));

    const missing = results.findIndex((r) => r === MISSING);
    if (missing >= 0) throw new ApiDataError(`缺少以下索引结果: [${missing}]`);
    return results as (T | Error)[];
  }
}

/** 工厂：默认从 SQLite 加载已存凭证的客户端 */
export function getClient(options?: QQClientOptions): QQClient {
  return new QQClient(options);
}

export {
  ApiDataError,
  CgiApiError,
  CredentialExpiredError,
  GlobalApiError,
  HTTPError,
  NetworkError,
  RateLimitedError,
  SignatureRequiredError,
};

/** 单个 req_N 结果的错误映射与解析（对齐 CgiRequest._parse_response） */
function parseSingleCgiResult<T>(raw: unknown, opts: Pick<CgiInvokeOptions, "allowErrorCodes" | "parseOnAllow">): T {
  const item = raw as Record<string, any> | null | undefined;
  const code = item?.code ?? 0;
  const data = item?.data ?? {};
  const allowed =
    opts.allowErrorCodes === "all" ||
    (Array.isArray(opts.allowErrorCodes) && (opts.allowErrorCodes as number[]).includes(code));
  if (allowed) {
    return (opts.parseOnAllow ? data : item) as T;
  }
  if (code === 2000) throw new SignatureRequiredError(code, data);
  if (code === 2001) throw new RateLimitedError(code, data);
  if (code === 1000 || code === 104401 || code === 104400) throw new CredentialExpiredError(code, data);
  if (code !== 0) throw new CgiApiError(`CGI 请求错误 (code=${code})`, code, data);
  return data as T;
}

/**
 * 同步拆包 + 错误映射（供 invoke / gather 共用）。
 * expectedCount：校验响应中 req_0..req_{N-1} 是否齐全（对齐 _unwrap_cgi_batch 的 KeyError 校验）。
 */
export function parseCgiResponse<T>(
  body: unknown,
  optsOrOpts: Pick<CgiInvokeOptions, "allowErrorCodes" | "parseOnAllow"> | Array<Pick<CgiInvokeOptions, "allowErrorCodes" | "parseOnAllow">>,
  expectedCount?: number,
): T[] {
  const resp = body as Record<string, any>;
  if (resp === null || resp === undefined || typeof resp !== "object") {
    // 对齐 Python "响应无内容" 检查（body 为空字符串/null 时 json() 产物非对象）
    throw new ApiDataError(resp === null || resp === undefined ? "响应无内容" : "响应内容非有效 JSON 格式");
  }
  const globalCode = resp.code ?? 0;
  if (globalCode !== 0) throw new GlobalApiError(globalCode, resp);

  const optsList = Array.isArray(optsOrOpts) ? optsOrOpts : [optsOrOpts];
  const count = expectedCount ?? optsList.length;
  const results: T[] = [];
  for (let i = 0; i < count; i++) {
    const key = `req_${i}`;
    if (!(key in resp)) {
      throw new ApiDataError(`CGI 响应格式异常, 缺少预期的子响应: '${key}'`);
    }
    results.push(parseSingleCgiResult<T>(resp[key], optsList[Math.min(i, optsList.length - 1)]));
  }
  return results;
}
