/**
 * 歌词解析与转换（KRC / 酷我加密歌词 / LRC）— 从 music-lib lyrics 包移植
 */
import zlib from "node:zlib";

const KRC_KEY = Buffer.from([
  0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69,
]);
const KUWO_LYRIC_KEY = Buffer.from("yeelion", "utf8");

/** 解密酷狗 KRC（base64 → 跳过 krc1 头 → XOR → zlib inflate） */
export function decodeKRC(base64Content: string): string {
  const raw = Buffer.from(base64Content, "base64");
  if (raw.length < 4) throw new Error("krc too short");
  const encrypted = raw.subarray(4);
  const plain = Buffer.allocUnsafe(encrypted.length);
  for (let i = 0; i < encrypted.length; i++) {
    plain[i] = encrypted[i] ^ KRC_KEY[i % KRC_KEY.length];
  }
  return zlib.inflateSync(plain).toString("utf8");
}

/** 解密酷我 newLyric 响应（tp=content 头 → zlib → base64 → XOR yeelion → GB18030） */
export function decodeKuwoLyric(body: Buffer): string {
  const head = "tp=content";
  if (!body.subarray(0, head.length).equals(Buffer.from(head, "utf8"))) {
    throw new Error("invalid kuwo lyric response");
  }
  const idx = body.indexOf(Buffer.from("\r\n\r\n", "utf8"));
  if (idx < 0) throw new Error("invalid kuwo lyric payload");
  const inflated = zlib.inflateSync(body.subarray(idx + 4)).toString("utf8");
  const compact = inflated.replace(/[\s\r\n\t]/g, "");
  const decoded = Buffer.from(compact, "base64");
  const plain = Buffer.allocUnsafe(decoded.length);
  for (let i = 0; i < decoded.length; i++) {
    plain[i] = decoded[i] ^ KUWO_LYRIC_KEY[i % KUWO_LYRIC_KEY.length];
  }
  // Node 内置 ICU 支持 GB18030
  return new TextDecoder("gb18030").decode(plain);
}

export function containsHan(s: string): boolean {
  return /[\u4e00-\u9fff]/.test(s);
}
export function containsKana(s: string): boolean {
  return /[\u3040-\u30ff\uff66-\uff9f]/.test(s);
}

/* ================= Go lyrics 包完整移植（verbatim 多语言管线） ================= */

export interface VTime {
  ms: number;
  ok: boolean;
}
export interface VWord {
  start: VTime;
  end: VTime;
  text: string;
}
export interface VLine {
  start: VTime;
  end: VTime;
  words: VWord[];
}
export type VData = VLine[];
export type VMultiData = Record<string, VData>;

const VT = (ms: number): VTime => ({ ms, ok: true });
const VT_NONE = (): VTime => ({ ms: 0, ok: false });

