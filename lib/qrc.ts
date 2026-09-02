/**
 * QQ QRC 歌词解密与解析 — 逐行移植自 music-lib/lyrics/qrc_des.go（QRC 专用 3DES）与
 * music-lib/lyrics/lyrics.go 中 QRC 相关部分（ParseQRC / ConvertVerbatimLRC / DecryptQRCHex）。
 */
import zlib from "node:zlib";

const QRC_SBOX: number[][] = [
  [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8, 4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0, 15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13],
  [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8, 15, 12, 0, 1, 10, 6, 9, 11, 5, 0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15, 13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9],
  [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1, 13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7, 1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12],
  [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9, 10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4, 3, 15, 0, 6, 10, 10, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14],
  [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6, 4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14, 11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3],
  [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8, 9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6, 4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13],
  [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6, 1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2, 6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12],
  [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2, 7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8, 2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11],
];

const QRC_ENCRYPT = 1;
const QRC_DECRYPT = 0;

const QRC_KEY = Buffer.from("!@#)(*$%123ZXC!@!@#)(NHL", "utf8");

function qrcTripleDESDecrypt(block: Uint8Array): Uint8Array {
  const keys = [
    qrcKeySchedule(Uint8Array.from(QRC_KEY.subarray(16)), QRC_DECRYPT),
    qrcKeySchedule(Uint8Array.from(QRC_KEY.subarray(8)), QRC_ENCRYPT),
    qrcKeySchedule(Uint8Array.from(QRC_KEY), QRC_DECRYPT),
  ];
  let data: Uint8Array = Uint8Array.from(block);
  for (let i = 0; i < 3; i++) {
    data = qrcDESCrypt(data, keys[i]);
  }
  return data;
}

function qrcBitNum(a: Uint8Array, b: number, c: number): number {
  return ((((a[Math.floor(b / 32) * 4 + 3 - Math.floor((b % 32) / 8)] >> (7 - (b % 8))) & 1) << c) >>> 0);
}

function qrcBitNumIntr(a: number, b: number, c: number): number {
  return (((a >>> (31 - b)) & 1) << c) >>> 0;
}

function qrcBitNumIntl(a: number, b: number, c: number): number {
  // Go: ((a << b) & 0x80000000) >> c（uint32 逻辑右移 → JS 需用 >>>）
  return (((a << b) & 0x80000000) >>> c) >>> 0;
}

function qrcSBoxBit(a: number): number {
  return (a & 32) | ((a & 31) >> 1) | ((a & 1) << 4);
}

function qrcInitialPermutation(input: Uint8Array): [number, number] {
  const s0 =
    (qrcBitNum(input, 57, 31) | qrcBitNum(input, 49, 30) | qrcBitNum(input, 41, 29) | qrcBitNum(input, 33, 28) |
      qrcBitNum(input, 25, 27) | qrcBitNum(input, 17, 26) | qrcBitNum(input, 9, 25) | qrcBitNum(input, 1, 24) |
      qrcBitNum(input, 59, 23) | qrcBitNum(input, 51, 22) | qrcBitNum(input, 43, 21) | qrcBitNum(input, 35, 20) |
      qrcBitNum(input, 27, 19) | qrcBitNum(input, 19, 18) | qrcBitNum(input, 11, 17) | qrcBitNum(input, 3, 16) |
      qrcBitNum(input, 61, 15) | qrcBitNum(input, 53, 14) | qrcBitNum(input, 45, 13) | qrcBitNum(input, 37, 12) |
      qrcBitNum(input, 29, 11) | qrcBitNum(input, 21, 10) | qrcBitNum(input, 13, 9) | qrcBitNum(input, 5, 8) |
      qrcBitNum(input, 63, 7) | qrcBitNum(input, 55, 6) | qrcBitNum(input, 47, 5) | qrcBitNum(input, 39, 4) |
      qrcBitNum(input, 31, 3) | qrcBitNum(input, 23, 2) | qrcBitNum(input, 15, 1) | qrcBitNum(input, 7, 0)) >>> 0;
  const s1 =
    (qrcBitNum(input, 56, 31) | qrcBitNum(input, 48, 30) | qrcBitNum(input, 40, 29) | qrcBitNum(input, 32, 28) |
      qrcBitNum(input, 24, 27) | qrcBitNum(input, 16, 26) | qrcBitNum(input, 8, 25) | qrcBitNum(input, 0, 24) |
      qrcBitNum(input, 58, 23) | qrcBitNum(input, 50, 22) | qrcBitNum(input, 42, 21) | qrcBitNum(input, 34, 20) |
      qrcBitNum(input, 26, 19) | qrcBitNum(input, 18, 18) | qrcBitNum(input, 10, 17) | qrcBitNum(input, 2, 16) |
      qrcBitNum(input, 60, 15) | qrcBitNum(input, 52, 14) | qrcBitNum(input, 44, 13) | qrcBitNum(input, 36, 12) |
      qrcBitNum(input, 28, 11) | qrcBitNum(input, 20, 10) | qrcBitNum(input, 12, 9) | qrcBitNum(input, 4, 8) |
      qrcBitNum(input, 62, 7) | qrcBitNum(input, 54, 6) | qrcBitNum(input, 46, 5) | qrcBitNum(input, 38, 4) |
      qrcBitNum(input, 30, 3) | qrcBitNum(input, 22, 2) | qrcBitNum(input, 14, 1) | qrcBitNum(input, 6, 0)) >>> 0;
  return [s0, s1];
}

