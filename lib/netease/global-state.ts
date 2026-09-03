/** 进程级全局状态 — 对齐 api-enhance 的 global.deviceId / global.cnIp */
import { generateDeviceId, generateRandomChineseIP } from "./utils";

interface NcmGlobalState {
  deviceId: string;
  cnIp: string;
}

const g = globalThis as typeof globalThis & { __ncmState?: NcmGlobalState };

export const ncmGlobals: NcmGlobalState = (g.__ncmState ??= {
  deviceId: generateDeviceId(),
  cnIp: generateRandomChineseIP(),
});
