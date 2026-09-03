/** 文件工具 — 对齐 api-enhanced util/fileHelper.js */
import fs from "node:fs";
import crypto from "node:crypto";
import { logger } from "./logger";

export function isTempFile(file: any): boolean {
  return !!(file && file.tempFilePath);
}

export async function getFileSize(file: any): Promise<number> {
  if (isTempFile(file)) {
    const stats = await fs.promises.stat(file.tempFilePath);
    return stats.size;
  }
  return file.data ? file.data.byteLength : file.size || 0;
}

export async function getFileMd5(file: any): Promise<string> {
  if (file.md5) return file.md5;

  if (isTempFile(file)) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("md5");
      const stream = fs.createReadStream(file.tempFilePath);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", reject);
    });
  }

  if (file.data) {
    return crypto.createHash("md5").update(file.data).digest("hex");
  }

  throw new Error("无法计算文件MD5: 缺少文件数据");
}

export function getUploadData(file: any): Buffer {
  if (isTempFile(file)) {
    return fs.readFileSync(file.tempFilePath);
  }
  return file.data;
}

export async function cleanupTempFile(filePath?: string): Promise<void> {
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch (e) {
    logger.info("临时文件清理失败:", (e as Error).message);
  }
}

export async function readFileChunk(filePath: string, offset: number, length: number): Promise<Buffer> {
  const fd = await fs.promises.open(filePath, "r");
  const buffer = Buffer.alloc(length);
  await fd.read(buffer, 0, length, offset);
  await fd.close();
  return buffer;
}

export function getFileExtension(filename: string): string {
  if (!filename) return "mp3";
  if (filename.includes(".")) {
    return filename.split(".").pop()!.toLowerCase();
  }
  return "mp3";
}

export function sanitizeFilename(filename: string): string {
  if (!filename) return "unknown";
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/\s/g, "")
    .replace(/\./g, "_");
}