function qrcInversePermutation(s0: number, s1: number): Uint8Array {
  const data = new Uint8Array(8);
  data[3] = (qrcBitNumIntr(s1, 7, 7) | qrcBitNumIntr(s0, 7, 6) | qrcBitNumIntr(s1, 15, 5) | qrcBitNumIntr(s0, 15, 4) | qrcBitNumIntr(s1, 23, 3) | qrcBitNumIntr(s0, 23, 2) | qrcBitNumIntr(s1, 31, 1) | qrcBitNumIntr(s0, 31, 0)) & 0xff;
  data[2] = (qrcBitNumIntr(s1, 6, 7) | qrcBitNumIntr(s0, 6, 6) | qrcBitNumIntr(s1, 14, 5) | qrcBitNumIntr(s0, 14, 4) | qrcBitNumIntr(s1, 22, 3) | qrcBitNumIntr(s0, 22, 2) | qrcBitNumIntr(s1, 30, 1) | qrcBitNumIntr(s0, 30, 0)) & 0xff;
  data[1] = (qrcBitNumIntr(s1, 5, 7) | qrcBitNumIntr(s0, 5, 6) | qrcBitNumIntr(s1, 13, 5) | qrcBitNumIntr(s0, 13, 4) | qrcBitNumIntr(s1, 21, 3) | qrcBitNumIntr(s0, 21, 2) | qrcBitNumIntr(s1, 29, 1) | qrcBitNumIntr(s0, 29, 0)) & 0xff;
  data[0] = (qrcBitNumIntr(s1, 4, 7) | qrcBitNumIntr(s0, 4, 6) | qrcBitNumIntr(s1, 12, 5) | qrcBitNumIntr(s0, 12, 4) | qrcBitNumIntr(s1, 20, 3) | qrcBitNumIntr(s0, 20, 2) | qrcBitNumIntr(s1, 28, 1) | qrcBitNumIntr(s0, 28, 0)) & 0xff;
  data[7] = (qrcBitNumIntr(s1, 3, 7) | qrcBitNumIntr(s0, 3, 6) | qrcBitNumIntr(s1, 11, 5) | qrcBitNumIntr(s0, 11, 4) | qrcBitNumIntr(s1, 19, 3) | qrcBitNumIntr(s0, 19, 2) | qrcBitNumIntr(s1, 27, 1) | qrcBitNumIntr(s0, 27, 0)) & 0xff;
  data[6] = (qrcBitNumIntr(s1, 2, 7) | qrcBitNumIntr(s0, 2, 6) | qrcBitNumIntr(s1, 10, 5) | qrcBitNumIntr(s0, 10, 4) | qrcBitNumIntr(s1, 18, 3) | qrcBitNumIntr(s0, 18, 2) | qrcBitNumIntr(s1, 26, 1) | qrcBitNumIntr(s0, 26, 0)) & 0xff;
  data[5] = (qrcBitNumIntr(s1, 1, 7) | qrcBitNumIntr(s0, 1, 6) | qrcBitNumIntr(s1, 9, 5) | qrcBitNumIntr(s0, 9, 4) | qrcBitNumIntr(s1, 17, 3) | qrcBitNumIntr(s0, 17, 2) | qrcBitNumIntr(s1, 25, 1) | qrcBitNumIntr(s0, 25, 0)) & 0xff;
  data[4] = (qrcBitNumIntr(s1, 0, 7) | qrcBitNumIntr(s0, 0, 6) | qrcBitNumIntr(s1, 8, 5) | qrcBitNumIntr(s0, 8, 4) | qrcBitNumIntr(s1, 16, 3) | qrcBitNumIntr(s0, 16, 2) | qrcBitNumIntr(s1, 24, 1) | qrcBitNumIntr(s0, 24, 0)) & 0xff;
  return data;
}

