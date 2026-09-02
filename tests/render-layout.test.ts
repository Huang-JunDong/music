/**
 * 歌词视频渲染预布局测试（词级 karaoke 布局管线）
 * 覆盖：词级时间轴规范化兜底 / 换行不拆词 / 行级时间按宽度比例插值 / 副行截断 / 行数上限 / 块高度
 */
import { describe, expect, it } from "vitest";
import {
  buildLineBlocks,
  createMockMeasureCtx,
  normalizeWordTimes,
  wrapText,
  wrapWords,
  RENDER_MAIN_ROW_H,
  RENDER_SUB_ROW_H,
  RENDER_BLOCK_PAD,
  RENDER_MAX_ROWS,
} from "../lib/render-layout";
import type { ClientLyricLine } from "../lib/lrc-client";

/* 等宽 mock：每字符 10px → W=720 时 maxWidth=620 = 62 字符 */
const ctx = createMockMeasureCtx(10);

function wordLine(overrides: Partial<ClientLyricLine> = {}): ClientLyricLine {
  return {
    time: 1000,
    text: "测试歌词",
    words: [
      { start: 1000, end: 1200, text: "测试" },
      { start: 1200, end: 1500, text: "歌词" },
    ],
    end: 1500,
    ...overrides,
  };
}

describe("normalizeWordTimes（词级时间轴兜底）", () => {
  it("末词 end 缺失（end==start）时用行末兜底且跨度 > 0", () => {
    const line: ClientLyricLine = {
      time: 0,
      text: "abc",
      words: [
        { start: 0, end: 500, text: "a" },
        { start: 500, end: 500, text: "b" }, // 非法 end
        { start: 800, end: 800, text: "c" }, // 末词无 end
      ],
      end: 1000,
    };
    const words = normalizeWordTimes(line, 1000);
    expect(words[0]).toMatchObject({ start: 0, end: 500 });
    expect(words[1].end).toBe(800); // 用后词 start 兜底
    expect(words[2].end).toBe(1000); // 末词用行末兜底
    expect(words[2].end).toBeGreaterThan(words[2].start);
  });
  it("无词级行返回空数组", () => {
    expect(normalizeWordTimes({ time: 0, text: "x" }, 100)).toHaveLength(0);
  });
});

describe("wrapWords（词级换行不拆词）", () => {
  it("超宽折行：每行宽 ≤ maxWidth 且词保持完整", () => {
    const maxWidth = 50; // 5 字符
    const words = [
      { start: 0, end: 100, text: "AAAA" },
      { start: 100, end: 200, text: "BBBB" },
      { start: 200, end: 300, text: "CC" },
    ];
    const rows = wrapWords(ctx, words, maxWidth);
    // AAAA(40)+BBBB(40)=80 > 50 → BBBB 换行；BBBB(40)+CC(20)=60 > 50 → CC 再换行
    expect(rows.map((r) => r.segs.map((s) => s.text))).toEqual([["AAAA"], ["BBBB"], ["CC"]]);
    expect(rows.every((r) => r.w <= maxWidth || r.segs.length === 1)).toBe(true);
    expect(rows[0].w).toBe(40);
  });
  it("同行可容纳多词：宽度累计不超限时合并", () => {
    const rows = wrapWords(ctx, [
      { start: 0, end: 10, text: "AA" },
      { start: 10, end: 20, text: "BB" },
      { start: 20, end: 30, text: "CC" },
    ], 50);
    // AA(20)+BB(20)=40 ≤ 50 同行；+CC(20)=60 > 50 → CC 换行
    expect(rows.map((r) => r.segs.map((s) => s.text))).toEqual([["AA", "BB"], ["CC"]]);
    expect(rows[0].w).toBe(40);
  });
  it("时间戳随词保留", () => {
    const rows = wrapWords(ctx, [{ start: 10, end: 20, text: "X" }], 100);
    expect(rows[0].segs[0]).toMatchObject({ start: 10, end: 20 });
  });
});

