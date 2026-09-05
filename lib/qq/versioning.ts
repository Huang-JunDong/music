/**
 * 请求版本策略 — 移植自 .ref/QQMusicApi qqmusic_api/core/versioning.py。
 * 三平台 comm 公共参数构造（Android 14.9.0.8 / Desktop / Web）、UA、g_tk。
 */
import type { Credential } from "./types";
import type { QQDevice } from "./device";
import { hash33 } from "./utils";

export type Platform = "android" | "desktop" | "web";

export interface VersionProfile {
  ct: number;
  cv: number;
  v?: number;
  platform?: string;
  uaVersion?: number;
  qimeiAppVersion?: string;
  qimeiSdkVersion?: string;
}

export const VERSION_POLICY: Record<Platform, VersionProfile> = {
  android: { ct: 11, cv: 14090008, v: 14090008, uaVersion: 14090008, qimeiAppVersion: "14.9.0.8", qimeiSdkVersion: "1.2.13.6" },
  desktop: { ct: 19, cv: 2201 },
  web: { ct: 24, cv: 4747474, platform: "yqq.json" },
};

export function getProfile(platform: Platform): VersionProfile {
  return VERSION_POLICY[platform] ?? VERSION_POLICY.web;
}

/** g_tk（Web/Desktop CSRF token，musickey 的 hash33） */
export function getGtk(credential: Credential): number {
  return credential.musickey ? hash33(credential.musickey, 5381) : 5381;
}

export function getUserAgent(platform: Platform, device: QQDevice): string {
  const profile = getProfile(platform);
  if (platform === "android") {
    const uaVersion = profile.uaVersion ?? profile.cv;
    return `QQMusic ${uaVersion}(android ${device.version.release})`;
  }
  return (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );
}

/** 构建统一 comm 参数（None 字段剔除，对齐 Python exclude_none） */
/** comm 缓存（对齐 Python VersionPolicy._comm_cache：键 = 平台+凭证+设备指纹+qimei+guid，命中返回副本） */
const commCache = new Map<string, Record<string, string | number>>();
const COMM_CACHE_MAX = 128;

export function buildComm(
  platform: Platform,
  credential: Credential,
  device: QQDevice,
  qimei: { q16: string; q36: string } | null,
  guid: string,
): Record<string, string | number> {
  const cacheKey = JSON.stringify([
    platform,
    credential.musicid,
    credential.musickey,
    credential.loginType,
    platform === "android"
      ? [device.android_id, device.version.release, device.model, String(device.version.sdk), device.fingerprint, device.session_uid, device.session_sid]
      : [],
    qimei ? [qimei.q16, qimei.q36] : null,
    guid,
  ]);
  const cached = commCache.get(cacheKey);
  if (cached) return { ...cached };

  const comm = buildCommUncached(platform, credential, device, qimei, guid);
  if (commCache.size >= COMM_CACHE_MAX) commCache.clear();
  commCache.set(cacheKey, comm);
  return { ...comm };
}

function buildCommUncached(
  platform: Platform,
  credential: Credential,
  device: QQDevice,
  qimei: { q16: string; q36: string } | null,
  guid: string,
): Record<string, string | number> {
  const profile = getProfile(platform);
  if (platform === "android") {
    const comm: Record<string, string | number> = {
      ct: profile.ct,
      cv: profile.cv,
      v: profile.v!,
      chid: "10003505",
      tmeAppID: "qqmusic",
      QIMEI: qimei?.q16 ?? "",
      QIMEI36: qimei?.q36 ?? "",
      OpenUDID: guid,
      udid: guid,
      uid: device.session_uid ?? "",
      OpenUDID2: guid,
      sid: device.session_sid ?? "",
      aid: device.android_id,
      os_ver: device.version.release,
      phonetype: device.model,
      devicelevel: String(device.version.sdk),
      newdevicelevel: String(device.version.sdk),
      rom: device.fingerprint,
    };
    if (credential.musicid) comm.qq = String(credential.musicid);
    if (credential.musickey) comm.authst = credential.musickey;
    const loginType = credential.loginType;
    if (loginType) comm.tmeLoginType = loginType;
    return comm;
  }
  if (platform === "desktop") {
    const gTk = getGtk(credential);
    const comm: Record<string, string | number> = {
      ct: profile.ct,
      cv: profile.cv,
      chid: "0",
      g_tk: gTk,
      guid: guid.toUpperCase(),
    };
    if (profile.platform) comm.platform = profile.platform;
    if (credential.musicid) comm.uin = credential.musicid;
    return comm;
  }
  const gTk = getGtk(credential);
  const comm: Record<string, string | number> = {
    ct: profile.ct,
    cv: profile.cv,
    platform: profile.platform!,
    chid: "0",
    uin: credential.musicid || 0,
    g_tk: gTk,
    g_tk_new_20200303: gTk,
    format: "json",
    inCharset: "utf-8",
    outCharset: "utf-8",
    notice: 0,
    need_new_code: 1,
  };
  return comm;
}