function qrcF(state: number, key: Uint8Array): number {
  const t1 =
    (qrcBitNumIntl(state, 31, 0) | ((state & 0xf0000000) >>> 1) | qrcBitNumIntl(state, 4, 5) |
      qrcBitNumIntl(state, 3, 6) | ((state & 0x0f000000) >>> 3) | qrcBitNumIntl(state, 8, 11) |
      qrcBitNumIntl(state, 7, 12) | ((state & 0x00f00000) >>> 5) | qrcBitNumIntl(state, 12, 17) |
      qrcBitNumIntl(state, 11, 18) | ((state & 0x000f0000) >>> 7) | qrcBitNumIntl(state, 16, 23)) >>> 0;
  const t2 =
    (qrcBitNumIntl(state, 15, 0) | ((state & 0x0000f000) << 15) | qrcBitNumIntl(state, 20, 5) |
      qrcBitNumIntl(state, 19, 6) | ((state & 0x00000f00) << 13) | qrcBitNumIntl(state, 24, 11) |
      qrcBitNumIntl(state, 23, 12) | ((state & 0x000000f0) << 11) | qrcBitNumIntl(state, 28, 17) |
      qrcBitNumIntl(state, 27, 18) | ((state & 0x0000000f) << 9) | qrcBitNumIntl(state, 0, 23)) >>> 0;
  const lrg = [
    ((t1 >>> 24) & 0xff) ^ key[0],
    ((t1 >>> 16) & 0xff) ^ key[1],
    ((t1 >>> 8) & 0xff) ^ key[2],
    ((t2 >>> 24) & 0xff) ^ key[3],
    ((t2 >>> 16) & 0xff) ^ key[4],
    ((t2 >>> 8) & 0xff) ^ key[5],
  ];
  const mixed =
    ((QRC_SBOX[0][qrcSBoxBit(lrg[0] >> 2)] << 28) |
      (QRC_SBOX[1][qrcSBoxBit(((lrg[0] & 0x03) << 4) | (lrg[1] >> 4))] << 24) |
      (QRC_SBOX[2][qrcSBoxBit(((lrg[1] & 0x0f) << 2) | (lrg[2] >> 6))] << 20) |
      (QRC_SBOX[3][qrcSBoxBit(lrg[2] & 0x3f)] << 16) |
      (QRC_SBOX[4][qrcSBoxBit(lrg[3] >> 2)] << 12) |
      (QRC_SBOX[5][qrcSBoxBit(((lrg[3] & 0x03) << 4) | (lrg[4] >> 4))] << 8) |
      (QRC_SBOX[6][qrcSBoxBit(((lrg[4] & 0x0f) << 2) | (lrg[5] >> 6))] << 4) |
      QRC_SBOX[7][qrcSBoxBit(lrg[5] & 0x3f)]) >>> 0;
  return (
    qrcBitNumIntl(mixed, 15, 0) | qrcBitNumIntl(mixed, 6, 1) | qrcBitNumIntl(mixed, 19, 2) |
    qrcBitNumIntl(mixed, 20, 3) | qrcBitNumIntl(mixed, 28, 4) | qrcBitNumIntl(mixed, 11, 5) |
    qrcBitNumIntl(mixed, 27, 6) | qrcBitNumIntl(mixed, 16, 7) | qrcBitNumIntl(mixed, 0, 8) |
    qrcBitNumIntl(mixed, 14, 9) | qrcBitNumIntl(mixed, 22, 10) | qrcBitNumIntl(mixed, 25, 11) |
    qrcBitNumIntl(mixed, 4, 12) | qrcBitNumIntl(mixed, 17, 13) | qrcBitNumIntl(mixed, 30, 14) |
    qrcBitNumIntl(mixed, 9, 15) | qrcBitNumIntl(mixed, 1, 16) | qrcBitNumIntl(mixed, 7, 17) |
    qrcBitNumIntl(mixed, 23, 18) | qrcBitNumIntl(mixed, 13, 19) | qrcBitNumIntl(mixed, 31, 20) |
    qrcBitNumIntl(mixed, 26, 21) | qrcBitNumIntl(mixed, 2, 22) | qrcBitNumIntl(mixed, 8, 23) |
    qrcBitNumIntl(mixed, 18, 24) | qrcBitNumIntl(mixed, 12, 25) | qrcBitNumIntl(mixed, 29, 26) |
    qrcBitNumIntl(mixed, 5, 27) | qrcBitNumIntl(mixed, 21, 28) | qrcBitNumIntl(mixed, 10, 29) |
    qrcBitNumIntl(mixed, 3, 30) | qrcBitNumIntl(mixed, 24, 31)
  ) >>> 0;
}