describe("wrapText（行级换行）", () => {
  it("按空白 token 贪心换行", () => {
    const rows = wrapText(ctx, "aaaa bbbb cccc", 80); // 8 字符宽
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) expect(row.w).toBeLessThanOrEqual(80);
    expect(rows.flatMap((r) => r.segs.map((s) => s.text.trim())).filter(Boolean).join("")).toBe("aaaabbbbcccc");
  });
  it("单 token 超宽按字符硬切", () => {
    const rows = wrapText(ctx, "ABCDEFGHIJ", 30); // 3 字符宽
    expect(rows.map((r) => r.segs.map((s) => s.text).join(""))).toEqual(["ABC", "DEF", "GHI", "J"]);
  });
});

describe("buildLineBlocks", () => {
  it("词级行：hasWords=true，行内 seg 保留词级时间", () => {
    const blocks = buildLineBlocks(ctx, [wordLine()], 10, 720);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].hasWords).toBe(true);
    expect(blocks[0].rows[0].segs.map((s) => s.text)).toEqual(["测试", "歌词"]);
    expect(blocks[0].rows[0].segs[0]).toMatchObject({ start: 1000, end: 1200 });
    expect(blocks[0].time).toBe(1000);
    expect(blocks[0].end).toBe(1500);
  });

  it("行级行：多物理行时间按宽度比例分摊（单调递增、首尾对齐行时间）", () => {
    // 90 字符 → 2 行（62 + 28 字符）
    const long = "A".repeat(62) + " " + "B".repeat(28);
    const line: ClientLyricLine = { time: 1000, text: long };
    const blocks = buildLineBlocks(ctx, [line, { time: 5000, text: "next" }], 30, 720);
    const block = blocks[0];
    expect(block.hasWords).toBe(false);
    expect(block.rows.length).toBe(2);
    const r1 = block.rows[0];
    const r2 = block.rows[1];
    expect(r1.segs[0].start).toBe(1000); // 行起始
    expect(r2.segs[r2.segs.length - 1].end).toBeCloseTo(5000, 5); // 行结束（下一行时间）
    // 宽度比例：第一行 62 字符（去掉空白 token 拼接宽度 620），第二行 280；比例 620/900
    expect(r1.segs[0].end).toBeCloseTo(r2.segs[0].start, 5); // 无缝衔接
    const ratio = (r1.segs[0].end - 1000) / (5000 - 1000);
    expect(ratio).toBeGreaterThan(0.6);
    expect(ratio).toBeLessThan(0.72);
  });

  it("副行：罗马音与译文计入高度并超宽截断", () => {
    const line = wordLine({
      romaji: "R".repeat(100), // 100 字符 > 58（(620-40)/10）
      translation: "译",
    });
    const blocks = buildLineBlocks(ctx, [line], 10, 720);
    expect(blocks[0].romaji.endsWith("…")).toBe(true);
    expect(blocks[0].romaji.length).toBeLessThanOrEqual(59);
    expect(blocks[0].translation).toBe("译");
    expect(blocks[0].height).toBe(1 * RENDER_MAIN_ROW_H + 2 * RENDER_SUB_ROW_H + RENDER_BLOCK_PAD);
  });

  it("物理行上限截断到 RENDER_MAX_ROWS", () => {
    const words = Array.from({ length: 40 }, (_, i) => ({
      start: i * 100,
      end: i * 100 + 100,
      text: "W".repeat(10), // 每词 100px，620px/行 → 每行 6 词 → 40 词 ≈ 7 行
    }));
    const line = wordLine({ words, text: words.map((w) => w.text).join("") });
    const blocks = buildLineBlocks(ctx, [line], 60, 720);
    expect(blocks[0].rows.length).toBe(RENDER_MAX_ROWS);
  });

  it("块 end 兜底：末行无下一行时用总时长", () => {
    const line: ClientLyricLine = { time: 1000, text: "x" };
    const blocks = buildLineBlocks(ctx, [line], 60, 720);
    expect(blocks[0].end).toBe(60_000);
  });
});