function vAtoi(s: string): number {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

/** parseLrcTime 移植：1/2/3+ 位毫秒归一化 */
function vParseLrcTime(m: string, s: string, ms: string): number {
  let msValue = vAtoi(ms);
  if (ms.length === 1) msValue *= 100;
  else if (ms.length === 2) msValue *= 10;
  else if (ms.length > 3) msValue = vAtoi(ms.slice(0, 3));
  return vAtoi(m) * 60000 + vAtoi(s) * 1000 + msValue;
}

/** formatTime 移植：mm:ss.cc（百分秒） */
export function formatLrcTime(ms: number): string {
  if (ms < 0) ms = 0;
  const minute = Math.floor(ms / 60000);
  const second = Math.floor((ms % 60000) / 1000);
  const centi = Math.floor((ms % 1000) / 10);
  return `${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}.${String(centi).padStart(2, "0")}`;
}

/** parseLrcWords 移植：行内词级时间戳解析 */
function vParseLrcWords(start: number, content: string): VWord[] {
  if (!content) return [];
  const re = /\[(\d+):(\d+)\.(\d+)\]/g;
  const matches = [...content.matchAll(re)];
  if (!matches.length) return [{ start: VT(start), end: VT_NONE(), text: content }];

  const words: VWord[] = [];
  let cursor = 0;
  let lastStart = start;
  for (const m of matches) {
    const text = content.slice(cursor, m.index ?? 0);
    const endMS = vParseLrcTime(m[1], m[2], m[3]);
    if (text) words.push({ start: VT(lastStart), end: VT(endMS), text });
    lastStart = endMS;
    cursor = (m.index ?? 0) + m[0].length;
  }
  if (cursor < content.length) {
    const text = content.slice(cursor);
    if (text) words.push({ start: VT(lastStart), end: VT_NONE(), text });
  }
  return words;
}

function vInferLineEnds(data: VData): void {
  data.sort((a, b) => (a.start.ok && b.start.ok ? a.start.ms - b.start.ms : 0));
  for (let i = 0; i + 1 < data.length; i++) {
    if (!data[i].end.ok && data[i + 1].start.ok) data[i].end = data[i + 1].start;
  }
}

/** ParseLRC 移植：返回 tags + 词级行数据 */
export function parseLrcVerbatim(raw: string): { tags: Record<string, string>; data: VData } {
  const tags: Record<string, string> = {};
  const out: VData = [];
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const tm = line.match(/^\[([A-Za-z]+):([^\]]*)\]$/);
    if (tm) {
      tags[tm[1]] = tm[2];
      continue;
    }
    const m = line.match(/^\[(\d+):(\d+)\.(\d+)\](.*)$/);
    if (!m) continue;
    const start = vParseLrcTime(m[1], m[2], m[3]);
    out.push({ start: VT(start), end: VT_NONE(), words: vParseLrcWords(start, m[4]) });
  }
  vInferLineEnds(out);
  return { tags, data: out };
}

/** ParseYRC 移植：[start,dur] + (start,dur,0)text 词级 */
export function parseYrcData(raw: string): VData {
  const out: VData = [];
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    const m = line.match(/^\[(\d+),(\d+)\](.*)$/);
    if (!m) continue;
    const start = vAtoi(m[1]);
    const end = start + vAtoi(m[2]);
    const content = m[3];
    const words: VWord[] = [];
    const wordRe = /(?:\[\d+,\d+\])?\((\d+),(\d+),\d+\)([^\(\[]*)/g;
    for (const wm of content.matchAll(wordRe)) {
      const wordStart = vAtoi(wm[1]);
      const wordEnd = wordStart + vAtoi(wm[2]);
      if (!wm[3]) continue;
      words.push({ start: VT(wordStart), end: VT(wordEnd), text: wm[3] });
    }
    if (!words.length && content) {
      words.push({ start: VT(start), end: VT(end), text: content });
    }
    out.push({ start: VT(start), end: VT(end), words });
  }
  return out;
}

/** ParseKRC 移植：[start,dur] + <offset,dur,0>text 词级；language tag → roma/ts 多语言 */
export function parseKrcVerbatim(raw: string): { tags: Record<string, string>; data: VMultiData } {
  const tags: Record<string, string> = {};
  const orig: VData = [];
  const result: VMultiData = {};
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const tm = line.match(/^\[([A-Za-z]+):([^\]]*)\]$/);
    if (tm) {
      tags[tm[1]] = tm[2];
      continue;
    }
    const m = line.match(/^\[(\d+),(\d+)\](.*)$/);
    if (!m) continue;
    const start = vAtoi(m[1]);
    const end = start + vAtoi(m[2]);
    const content = m[3];
    const words: VWord[] = [];
    const wordRe = /(?:\[\d+,\d+\])?<(\d+),(\d+),\d+>([^<]*)/g;
    for (const wm of content.matchAll(wordRe)) {
      const wordStart = start + vAtoi(wm[1]);
      const wordEnd = wordStart + vAtoi(wm[2]);
      if (!wm[3]) continue;
      words.push({ start: VT(wordStart), end: VT(wordEnd), text: wm[3] });
    }
    if (!words.length && content) {
      words.push({ start: VT(start), end: VT(end), text: content });
    }
    orig.push({ start: VT(start), end: VT(end), words });
  }
  if (orig.length) result.orig = orig;
  const lang = (tags.language ?? "").trim();
  if (lang) addKrcLanguage(result, orig, lang);
  return { tags, data: result };
}

