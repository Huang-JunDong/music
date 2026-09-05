/**
 * COS 文件直传会话 — 完整移植 .ref/QQMusicApi qqmusic_api/modules/helper_utils.py 的 UploadFileSession。
 *  - prepare：并发计算文件 SHA1/大小，InitUpload 获取 COS 临时凭证，按 SHA1 去重复用未过期凭证（10 分钟余量）
 *  - upload：并发直传 COS（信号量限流默认 3）→ >5MB 走分块上传 → FinishUpload 通知服务器验证
 *  - 重试：408/429/5xx 指数退避 2^attempt 秒，最多 3 次
 * COS 访问直接实现 XML API v5 签名（等价 qcloud_cos SDK 的 put_object/upload_file），无需外部 SDK。
 */
import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import type { CgiInvokeOptions } from "../types";
import type { QQClient } from "../client";
import { ApiDataError, NetworkError } from "../errors";
import { finishUpload, initUpload, type BusinessType, type InitUploadFile } from "./helper";

/** 分块上传阈值（5MB） */
const MULTIPART_THRESHOLD = 5 * 1024 * 1024;
/** COS 上传重试次数 */
const UPLOAD_RETRIES = 3;
/** 可重试的 HttpStatus */
const RETRY_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
/** 单块大小（>5MB 文件分块上传） */
const PART_SIZE = 5 * 1024 * 1024;

export interface UploadAuthInfo {
  SecretID: string;
  SecretKey: string;
  Token: string;
  StartTime: number;
  ExpiredTime: number;
}

export interface UploadFileInfo {
  FileSha1: string;
  ObjectKey: string;
  Buckets: Array<{
    Bucket: { Name: string; Region: string };
    UploadStatus: number;
  }>;
}

export interface InitUploadResponse {
  AuthInfo: UploadAuthInfo;
  Files: UploadFileInfo[];
}

export interface UploadObjectInfo {
  Storage: { Bucket: { Name: string; Region: string }; ObjectKey: string };
  Url: Record<string, string>;
  [key: string]: unknown;
}

const sleep = (sec: number) => new Promise((resolve) => setTimeout(resolve, sec * 1000));

/** 流式计算文件 SHA1（8KB 分块，对齐 _get_file_info） */
async function fileSha1(filePath: string): Promise<string> {
  const hash = createHash("sha1");
  const stream = fs.createReadStream(filePath, { highWaterMark: 8192 });
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function getFileInfo(filePath: string): Promise<InitUploadFile> {
  const stat = await fsp.stat(filePath).catch(() => null);
  if (!stat?.isFile()) throw new Error(`文件不存在: ${filePath}`);
  return {
    FileSha1: await fileSha1(filePath),
    FileName: path.basename(filePath),
    FileSize: stat.size,
  };
}

/* ---------------- COS XML API v5 签名 ---------------- */

const sha1Hex = (content: string) => createHash("sha1").update(content, "utf-8").digest("hex");
const hmacSha1Hex = (key: string, content: string) => createHmac("sha1", key).update(content, "utf-8").digest("hex");

function buildCosAuthorization(
  method: string,
  urlPath: string,
  queryParams: Record<string, string>,
  headers: Record<string, string>,
  secretId: string,
  secretKey: string,
  token: string,
): string {
  const now = Math.floor(Date.now() / 1000);
  const keyTime = `${now - 60};${now + 600}`;

  const sortedEntries = (obj: Record<string, string>) =>
    Object.entries(obj)
      .map(([k, v]) => [k.toLowerCase(), encodeURIComponent(String(v))] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const paramEntries = sortedEntries(queryParams);
  const headerEntries = sortedEntries(headers);
  const httpString = [
    method.toUpperCase(),
    urlPath,
    paramEntries.map(([k, v]) => `${k}=${v}`).join("&"),
    headerEntries.map(([k, v]) => `${k}=${v}`).join("&"),
    "",
  ].join("\n");

  const signKey = hmacSha1Hex(keyTime, secretKey);
  const stringToSign = ["sha1", keyTime, sha1Hex(httpString), ""].join("\n");
  const signature = hmacSha1Hex(signKey, stringToSign);

  return [
    "q-sign-algorithm=sha1",
    `q-ak=${secretId}`,
    `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`,
    `q-header-list=${headerEntries.map(([k]) => k).join(";")}`,
    `q-url-param-list=${paramEntries.map(([k]) => k).join(";")}`,
    `q-signature=${signature}`,
  ].join("&");
}

/** 带重试的 COS 请求执行（408/429/5xx 指数退避 2^attempt，3 次） */
async function cosRequestWithRetry(
  init: RequestInit & { baseUrl: string; urlPath: string; queryParams: Record<string, string>; host: string },
  auth: { secretId: string; secretKey: string; token: string },
  body?: BodyInit,
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = { Host: init.host };
  if (auth.token) headers["x-cos-security-token"] = auth.token;

  for (let attempt = 0; attempt <= UPLOAD_RETRIES; attempt++) {
    // 签名使用与实际发送一致的请求头/参数
    const authorization = buildCosAuthorization(method, init.urlPath, init.queryParams, headers, auth.secretId, auth.secretKey, auth.token);
    const sendHeaders = { ...headers, Authorization: authorization };

    // 与签名一致的 query 编码（encodeURIComponent，而非 URLSearchParams 的 form 编码）
    const query = Object.entries(init.queryParams)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    const url = `${init.baseUrl}${init.urlPath}${query ? `?${query}` : ""}`;

    try {
      const res = await fetch(url, { method, headers: sendHeaders, body });
      if (RETRY_HTTP_STATUSES.has(res.status) && attempt < UPLOAD_RETRIES) {
        await sleep(2 ** attempt);
        continue;
      }
      if (!res.ok) {
        throw new NetworkError(`COS 上传失败: HTTP ${res.status} ${await res.text().catch(() => "")}`);
      }
      return res;
    } catch (err) {
      if (err instanceof NetworkError) throw err;
      // 连接级错误（对齐 CosClientError 分支）：指数退避后重试
      if (attempt < UPLOAD_RETRIES) {
        await sleep(2 ** attempt);
        continue;
      }
      throw new NetworkError(`Upload to COS failed after max retries: ${(err as Error)?.message ?? err}`);
    }
  }
  throw new NetworkError("Upload to COS failed after max retries");
}

/** COS 简单上传（put_object 等价）：PUT 单请求携带全部内容 */
async function putObject(
  filePath: string,
  region: string,
  bucketName: string,
  objectKey: string,
  auth: { secretId: string; secretKey: string; token: string },
): Promise<void> {
  const content = await fsp.readFile(filePath);
  const urlPath = `/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
  await cosRequestWithRetry(
    {
      method: "PUT",
      baseUrl: `https://${bucketName}.cos.${region}.myqcloud.com`,
      urlPath,
      queryParams: {},
      host: `${bucketName}.cos.${region}.myqcloud.com`,
    },
    auth,
    new Uint8Array(content),
  );
}

