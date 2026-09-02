/**
 * 汽水音乐音频解密 — 逐行移植自 music-lib/soda/crypto.go，全部使用 node:crypto。
 *
 * 流程：playAuth(base64) → spade 解出 hex key → 定位 mp4 moov/stbl/stsz/senc/mdat box →
 * 按 senc IV 做 AES-CTR 分段解密 mdat → 还原 stsd 中的 enca → frma 原始格式。
 */
import crypto from "node:crypto";

interface Mp4Box {
  offset: number;
  size: number;
  /** box payload（跳过 8/16 字节头） */
  data: Buffer;
}

interface SencSubsample {
  clear: number;
  encrypted: number;
}

interface SencSample {
  iv: Buffer;
  subsamples: SencSubsample[];
}

function findBox(data: Buffer, boxType: string, start: number, end: number): Mp4Box | null {
  if (end > data.length) end = data.length;
  const target = Buffer.from(boxType, "ascii");
  let pos = start;
  while (pos + 8 <= end) {
    const size = data.readUInt32BE(pos);
    if (size < 8) break;
    if (data.subarray(pos + 4, pos + 8).equals(target)) {
      return { offset: pos, size, data: data.subarray(pos + 8, pos + size) };
    }
    pos += size;
  }
  return null;
}

/** 容器 box 的子级起始偏移（对齐 boxChildStart） */
function boxChildStart(boxType: string, offset: number, headerSize: number): [number, boolean] {
  switch (boxType) {
    case "moov":
    case "trak":
    case "mdia":
    case "minf":
    case "stbl":
    case "sinf":
    case "schi":
      return [offset + headerSize, true];
    case "stsd":
      return [offset + headerSize + 8, true];
    case "enca":
    case "mp4a":
    case "alac":
    case "fLaC":
      return [offset + headerSize + 28, true];
    default:
      return [0, false];
  }
}

function findBoxDeep(data: Buffer, boxType: string, start: number, end: number): Mp4Box | null {
  if (end > data.length) end = data.length;
  const target = Buffer.from(boxType, "ascii");
  let pos = start;
  while (pos + 8 <= end) {
    let size = data.readUInt32BE(pos);
    let headerSize = 8;
    if (size === 1) {
      if (pos + 16 > end) break;
      const size64 = data.readBigUInt64BE(pos + 8);
      if (size64 > BigInt(end - pos)) break;
      size = Number(size64);
      headerSize = 16;
    }
    if (size < headerSize || pos + size > end) break;
    const currentType = data.toString("ascii", pos + 4, pos + 8);
    if (data.subarray(pos + 4, pos + 8).equals(target)) {
      return { offset: pos, size, data: data.subarray(pos + headerSize, pos + size) };
    }

    const [childStart, ok] = boxChildStart(currentType, pos, headerSize);
    if (ok && childStart < pos + size) {
      const found = findBoxDeep(data, boxType, childStart, pos + size);
      if (found) return found;
    }
    pos += size;
  }
  return null;
}

function parseStsz(data: Buffer): number[] {
  if (data.length < 12) return [];
  const sampleSizeFixed = data.readUInt32BE(4);
  const sampleCount = data.readUInt32BE(8);
  const sizes = new Array<number>(sampleCount).fill(0);
  if (sampleSizeFixed !== 0) {
    for (let i = 0; i < sampleCount; i++) sizes[i] = sampleSizeFixed;
  } else {
    for (let i = 0; i < sampleCount; i++) {
      if (12 + i * 4 + 4 <= data.length) {
        sizes[i] = data.readUInt32BE(12 + i * 4);
      }
    }
  }
  return sizes;
}

