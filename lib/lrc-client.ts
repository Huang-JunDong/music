/** 浏览器端 LRC 解析（轻量版，无 Node 依赖）
 * 支持：行级 LRC、karaoke 词级行（verbatim）、同时间戳行归并（译文/罗马音）、“原文（译文）”内联合并 */
export interface ClientLyricWord {
  start: number; // 毫秒
  end: number; // 毫秒
  text: string;
}

export interface ClientLyricLine {
  time: number; // 毫秒（行起始）
  text: string;
  translation?: string;
  romaji?: string;
  words?: ClientLyricWord[]; // karaoke 词级（netease YRC / QQ QRC / kugou KRC）
  end?: number; // 行结束（词级时 = 末词 end）
}

const TIME_TAG = /\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/g;

function parseTagMs(m: string, s: string, ms: string): number {
  return Number(m) * 60_000 + Number(s) * 1000 + Number((ms ?? "0").padEnd(3, "0"));
}

function hasHan(s: string): boolean {
  return /[\u4e00-\u9fff]/.test(s);
}
function hasKana(s: string): boolean {
  return /[\u3040-\u30ff\uff66-\uff9f]/.test(s);
}
function hasLatin(s: string): boolean {
  return /[A-Za-z]/.test(s);
}

interface RawLine {
  time: number;
  text: string;
  words: ClientLyricWord[] | null;
  end?: number;
}

/** 单行解析：行首连续多时间戳 → 多行；行内夹时间戳 → karaoke 词级切分 */
function parseRawLine(line: string): RawLine[] {
  const tokens: { ms: number; index: number; length: number }[] = [];
  TIME_TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TIME_TAG.exec(line)) !== null) {
    tokens.push({ ms: parseTagMs(m[1], m[2], m[3]), index: m.index, length: m[0].length });
  }
  if (!tokens.length) return [];

  // 行首连续时间戳（词级行的行首也可能只出现一次）
  let headEnd = 0;
  const headTimes: number[] = [];
  for (const tk of tokens) {
    if (tk.index !== headEnd) break;
    headTimes.push(tk.ms);
    headEnd = tk.index + tk.length;
  }

  const rest = line.slice(headEnd);
  // 行内残余时间戳 → karaoke 词级（index 归一为 rest 相对坐标）
  const inner = tokens
    .filter((tk) => tk.index >= headEnd)
    .map((tk) => ({ ms: tk.ms, index: tk.index - headEnd, length: tk.length }));
  let words: ClientLyricWord[] | null = null;
  let text = rest;
  if (inner.length > 0) {
    words = [];
    let cursor = 0;
    let lastStart = headTimes[headTimes.length - 1];
    for (const tk of inner) {
      const wText = rest.slice(cursor, tk.index);
      if (wText) words.push({ start: lastStart, end: tk.ms, text: wText });
      lastStart = tk.ms;
      cursor = tk.index + tk.length;
    }
    if (cursor < rest.length) {
      words.push({ start: lastStart, end: lastStart, text: rest.slice(cursor) });
    }
    text = words.map((w) => w.text).join("");
  }
  text = text.trim();
  if (!text) return [];

  const end = words?.length ? Math.max(...words.map((w) => w.end)) : undefined;
  return headTimes.map((t) => ({ time: t, text, words, end }));
}

export function parseLrcClient(lrc: string): ClientLyricLine[] {
  const raw: RawLine[] = [];
  for (const rawLine of lrc.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    // 纯 tag 行（[ti:] 等）跳过
    if (/^\[[A-Za-z]+:[^\]]*\]$/.test(line)) continue;
    raw.push(...parseRawLine(line));
  }
  raw.sort((a, b) => a.time - b.time);

  // 同时间戳行归并（ConvertVerbatimLRC 输出特征：orig → roma → ts 同起始独立行）
  const out: ClientLyricLine[] = [];
  let i = 0;
  while (i < raw.length) {
    const main = raw[i];
    const line: ClientLyricLine = {
      time: main.time,
      text: main.text,
      ...(main.words?.length ? { words: main.words, end: main.end } : {}),
    };
    let j = i + 1;
    while (j < raw.length && raw[j].time === main.time) {
      const extra = raw[j].text;
      if (!line.translation && hasHan(extra) && !hasKana(extra)) {
        line.translation = extra;
      } else if (!line.romaji && hasLatin(extra) && !hasHan(extra) && !hasKana(extra)) {
        line.romaji = extra;
      } else if (!line.translation) {
        line.translation = extra;
      }
      j++;
    }
    // “原文（译文）”内联兜底（服务端行级渠道的合并格式）
    if (!line.translation) {
      const tm = line.text.match(/^(.*)（(.*)）$/);
      if (tm) {
        line.text = tm[1];
        line.translation = tm[2];
      }
    }
    out.push(line);
    i = j;
  }
  return out;
}
