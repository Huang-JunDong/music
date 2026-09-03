/**
 * 极简 axios 兼容层 — 供少数直连模块（audio_match / register_xeapikey / related_playlist /
 * checktoken_v3 / 上传类）使用，基于原生 fetch。
 * 仅实现被用到的方法面：({ method, url, headers, data, timeout }) 与 get(url, config)。
 */
export interface AxiosLikeResponse<T = any> {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: T;
}

export interface AxiosLikeConfig {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  data?: any;
  timeout?: number;
  responseType?: string;
  params?: Record<string, any>;
  /** 同 axios：自定义状态码放行函数；传入则覆盖默认 2xx 校验 */
  validateStatus?: (status: number) => boolean;
}

function normalizeHeaders(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}

async function request<T = any>(config: AxiosLikeConfig): Promise<AxiosLikeResponse<T>> {
  const method = (config.method || "get").toUpperCase();
  let url = config.url ?? "";
  if (config.params) {
    const qs = new URLSearchParams(
      Object.entries(config.params).map(([k, v]) => [k, String(v)]),
    ).toString();
    if (qs) url += (url.includes("?") ? "&" : "?") + qs;
  }

  const init: RequestInit = {
    method,
    headers: config.headers ? { ...config.headers } : {},
    signal: config.timeout ? AbortSignal.timeout(config.timeout) : undefined,
  };
  if (config.data != null && method !== "GET" && method !== "HEAD") {
    if (
      typeof config.data === "string" ||
      config.data instanceof Buffer ||
      config.data instanceof Uint8Array ||
      typeof (config.data as any)?.on === "function"
    ) {
      init.body = config.data;
      const headers = init.headers as Record<string, string>;
      if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
        headers["Content-Type"] = "application/x-www-form-urlencoded;charset=utf-8";
      }
    } else {
      init.body = new URLSearchParams(config.data).toString();
    }
  }

  const res = await fetch(url, init);
  let data: any = await res.text();
  try {
    data = JSON.parse(data);
  } catch {
    /* 保留文本 */
  }
  const out: AxiosLikeResponse = {
    status: res.status,
    statusText: res.statusText,
    headers: normalizeHeaders(res),
    data,
  };
  // 对齐 axios 默认行为：非 2xx 抛错并携带 error.response（调用方 catch 分支语义与源实现一致）
  const validate = config.validateStatus ?? ((s: number) => s >= 200 && s < 300);
  if (!validate(res.status)) {
    const err = new Error(`Request failed with status code ${res.status}`) as Error & { response?: AxiosLikeResponse };
    err.response = out;
    throw err;
  }
  return out;
}

const axiosLike = {
  request,
  get: <T = any>(url: string, config: AxiosLikeConfig = {}) => request<T>({ ...config, url, method: "get" }),
  post: <T = any>(url: string, data?: any, config: AxiosLikeConfig = {}) =>
    request<T>({ ...config, url, method: "post", data }),
};

export default axiosLike;