function qrcDESCrypt(input: Uint8Array, key: Uint8Array[]): Uint8Array {
  let [s0, s1] = qrcInitialPermutation(input);
  for (let i = 0; i < 15; i++) {
    const prev = s1;
    s1 = (qrcF(s1, key[i]) ^ s0) >>> 0;
    s0 = prev;
  }
  s0 = (qrcF(s1, key[15]) ^ s0) >>> 0;
  return qrcInversePermutation(s0, s1);
}

function qrcKeySchedule(key: Uint8Array, mode: number): Uint8Array[] {
  const schedule: Uint8Array[] = [];
  for (let i = 0; i < 16; i++) schedule.push(new Uint8Array(6));
  const keyRndShift = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
  const keyPermC = [56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35];
  const keyPermD = [62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 60, 52, 44, 36, 28, 20, 12, 4, 27, 19, 11, 3];
  const keyCompression = [13, 16, 10, 23, 0, 4, 2, 27, 14, 5, 20, 9, 22, 18, 11, 3, 25, 7, 15, 6, 26, 19, 12, 1, 40, 51, 30, 36, 46, 54, 29, 39, 50, 44, 32, 47, 43, 48, 38, 55, 33, 52, 45, 41, 49, 35, 28, 31];
  let c = 0;
  let d = 0;
  for (let i = 0; i < 28; i++) {
    c = (c + qrcBitNum(key, keyPermC[i], 31 - i)) >>> 0;
    d = (d + qrcBitNum(key, keyPermD[i], 31 - i)) >>> 0;
  }
  for (let i = 0; i < 16; i++) {
    const shift = keyRndShift[i];
    // Go: ((c << shift) | (c >> (28-shift))) & 0xfffffff0（uint32 逻辑右移）
    c = (((c << shift) | (c >>> (28 - shift))) & 0xfffffff0) >>> 0;
    d = (((d << shift) | (d >>> (28 - shift))) & 0xfffffff0) >>> 0;
    let toGen = i;
    if (mode === QRC_DECRYPT) {
      toGen = 15 - i;
    }
    for (let j = 0; j < 24; j++) {
      schedule[toGen][Math.floor(j / 8)] |= qrcBitNumIntr(c, keyCompression[j], 7 - (j % 8)) & 0xff;
    }
    for (let j = 24; j < 48; j++) {
      schedule[toGen][Math.floor(j / 8)] |= qrcBitNumIntr(d, keyCompression[j] - 27, 7 - (j % 8)) & 0xff;
    }
  }
  return schedule;
}

