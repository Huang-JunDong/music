/**
 * 歌词视频渲染预布局（纯逻辑，供 /render 页与单元测试共用）
 * 渲染前一次性完成：词级时间轴规范化、按词/按字符换行、行级渠道时间插值、副行截断。
 * 帧循环直接消费 Layout 结果，零 measureText —— 长歌 30fps 渲染不掉帧。
 */
import type { ClientLyricLine } from "./lrc-client";

export interface LayoutSeg {
  text: string;
  w: number;
  start: number; // 毫秒
  end: number; // 毫秒
}

export interface LayoutRow {
  segs: LayoutSeg[];
  w: number; // 行内 segs 总宽
}

export interface LineBlock {
  time: number;
  end: number;
  rows: LayoutRow[];
  romaji: string;
  translation: string;
  hasWords: boolean; // 词级（true）或整行进度（false）
  height: number;
}

/** 度量上下文最小契约（CanvasRenderingContext2D 结构兼容；测试可注入 mock） */
export interface MeasureCtx {
  font: string;
  measureText(text: string): { width: number };
}

export const RENDER_MAIN_ROW_H = 60; // 主行物理行高
export const RENDER_SUB_ROW_H = 38; // 副行行高
export const RENDER_BLOCK_PAD = 14; // 块内边距
export const RENDER_MAX_ROWS = 3; // 单块主行物理行上限

/** 词级时间轴规范化：end 缺失/非法时用后词 start / 行末兜底，保证每个词有正跨度 */
export function normalizeWordTimes(
  line: ClientLyricLine,
  lineEnd: number,
): { start: number; end: number; text: string }[] {
  const words = (line.words ?? []).filter((w) => w.text);
  return words.map((w, i) => {
    const start = w.start;
    let end = w.end > w.start ? w.end : 0;
    if (!end) end = words[i + 1]?.start ?? lineEnd;
    if (end <= start) end = start + Math.max(80, (lineEnd - start) / Math.max(1, words.length - i));
    return { start, end, text: w.text };
  });
}

/** 词级换行：贪心累加词宽，超宽折行；词永不拆分 */
export function wrapWords(
  ctx: MeasureCtx,
  words: { start: number; end: number; text: string }[],
  maxWidth: number,
): LayoutRow[] {
  const rows: LayoutRow[] = [];
  let segs: LayoutSeg[] = [];
  let w = 0;
  for (const word of words) {
    const ww = ctx.measureText(word.text).width;
    if (w + ww > maxWidth && segs.length) {
      rows.push({ segs, w });
      segs = [];
      w = 0;
    }
    segs.push({ text: word.text, w: ww, start: word.start, end: word.end });
    w += ww;
  }
  if (segs.length) rows.push({ segs, w });
  return rows;
}

/** 行级换行：按空白分词贪心；单 token 超宽按字符硬切 */
export function wrapText(ctx: MeasureCtx, text: string, maxWidth: number): LayoutRow[] {
  const rows: LayoutRow[] = [];
  const tokens = text.match(/\S+|\s+/g) ?? [];
  let segs: LayoutSeg[] = [];
  let w = 0;
  const pushRow = () => {
    if (segs.length) rows.push({ segs, w });
    segs = [];
    w = 0;
  };
  for (const token of tokens) {
    let remain = token;
    while (remain) {
      const tw = ctx.measureText(remain).width;
      if (tw <= maxWidth - w) {
        segs.push({ text: remain, w: tw, start: 0, end: 0 });
        w += tw;
        remain = "";
        break;
      }
      let cut = remain.length;
      while (cut > 1 && ctx.measureText(remain.slice(0, cut)).width > maxWidth - w) cut--;
      if (cut <= 0) {
        pushRow();
        continue;
      }
      const head = remain.slice(0, cut);
      const hw = ctx.measureText(head).width;
      segs.push({ text: head, w: hw, start: 0, end: 0 });
      w += hw;
      pushRow();
      remain = remain.slice(cut);
    }
  }
  pushRow();
  return rows;
}

/** 截断加省略号 */
export function clipRenderText(ctx: MeasureCtx, text: string, maxWidth: number): string {
  if (!text) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

/**
 * 预布局全部歌词行：
 * - 词级行（YRC/QRC/KRC）：normalizeWordTimes + wrapWords
 * - 行级行：wrapText 后按物理行宽度比例分摊行时间（多行也能平滑逐行填充）
 * - 副行（罗马音/译文）单行截断
 */
export function buildLineBlocks(
  ctx: MeasureCtx,
  lyrics: ClientLyricLine[],
  durationSec: number,
  W: number,
  opts: { mainFont?: string; subRomaFont?: string; subTransFont?: string } = {},
): LineBlock[] {
  const mainFont = opts.mainFont ?? "";
  const subRomaFont = opts.subRomaFont ?? mainFont;
  const subTransFont = opts.subTransFont ?? mainFont;
  const maxWidth = W - 100;
  const totalMs = durationSec * 1000;
  const blocks: LineBlock[] = [];

  for (let i = 0; i < lyrics.length; i++) {
    const line = lyrics[i];
    const lineEnd = line.end && line.end > line.time ? line.end : (lyrics[i + 1]?.time ?? totalMs);

    ctx.font = mainFont;
    let rows: LayoutRow[];
    let hasWords = false;
    if (line.words?.length) {
      rows = wrapWords(ctx, normalizeWordTimes(line, lineEnd), maxWidth);
      hasWords = true;
    } else {
      rows = wrapText(ctx, line.text || "· · ·", maxWidth);
    }

    // 物理行数上限：超出截断（末词/末段加省略号）
    if (rows.length > RENDER_MAX_ROWS) {
      rows = rows.slice(0, RENDER_MAX_ROWS);
      const last = rows[rows.length - 1];
      const lastSeg = last.segs[last.segs.length - 1];
      if (lastSeg) {
        lastSeg.text = clipRenderText(ctx, lastSeg.text, Math.max(40, maxWidth - (last.w - lastSeg.w)));
        lastSeg.w = ctx.measureText(lastSeg.text).width;
        last.w = last.segs.reduce((acc, s) => acc + s.w, 0);
      }
    }

    // 行级（无词级时间）：按物理行宽度比例分摊行时间
    if (!hasWords) {
      const totalW = rows.reduce((acc, r) => acc + r.w, 0) || 1;
      const span = Math.max(1, lineEnd - line.time);
      let pre = 0;
      for (const row of rows) {
        const start = line.time + (span * pre) / totalW;
        pre += row.w;
        const end = line.time + (span * pre) / totalW;
        for (const seg of row.segs) {
          seg.start = start;
          seg.end = end;
        }
      }
    }

    ctx.font = subRomaFont;
    const romaji = clipRenderText(ctx, line.romaji ?? "", maxWidth - 40);
    ctx.font = subTransFont;
    const translation = clipRenderText(ctx, line.translation ?? "", maxWidth - 40);

    const height =
      rows.length * RENDER_MAIN_ROW_H + (romaji ? RENDER_SUB_ROW_H : 0) + (translation ? RENDER_SUB_ROW_H : 0) + RENDER_BLOCK_PAD;

    blocks.push({ time: line.time, end: lineEnd, rows, romaji, translation, hasWords, height });
  }
  return blocks;
}

/** mock 度量上下文：等宽字体（每字符 10px），供测试与无 DOM 环境 */
export function createMockMeasureCtx(charW = 10): MeasureCtx {
  return {
    font: "",
    measureText: (text: string) => ({ width: text.length * charW }),
  };
}
