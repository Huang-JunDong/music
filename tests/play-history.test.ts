/**
 * 播放历史测试（审核整改 P3-4 / P1-1 / P2-1 锚定）：
 * 纯函数（sanitize / sid 校验 / extra 解码）+ 会话隔离行为（getDB mock 为
 * better-sqlite3 :memory:，对齐 source-session.test.ts 的 vi.mock 模式，不触真实 app.db）。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";

let db: Database.Database;

vi.mock("@/lib/store", () => ({
  getDB: () => db,
}));

import {
  PLAY_HISTORY_LIMIT,
  clearPlayHistory,
  decodeExtraMap,
  isValidHistorySid,
  listPlayHistory,
  recordPlayHistory,
  sanitizePlayHistoryBody,
} from "../lib/play-history";

const SID_A = "11111111-1111-4111-8111-111111111111";
const SID_B = "22222222-2222-4222-8222-222222222222";

function song(id: string, name = `歌-${id}`) {
  return { id, source: "netease", name, artist: "歌手", duration: 180 };
}

/* 单实例内存库复用（play-history 模块级语句缓存绑定首个 db 实例，重建会导致写读漂移）；
 * 每用例仅清空表数据 */
beforeAll(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE play_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_key TEXT NOT NULL DEFAULT '',
      song_id TEXT NOT NULL,
      source TEXT NOT NULL,
      extra TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      artist TEXT NOT NULL DEFAULT '',
      cover TEXT NOT NULL DEFAULT '',
      duration INTEGER NOT NULL DEFAULT 0,
      played_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_play_history_sid ON play_history(session_key, id);
  `);
});

beforeEach(() => {
  db.prepare("DELETE FROM play_history").run();
});

describe("sanitizePlayHistoryBody（P2-1：类型校验防 500）", () => {
  it("非对象 / 缺 id 或 source / 非字符串 → null", () => {
    expect(sanitizePlayHistoryBody(null)).toBeNull();
    expect(sanitizePlayHistoryBody([1, 2])).toBeNull();
    expect(sanitizePlayHistoryBody({ source: "netease" })).toBeNull();
    expect(sanitizePlayHistoryBody({ id: 123, source: "netease" })).toBeNull();
    expect(sanitizePlayHistoryBody({ id: "x", source: 42 })).toBeNull();
    expect(sanitizePlayHistoryBody({ id: "  ", source: "netease" })).toBeNull();
  });

  it("类型非法字段静默归默认（不抛 .trim()/NaN 绑定错误）", () => {
    const out = sanitizePlayHistoryBody({ id: "x", source: "y", name: 123, artist: {}, cover: true, duration: {}, size: "big", ext: null });
    expect(out).not.toBeNull();
    expect(out!.name).toBe("");
    expect(out!.artist).toBe("");
    expect(out!.cover).toBe("");
    expect(out!.duration).toBe(0);
    expect(out!.size).toBe(0);
    expect(out!.ext).toBeUndefined();
  });

  it("正常字段透传，extra 仅保留字符串值", () => {
    const out = sanitizePlayHistoryBody({ id: " x ", source: " y ", name: "n", artist: "a", duration: 1.5, extra: { k: "v", n: 1, b: null } });
    expect(out).toEqual({ id: "x", source: "y", name: "n", artist: "a", album: "", album_id: undefined, cover: "", duration: 1.5, link: "", size: 0, bitrate: 0, ext: undefined, extra: { k: "v" } });
  });

  it("负数 / NaN / Infinity 数值归零", () => {
    const out = sanitizePlayHistoryBody({ id: "x", source: "y", duration: -5, size: Number.NaN, bitrate: Number.POSITIVE_INFINITY });
    expect(out!.duration).toBe(0);
    expect(out!.size).toBe(0);
    expect(out!.bitrate).toBe(0);
  });
});

describe("isValidHistorySid", () => {
  it("接受合法 UUID；拒绝空串 / 大写 / 非法字符 / 非字符串", () => {
    expect(isValidHistorySid(SID_A)).toBe(true);
    expect(isValidHistorySid("")).toBe(false);
    expect(isValidHistorySid("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA")).toBe(false);
    expect(isValidHistorySid("not-a-sid")).toBe(false);
    expect(isValidHistorySid("'; DROP TABLE play_history;--")).toBe(false);
    expect(isValidHistorySid(42)).toBe(false);
    expect(isValidHistorySid(undefined)).toBe(false);
  });
});

describe("decodeExtraMap", () => {
  it("空串 / 非法 JSON / 数组 / 非对象返回空 map", () => {
    expect(decodeExtraMap("")).toEqual({});
    expect(decodeExtraMap("   ")).toEqual({});
    expect(decodeExtraMap("not json")).toEqual({});
    expect(decodeExtraMap("[1,2]")).toEqual({});
    expect(decodeExtraMap("null")).toEqual({});
  });

  it("字符串直通，有限数值字符串化，其余丢弃", () => {
    expect(decodeExtraMap('{"a":"x","n":3.5,"b":null,"c":true}')).toEqual({ a: "x", n: "3.5" });
  });
});

describe("会话隔离（P1-1）", () => {
  it("会话 A 的记录对会话 B 不可见", () => {
    recordPlayHistory(SID_A, song("1"));
    recordPlayHistory(SID_A, song("2"));
    expect(listPlayHistory(SID_A).map((s) => s.id)).toEqual(["2", "1"]);
    expect(listPlayHistory(SID_B)).toEqual([]);
  });

  it("非法会话键拒绝读写清（服务层兜底）", () => {
    recordPlayHistory("'; DROP TABLE play_history;--", song("1"));
    recordPlayHistory("", song("1"));
    expect(listPlayHistory("'; DROP TABLE play_history;--")).toEqual([]);
    expect(listPlayHistory("")).toEqual([]);
    expect(() => clearPlayHistory("bad")).not.toThrow();
    /* 表未被破坏 */
    recordPlayHistory(SID_A, song("1"));
    expect(listPlayHistory(SID_A).length).toBe(1);
  });

  it("clearPlayHistory 只清本会话", () => {
    recordPlayHistory(SID_A, song("1"));
    recordPlayHistory(SID_B, song("2"));
    clearPlayHistory(SID_A);
    expect(listPlayHistory(SID_A)).toEqual([]);
    expect(listPlayHistory(SID_B).map((s) => s.id)).toEqual(["2"]);
  });
});

describe("记录行为", () => {
  it("同源同曲重播去重置顶（不产生重复行）", () => {
    recordPlayHistory(SID_A, song("1"));
    recordPlayHistory(SID_A, song("2"));
    recordPlayHistory(SID_A, song("1"));
    const list = listPlayHistory(SID_A);
    expect(list.length).toBe(2);
    expect(list[0].id).toBe("1");
  });

  it("超上限裁剪最旧（单会话 100 条）", () => {
    for (let i = 0; i < PLAY_HISTORY_LIMIT + 5; i++) recordPlayHistory(SID_A, song(`s${i}`));
    const list = listPlayHistory(SID_A);
    expect(list.length).toBe(PLAY_HISTORY_LIMIT);
    expect(list[0].id).toBe(`s${PLAY_HISTORY_LIMIT + 4}`);
    expect(list[list.length - 1].id).toBe("s5");
  });

  it("duration 非法（NaN）落库为 0 不抛错（P2-1 服务层双保险）", () => {
    const bad = { ...song("1"), duration: Number.NaN } as unknown as { id: string; source: string; duration: number };
    expect(() => recordPlayHistory(SID_A, bad)).not.toThrow();
    expect(listPlayHistory(SID_A)[0].duration).toBe(0);
  });

  it("roundtrip：extra 字段（album/link/size/bitrate）写入后可恢复", () => {
    recordPlayHistory(SID_A, {
      id: "1", source: "qq", name: "n", artist: "a", album: "al", album_id: "aid",
      cover: "http://c/1.png", duration: 240, link: "http://l/1.flac", size: 2048, bitrate: 999, ext: "flac",
    });
    const [s] = listPlayHistory(SID_A);
    expect(s.album).toBe("al");
    expect(s.album_id).toBe("aid");
    expect(s.link).toBe("http://l/1.flac");
    expect(s.size).toBe(2048);
    expect(s.bitrate).toBe(999);
    expect(s.ext).toBe("flac");
    expect(s.extra?.album).toBe("al");
  });

  it("超保留期（90 天）的旧行在下次写入时被兜底清理", () => {
    recordPlayHistory(SID_A, song("old"));
    db.prepare("UPDATE play_history SET played_at = datetime('now', '-100 days') WHERE session_key = ?").run(SID_A);
    recordPlayHistory(SID_A, song("new"));
    const list = listPlayHistory(SID_A);
    expect(list.map((s) => s.id)).toEqual(["new"]);
  });
});
