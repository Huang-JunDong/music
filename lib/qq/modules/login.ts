/**
 * 登录模块 — 移植自 .ref/QQMusicApi qqmusic_api/modules/login.py。
 * QQ 扫码（ptlogin2 → graph.qq.com OAuth → QQConnectLogin）、微信扫码（open.weixin → LoginServer）、
 * 手机客户端扫码（CreateQRCode + MQTT 推送）、手机验证码（SendPhoneAuthCode/Login）、
 * 凭证检查/刷新/登出。
 */
import { randomUUID } from "node:crypto";
import type { CgiInvokeOptions, Credential, Platform } from "../types";
import { credentialFromJSON } from "../credential";
import type { QQClient } from "../client";
import {
  ApiDataError,
  CredentialRefreshError,
  LoginAccountRestrictedError,
  LoginAuthExpiredError,
  LoginDeviceLimitError,
  LoginError,
  LoginRateLimitError,
  NetworkError,
} from "../errors";
import { hash33 } from "../utils";
import { getProfile } from "../versioning";
import { MqttClient } from "../mqtt";

export type QRLoginType = "qq" | "wx" | "mobile";

export type QRCodeEvent = "DONE" | "SCAN" | "CONF" | "TIMEOUT" | "REFUSE";

/** 二维码登录事件码映射（QQ ptqrlogin code / WX errcode → 事件） */
const QQ_EVENT_BY_CODE: Record<number, QRCodeEvent> = {
  0: "DONE",
  405: "DONE",
  66: "SCAN",
  408: "SCAN",
  67: "CONF",
  404: "CONF",
  65: "TIMEOUT",
  402: "TIMEOUT",
  68: "REFUSE",
  403: "REFUSE",
};

/** Web 层事件序列化码（对齐参考仓库 QR_CODE_EVENT_CODES） */
export const QR_EVENT_CODES: Record<QRCodeEvent, number> = {
  DONE: 0,
  SCAN: 1,
  CONF: 2,
  TIMEOUT: 3,
  REFUSE: 4,
};

export interface QR {
  data: Buffer;
  qrType: QRLoginType;
  mimetype: string;
  identifier: string;
}

export interface QRLoginResult {
  event: QRCodeEvent;
  done: boolean;
  credential?: Credential;
}

const ERROR_CODES = [1000, 104401, 104400, 20261, 20271, 20272, 20274, 20277, 20278, 20279, 20450, 104604];

/** LoginServer 结果校验与错误映射（对齐 _validate_result，含全部专用子类） */
function validateLoginResult(resp: Record<string, any>): Record<string, any> {
  const code = resp?.code ?? 0;
  const data = resp?.data ?? {};
  switch (code) {
    case 0:
      return resp;
    case 1000:
    case 104401:
    case 104400:
      throw new LoginAuthExpiredError(code, data);
    case 20261:
      throw new LoginError("登录参数错误", code, data);
    case 20271:
      throw new LoginError("验证码错误", code, data);
    case 20272:
      throw new LoginError("账号绑定异常", code, data);
    case 20274:
      throw new LoginError("账号绑定缺失", code, data);
    case 20277:
    case 20278:
      throw new LoginAccountRestrictedError(code, data);
    case 20279:
      throw new LoginDeviceLimitError(code, data);
    case 20450:
      throw new LoginAccountRestrictedError("账号已被封禁", code, data);
    case 104604:
      throw new LoginRateLimitError(code, data);
    default:
      throw new LoginError("登录失败", code, data);
  }
}

/* ---------------- 凭证生命周期 ---------------- */

