/**
 * 核心请求器 — 对齐 api-enhanced util/request.js
 * weapi / linuxapi / xeapi / eapi / api 五种加密通道 + cookie 加工 + NMTID 采集 +
 * 匿名 token 注入 + xeapi 公钥/会话管理 + 响应解密
 * 基于 Node 原生 fetch（Next.js node runtime）。
 */
import crypto from "node:crypto";
import * as encrypt from "./crypto";
import { APP_CONF } from "./config";
import { logger } from "./logger";
import { proxyInsecure } from "../env";
import {
  cookieToJson,
  cookieObjToString,
  toBoolean,
  generateRandomChineseIP,
} from "./utils";
import { ncmGlobals } from "./global-state";
import { ensureAnonymousToken, getAnonymousToken } from "./anonymous";
import { getTokenV2, getTokenV3 } from "./checktoken";
import {
  getCachedXeapiPublicKey,
  getXeapiPublicKey,
  type XeapiPublicKeyState,
} from "./xeapi-key";
import type { NcmRequestOption, NcmResponse, NcmResponseOf } from "./types";

const DOMAIN = APP_CONF.domain;
const API_DOMAIN = APP_CONF.apiDomain;
const EAPI_DOMAIN = APP_CONF.eapiDomain;
const XEAPI_DOMAIN = APP_CONF.xeapiDomain;
const ENCRYPT_RESPONSE = APP_CONF.encryptResponse;
const SPECIAL_STATUS_CODES = new Set([201, 302, 400, 502, 800, 801, 802, 803]);

let xeapiSessionId = "";
let xeapiSessionKey = "";

