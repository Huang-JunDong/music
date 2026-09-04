import fs from "node:fs";
import path from "node:path";

/**
 * 原子落盘（审核 5.6 / A-18）：同目录临时文件 + rename。
 * 进程崩溃/断电不留半成品文件（残缺音频会被本地音乐索引收录为损坏曲目）；
 * 失败时清理临时文件后原样抛出。Windows 上 Node rename 覆盖已存在目标（MoveFileEx REPLACE_EXISTING）。
 */
export function writeFileAtomic(filePath: string, data: Buffer): void {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* 临时文件可能尚未创建 */
    }
    throw err;
  }
}