/** 检查登录凭证是否已过期（Android 平台走 CGI；Web 平台走主页 fcg） */
export async function checkExpired(client: QQClient, credential?: Credential | null): Promise<boolean> {
  const target = credential ?? client.credential;
  if (client.platform === "web") {
    const res = await client.raw({
      method: "GET",
      url: "https://c6.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg",
      params: {
        g_tk: String(hash33(target.musickey, 5381)),
        format: "json",
        inCharset: "utf-8",
        outCharset: "utf-8",
        notice: "0",
        cid: "205360838",
        needNewCode: "0",
        loginUin: String(target.musicid),
        hostUin: "0",
        userid: String(target.musicid),
        reqfrom: "1",
      },
      credential: target,
    });
    const body = res.json<Record<string, any>>();
    return body?.code !== 0;
  }
  const data = await client.invoke(
    "music.UserInfo.userInfoServer",
    "GetLoginUserInfo",
    {},
    { credential: target, allowErrorCodes: [1000, 104401, 104400] },
  );
  return (data as Record<string, any>)?.code !== 0;
}

/** 刷新登录凭证（按登录类型构造 refresh 参数，loginMode=2） */
export async function refreshCredential(client: QQClient, credential?: Credential | null): Promise<Credential> {
  const target = credential ?? client.credential;
  let param: Record<string, unknown>;
  switch (target.loginType) {
    case 1:
      param = {
        openid: target.openid,
        refresh_token: target.refresh_token,
        str_musicid: target.str_musicid || String(target.musicid),
        musickey: target.musickey,
        unionid: target.unionid,
        refresh_key: target.refresh_key,
        loginMode: 2,
      };
      break;
    case 2:
      param = {
        openid: target.openid,
        access_token: target.access_token,
        refresh_token: target.refresh_token,
        expired_in: target.expired_at,
        musicid: target.musicid,
        musickey: target.musickey,
        refresh_key: target.refresh_key,
        loginMode: 2,
      };
      break;
    default:
      param = {
        openid: target.openid,
        access_token: target.access_token,
        refresh_token: target.refresh_token,
        expired_in: target.expired_at,
        str_musicid: target.str_musicid || String(target.musicid),
        musicid: target.musicid,
        musickey: target.musickey,
        unionid: target.unionid,
        refresh_key: target.refresh_key,
        loginMode: 2,
      };
  }
  const data = await client.invoke("music.login.LoginServer", "Login", param, {
    comm: { tmeLoginType: target.loginType },
    credential: target,
    allowErrorCodes: ERROR_CODES,
  });
  try {
    return credentialFromJSON(validateLoginResult(data as Record<string, any>));
  } catch (err) {
    if (err instanceof LoginError) {
      // 对齐 Python：LoginError → CredentialRefreshError(message/code/data)
      throw new CredentialRefreshError(err.message, err.code, err.data);
    }
    throw err;
  }
}

/** 登出当前账号（未显式传凭证时重置客户端全局凭证，对齐 logout 的 credential 重置） */
export async function logout(client: QQClient, credential?: Credential | null): Promise<void> {
  await client.invoke("music.login.LoginServer", "Logout", {}, {
    credential: credential ?? null,
    allowErrorCodes: ERROR_CODES,
    requireLogin: true,
  });
  if (credential == null) {
    client.setCredential(null);
  }
}

/* ---------------- 二维码登录 ---------------- */

/** 获取 QQ 授权二维码（ptqrshow + qrsig） */
async function getQQQr(client: QQClient): Promise<QR> {
  const res = await client.raw({
    method: "GET",
    url: "https://ssl.ptlogin2.qq.com/ptqrshow",
    params: {
      appid: "716027609",
      e: "2",
      l: "M",
      s: "3",
      d: "72",
      v: "4",
      t: String(Math.random()),
      daid: "383",
      pt_3rd_aid: "100497308",
    },
    headers: { Referer: "https://xui.ptlogin2.qq.com/" },
    cookies: {},
  });
  const qrsig = res.cookies.qrsig;
  if (!qrsig) throw new ApiDataError("获取 qrsig 失败");
  return makeQR(Buffer.from(res.bytes), "qq", "image/png", qrsig);
}

function makeQR(data: Buffer, qrType: QRLoginType, mimetype: string, identifier: string): QR {
  return { data, qrType, mimetype, identifier };
}