/** addKrcLanguage 移植：base64 JSON content → type 0=roma（逐词对位）/ type 1=ts（整行） */
function addKrcLanguage(result: VMultiData, orig: VData, encoded: string): void {
  let payload: { content?: { type?: number; lyricContent?: string[][] }[] };
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    return;
  }
  for (const lang of payload.content ?? []) {
    if (lang.type === 0) {
      const roma: VData = [];
      let offset = 0;
      for (let i = 0; i < orig.length; i++) {
        const line = orig[i];
        if (!vLineHasText(line)) {
          offset++;
          continue;
        }
        const li = i - offset;
        if (li < 0 || li >= (lang.lyricContent?.length ?? 0)) continue;
        const words: VWord[] = [];
        for (let j = 0; j < line.words.length; j++) {
          const cell = lang.lyricContent?.[li]?.[j];
          if (cell === undefined) continue;
          words.push({ start: line.words[j].start, end: line.words[j].end, text: cell });
        }
        roma.push({ start: line.start, end: line.end, words });
      }
      if (roma.length) result.roma = roma;
    } else if (lang.type === 1) {
      const ts: VData = [];
      for (let i = 0; i < orig.length; i++) {
        const text = lang.lyricContent?.[i]?.[0];
        if (!text) continue;
        ts.push({
          start: orig[i].start,
          end: orig[i].end,
          words: [{ start: orig[i].start, end: orig[i].end, text }],
        });
      }
      if (ts.length) result.ts = ts;
    }
  }
}

/** Merge 移植：主歌词 + ts + roma → MultiData */
export function mergeMultiData(primary: string, ts: string, roma: string): VMultiData {
  const out: VMultiData = {};
  if (primary.trim()) out.orig = parseLrcVerbatim(primary).data;
  if (ts.trim()) out.ts = parseLrcVerbatim(ts).data;
  if (roma.trim()) out.roma = parseLrcVerbatim(roma).data;
  return out;
}

export const DEFAULT_DISPLAY_ORDER = ["orig", "roma", "ts"];

function vLineStart(line: VLine): VTime {
  if (line.words.length && line.words[0].start.ok) return line.words[0].start;
  return line.start;
}

function vLineEnd(line: VLine): VTime {
  if (line.words.length && line.words[line.words.length - 1].end.ok) {
    return line.words[line.words.length - 1].end;
  }
  return line.end;
}

function vLineHasText(line: VLine): boolean {
  return line.words.some((w) => w.text.trim() !== "");
}

function vHasTimedLines(lines: VData): boolean {
  return lines.some((l) => l.start.ok);
}

function vMappedIndex(lines: VData, i: number, orig: VLine): number {
  if (orig.start.ok) {
    for (let idx = 0; idx < lines.length; idx++) {
      if (lines[idx].start.ok && lines[idx].start.ms === orig.start.ms && vLineHasText(lines[idx])) {
        return idx;
      }
    }
    if (vHasTimedLines(lines)) return -1;
  }
  return i < lines.length ? i : -1;
}

/** lineToVerbatimLRC 移植：行首时间 + 词级时间交错 */
function vLineToVerbatim(line: VLine, forcedStart: VTime, forcedEnd: VTime): string {
  const start = forcedStart.ok ? forcedStart : vLineStart(line);
  const end = forcedEnd.ok ? forcedEnd : vLineEnd(line);
  let out = "";
  if (start.ok) out += `[${formatLrcTime(start.ms)}]`;
  let lastEnd = start;
  for (const word of line.words) {
    if (!word.text) continue;
    if (word.start.ok && (!lastEnd.ok || word.start.ms !== lastEnd.ms)) {
      out += `[${formatLrcTime(word.start.ms)}]`;
    }
    out += word.text;
    if (word.end.ok) {
      out += `[${formatLrcTime(word.end.ms)}]`;
      lastEnd = word.end;
    }
  }
  if (end.ok && !out.endsWith("]")) out += `[${formatLrcTime(end.ms)}]`;
  return out;
}