/** COS 分块上传（upload_file 等价）：初始化 → 逐块上传 → 完成 */
async function multipartUpload(
  filePath: string,
  region: string,
  bucketName: string,
  objectKey: string,
  auth: { secretId: string; secretKey: string; token: string },
): Promise<void> {
  const host = `${bucketName}.cos.${region}.myqcloud.com`;
  const baseUrl = `https://${host}`;
  const urlPath = `/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
  const stat = await fsp.stat(filePath);

  // 1. CreateMultipartUpload
  const initRes = await cosRequestWithRetry(
    { method: "POST", baseUrl, urlPath, queryParams: { uploads: "" }, host },
    auth,
  );
  const initText = await initRes.text();
  const uploadId = initText.match(/<UploadId>(.+?)<\/UploadId>/)?.[1];
  if (!uploadId) throw new ApiDataError("COS 分块上传初始化失败: 未返回 UploadId");

  // 2. UploadPart（顺序上传，块大小 PART_SIZE）
  const totalParts = Math.ceil(stat.size / PART_SIZE);
  const etags: string[] = [];
  const handle = await fsp.open(filePath, "r");
  try {
    for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
      const start = (partNumber - 1) * PART_SIZE;
      const length = Math.min(PART_SIZE, stat.size - start);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, start);
      const partRes = await cosRequestWithRetry(
        { method: "PUT", baseUrl, urlPath, queryParams: { partNumber: String(partNumber), uploadId }, host },
        auth,
        new Uint8Array(buffer),
      );
      const etag = partRes.headers.get("etag") ?? "";
      etags.push(etag);
    }
  } finally {
    await handle.close();
  }

  // 3. CompleteMultipartUpload
  const completeBody = `<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUpload>${etags
    .map((etag, i) => `<Part><PartNumber>${i + 1}</PartNumber><ETag>${etag}</ETag></Part>`)
    .join("")}</CompleteMultipartUpload>`;
  await cosRequestWithRetry(
    {
      method: "POST",
      baseUrl,
      urlPath,
      queryParams: { uploadId },
      host,
    },
    auth,
    completeBody,
  );
}

/** 单文件上传调度：>5MB 分块，否则简单上传（对齐 _upload_to_cos） */
async function uploadToCos(
  filePath: string,
  region: string,
  secretId: string,
  secretKey: string,
  token: string,
  bucketName: string,
  objectKey: string,
  fileSize: number,
): Promise<void> {
  const auth = { secretId, secretKey, token };
  if (fileSize > MULTIPART_THRESHOLD) {
    await multipartUpload(filePath, region, bucketName, objectKey, auth);
  } else {
    await putObject(filePath, region, bucketName, objectKey, auth);
  }
}

/** 简易并发信号量 */
class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  constructor(private readonly limit: number) {}

  async run<T>(op: () => Promise<T>): Promise<T> {
    while (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    try {
      return await op();
    } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }
}

export interface UploadFileSessionOptions {
  client: QQClient;
  /** 上传业务 ID */
  busId: BusinessType;
  /** 可选请求凭证（缺省使用客户端全局凭证） */
  credential?: CgiInvokeOptions["credential"];
  /** 最大并发上传数（默认 3） */
  maxConcurrency?: number;
}

/**
 * 封装 COS 文件上传流程的会话对象（对齐 UploadFileSession）。
 * const session = new UploadFileSession({client, busId: "songlist"});
 * const objects = await session.upload(["./cover.jpg"]);
 */
export class UploadFileSession {
  private readonly client: QQClient;
  private readonly busId: BusinessType;
  private readonly credential: CgiInvokeOptions["credential"];
  private readonly maxConcurrency: number;
  private initResponse: InitUploadResponse | null = null;
  private lastFileShas: string[] | null = null;

  constructor(options: UploadFileSessionOptions) {
    this.client = options.client;
    this.busId = options.busId;
    this.credential = options.credential ?? null;
    this.maxConcurrency = options.maxConcurrency ?? 3;
  }

  /** 准备上传：获取或复用有效的临时凭证（按文件 SHA1 去重，10 分钟余量防临界过期） */
  async prepare(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) throw new Error("至少需要提供一个文件路径.");

    const fileInfos = await Promise.all(filePaths.map((p) => getFileInfo(p)));
    const currentShas = fileInfos.map((info) => info.FileSha1);

    if (this.lastFileShas?.join(",") !== currentShas.join(",")) {
      this.initResponse = null;
      this.lastFileShas = currentShas;
    }

    if (this.initResponse !== null) {
      const now = Math.floor(Date.now() / 1000);
      // 留 10 分钟余量防止临界过期
      if (now < this.initResponse.AuthInfo.ExpiredTime - 600) return;
    }

    const resp = (await initUpload(this.client, this.busId, fileInfos, {
      credential: this.credential,
    })) as InitUploadResponse;
    if (!resp?.AuthInfo || !Array.isArray(resp.Files)) {
      throw new ApiDataError("获取上传凭证失败: 服务器未返回凭证信息");
    }
    this.initResponse = resp;
  }

  /** 执行多文件的完整上传流程，返回全部上传成功的对象信息 */
  async upload(input: string | string[]): Promise<UploadObjectInfo[]> {
    const filePaths = Array.isArray(input) ? input : [input];
    await this.prepare(filePaths);

    const initResponse = this.initResponse;
    if (initResponse === null) throw new ApiDataError("获取上传凭证失败: 服务器未返回凭证信息");

    const { SecretID: secretId, SecretKey: secretKey, Token: token } = initResponse.AuthInfo;
    const filesInfo = initResponse.Files;
    if (!filesInfo || filesInfo.length !== filePaths.length) {
      throw new Error("InitUpload 返回的文件目标数量不匹配.");
    }

    const semaphore = new Semaphore(this.maxConcurrency);
    const stats = await Promise.all(filePaths.map((p) => fsp.stat(p)));
    const finishResults: Array<{ Storage: { Bucket: { Name: string; Region: string }; ObjectKey: string }; UploadResult: number }> = [];

    // 阶段一：全量校验与 finish 结果构造（无副作用，校验失败不会遗留孤立的上传任务）
    const uploadPlans: Array<{ filePath: string; region: string; bucketName: string; objectKey: string; fileSize: number }> = [];
    for (let i = 0; i < filesInfo.length; i++) {
      const fileInfo = filesInfo[i];
      const buckets = fileInfo.Buckets;
      if (!buckets || buckets.length === 0) {
        throw new ApiDataError(`获取上传凭证失败: 文件 ${filePaths[i]} 未返回目标存储桶信息.`);
      }
      const targetBucket = buckets[0];
      const bucketName = targetBucket.Bucket.Name;
      const region = targetBucket.Bucket.Region;
      const objectKey = fileInfo.ObjectKey;
      const fileSize = stats[i]?.size ?? 0;

      if (![secretId, secretKey, token, objectKey, bucketName, region].every(Boolean)) {
        throw new ApiDataError(`获取上传凭证失败: 文件 ${filePaths[i]} 上传凭证信息不完整.`);
      }

      // upload_status != 1：跳过已上传文件（秒传），否则并发直传 COS
      if (targetBucket.UploadStatus !== 1) {
        uploadPlans.push({ filePath: filePaths[i], region, bucketName, objectKey, fileSize });
      }

      finishResults.push({
        Storage: { Bucket: { Name: bucketName, Region: region }, ObjectKey: objectKey },
        UploadResult: 0,
      });
    }

    // 阶段二：并发执行上传（信号量限流）
    await Promise.all(
      uploadPlans.map((plan) =>
        semaphore.run(() => uploadToCos(plan.filePath, plan.region, secretId, secretKey, token, plan.bucketName, plan.objectKey, plan.fileSize)),
      ),
    );

    const finishData = (await finishUpload(this.client, this.busId, finishResults, {
      credential: this.credential,
    })) as { Objects?: UploadObjectInfo[] } | null;
    const objects = finishData?.Objects;
    if (!objects || objects.length === 0) {
      throw new ApiDataError("FinishUpload 未返回上传成功的文件对象.");
    }
    return objects;
  }
}
