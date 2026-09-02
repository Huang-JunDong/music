/** 统一 HTTP 封装：默认 UA / 随机国内 IP 头 / 超时 / 无缓存 */

export const UA_PC =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";
export const UA_ANDROID =
  "Mozilla/5.0 (Linux; Android 10; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.162 Mobile Safari/537.36";
export const UA_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13B143 Safari/601.1";

/** 随机中国大陆 IP，规避部分平台风控（前缀表对齐 Go utils.RandomChinaIP） */
const CN_IP_PREFIXES: [number, number][] = [
  [116, 255],
  [116, 228],
  [218, 192],
  [124, 0],
  [14, 132],
  [183, 14],
  [58, 14],
  [113, 116],
  [120, 230],
];
export function randomCNIP(): string {
  const [a, b] = CN_IP_PREFIXES[Math.floor(Math.random() * CN_IP_PREFIXES.length)];
  return `${a}.${b}.${randByte()}.${randByte()}`;
}
function randByte(): number {
  return Math.floor(Math.random() * 254) + 1;
}

export interface HttpInit {
  headers?: Record<string, string>;
  timeoutMs?: number;
  redirect?: RequestRedirect;
  method?: string;
  body?: string;
}

async function doFetch(url: string, init: HttpInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 15_000);
  try {
    // 随机 IP 双头注入（对齐 Go WithRandomIPHeader：X-Forwarded-For + X-Real-IP 同值）。
    // migu 域名全家族在 Go 侧不带随机 IP 头，此处按域名跳过以精确对齐。
    const ipHeaders: Record<string, string> = {};
    if (!/(^|\.)migu\.cn$|(^|\.)migu\.com$/.test(safeHostname(url))) {
      const ip = randomCNIP();
      ipHeaders["X-Forwarded-For"] = ip;
      ipHeaders["X-Real-IP"] = ip;
    }
    return await fetch(url, {
      method: init.method ?? "GET",
      body: init.body,
      headers: {
        "User-Agent": UA_PC,
        ...ipHeaders,
        ...(init.headers ?? {}),
      },
      redirect: init.redirect ?? "follow",
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export async function httpGetText(url: string, init: HttpInit = {}): Promise<string> {
  const resp = await doFetch(url, init);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${new URL(url).host}`);
  return resp.text();
}

export async function httpGetJSON<T = unknown>(url: string, init: HttpInit = {}): Promise<T> {
  const text = await httpGetText(url, init);
  return JSON.parse(text) as T;
}

export async function httpPostFormResp(
  url: string,
  form: Record<string, string>,
  init: HttpInit = {},
): Promise<Response> {
  const body = new URLSearchParams(form).toString();
  return doFetch(url, {
    ...init,
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(init.headers ?? {}),
    },
  });
}

export async function httpPostFormText(
  url: string,
  form: Record<string, string>,
  init: HttpInit = {},
): Promise<string> {
  const resp = await httpPostFormResp(url, form, init);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${new URL(url).host}`);
  return resp.text();
}

export async function httpPostFormJSON<T = unknown>(
  url: string,
  form: Record<string, string>,
  init: HttpInit = {},
): Promise<T> {
  const text = await httpPostFormText(url, form, init);
  return JSON.parse(text) as T;
}

/** 不跟随重定向，用于拿 302 Location */
export async function httpGetNoRedirect(url: string, init: HttpInit = {}): Promise<Response> {
  return doFetch(url, { ...init, redirect: "manual" });
}

/** 任意 method/body 的原始请求，直接暴露 Response（供读取 Set-Cookie / Location / 二进制体） */
export async function httpRequest(url: string, init: HttpInit = {}): Promise<Response> {
  return doFetch(url, init);
}

/** POST JSON body 并解析 JSON 响应（对齐 Go utils.Post + json.Marshal 请求体） */
export async function httpPostJSON<T = unknown>(
  url: string,
  data: unknown,
  init: HttpInit = {},
): Promise<T> {
  const resp = await doFetch(url, {
    ...init,
    method: "POST",
    body: JSON.stringify(data),
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${new URL(url).host}`);
  return (await resp.json()) as T;
}

/** POST 自定义 Content-Type 的 JSON 字符串 body（对齐 Go 中 form Content-Type + JSON body 的写法） */
export async function httpPostRawBodyText(
  url: string,
  body: string,
  contentType: string,
  init: HttpInit = {},
): Promise<Response> {
  return doFetch(url, {
    ...init,
    method: "POST",
    body,
    headers: {
      "Content-Type": contentType,
      ...(init.headers ?? {}),
    },
  });
}

/** 从 Response 提取 Set-Cookie → {name: value}（对齐 Go resp.Cookies()） */
export function responseCookies(resp: Response): Record<string, string> {
  const cookies: Record<string, string> = {};
  const headers = resp.headers as Headers & { getSetCookie?: () => string[] };
  const list = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  for (const raw of list) {
    const pair = raw.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name) cookies[name] = value;
  }
  return cookies;
}

/** GET 原始字节（供 GB18030 等非 UTF-8 响应手动解码） */
export async function httpGetBuffer(url: string, init: HttpInit = {}): Promise<Buffer> {
  const resp = await doFetch(url, init);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${new URL(url).host}`);
  return Buffer.from(await resp.arrayBuffer());
}

/** POST 原始 JSON 字符串（Content-Type: application/json） */
export async function httpPostJSONText(url: string, json: string, init: HttpInit = {}): Promise<string> {
  const resp = await doFetch(url, {
    ...init,
    method: "POST",
    body: json,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${new URL(url).host}`);
  return resp.text();
}

/** GB18030 兜底解码：优先 UTF-8，非法时回退 GB18030（对齐 Go simplifiedchinese） */
export function decodeBodyBuffer(buf: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    try {
      return new TextDecoder("gb18030").decode(buf);
    } catch {
      return buf.toString("utf8");
    }
  }
}

export function firstNonEmpty(...values: (string | undefined | null)[]): string {
  for (const v of values) {
    if (v && v.trim()) return v.trim();
  }
  return "";
}