function parseSenc(data: Buffer, ivSize: number): SencSample[] {
  if (data.length < 8) return [];
  if (ivSize !== 8 && ivSize !== 16) ivSize = 8;
  const flags = data.readUInt32BE(0) & 0x00ffffff;
  const sampleCount = data.readUInt32BE(4);
  const samples: SencSample[] = [];
  let ptr = 8;
  const hasSubsamples = (flags & 0x02) !== 0;
  for (let i = 0; i < sampleCount; i++) {
    if (ptr + ivSize > data.length) break;
    const sample: SencSample = { iv: Buffer.from(data.subarray(ptr, ptr + ivSize)), subsamples: [] };
    ptr += ivSize;
    if (hasSubsamples) {
      if (ptr + 2 > data.length) break;
      const subCount = data.readUInt16BE(ptr);
      ptr += 2;
      if (ptr + subCount * 6 > data.length) break;
      for (let j = 0; j < subCount; j++) {
        sample.subsamples.push({
          clear: data.readUInt16BE(ptr),
          encrypted: data.readUInt32BE(ptr + 2),
        });
        ptr += 6;
      }
    }
    samples.push(sample);
  }
  return samples;
}

function defaultPerSampleIVSize(data: Buffer, start: number, end: number): number {
  const tenc = findBoxDeep(data, "tenc", start, end);
  if (!tenc || tenc.data.length < 8) return 8;
  const ivSize = tenc.data[7];
  if (ivSize === 8 || ivSize === 16) return ivSize;
  return 8;
}

/** enca box 里的 frma 还原原始格式（默认 mp4a） */
function encryptedSampleOriginalFormat(stsdData: Buffer): Buffer {
  const idx = stsdData.indexOf(Buffer.from("frma", "ascii"));
  if (idx < 4 || idx + 8 > stsdData.length) return Buffer.from("mp4a", "ascii");
  const size = stsdData.readUInt32BE(idx - 4);
  if (size < 12 || idx - 4 + size > stsdData.length) return Buffer.from("mp4a", "ascii");
  return stsdData.subarray(idx + 4, idx + 8);
}

/** AES-CTR 解密单个 senc sample（clear 段透传，encrypted 段连续走同一 CTR 流） */
function decryptSencSample(key: Buffer, chunk: Buffer, sample: SencSample): Buffer {
  let iv = sample.iv;
  if (iv.length < 16) {
    const padded = Buffer.alloc(16, 0);
    iv.copy(padded, 0);
    iv = padded;
  }
  const algo = `aes-${key.length * 8}-ctr`;
  const stream = crypto.createDecipheriv(algo, key, iv);
  stream.setAutoPadding(false);

  if (sample.subsamples.length === 0) {
    return Buffer.concat([stream.update(chunk), stream.final()]);
  }

  const dst = Buffer.alloc(chunk.length);
  let pos = 0;
  for (const sub of sample.subsamples) {
    let clearBytes = sub.clear;
    if (clearBytes > chunk.length - pos) clearBytes = chunk.length - pos;
    chunk.copy(dst, pos, pos, pos + clearBytes);
    pos += clearBytes;
    if (pos >= chunk.length) break;

    let encryptedBytes = sub.encrypted;
    if (encryptedBytes > chunk.length - pos) encryptedBytes = chunk.length - pos;
    if (encryptedBytes > 0) {
      const decrypted = stream.update(chunk.subarray(pos, pos + encryptedBytes));
      decrypted.copy(dst, pos);
    }
    pos += encryptedBytes;
    if (pos >= chunk.length) break;
  }
  stream.final();
  if (pos < chunk.length) {
    chunk.copy(dst, pos, pos);
  }
  return dst;
}

