/**
 * 辅助功能模块 — 移植自 .ref/QQMusicApi qqmusic_api/modules/helper.py。
 * COS 上传临时凭证初始化与完成（签名网关）。
 */
import type { CgiInvokeOptions } from "../types";
import type { QQClient } from "../client";

export const BUSINESS_TYPES = ["songlist", "homepage", "Aiplassistant"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export interface InitUploadFile {
  FileSha1: string;
  FileName: string;
  FileSize: number;
}

export interface FinishUploadResult {
  Storage: Record<string, unknown>;
  [key: string]: unknown;
}

/** 初始化 COS 上传以获取临时凭证 */
export async function initUpload(
  client: QQClient,
  busId: string,
  files: InitUploadFile[],
  options?: CgiInvokeOptions,
) {
  return client.invoke(
    "music.filesys.FileSystem",
    "InitUpload",
    { BusID: busId, Files: files },
    { sign: true, requireLogin: true, ...options },
  );
}

/** 完成 COS 上传并通知服务器验证 */
export async function finishUpload(
  client: QQClient,
  busId: string,
  results: FinishUploadResult[],
  options?: CgiInvokeOptions,
) {
  return client.invoke(
    "music.filesys.FileSystem",
    "FinishUpload",
    { BusID: busId, Results: results },
    { sign: true, requireLogin: true, ...options },
  );
}