/** 获取微信登录二维码（qrconnect 页面提取 uuid → qrcode 图片） */
async function getWxQr(client: QQClient): Promise<QR> {
  const page = await client.raw({
    method: "GET",
    url: "https://open.weixin.qq.com/connect/qrconnect",
    params: {
      appid: "wx48db31d50e334801",
      redirect_uri: "https://y.qq.com/portal/wx_redirect.html?login_type=2&surl=https://y.qq.com/",
      response_type: "code",
      scope: "snsapi_login",
      state: "STATE",
      href: "https://y.qq.com/mediastyle/music_v17/src/css/popup_wechat.css#wechat_redirect",
    },
    cookies: {},
  });
  if (!page.text) throw new ApiDataError("获取二维码失败");
  const uuidMatch = page.text.match(/uuid=(.+?)"/);
  if (!uuidMatch) throw new ApiDataError("获取 uuid 失败");
  const uuid = uuidMatch[1];
  const img = await client.raw({
    method: "GET",
    url: `https://open.weixin.qq.com/connect/qrcode/${uuid}`,
    headers: { Referer: "https://open.weixin.qq.com/connect/qrconnect" },
    cookies: {},
  });
  return makeQR(Buffer.from(img.bytes), "wx", "image/jpeg", uuid);
}

/** 获取手机客户端登录二维码（CreateQRCode；ct/cv 取全局平台 profile，全局为 Web 时切换 Android 平台） */
export async function getMobileQr(client: QQClient): Promise<QR> {
  // 对齐 Python：_build_version_params() 无参 → 取全局平台 profile；platform 仅在全局为 WEB 时固定 ANDROID
  const profile = getProfile(client.platform);
  const data = await client.invoke(
    "music.login.LoginServer",
    "CreateQRCode",
    { tmeAppID: "qqmusic", ct: profile.ct, cv: profile.cv },
    { comm: { ct: 23, cv: 0 }, platform: (client.platform === "web" ? "android" : undefined) as Platform | undefined },
  );
  const qrcode = String((data as Record<string, any>)?.qrcode ?? "");
  const qrcodeId = String((data as Record<string, any>)?.qrcodeID ?? "");
  if (!qrcode || !qrcodeId) throw new ApiDataError("获取二维码失败");
  const b64 = qrcode.split(",").pop() ?? "";
  return makeQR(Buffer.from(b64, "base64"), "mobile", "image/png", qrcodeId);
}

/** 获取指定类型的登录二维码 */
export async function getQrcode(client: QQClient, loginType: QRLoginType): Promise<QR> {
  if (loginType === "wx") return getWxQr(client);
  if (loginType === "mobile") return getMobileQr(client);
  return getQQQr(client);
}

/** QQ 二维码鉴权：check_sig 取 p_skey → OAuth authorize 取 code → QQConnectLogin 换凭证 */
async function authorizeQQQr(client: QQClient, uin: string, sigx: string): Promise<Credential> {
  const checkSig = await client.raw({
    method: "GET",
    url: "https://ssl.ptlogin2.graph.qq.com/check_sig",
    params: {
      uin,
      pttype: "1",
      service: "ptqrlogin",
      nodirect: "0",
      ptsigx: sigx,
      s_url: "https://graph.qq.com/oauth2.0/login_jump",
      ptlang: "2052",
      ptredirect: "100",
      aid: "716027609",
      daid: "383",
      j_later: "0",
      low_login_hour: "0",
      regmaster: "0",
      pt_login_type: "3",
      pt_aid: "0",
      pt_aaid: "16",
      pt_light: "0",
      pt_3rd_aid: "100497308",
    },
    headers: { Referer: "https://xui.ptlogin2.qq.com/" },
    cookies: {},
    redirect: "manual",
  });
  const pSkey = checkSig.cookies.p_skey;
  if (!pSkey) throw new ApiDataError("获取 p_skey 失败");

  const authorize = await client.raw({
    method: "POST",
    url: "https://graph.qq.com/oauth2.0/authorize",
    data: {
      response_type: "code",
      client_id: "100497308",
      redirect_uri: "https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/",
      scope: "get_user_info,get_app_friends",
      state: "state",
      switch: "",
      from_ptlogin: "1",
      src: "1",
      update_auth: "1",
      openapi: "1010_1030",
      g_tk: String(hash33(pSkey, 5381)),
      auth_time: String(Math.floor(Date.now() / 1000) * 1000),
      ui: randomUUID(),
    },
    cookies: checkSig.cookies,
    redirect: "manual",
  });
  const location = authorize.headers.get("location") ?? "";
  const codeMatch = location.match(/(?<=code=)(.+?)(?=&)/);
  if (!codeMatch) throw new ApiDataError("获取 code 失败");

  const data = await client.invoke(
    "QQConnectLogin.LoginServer",
    "QQLogin",
    { code: codeMatch[0] },
    { comm: { tmeLoginType: 2 }, allowErrorCodes: ERROR_CODES },
  );
  return credentialFromJSON(validateLoginResult(data as Record<string, any>));
}

/** 微信二维码鉴权：code → LoginServer.Login（tmeLoginType=1） */
async function authorizeWxQr(client: QQClient, code: string): Promise<Credential> {
  const data = await client.invoke(
    "music.login.LoginServer",
    "Login",
    { code, strAppid: "wx48db31d50e334801" },
    { comm: { tmeLoginType: 1 }, allowErrorCodes: ERROR_CODES },
  );
  return credentialFromJSON(validateLoginResult(data as Record<string, any>));
}

/** 检查 QQ 二维码状态（ptqrlogin 轮询，DONE 时完成 OAuth 换凭证） */
async function checkQQQr(client: QQClient, qrcode: QR): Promise<QRLoginResult> {
  const qrsig = qrcode.identifier;
  let res;
  try {
    res = await client.raw({
      method: "GET",
      url: "https://ssl.ptlogin2.qq.com/ptqrlogin",
      params: {
        u1: "https://graph.qq.com/oauth2.0/login_jump",
        ptqrtoken: String(hash33(qrsig)),
        ptredirect: "0",
        h: "1",
        t: "1",
        g: "1",
        from_ui: "1",
        ptlang: "2052",
        action: `0-0-${Date.now()}`,
        js_ver: "20102616",
        js_type: "1",
        pt_uistyle: "40",
        aid: "716027609",
        daid: "383",
        pt_3rd_aid: "100497308",
        has_onekey: "1",
      },
      headers: { Referer: "https://xui.ptlogin2.qq.com/" },
      cookies: { qrsig },
    });
  } catch (err) {
    if (err instanceof NetworkError) throw new ApiDataError("无效 qrsig");
    throw err;
  }
  const statusMatch = res.text.match(/ptuiCB\((.*?)\)/);
  if (!statusMatch) throw new ApiDataError("获取二维码状态失败: 无法解析响应");
  const args = [...statusMatch[1].matchAll(/'((?:\\.|[^'])*)'/g)].map((m) => m[1]);
  if (!args.length) throw new ApiDataError("获取二维码状态失败: 无法解析状态参数");
  if (!/^\d+$/.test(args[0])) throw new ApiDataError("获取二维码状态失败: 无效的状态码");
  const event = QQ_EVENT_BY_CODE[Number(args[0])];
  if (!event) throw new ApiDataError(`无法识别的二维码登录状态码: ${args[0]}`);
  if (event !== "DONE") return { event, done: false };
  if (args.length < 3) throw new ApiDataError("获取登录凭据失败: 缺少必要参数");
  const sigxMatch = args[2].match(/(?:\?|&)ptsigx=(.+?)&s_url/);
  const uinMatch = args[2].match(/(?:\?|&)uin=(.+?)&service/);
  if (!sigxMatch || !uinMatch) throw new ApiDataError("获取登录凭据失败: 无法解析必要参数");
  return {
    event,
    done: true,
    credential: await authorizeQQQr(client, uinMatch[1], sigxMatch[1]),
  };
}