function bitcount(n: number): number {
  let u = n >>> 0;
  u = u - ((u >> 1) & 0x55555555);
  u = (u & 0x33333333) + ((u >> 2) & 0x33333333);
  return (((u + (u >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
}

function decodeBase36(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30; // '0'-'9'
  if (c >= 0x61 && c <= 0x7a) return c - 0x61 + 10; // 'a'-'z'
  return 0xff;
}

/** spade 内层解密：0xFA 0x55 前缀 XOR + bitcount/i - 21（mod 255） */
function decryptSpadeInner(keyBytes: Buffer): Buffer {
  const result = Buffer.alloc(keyBytes.length);
  const buff = Buffer.concat([Buffer.from([0xfa, 0x55]), keyBytes]);
  for (let i = 0; i < result.length; i++) {
    let v = keyBytes[i] ^ buff[i];
    v -= bitcount(i);
    v -= 21;
    while (v < 0) v += 255;
    result[i] = v & 0xff;
  }
  return result;
}

/** 从 playAuth(base64) 解出 hex 格式的 AES key */
function extractKey(playAuth: string): string {
  const bytesData = Buffer.from(playAuth, "base64");
  if (bytesData.length < 3) throw new Error("auth data too short");
  const paddingLen = ((bytesData[0] ^ bytesData[1] ^ bytesData[2]) - 48) & 0xff;
  if (bytesData.length < paddingLen + 2) throw new Error("invalid padding length");
  const innerInput = bytesData.subarray(1, bytesData.length - paddingLen);
  const tmpBuff = decryptSpadeInner(innerInput);
  if (tmpBuff.length === 0) throw new Error("decryption failed");
  const skipBytes = decodeBase36(tmpBuff[0]);
  const endIndex = 1 + (bytesData.length - paddingLen - 2) - skipBytes;
  if (endIndex > tmpBuff.length || endIndex < 1) throw new Error("index out of bounds");
  return tmpBuff.toString("ascii", 1, endIndex);
}

/** 核心解密函数（对齐 DecryptAudio） */
export function decryptAudio(fileData: Buffer, playAuth: string): Buffer {
  const hexKey = extractKey(playAuth);
  const keyBytes = Buffer.from(hexKey, "hex");

  const moov = findBox(fileData, "moov", 0, fileData.length);
  if (!moov) throw new Error("moov box not found");

  let stbl = findBox(fileData, "stbl", moov.offset, moov.offset + moov.size);
  if (!stbl) {
    const trak = findBox(fileData, "trak", moov.offset + 8, moov.offset + moov.size);
    if (trak) {
      const mdia = findBox(fileData, "mdia", trak.offset + 8, trak.offset + trak.size);
      if (mdia) {
        const minf = findBox(fileData, "minf", mdia.offset + 8, mdia.offset + mdia.size);
        if (minf) {
          stbl = findBox(fileData, "stbl", minf.offset + 8, minf.offset + minf.size);
        }
      }
    }
  }
  if (!stbl) throw new Error("stbl box not found");

  const stsz = findBox(fileData, "stsz", stbl.offset + 8, stbl.offset + stbl.size);
  if (!stsz) throw new Error("stsz box not found");
  const sampleSizes = parseStsz(stsz.data);

  let senc =
    findBox(fileData, "senc", moov.offset + 8, moov.offset + moov.size) ??
    findBox(fileData, "senc", stbl.offset + 8, stbl.offset + stbl.size);
  if (!senc) throw new Error("senc box not found");
  const sencSamples = parseSenc(senc.data, defaultPerSampleIVSize(fileData, stbl.offset, stbl.offset + stbl.size));

  const mdat = findBox(fileData, "mdat", 0, fileData.length);
  if (!mdat) throw new Error("mdat box not found");

  const decryptedData = Buffer.from(fileData);

  let readPtr = mdat.offset + 8;
  const decryptedChunks: Buffer[] = [];
  let decryptedLength = 0;

  for (let i = 0; i < sampleSizes.length; i++) {
    const size = sampleSizes[i];
    if (readPtr + size > decryptedData.length) break;
    const chunk = decryptedData.subarray(readPtr, readPtr + size);

    if (i < sencSamples.length) {
      const dst = decryptSencSample(keyBytes, chunk, sencSamples[i]);
      decryptedChunks.push(dst);
      decryptedLength += dst.length;
    } else {
      decryptedChunks.push(chunk);
      decryptedLength += chunk.length;
    }
    readPtr += size;
  }

  if (decryptedLength === mdat.size - 8) {
    Buffer.concat(decryptedChunks).copy(decryptedData, mdat.offset + 8);
  } else {
    throw new Error("decrypted size mismatch");
  }

  const stsd = findBox(fileData, "stsd", stbl.offset + 8, stbl.offset + stbl.size);
  if (stsd) {
    const stsdOffset = stsd.offset;
    const stsdData = decryptedData.subarray(stsdOffset, stsdOffset + stsd.size);
    const idx = stsdData.indexOf(Buffer.from("enca", "ascii"));
    if (idx !== -1) {
      encryptedSampleOriginalFormat(stsdData).copy(stsdData, idx);
      stsdData.copy(decryptedData, stsdOffset);
    }
  }

  return decryptedData;
}
