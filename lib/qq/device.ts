/**
 * 虚拟 Android 设备指纹 — 移植自 .ref/QQMusicApi qqmusic_api/utils/device.py。
 * 持久化到 data/qq_device.json（首次随机生成后保持稳定，含 Android session 与 QIMEI 缓存）。
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { Credential } from "./types";

export interface OSVersion {
  incremental: string;
  release: string;
  codename: string;
  sdk: number;
}

export interface QQDevice {
  display: string;
  product: string;
  device: string;
  board: string;
  model: string;
  fingerprint: string;
  boot_id: string;
  proc_version: string;
  imei: string;
  brand: string;
  bootloader: string;
  base_band: string;
  version: OSVersion;
  sim_info: string;
  os_type: string;
  mac_address: string;
  wifi_bssid: string;
  wifi_ssid: string;
  imsi_md5: number[];
  android_id: string;
  apn: string;
  vendor_name: string;
  vendor_os_name: string;
  qimei: string | null;
  qimei36: string | null;
  qimei_save_time: number | null;
  session_uid: string | null;
  session_sid: string | null;
  session_vkey: number | string | null;
  session_save_time: number | null;
  open_udid: string;
}

const DEVICE_FILE = path.join(process.cwd(), "data", "qq_device.json");

/** 设备出口 IP（对齐 Python Device.ip_address ClassVar：类级常量，不参与实例序列化） */
export const DEVICE_IP_ADDRESS: readonly number[] = [10, 0, 1, 3];

const randInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));
const randHex = (n: number) =>
  Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
const randAlnum = (n: number) => {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
};

/** 生成满足 Luhn 校验的随机 IMEI */
export function randomImei(): string {
  const digits = Array.from({ length: 14 }, () => randInt(0, 9));
  let sum = 0;
  digits.forEach((d, idx) => {
    let c = d;
    if (idx % 2 === 1) {
      c *= 2;
      if (c > 9) c -= 9;
    }
    sum += c;
  });
  digits.push((10 - (sum % 10)) % 10);
  return digits.join("");
}

export function createDevice(): QQDevice {
  return {
    display: `QMAPI.${randInt(100000, 999999)}.001`,
    product: "iarim",
    device: "sagit",
    board: "eomam",
    model: "MI 6",
    fingerprint: `xiaomi/iarim/sagit:10/eomam.200122.001/${randInt(1000000, 9999999)}:user/release-keys`,
    boot_id: randomUUID(),
    proc_version: `Linux 5.4.0-54-generic-${randAlnum(8)} (android-build@google.com)`,
    imei: randomImei(),
    brand: "Xiaomi",
    bootloader: "U-boot",
    base_band: "",
    version: { incremental: "5891938", release: "10", codename: "REL", sdk: 29 },
    sim_info: "T-Mobile",
    os_type: "android",
    mac_address: "00:50:56:C0:00:08",
    wifi_bssid: "00:50:56:C0:00:08",
    wifi_ssid: "<unknown ssid>",
    imsi_md5: Array.from(createHash("md5").update(Buffer.from(randHex(16), "hex")).digest()),
    android_id: randHex(16),
    apn: "wifi",
    vendor_name: "MIUI",
    vendor_os_name: "qmapi",
    qimei: null,
    qimei36: null,
    qimei_save_time: null,
    session_uid: null,
    session_sid: null,
    session_vkey: null,
    session_save_time: null,
    open_udid: randomUUID().replace(/-/g, ""),
  };
}

function saveDeviceFile(device: QQDevice): void {
  try {
    fs.mkdirSync(path.dirname(DEVICE_FILE), { recursive: true });
    // 原子写（审核整改 P3-03）：临时文件 + rename，异常中断不留半成品
    const tmp = `${DEVICE_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(device));
    fs.renameSync(tmp, DEVICE_FILE);
  } catch {
    /* 持久化失败仅影响指纹稳定性，不阻断请求 */
  }
}

let cachedDevice: QQDevice | null = null;

/** 获取（并按需创建/加载）设备指纹，进程级缓存 + 文件持久化 */
export function getDevice(): QQDevice {
  if (cachedDevice) return cachedDevice;
  try {
    if (fs.existsSync(DEVICE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DEVICE_FILE, "utf-8")) as QQDevice;
      if (raw && raw.open_udid) {
        cachedDevice = { ...createDevice(), ...raw, version: { ...createDevice().version, ...raw.version } };
        return cachedDevice;
      }
    }
  } catch {
    /* 损坏文件按新建处理 */
  }
  cachedDevice = createDevice();
  saveDeviceFile(cachedDevice);
  return cachedDevice;
}

/** 立即保存当前设备指纹 */
export function saveDevice(): void {
  if (cachedDevice) saveDeviceFile(cachedDevice);
}

/** 应用新申请的 QIMEI 并立即保存 */
export function applyQimei(q16: string, q36: string): void {
  const device = getDevice();
  device.qimei = q16;
  device.qimei36 = q36;
  device.qimei_save_time = Math.floor(Date.now() / 1000);
  saveDeviceFile(device);
}

/** Android session 是否仍有效（24h 内） */
export function isSessionValid(device: QQDevice): boolean {
  return (
    device.session_save_time !== null &&
    Math.floor(Date.now() / 1000) - device.session_save_time < 86400 &&
    !!device.session_uid &&
    !!device.session_sid
  );
}

export type { Credential };
