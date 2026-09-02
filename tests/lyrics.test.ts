/**
 * 歌词 verbatim 管线测试 — 对齐 Go lyrics 包行为
 * 覆盖：ParseLRC（词级）/ ParseYRC / ParseKRC（language 多语言）/ ConvertVerbatimLRC / convertKuwoNewLyric
 */
import { describe, expect, it } from "vitest";
import {
  parseLrcVerbatim,
  parseYrcData,
  parseKrcVerbatim,
  convertVerbatimLRC,
  convertKuwoNewLyric,
  formatLrcTime,
} from "../lib/lyrics";

describe("formatLrcTime", () => {
  it("百分秒格式 mm:ss.cc", () => {
    expect(formatLrcTime(0)).toBe("00:00.00");
    expect(formatLrcTime(61_234)).toBe("01:01.23");
    expect(formatLrcTime(-5)).toBe("00:00.00");
  });
});

describe("parseLrcVerbatim", () => {
  it("普通行级 LRC：tags + 行数据", () => {
    const { tags, data } = parseLrcVerbatim("[ti:歌名]\n[ar:歌手]\n\n[00:01.00]第一行\n[00:03.50]第二行\n");
    expect(tags.ti).toBe("歌名");
    expect(tags.ar).toBe("歌手");
    expect(data).toHaveLength(2);
    expect(data[0].start.ms).toBe(1000);
    expect(data[0].words[0].text).toBe("第一行");
    expect(data[1].start.ms).toBe(3500);
  });

  it("毫秒位数归一化：1 位×100、2 位×10", () => {
    const { data } = parseLrcVerbatim("[00:01.5]a\n[00:02.25]b\n[00:03.123]c");
    expect(data[0].start.ms).toBe(1500);
    expect(data[1].start.ms).toBe(2250);
    expect(data[2].start.ms).toBe(3123);
  });

  it("词级 LRC：行内时间戳切词（Go parseLrcWords：词 start = 前一时间戳 end）", () => {
    const { data } = parseLrcVerbatim("[00:10.00][00:10.50]你[00:11.00]好");
    expect(data).toHaveLength(1);
    const words = data[0].words;
    expect(words.map((w) => w.text)).toEqual(["你", "好"]);
    expect(words[0].start.ms).toBe(10_500); // '你' 前最近时间戳 [00:10.50] 的值
    expect(words[0].end.ms).toBe(11_000);
    expect(words[1].start.ms).toBe(11_000); // '好' 跟在 [00:11.00] 后（尾词无 end）
    expect(words[1].end.ok).toBe(false);
  });

  it("行尾推断：无 End 的行以下一行 Start 补齐", () => {
    const { data } = parseLrcVerbatim("[00:01.00]a\n[00:02.00]b");
    expect(data[0].end.ok).toBe(true);
    expect(data[0].end.ms).toBe(2000);
  });
});

describe("parseYrcData", () => {
  it("[start,dur] 行 + (start,dur,0)词", () => {
    const data = parseYrcData("[1000,2000](1000,500,0)你(1500,500,0)好\n[3000,1000](3000,1000,0)呀");
    expect(data).toHaveLength(2);
    expect(data[0].start.ms).toBe(1000);
    expect(data[0].end.ms).toBe(3000);
    expect(data[0].words.map((w) => w.text)).toEqual(["你", "好"]);
    expect(data[0].words[1].end.ms).toBe(2000);
  });

  it("无词标记的行退化为整词", () => {
    const data = parseYrcData("[0,1000]纯文本行");
    expect(data[0].words).toHaveLength(1);
    expect(data[0].words[0].text).toBe("纯文本行");
  });
});