function vWriteTags(tags: Record<string, string>): string {
  let out = "";
  for (const k of ["ti", "ar", "al", "by", "offset"]) {
    const v = (tags[k] ?? "").trim();
    if (v) out += `[${k}:${v}]\n`;
  }
  if (Object.keys(tags).length) out += "\n";
  return out;
}

/** ConvertVerbatimLRC 移植：tags 头 + orig/roma/ts 逐行交错（默认顺序 orig→roma→ts） */
export function convertVerbatimLRC(
  tags: Record<string, string>,
  data: VMultiData,
  order: string[] = DEFAULT_DISPLAY_ORDER,
): string {
  let out = vWriteTags(tags);
  const orig = data.orig ?? [];
  for (let i = 0; i < orig.length; i++) {
    const origLine = orig[i];
    const lineStart = vLineStart(origLine);
    const lineEnd = vLineEnd(origLine);
    for (const lang of order) {
      const lines = data[lang];
      if (!lines?.length) continue;
      const idx = vMappedIndex(lines, i, origLine);
      if (idx < 0 || idx >= lines.length) continue;
      if (!vLineHasText(lines[idx])) continue;
      out += vLineToVerbatim(lines[idx], lineStart, lineEnd);
      out += "\n";
    }
  }
  return out.replace(/\n+$/, "");
}

/* ================= kuwo convertKuwoNewLyric 移植 ================= */

const KUWO_LINE_RE = /^\[(\d{2}):(\d{2})\.(\d{3})\](.*)$/;
const KUWO_TAG_RE = /^\[[A-Za-z]+:[^\]]*\]$/;
const KUWO_WORD_RE = /<(-?\d+),(-?\d+)>([^<]*)/g;

function kuwoPayloadText(payload: string): string {
  const matches = [...payload.matchAll(KUWO_WORD_RE)];
  if (!matches.length) return payload.trim();
  return matches.map((m) => m[3]).join("").trim();
}

function isKuwoChineseTranslationPayload(payload: string): boolean {
  if (!payload.startsWith("<0,0>")) return false;
  const text = kuwoPayloadText(payload);
  return containsHan(text) && !containsKana(text);
}

function isKuwoRomajiPayload(text: string): boolean {
  let hasLatin = false;
  for (const ch of text) {
    if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z")) {
      hasLatin = true;
      continue;
    }
    if (containsHan(ch) || containsKana(ch)) return false;
  }
  return hasLatin;
}

/** convertKuwoNewLyric 移植：原文行后追加独立 roma（前）/translation（后）行；保留 tag 行 */
export function convertKuwoNewLyric(raw: string): string {
  const lines = raw.split(/\r|\n/).map((l) => l.trim());
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const m = line.match(KUWO_LINE_RE);
    if (!m) {
      if (KUWO_TAG_RE.test(line)) out.push(line);
      continue;
    }

    const payload = m[4];
    if (isKuwoChineseTranslationPayload(payload)) continue;
    const text = kuwoPayloadText(payload);
    if (!text) continue;

    const timestamp = `[${m[1]}:${m[2]}.${m[3]}]`;
    out.push(timestamp + text);

    let roma = "";
    let translation = "";
    while (i + 1 < lines.length) {
      const nextMatch = lines[i + 1].match(KUWO_LINE_RE);
      if (!nextMatch || !nextMatch[4].startsWith("<0,0>")) break;
      const nextText = kuwoPayloadText(nextMatch[4]);
      i++;
      if (!nextText) continue;
      if (isKuwoChineseTranslationPayload(nextMatch[4]) && !translation) {
        translation = nextText;
      } else if (isKuwoRomajiPayload(nextText) && !roma) {
        roma = nextText;
      }
    }
    if (roma) out.push(timestamp + roma);
    if (translation) out.push(timestamp + translation);
  }

  return out.join("\n").replace(/\n+$/, "");
}
