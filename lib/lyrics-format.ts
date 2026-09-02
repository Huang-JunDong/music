/**
 * 歌词格式处理 — 移植 internal/web/lyrics_format.go
 * classifyLyricFormat / formatLyricForMode
 */

const LYRIC_FORMAT_KARAOKE = "karaoke";
const LYRIC_FORMAT_LINE = "line";

const LRC_TIMESTAMP_RE = /\[(\d+):(\d+)\.(\d{1,3})\]/g;
const LRC_TAG_LINE_RE = /^\[[A-Za-z]+:[^\]]*\]$/;

interface TimestampMatch {
  start: number;
  end: number;
  text: string;
}

function findAllTimestamps(line: string): TimestampMatch[] {
  const matches: TimestampMatch[] = [];
  LRC_TIMESTAMP_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LRC_TIMESTAMP_RE.exec(line)) !== null) {
    matches.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  }
  return matches;
}

/** 分类歌词格式：karaoke（多时间戳/重复时间戳）或 line */
export function classifyLyricFormat(raw: string): string {
  const startCounts = new Map<string, number>();
  for (const rawLine of (raw ?? "").split("\n")) {
    const line = rawLine.trim();
    if (!line || LRC_TAG_LINE_RE.test(line)) continue;
    const matches = findAllTimestamps(line);
    if (matches.length === 0) continue;
    if (matches.length > 1) return LYRIC_FORMAT_KARAOKE;
    const start = line.slice(matches[0].start, matches[0].end);
    const count = (startCounts.get(start) ?? 0) + 1;
    startCounts.set(start, count);
    if (count > 1) return LYRIC_FORMAT_KARAOKE;
  }
  return LYRIC_FORMAT_LINE;
}

/** 按模式格式化歌词：line → 仅保留原文行；其他（auto/origin/translation 等）原样返回 */
export function formatLyricForMode(raw: string, mode: string): string {
  if ((mode ?? "").toLowerCase() === LYRIC_FORMAT_LINE) {
    return lyricOriginalLineOnly(raw);
  }
  return raw;
}

/** 去重时间戳、剔除空行、按时间排序的纯原文 LRC */
export function lyricOriginalLineOnly(raw: string): string {
  const seenStarts = new Set<string>();
  const tags: string[] = [];
  const lines: { start: string; text: string }[] = [];

  for (const rawLine of (raw ?? "").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (LRC_TAG_LINE_RE.test(line)) {
      tags.push(line);
      continue;
    }
    const matches = findAllTimestamps(line);
    if (matches.length === 0) continue;
    const start = line.slice(matches[0].start, matches[0].end);
    if (seenStarts.has(start)) continue;
    seenStarts.add(start);
    const text = line.replace(LRC_TIMESTAMP_RE, "").trim();
    if (!text) continue;
    lines.push({ start, text });
  }

  lines.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  let out = "";
  for (const tag of tags) out += tag + "\n";
  if (tags.length > 0 && lines.length > 0) out += "\n";
  for (const line of lines) out += line.start + line.text + "\n";
  return out.replace(/\n+$/, "");
}