describe("parseKrcVerbatim + language 多语言", () => {
  const krc = [
    "[ti:题目]",
    "[1000,2000]<0,500,0>你<500,500,0>好",
    "[3000,1000]<0,1000,0>呀",
  ].join("\n");

  it("词级时间 = 行 start + offset", () => {
    const { data } = parseKrcVerbatim(krc);
    expect(data.orig).toHaveLength(2);
    expect(data.orig![0].words[0].start.ms).toBe(1000);
    expect(data.orig![0].words[1].start.ms).toBe(1500);
    expect(data.orig![1].words[0].start.ms).toBe(3000);
  });

  it("language tag：type 0=roma 逐词对位 / type 1=ts 整行", () => {
    const payload = {
      content: [
        { type: 0, lyricContent: [["ni", "hao"], ["ya"]] },
        { type: 1, lyricContent: [["你好呀"], ["呀"]] },
      ],
    };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
    const { data } = parseKrcVerbatim(`${krc}\n[language:${encoded}]`);
    expect(data.roma).toHaveLength(2);
    expect(data.roma![0].words.map((w) => w.text)).toEqual(["ni", "hao"]);
    expect(data.ts).toHaveLength(2);
    expect(data.ts![0].words[0].text).toBe("你好呀");
  });
});

describe("convertVerbatimLRC", () => {
  it("tags 头 + orig→roma→ts 交错 + 词级时间戳", () => {
    const out = convertVerbatimLRC(
      { ti: "T", ar: "A" },
      {
        orig: [
          {
            start: { ms: 1000, ok: true },
            end: { ms: 2000, ok: true },
            words: [
              { start: { ms: 1000, ok: true }, end: { ms: 1500, ok: true }, text: "你" },
              { start: { ms: 1500, ok: true }, end: { ms: 2000, ok: true }, text: "好" },
            ],
          },
        ],
        roma: [
          {
            start: { ms: 1000, ok: true },
            end: { ms: 2000, ok: true },
            words: [{ start: { ms: 1000, ok: true }, end: { ms: 2000, ok: true }, text: "ni hao" }],
          },
        ],
        ts: [
          {
            start: { ms: 1000, ok: true },
            end: { ms: 2000, ok: true },
            words: [{ start: { ms: 1000, ok: true }, end: { ms: 2000, ok: true }, text: "译文" }],
          },
        ],
      },
    );
    const lines = out.split("\n");
    expect(lines[0]).toBe("[ti:T]");
    expect(lines[1]).toBe("[ar:A]");
    expect(lines[3]).toBe("[00:01.00]你[00:01.50]好[00:02.00]");
    // Go lineToVerbatimLRC：词带 end 时输出词尾时间戳（roma/ts 整词 end=2000 同样输出）
    expect(lines[4]).toBe("[00:01.00]ni hao[00:02.00]");
    expect(lines[5]).toBe("[00:01.00]译文[00:02.00]");
  });

  it("时间戳相同的语言行按 start 匹配；无文本行跳过", () => {
    const out = convertVerbatimLRC(
      {},
      {
        orig: [{ start: { ms: 0, ok: true }, end: { ms: 0, ok: false }, words: [{ start: { ms: 0, ok: true }, end: { ms: 0, ok: false }, text: "  " }] }],
      },
    );
    expect(out).toBe("");
  });
});

describe("convertKuwoNewLyric", () => {
  it("原文行后追加独立 roma/translation 行，roma 在前", () => {
    const raw = [
      "[id:song]",
      "[00:01.000]<0,500>你<500,500>好",
      "[00:01.000]<0,0>ni hao",
      "[00:01.000]<0,0>你好",
      "[00:03.000]第二行",
    ].join("\n");
    const out = convertKuwoNewLyric(raw);
    const lines = out.split("\n");
    expect(lines[0]).toBe("[id:song]");
    expect(lines[1]).toBe("[00:01.000]你好");
    expect(lines[2]).toBe("[00:01.000]ni hao"); // roma 在前
    expect(lines[3]).toBe("[00:01.000]你好"); // translation
    expect(lines[4]).toBe("[00:03.000]第二行");
  });

  it("主行本身是中文译文 payload 时跳过", () => {
    const out = convertKuwoNewLyric("[00:01.000]<0,0>中文译文行");
    expect(out).toBe("");
  });
});