// 预计算 WNMCID（进程级一次）
const WNMCID = (() => {
  const characters = "abcdefghijklmnopqrstuvwxyz";
  let randomString = "";
  for (let i = 0; i < 6; i++) {
    randomString += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return `${randomString}.${Date.now()}.01.0`;
})();

let NMTID = "";
let NMTID_RETRIES_LEFT = 3;

const osMap: Record<string, { os: string; appver: string; osver: string; channel: string }> = {
  pc: { os: "pc", appver: "3.1.17.204416", osver: "Microsoft-Windows-10-Professional-build-19045-64bit", channel: "netease" },
  linux: { os: "linux", appver: "1.2.1.0428", osver: "Deepin 20.9", channel: "netease" },
  android: { os: "android", appver: "8.20.20.231215173437", osver: "14", channel: "xiaomi" },
  iphone: { os: "iPhone OS", appver: "9.0.90", osver: "16.2", channel: "distribution" },
  osx: { os: "osx", appver: "3.1.10.5100", osver: "15.5", channel: "netease" },
};

const userAgentMap: Record<string, Record<string, string>> = {
  weapi: {
    pc: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
  },
  linuxapi: {
    linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36",
  },
  api: {
    pc: "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/3.1.29.205117",
    android:
      "NeteaseMusic/9.5.61.260802021928(9005061);Dalvik/2.1.0 (Linux; U; Android 12; HBN-AL00 Build/cd737a2.0)",
    iphone: "NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)",
  },
};

const chooseUserAgent = (cryptoType: string, uaType = "pc"): string =>
  (userAgentMap[cryptoType] && userAgentMap[cryptoType][uaType]) || "";

// ---------------------------------------------------------------------------
// cookie 加工
// ---------------------------------------------------------------------------

function processCookieObject(cookie: Record<string, any>, cryptoType: string): Record<string, any> {
  const _ntes_nuid = crypto.randomBytes(16).toString("hex");
  const os = osMap[cookie.os] || osMap["pc"];

  const processedCookie: Record<string, any> = {
    ...cookie,
    __remember_me: "true",
    ntes_kaola_ad: "1",
    _ntes_nuid: cookie._ntes_nuid || _ntes_nuid,
    _ntes_nnid: cookie._ntes_nnid || `${_ntes_nuid},${Date.now().toString()}`,
    WNMCID: cookie.WNMCID || WNMCID,
    WEVNSM: cookie.WEVNSM || "1.0.0",
    osver: cookie.osver || os.osver,
    deviceId: cookie.deviceId || ncmGlobals.deviceId,
    os: cookie.os || os.os,
    channel: cookie.channel || os.channel,
    appver: cookie.appver || os.appver,
  };

  // 服务端下发条件为不带 NMTID 请求任意 eapi 加密方式接口
  if (cookie.NMTID) {
    processedCookie["NMTID"] = cookie.NMTID;
  } else if (NMTID) {
    processedCookie["NMTID"] = NMTID;
  } else if (NMTID_RETRIES_LEFT <= 0 || cryptoType !== "eapi") {
    processedCookie["NMTID"] = "00O" + crypto.randomBytes(10).toString("hex");
  }

  if (!processedCookie.MUSIC_U) {
    processedCookie.MUSIC_A = processedCookie.MUSIC_A || getAnonymousToken();
  }

  return processedCookie;
}

function createHeaderCookie(header: Record<string, any>): string {
  return Object.keys(header)
    .map((key) => encodeURIComponent(key) + "=" + encodeURIComponent(header[key]))
    .join("; ");
}

const generateRequestId = (): string =>
  `${Date.now()}_${Math.floor(Math.random() * 1000).toString().padStart(4, "0")}`;

// ---------------------------------------------------------------------------
// createRequest
// ---------------------------------------------------------------------------

/** 代理 dispatcher 缓存（同 proxy URL 复用连接池；undici 动态加载，未用到时代零开销） */
const proxyDispatcherCache = new Map<string, unknown>();

async function getProxyDispatcher(proxyUrl: string): Promise<unknown> {
  if (proxyDispatcherCache.has(proxyUrl)) return proxyDispatcherCache.get(proxyUrl);
  let agent: unknown;
  try {
    const purl = new URL(proxyUrl);
    if (purl.hostname) {
      const { ProxyAgent } = await import("undici");
      const token =
        purl.username && purl.password
          ? "Basic " + Buffer.from(`${decodeURIComponent(purl.username)}:${decodeURIComponent(purl.password)}`).toString("base64")
          : undefined;
      agent = new ProxyAgent({
        uri: `${purl.protocol}//${purl.host}`,
        token,
        // 审核整改 A-05：默认严格校验目标证书；仅 MUSIC_DL_PROXY_INSECURE=1（书面风险接受的
        // 代码化，供自签证书代理场景显式降级）时关闭，默认生产环境保持安全。
        requestTls: purl.protocol === "https:" ? { rejectUnauthorized: !proxyInsecure() } : undefined,
      });
    } else {
      logger.error("[proxy] 代理配置无效,不使用代理");
    }
  } catch (e: any) {
    logger.error("[proxy] 代理URL解析/加载失败:", e?.message ?? e);
  }
  if (agent) proxyDispatcherCache.set(proxyUrl, agent);
  return agent;
}

export async function createRequest<T = any>(
  uri: string,
  data: Record<string, any>,
  options: NcmRequestOption,
): Promise<NcmResponseOf<T>> {
  let token = "";
  switch (options.checkToken) {
    case "v2":
      token = await getTokenV2();
      break;
    case "v3":
      token = await getTokenV3();
      break;
  }

  const headers: Record<string, string> = options.headers ? { ...options.headers } : {};
  const ip = options.realIP || options.ip || "";

  let cryptoType = options.crypto;
  if (cryptoType === "") {
    cryptoType = APP_CONF.encrypt ? "eapi" : "api";
  }

  if (ip) {
    headers["X-Real-IP"] = ip;
    headers["X-Forwarded-For"] = ip;
  }

  let cookie: Record<string, any> = (options.cookie as any) || {};
  if (typeof cookie === "string") {
    cookie = cookieToJson(cookie);
  }
  if (typeof cookie === "object" && cookie !== null) {
    cookie = processCookieObject(cookie, cryptoType);
    headers["Cookie"] = cookieObjToString(cookie);
  } else {
    cookie = {};
  }

  // 无登录态时惰性注册匿名 token（对齐 app.js 启动 generateConfig 行为）
  if (!cookie.MUSIC_U && !getAnonymousToken()) {
    await ensureAnonymousToken((u, d, o) => createRequest(u, d, o as NcmRequestOption));
    const processed = processCookieObject({ ...(options.cookie as any) || {} }, cryptoType);
    if (!processed.MUSIC_U) processed.MUSIC_A = getAnonymousToken();
    cookie = processed;
    headers["Cookie"] = cookieObjToString(cookie);
  }

  let url = "";
  let encryptData: Record<string, any>;
  const csrfToken = cookie["__csrf"] || "";

  const answer: NcmResponse = { status: 500, body: {}, cookie: [] };

  (data as any).e_r = toBoolean(
    options.e_r !== undefined
      ? options.e_r
      : (data as any).e_r !== undefined
        ? (data as any).e_r
        : ENCRYPT_RESPONSE,
  );

  switch (cryptoType) {
    case "weapi": {
      headers["Referer"] = options.domain || DOMAIN;
      headers["User-Agent"] = options.ua || chooseUserAgent("weapi");
      (data as any).csrf_token = csrfToken;
      if (options.checkToken) {
        headers["X-antiCheatToken"] = token;
      }
      encryptData = encrypt.weapi(data);
      url = (options.domain || DOMAIN) + "/weapi/" + uri.substr(5);
      break;
    }

    case "linuxapi": {
      headers["User-Agent"] = options.ua || chooseUserAgent("linuxapi", "linux");
      encryptData = encrypt.linuxapi({
        method: "POST",
        url: (options.domain || DOMAIN) + uri,
        params: data,
      });
      url = (options.domain || DOMAIN) + "/api/linux/forward";
      break;
    }

    case "xeapi": {
      let xeapiPublicKey: XeapiPublicKeyState | null = getCachedXeapiPublicKey();
      if (!xeapiPublicKey) {
        xeapiPublicKey = await getXeapiPublicKey({}, (cookie as any).deviceId || "");
      }
      if (!xeapiPublicKey) {
        throw new Error("xeapi public key is missing");
      }
      const xeapiOs = cookie.os === "android" ? cookie.os : "android";
      const xeapiAppver = cookie.os === "android" && cookie.appver ? cookie.appver : "9.1.65";
      const xeapiOsver = cookie.os === "android" && cookie.osver ? cookie.osver : "16";
      const xeapiBuildver = cookie.buildver || Date.now().toString().substr(0, 10);
      headers["User-Agent"] = options.ua || chooseUserAgent("api", "android");
      headers["X-Client-Enc-State"] = "ENCRYPTED";
      headers["x-aeapi"] = "true";
      headers["content-type"] = "application/x-www-form-urlencoded;charset=utf-8";
      headers["x-deviceid"] = cookie.deviceId;
      headers["x-os"] = xeapiOs;
      headers["x-osver"] = xeapiOsver;
      headers["x-appver"] = xeapiAppver;
      headers["x-sdeviceid"] = cookie.sDeviceId || cookie.deviceId;
      headers["x-buildver"] = xeapiBuildver;
      if (cookie.MUSIC_U) headers["x-music-u"] = cookie.MUSIC_U;
      if (options.checkToken) {
        headers["X-antiCheatToken"] = token;
      }
      const xeapiCookie = {
        ...cookie,
        os: xeapiOs,
        osver: xeapiOsver,
        appver: xeapiAppver,
        buildver: xeapiBuildver,
        deviceId: cookie.deviceId,
        sDeviceId: cookie.sDeviceId || cookie.deviceId,
      };
      headers["Cookie"] = cookieObjToString(xeapiCookie);
      url = (options.domain || XEAPI_DOMAIN) + "/xeapi/" + uri.substr(5);
      encryptData = encrypt.xeapi(uri, data, {
        ...(options as any),
        publicKeyState: xeapiPublicKey,
        sessionId: xeapiSessionId,
        sessionKey: xeapiSessionKey,
        appver: xeapiAppver,
        deviceId: cookie.deviceId,
        os: xeapiOs,
        uid: cookie.uid || cookie.userId || "",
      });
      break;
    }

    case "eapi":
    case "api": {
      const header: Record<string, any> = {
        osver: cookie.osver,
        deviceId: cookie.deviceId,
        os: cookie.os,
        appver: cookie.appver,
        versioncode: cookie.versioncode || "140",
        mobilename: cookie.mobilename || "",
        buildver: cookie.buildver || Date.now().toString().substr(0, 10),
        resolution: cookie.resolution || "1920x1080",
        __csrf: csrfToken,
        channel: cookie.channel,
        requestId: generateRequestId(),
      };

      if (cookie.MUSIC_U) header["MUSIC_U"] = cookie.MUSIC_U;
      if (cookie.MUSIC_A) header["MUSIC_A"] = cookie.MUSIC_A;
      if (options.checkToken) header["X-antiCheatToken"] = token;
      if (cryptoType === "eapi" && cookie.NMTID) header["NMTID"] = cookie.NMTID;

      headers["Cookie"] = createHeaderCookie(header);
      headers["User-Agent"] =
        options.ua ||
        (cookie.os === "osx"
          ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
          : chooseUserAgent("api", "iphone"));

      if (cryptoType === "eapi") {
        (data as any).header = header;
        encryptData = encrypt.eapi(uri, data);
        url = (options.domain || EAPI_DOMAIN) + "/eapi/" + uri.substr(5);
      } else {
        url = (options.domain || API_DOMAIN) + uri;
        encryptData = data;
      }
      break;
    }

    default:
      console.log("[ERR]", "Unknown Crypto:", cryptoType);
      encryptData = data;
      url = (options.domain || API_DOMAIN) + uri;
      break;
  }

  const body = new URLSearchParams(
    Object.entries(encryptData).map(([k, v]) => [k, typeof v === "string" ? v : String(v)]),
  ).toString();

  const useE_r = (cryptoType === "eapi" || cryptoType === "weapi") && (data as any).e_r;
  const useXeapi = cryptoType === "xeapi";

  /** proxy 参数支持 — 对齐源 request.js（http/https 代理走 undici ProxyAgent；PAC 暂不支持则忽略并提示） */
  let dispatcher: unknown;
  if (options.proxy) {
    if (String(options.proxy).includes("pac")) {
      logger.warn("[proxy] PAC 代理在 fetch 链路暂不支持，本次请求不使用代理");
    } else {
      dispatcher = await getProxyDispatcher(String(options.proxy));
    }
  }

  let res: Response;
  try {
    // axios 语义：表单字符串 body 默认 application/x-www-form-urlencoded（fetch 不会自动设置）
    const requestHeaders: Record<string, string> = { ...headers };
    if (!Object.keys(requestHeaders).some((k) => k.toLowerCase() === "content-type")) {
      requestHeaders["Content-Type"] = "application/x-www-form-urlencoded";
    }

    res = await fetch(url, {
      method: "POST",
      headers: requestHeaders,
      body,
      signal: options.timeout > 0 ? AbortSignal.timeout(options.timeout) : undefined,
      // @ts-expect-error Node fetch 扩展：undici ProxyAgent dispatcher（proxy 参数）
      dispatcher,
    });
  } catch (err: any) {
    answer.status = 502;
    answer.body = { code: 502, msg: err?.message || String(err) };
    throw answer;
  }

  const setCookies =
    (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ??
    (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")!] : []);

  const cleanCookie = (x: string) => x.replace(/\s*Domain=[^(;|$)]+;*/, "");

  if (cryptoType === "eapi" && !NMTID && NMTID_RETRIES_LEFT > 0 && !cookie.NMTID) {
    NMTID_RETRIES_LEFT--;
    answer.cookie = setCookies.map((x) => {
      const cleaned = cleanCookie(x);
      const match = x.match(/(?:^|;\s*)NMTID=([^;]+)/);
      if (match) NMTID = match[1];
      return cleaned;
    });
  } else {
    answer.cookie = setCookies.map(cleanCookie);
  }

  try {
    let parsed: any;
    if (useXeapi) {
      const ssid = res.headers.get("x-encr-ssid");
      const sskey = res.headers.get("x-encr-sskey");
      if (ssid && sskey) {
        xeapiSessionId = ssid;
        xeapiSessionKey = sskey;
      }
      parsed = encrypt.xeapiResDecrypt(Buffer.from(await res.arrayBuffer()));
    } else if (useE_r) {
      parsed = encrypt.eapiResDecrypt(
        Buffer.from(await res.arrayBuffer()).toString("hex").toUpperCase(),
        headers["x-aeapi"] === "true",
      );
    } else {
      const text = await res.text();
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    answer.body = parsed;
    if (answer.body && typeof answer.body === "object" && answer.body.code) {
      answer.body.code = Number(answer.body.code);
    }
    answer.status = Number(
      (answer.body && answer.body.code) || res.status,
    );
    if (answer.body && SPECIAL_STATUS_CODES.has(answer.body.code)) {
      answer.status = 200;
    }
  } catch {
    answer.body = await res.text();
    answer.status = res.status;
  }

  answer.status = answer.status > 100 && answer.status < 600 ? answer.status : 400;

  if (answer.status === 200) {
    return answer;
  }
  throw answer;
}

export { generateRandomChineseIP };
