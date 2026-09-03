/**
 * 通用哈希工具。
 * 网易云专属加密（weapi / eapi / linuxapi / xeapi）已整体迁移至 lib/netease/crypto.ts
 * （api-enhanced 增强版），本文件仅保留跨源通用能力。
 */
import crypto from "node:crypto";

export function md5hex(input: string): string {
  return crypto.createHash("md5").update(input, "utf8").digest("hex");
}