/** 解密 QRC hex 密文 → 明文（zlib 解压），对齐 lyrics.DecryptQRCHex */
export function decryptQRCHex(content: string): string {
  const trimmed = content.trim();
  if (!/^[0-9a-fA-F]+$/.test(trimmed) || trimmed.length % 2 !== 0) {
    throw new Error("qrc hex decode error");
  }
  const encrypted = Buffer.from(trimmed, "hex");
  if (encrypted.length % 8 !== 0) {
    throw new Error(`qrc encrypted length ${encrypted.length} is not multiple of 8`);
  }
  const plain = Buffer.alloc(encrypted.length);
  for (let i = 0; i < encrypted.length; i += 8) {
    plain.set(qrcTripleDESDecrypt(Uint8Array.from(encrypted.subarray(i, i + 8))), i);
  }
  return zlib.inflateSync(plain).toString("utf8");
}

// ---------------------------------------------------------------------------
// 以下移植自 music-lib/lyrics/lyrics.go 的 QRC 相关部分
// ---------------------------------------------------------------------------

export interface QrcTime {
  ms: number;
  ok: boolean;
}

export interface QrcWord {
  start: QrcTime;
  end: QrcTime;
  text: string;
}

export interface QrcLine {
  start: QrcTime;
  end: QrcTime;
  words: QrcWord[];
}

export type QrcData = QrcLine[];
export type QrcMultiData = Record<string, QrcData>;

const LRC_TAG_RE = /^\[([A-Za-z]+):([^\]]*)\]$/;
const QRC_CONTENT_RE = /<Lyric_1[^>]*LyricContent="([\s\S]*?)"\s*\/>/;
const QRC_LINE_RE = /^\[(\d+),(\d+)\](.*)$/;
const QRC_WORD_RE = /(?:\[\d+,\d+\])?([^()]*)\((\d+),(\d+)\)/g;

function atoi(s: string): number {
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? 0 : n;
}

/** 对齐 Go html.UnescapeString 的常用子集（命名实体 + 十/十六进制数字实体） */
function htmlUnescape(s: string): string {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0",
    copy: "\u00a9", reg: "\u00ae", hellip: "\u2026", mdash: "\u2014", ndash: "\u2013",
    lsaquo: "\u2039", rsaquo: "\u203a", ldquo: "\u201c", rdquo: "\u201d", lsquo: "\u2018", rsquo: "\u2019",
  };
  return s.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const isHex = body[1] === "x" || body[1] === "X";
      const num = parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (Number.isNaN(num) || num < 0 || num > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(num);
      } catch {
        return whole;
      }
    }
    return named[body] ?? whole;
  });
}

/** 解析 QRC 明文 → (tags, Data)，对齐 lyrics.ParseQRC */
export function parseQRC(raw: string): [Record<string, string>, QrcData] {
  const contentMatch = QRC_CONTENT_RE.exec(raw);
  if (contentMatch) {
    raw = htmlUnescape(contentMatch[1]);
  }
  const tags: Record<string, string> = {};
  const out: QrcData = [];
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (line === "") continue;
    const tm = LRC_TAG_RE.exec(line);
    if (tm) {
      tags[tm[1]] = tm[2];
      continue;
    }
    const m = QRC_LINE_RE.exec(line);
    if (!m) continue;
    const start = atoi(m[1]);
    const end = start + atoi(m[2]);
    const content = m[3] ?? "";
    const words: QrcWord[] = [];
    QRC_WORD_RE.lastIndex = 0;
    let wm: RegExpExecArray | null;
    while ((wm = QRC_WORD_RE.exec(content)) !== null) {
      const wordStart = atoi(wm[2]);
      const wordEnd = wordStart + atoi(wm[3]);
      if (wm[1] === "" || wm[1] === "\r") continue;
      words.push({ start: { ms: wordStart, ok: true }, end: { ms: wordEnd, ok: true }, text: wm[1] });
    }
    if (words.length === 0 && content !== "") {
      words.push({ start: { ms: start, ok: true }, end: { ms: end, ok: true }, text: content });
    }
    out.push({ start: { ms: start, ok: true }, end: { ms: end, ok: true }, words });
  }
  return [tags, out];
}

