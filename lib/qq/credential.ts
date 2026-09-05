/**
 * QQ 音乐登录凭证 — 对齐 .ref/QQMusicApi qqmusic_api/models/request.py Credential。
 * 持久化复用本项目 lib/cookies.ts（source="qq"），cookie 字符串双向兼容：
 *  - 旧版链路字段：uin / qqmusic_uin / qm_keyst / qqmusic_key / euin
 *  - 新版扩展字段：loginType / openid / refresh_token / access_token / expired_at / refresh_key ...
 */
import { getCookie, setCookie } from "../cookies";
import type { Credential } from "./types";

export type { Credential };

export function emptyCredential(): Credential {
  return {
    openid: "",
    refresh_token: "",
    access_token: "",
    expired_at: 0,
    musicid: 0,
    musickey: "",
    unionid: "",
    str_musicid: "",
    refresh_key: "",
    musickeyCreateTime: 0,
    keyExpiresIn: 0,
    first_login: 0,
    bindAccountType: 0,
    needRefreshKeyIn: 0,
    encryptUin: "",
    loginType: 0,
  };
}

/** 缺省时依据 musickey 前缀推断登录类型：W_X 前缀 = 微信(1)，否则 QQ(2) */
export function inferLoginType(cred: Credential): number {
  if (cred.loginType) return cred.loginType;
  if (!cred.musickey) return 0;
  return cred.musickey.startsWith("W_X") ? 1 : 2;
}

/** 凭据是否过期（musickeyCreateTime + keyExpiresIn；时间字段缺失时视为已过期，对齐 Python is_expired 语义） */
export function isCredentialExpired(cred: Credential): boolean {
  const now = Math.floor(Date.now() / 1000);
  return now >= (cred.musickeyCreateTime ?? 0) + (cred.keyExpiresIn ?? 0);
}

/** 从任意 JSON（LoginServer 响应 data 等）构造 Credential，自动补推断 loginType 与 str_musicid */
export function credentialFromJSON(raw: Record<string, unknown>): Credential {
  const cred = { ...emptyCredential() };
  const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const str = (v: unknown, d = "") => (v === null || v === undefined ? d : String(v));
  cred.openid = str(raw.openid);
  cred.refresh_token = str(raw.refresh_token);
  cred.access_token = str(raw.access_token);
  cred.expired_at = num(raw.expired_at);
  cred.musicid = num(raw.musicid, num(raw.str_musicid));
  cred.musickey = str(raw.musickey);
  cred.unionid = str(raw.unionid);
  cred.str_musicid = str(raw.str_musicid, cred.musicid ? String(cred.musicid) : "");
  cred.refresh_key = str(raw.refresh_key);
  cred.musickeyCreateTime = num(raw.musickeyCreateTime);
  cred.keyExpiresIn = num(raw.keyExpiresIn);
  cred.first_login = num(raw.first_login);
  cred.bindAccountType = num(raw.bindAccountType);
  cred.needRefreshKeyIn = num(raw.needRefreshKeyIn);
  cred.encryptUin = str(raw.encryptUin);
  cred.loginType = num(raw.loginType);
  return { ...cred, loginType: inferLoginType(cred) };
}

/** 解析 cookie 字符串为 Credential（兼容旧版 uin/qm_keyst 键名） */
export function credentialFromCookie(cookieStr: string): Credential {
  const map: Record<string, string> = {};
  for (const part of (cookieStr ?? "").split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) map[k] = decodeURIComponent(v);
  }
  const musicidStr = map.uin || map.qqmusic_uin || "";
  const cred = credentialFromJSON({
    musicid: musicidStr && /^\d+$/.test(musicidStr) ? Number(musicidStr) : 0,
    str_musicid: musicidStr,
    musickey: map.qm_keyst || map.qqmusic_key || "",
    encryptUin: map.euin || map.encryptUin || "",
    loginType: map.loginType ? Number(map.loginType) : 0,
    openid: map.openid || "",
    refresh_token: map.refresh_token || "",
    access_token: map.access_token || "",
    expired_at: map.expired_at ? Number(map.expired_at) : 0,
    refresh_key: map.refresh_key || "",
    unionid: map.unionid || "",
    musickeyCreateTime: map.musickeyCreateTime ? Number(map.musickeyCreateTime) : 0,
    keyExpiresIn: map.keyExpiresIn ? Number(map.keyExpiresIn) : 0,
    needRefreshKeyIn: map.needRefreshKeyIn ? Number(map.needRefreshKeyIn) : 0,
    bindAccountType: map.bindAccountType ? Number(map.bindAccountType) : 0,
    first_login: map.first_login ? Number(map.first_login) : 0,
  });
  return cred;
}

