/**
 * CryptoJS 兼容层 — 仅覆盖 api-enhanced 模块用到的方法面
 * MD5 / SHA 系列 / enc.Utf8 / enc.Base64 / enc.Hex / lib.WordArray.random，基于 node:crypto
 */
import crypto from "node:crypto";

export class WordArray {
  constructor(public buf: Buffer) {}
  toString(encoder?: { stringify: (w: WordArray) => string }): string {
    return encoder ? encoder.stringify(this) : this.buf.toString("hex");
  }
}

export const enc = {
  Utf8: {
    parse: (s: string) => new WordArray(Buffer.from(s, "utf8")),
    stringify: (w: WordArray) => w.buf.toString("utf8"),
  },
  Base64: {
    parse: (s: string) => new WordArray(Buffer.from(s, "base64")),
    stringify: (w: WordArray) => w.buf.toString("base64"),
  },
  Hex: {
    parse: (s: string) => new WordArray(Buffer.from(s, "hex")),
    stringify: (w: WordArray) => w.buf.toString("hex"),
  },
};

function hasher(algo: string) {
  return (input: string | WordArray) => {
    const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input.buf;
    return new WordArray(crypto.createHash(algo).update(buf).digest());
  };
}

export const lib = {
  WordArray: {
    random: (bytes: number) => new WordArray(crypto.randomBytes(bytes)),
  },
};

const CryptoJS = {
  MD5: hasher("md5"),
  SHA1: hasher("sha1"),
  SHA256: hasher("sha256"),
  SHA512: hasher("sha512"),
  enc,
  lib,
};

export default CryptoJS;