/** 检查微信二维码状态（长轮询 35s；仅超时视为等待扫描，网络错误上抛 NetworkError） */
async function checkWxQr(client: QQClient, qrcode: QR): Promise<QRLoginResult> {
  const uuid = qrcode.identifier;
  let res;
  try {
    res = await client.raw({
      method: "GET",
      url: "https://lp.open.weixin.qq.com/connect/l/qrconnect",
      params: { uuid, _: String(Math.floor(Date.now() / 1000) * 1000) },
      headers: { Referer: "https://open.weixin.qq.com/" },
      timeoutMs: 35000,
    });
  } catch (err) {
    // raw() 已将超时（对齐 ReadTimeout）转为 status=0 空结果；此处捕获的均为网络错误 → 上抛
    if (err instanceof NetworkError) throw err;
    throw new NetworkError(String((err as Error)?.message ?? err));
  }
  if (res.status === 0) return { event: "SCAN", done: false };
  const match = res.text.match(/window\.wx_errcode=(\d+);window\.wx_code='([^']*)'/);
  if (!match) throw new ApiDataError("获取二维码状态失败: 无法解析响应");
  const event = QQ_EVENT_BY_CODE[Number(match[1])];
  if (!event) throw new ApiDataError(`获取二维码状态失败: 无效的错误码 ${match[1]}`);
  if (event !== "DONE") return { event, done: false };
  if (!match[2]) throw new ApiDataError("获取 code 失败: 无效的 code");
  return { event, done: true, credential: await authorizeWxQr(client, match[2]) };
}