/** Credential 序列化为 cookie 字符串（新旧字段全量写入，双向无损） */
export function credentialToCookie(cred: Credential): string {
  if (!cred || (!cred.musicid && !cred.musickey)) return "";
  const musicid = cred.str_musicid || String(cred.musicid || "");
  const pairs: [string, string][] = [
    ["uin", musicid],
    ["qqmusic_uin", musicid],
    ["qm_keyst", cred.musickey],
    ["qqmusic_key", cred.musickey],
    ["euin", cred.encryptUin],
    ["encryptUin", cred.encryptUin],
    ["loginType", String(inferLoginType(cred))],
    ["openid", cred.openid],
    ["refresh_token", cred.refresh_token],
    ["access_token", cred.access_token],
    ["expired_at", String(cred.expired_at || 0)],
    ["refresh_key", cred.refresh_key],
    ["unionid", cred.unionid],
    ["str_musicid", cred.str_musicid],
    ["musickeyCreateTime", String(cred.musickeyCreateTime || 0)],
    ["keyExpiresIn", String(cred.keyExpiresIn || 0)],
  ];
  return pairs
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

/** 从 SQLite（source="qq"）加载凭证；无有效凭证返回 null */
export function loadCredential(): Credential | null {
  const raw = getCookie("qq");
  if (!raw) return null;
  const cred = credentialFromCookie(raw);
  return cred.musicid && cred.musickey ? cred : null;
}

/** 保存凭证到 SQLite（source="qq"，与旧链路/手动 Cookie 配置同库） */
export function saveCredential(cred: Credential): void {
  const cookie = credentialToCookie(cred);
  if (cookie) setCookie("qq", cookie);
}

/** 清除已保存凭证 */
export function clearCredential(): void {
  setCookie("qq", "");
}

/** 脱敏凭证（Web 响应用）：token 类字段保留首尾 4 位（审核整改 P3-02，对齐 2.2 脱敏读取） */
export function serializeCredentialMasked(cred: Credential): Record<string, unknown> {
  const out = serializeCredential(cred);
  for (const key of ["musickey", "access_token", "refresh_token", "refresh_key"]) {
    const v = out[key];
    if (typeof v === "string" && v.length > 8) out[key] = `${v.slice(0, 4)}***${v.slice(-4)}`;
  }
  return out;
}

/** Credential → snake_case JSON（对齐参考仓库 Credential 模型的序列化字段名，用于 Web 响应输出） */
export function serializeCredential(cred: Credential): Record<string, unknown> {
  return {
    openid: cred.openid,
    refresh_token: cred.refresh_token,
    access_token: cred.access_token,
    expired_at: cred.expired_at,
    musicid: cred.musicid,
    musickey: cred.musickey,
    unionid: cred.unionid,
    str_musicid: cred.str_musicid,
    refresh_key: cred.refresh_key,
    musickey_create_time: cred.musickeyCreateTime,
    key_expires_in: cred.keyExpiresIn,
    first_login: cred.first_login,
    bind_account_type: cred.bindAccountType,
    need_refresh_key_in: cred.needRefreshKeyIn,
    encrypt_uin: cred.encryptUin,
    login_type: inferLoginType(cred),
  };
}