export function defaultDisplayOrder(): string[] {
  return ["orig", "roma", "ts"];
}

/** 多语言逐字数据 → verbatim LRC，对齐 lyrics.ConvertVerbatimLRC */
export function convertVerbatimLRC(tags: Record<string, string>, data: QrcMultiData, order: string[]): string {
  const parts: string[] = [];
  writeTags(parts, tags);
  const langs = order.length > 0 ? order : defaultDisplayOrder();
  const orig = data["orig"] ?? [];
  for (let i = 0; i < orig.length; i++) {
    const origLine = orig[i];
    const start = lineStart(origLine);
    const end = lineEnd(origLine);
    for (const lang of langs) {
      const lines = data[lang];
      if (!lines || lines.length === 0) continue;
      const idx = mappedIndex(lines, i, origLine);
      if (idx < 0 || idx >= lines.length) continue;
      if (!lineHasText(lines[idx])) continue;
      parts.push(lineToVerbatimLRC(lines[idx], start, end));
    }
  }
  return parts.join("\n").replace(/\n+$/, "");
}

function writeTags(parts: string[], tags: Record<string, string>): void {
  for (const k of ["ti", "ar", "al", "by", "offset"]) {
    const v = (tags[k] ?? "").trim();
    if (v !== "") {
      parts.push(`[${k}:${v}]`);
    }
  }
  if (Object.keys(tags).length > 0) {
    parts.push("");
  }
}

function mappedIndex(lines: QrcData, i: number, orig: QrcLine): number {
  if (orig.start.ok) {
    for (let idx = 0; idx < lines.length; idx++) {
      if (lines[idx].start.ok && lines[idx].start.ms === orig.start.ms && lineHasText(lines[idx])) {
        return idx;
      }
    }
    if (hasTimedLines(lines)) {
      return -1;
    }
  }
  if (i < lines.length) {
    return i;
  }
  return -1;
}

function hasTimedLines(lines: QrcData): boolean {
  for (const line of lines) {
    if (line.start.ok) return true;
  }
  return false;
}

function lineStart(line: QrcLine): QrcTime {
  if (line.words.length > 0 && line.words[0].start.ok) {
    return line.words[0].start;
  }
  return line.start;
}

function lineEnd(line: QrcLine): QrcTime {
  if (line.words.length > 0 && line.words[line.words.length - 1].end.ok) {
    return line.words[line.words.length - 1].end;
  }
  return line.end;
}

function lineHasText(line: QrcLine): boolean {
  for (const w of line.words) {
    if (w.text.trim() !== "") return true;
  }
  return false;
}

function lineToVerbatimLRC(line: QrcLine, forcedStart: QrcTime, forcedEnd: QrcTime): string {
  let start = forcedStart;
  if (!start.ok) start = lineStart(line);
  let end = forcedEnd;
  if (!end.ok) end = lineEnd(line);
  let b = "";
  if (start.ok) {
    b += `[${formatTime(start.ms)}]`;
  }
  let lastEnd = start;
  for (const word of line.words) {
    if (word.text === "") continue;
    if (word.start.ok && (!lastEnd.ok || word.start.ms !== lastEnd.ms)) {
      b += `[${formatTime(word.start.ms)}]`;
    }
    b += word.text;
    if (word.end.ok) {
      b += `[${formatTime(word.end.ms)}]`;
      lastEnd = word.end;
    }
  }
  if (end.ok && !b.endsWith("]")) {
    b += `[${formatTime(end.ms)}]`;
  }
  return b;
}

function formatTime(ms: number): string {
  if (ms < 0) ms = 0;
  const minute = Math.floor(ms / 60000);
  const second = Math.floor((ms % 60000) / 1000);
  const centisecond = Math.floor((ms % 1000) / 10);
  const mm = String(minute).padStart(2, "0");
  const ss = String(second).padStart(2, "0");
  const cc = String(centisecond).padStart(2, "0");
  return `${mm}:${ss}.${cc}`;
}