/** 检查二维码登录状态（qq/wx 双通道） */
export async function checkQrcode(client: QQClient, qrcode: QR): Promise<QRLoginResult> {
  if (qrcode.qrType === "wx") return checkWxQr(client, qrcode);
  return checkQQQr(client, qrcode);
}

/**
 * 手机客户端扫码登录（MQTT 单连接生命周期）。
 * 订阅 management.qrcode_login/{id}，消费 scanned/canceled/timeout/loginFailed/cookies 事件。
 * MQTT 建连/订阅/监听过程的网络错误包装为 NetworkError 上抛（对齐 ConnectionError → NetworkError）。
 */
export async function* checkingMobileQrcode(
  client: QQClient,
  qrcode: QR,
  deadline?: number,
): AsyncGenerator<QRLoginResult> {
  const clientId = `${Date.now()}${1000 + Math.floor(Math.random() * 9000)}`;
  const mqtt = new MqttClient({
    clientId,
    host: "mu.y.qq.com",
    port: 443,
    path: "/ws/handshake",
    keepAlive: 45,
    connectProperties: {
      authMethod: "pass",
      userProperties: [
        ["tmeAppID", "qqmusic"],
        ["business", "management"],
        ["hashTag", qrcode.identifier],
        ["clientTag", "management.user"],
        ["userID", qrcode.identifier],
      ],
    },
    headers: {
      Origin: "https://y.qq.com",
      Referer: "https://y.qq.com/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    },
  });

  const timeoutLeftMs = (): number | undefined =>
    deadline === undefined ? undefined : Math.max(0, deadline - Date.now());

  const withDeadline = async <R>(op: () => Promise<R>): Promise<R> => {
    const left = timeoutLeftMs();
    if (left === undefined) return op();
    if (left <= 0) throw new TimeoutError();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        op(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new TimeoutError()), left);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  try {
    try {
      await withDeadline(() => mqtt.connect());
      await withDeadline(() =>
        mqtt.subscribe(`management.qrcode_login/${qrcode.identifier}`, {
          userProperties: [
            ["authorization", "tmelogin"],
            ["pubsub", "unicast"],
          ],
        }),
      );
    } catch (err) {
      if (err instanceof TimeoutError) {
        yield { event: "TIMEOUT", done: false };
        return;
      }
      // 连接/订阅阶段网络错误（含 MQTT CONNACK 失败包装的 NetworkError）→ NetworkError 上抛
      throw err instanceof NetworkError ? err : new NetworkError(String((err as Error)?.message ?? err));
    }

    yield { event: "SCAN", done: false };

    for (;;) {
      let msg;
      try {
        msg = await withDeadline(() => mqtt.waitForMessage());
      } catch (err) {
        if (err instanceof TimeoutError) {
          yield { event: "TIMEOUT", done: false };
          return;
        }
        // 意外断线等网络错误 → NetworkError 上抛（对齐 ConnectionError → NetworkError）
        throw err instanceof NetworkError ? err : new NetworkError(String((err as Error)?.message ?? err));
      }

      const eventType = msg.properties.type;
      const payload = msg.json();
      if (eventType === "scanned") {
        yield { event: "CONF", done: false };
      } else if (eventType === "canceled") {
        yield { event: "REFUSE", done: false };
        return;
      } else if (eventType === "timeout") {
        yield { event: "TIMEOUT", done: false };
        return;
      } else if (eventType === "loginFailed") {
        throw new LoginError("登录失败", -1, payload);
      } else if (eventType === "cookies") {
        const cookies = (payload as Record<string, any>)?.cookies ?? {};
        const uin = cookies?.qqmusic_uin?.value;
        const key = cookies?.qqmusic_key?.value;
        if (!uin || !key) throw new ApiDataError("获取登录凭据失败: 缺少必要参数");
        const data = await client.invoke(
          "music.login.LoginServer",
          "Login",
          { musicid: Number(uin), qrCodeID: qrcode.identifier, token: String(key) },
          { comm: { tmeLoginType: 6 }, allowErrorCodes: ERROR_CODES },
        );
        yield {
          event: "DONE",
          done: true,
          credential: credentialFromJSON(validateLoginResult(data as Record<string, any>)),
        };
        return;
      }
    }
  } finally {
    mqtt.disconnect();
  }
}

/** deadline 超时信号（对齐 anyio TimeoutError 的流内超时语义） */
class TimeoutError extends Error {
  constructor() {
    super("deadline exceeded");
    this.name = "TimeoutError";
  }
}

/* ---------------- 手机验证码登录 ---------------- */

export type PhoneLoginEvent = "SEND" | "CAPTCHA" | "FREQUENCY";

export interface PhoneAuthCodeResult {
  event: PhoneLoginEvent;
  info?: string | null;
}

const PHONE_EVENT_BY_CODE: Record<number, PhoneLoginEvent> = {
  20276: "CAPTCHA",
  100001: "FREQUENCY",
  0: "SEND",
};

export const PHONE_EVENT_CODES: Record<PhoneLoginEvent, number> = {
  SEND: 0,
  CAPTCHA: 1,
  FREQUENCY: 2,
};

/** 发送手机验证码（Android 平台；明文手机号或加密手机号） */
export async function sendAuthcode(
  client: QQClient,
  phone: number | string,
  countryCode = 86,
  options?: CgiInvokeOptions,
): Promise<PhoneAuthCodeResult> {
  const param: Record<string, string> = { tmeAppid: "qqmusic", areaCode: String(countryCode) };
  if (typeof phone === "string") param.encryptedPhoneNo = phone;
  else param.phoneNo = String(phone);
  const resp = await client.invoke("music.login.LoginServer", "SendPhoneAuthCode", param, {
    comm: { tmeLoginMethod: 3 },
    platform: "android",
    allowErrorCodes: "all",
    ...options,
  });
  const code = (resp as Record<string, any>)?.code ?? 0;
  const data = (resp as Record<string, any>)?.data ?? {};
  const event = PHONE_EVENT_BY_CODE[code];
  if (!event) throw new LoginError("发送验证码失败", code, data);
  if (event === "CAPTCHA") return { event, info: (data as Record<string, any>)?.securityURL };
  return { event };
}

/** 使用手机验证码鉴权（Android 平台） */
export async function phoneAuthorize(
  client: QQClient,
  phone: number | string,
  authCode: string,
  options?: CgiInvokeOptions,
): Promise<Credential> {
  const param: Record<string, string | number> = { code: authCode, loginMode: 1 };
  if (typeof phone === "string") param.encryptedPhoneNo = phone;
  else param.phoneNo = String(phone);
  const data = await client.invoke("music.login.LoginServer", "Login", param, {
    comm: { tmeLoginMethod: 3, tmeLoginType: 0 },
    platform: "android",
    allowErrorCodes: ERROR_CODES,
    ...options,
  });
  return credentialFromJSON(validateLoginResult(data as Record<string, any>));
}
