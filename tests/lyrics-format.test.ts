/**
 * 歌词格式化/前端解析测试 — 对齐 Go lyrics_format.go 与 APlayer 渲染语义
 */
import { describe, expect, it } from "vitest";
import { classifyLyricFormat, formatLyricForMode, lyricOriginalLineOnly } from "../lib/lyrics-format";
import { parseLrcClient } from "../lib/lrc-client";

describe("classifyLyricFormat", () => {
  it("行级（每行单时间戳不重复）→ line", () => {
    expect(classifyLyricFormat("[00:01.00]a\n[00:02.00]b")).toBe("line");
  });

  it("tags 行不参与判定", () => {
    expect(classifyLyricFormat("[ti:x]\n[00:01.00]a")).toBe("line");
  });

  it("行内多时间戳 → karaoke（verbatim 词级）", () => {
    expect(classifyLyricFormat("[00:01.00]你[00:01.50]好")).toBe("karaoke");
  });

  it("跨行重复时间戳 → karaoke（orig/ts 同起始交错）", () => {
    expect(classifyLyricFormat("[00:01.00]orig\n[00:01.00]ts")).toBe("karaoke");
  });
});

describe("formatLyricForMode（line 模式）", () => {
  it("去词级时间戳、按时间戳去重（保留首个语言）、排序", () => {
    const raw = "[ti:T]\n[00:02.00]你[00:02.50]好\n[00:01.00]首行\n[00:01.00]译文重复行";
    const out = formatLyricForMode(raw, "line");
    const lines = out.split("\n");
    expect(lines[0]).toBe("[ti:T]");
    expect(lines[1]).toBe(""); // tags 后空行（对齐 Go）
    expect(lines[2]).toBe("[00:01.00]首行");
    expect(lines[3]).toBe("[00:02.00]你好");
    expect(out).not.toContain("译文重复行");
  });

  it("auto 模式原样返回", () => {
    const raw = "[00:01.00]你[00:01.50]好";
    expect(formatLyricForMode(raw, "auto")).toBe(raw);
  });
});

describe("lyricOriginalLineOnly 边界", () => {
  it("纯时间戳行（剥后空文本）被剔除", () => {
    expect(lyricOriginalLineOnly("[00:01.00]")).toBe("");
  });
  it("无时间戳的杂行被剔除", () => {
    expect(lyricOriginalLineOnly("随便一行")).toBe("");
  });
});

describe("parseLrcClient（前端）", () => {
  it("行首连续多时间戳生成多行", () => {
    const lines = parseLrcClient("[00:01.00][00:05.00]副歌");
    expect(lines).toHaveLength(2);
    expect(lines[0].time).toBe(1000);
    expect(lines[1].time).toBe(5000);
    expect(lines[0].text).toBe("副歌");
  });

  it("karaoke 词级行：保留词级片段（start/end/text），text 为拼接全文", () => {
    const lines = parseLrcClient("[00:10.00]你[00:10.50]好[00:11.00]");
    expect(lines).toHaveLength(1);
    expect(lines[0].time).toBe(10_000);
    expect(lines[0].text).toBe("你好");
    expect(lines[0].words?.map((w) => w.text)).toEqual(["你", "好"]);
    expect(lines[0].words?.[0]).toMatchObject({ start: 10_000, end: 10_500 });
    expect(lines[0].words?.[1]).toMatchObject({ start: 10_500, end: 11_000 });
    expect(lines[0].end).toBe(11_000);
  });

  it("“原文（译文）”合并拆分", () => {
    const lines = parseLrcClient("[00:01.00]hello（你好）");
    expect(lines[0].text).toBe("hello");
    expect(lines[0].translation).toBe("你好");
  });

  it("同时间戳独立行归并：roma（拉丁）→ romaji、ts（汉字）→ translation（ConvertVerbatimLRC 输出特征）", () => {
    const lines = parseLrcClient(
      "[ti:T]\n[00:01.00]君が代\n[00:01.00]kimigayo\n[00:01.00]君之代\n[00:05.00]第二行",
    );
    expect(lines).toHaveLength(2);
    expect(lines[0].text).toBe("君が代");
    expect(lines[0].romaji).toBe("kimigayo");
    expect(lines[0].translation).toBe("君之代");
    expect(lines[1].text).toBe("第二行");
    expect(lines[1].translation).toBeUndefined();
  });

  it("词级行 + 同时间戳副行：主行带 words，副行归并（网易云 YRC 实际形态）", () => {
    const lines = parseLrcClient("[00:01.00]你[00:01.50]好\n[00:01.00]ni hao\n[00:01.00]你好呀");
    expect(lines).toHaveLength(1);
    expect(lines[0].words?.length).toBe(2);
    expect(lines[0].romaji).toBe("ni hao");
    expect(lines[0].translation).toBe("你好呀");
  });

  it("纯 tag 行剔除", () => {
    expect(parseLrcClient("[ti:歌名]\n[by:x]")).toHaveLength(0);
  });
});
