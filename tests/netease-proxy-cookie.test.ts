/**
 * 审核整改 P1-01 锚定：netease 代理"显式传 cookie"的请求一律不写全局凭证库
 * （防任意访客经 ?cookie= 触发上游 Set-Cookie 覆盖全局兜底账号）；
 * 同时锚定多用户会话改道回写（浏览器自带凭证时刷新经 Set-Cookie 回本浏览器）。
 * SQLite 经 vi.mock("@/lib/store") 替换为内存 Map；上游模块经 registry mock 固定返回 MUSIC_U。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { NextRequest } from "next/server";

const dbMock = vi.hoisted(() => {
  const state = {
    rows: new Map<string, string>(),
    writes: [] as Array<{ kind: "upsert" | "delete"; source: string; value?: string }>,
  };
  const db = {
    prepare(sql: string) {
      if (/SELECT cookie FROM cookies WHERE/.test(sql)) {
        return { get: (...a: unknown[]) => ({ cookie: state.rows.get(String(a[0])) ?? "" }) };
      }
      if (/SELECT source, cookie FROM cookies/.test(sql)) {
        return {
          all: () => [...state.rows.entries()].map(([source, cookie]) => ({ source, cookie })),
        };
      }
      if (/INSERT INTO cookies/.test(sql)) {
        return {
          run: (...a: unknown[]) => {
            state.writes.push({ kind: "upsert", source: String(a[0]), value: String(a[1]) });
            state.rows.set(String(a[0]), String(a[1]));
          },
        };
      }
      if (/DELETE FROM cookies/.test(sql)) {
        return {
          run: (...a: unknown[]) => {
            state.writes.push({ kind: "delete", source: String(a[0]) });
            state.rows.delete(String(a[0]));
          },
        };
      }
      return { get: () => ({ c: 1 }), all: () => [] as unknown[], run: () => {} };
    },
    transaction: (fn: () => void) => () => fn(),
  };
  return { state, getDB: () => db };
});

vi.mock("@/lib/store", () => ({ getDB: dbMock.getDB }));

/* 上游模块固定返回带 MUSIC_U 的 Set-Cookie（触发 mergeStoredCookie 写库路径） */
vi.mock("@/lib/netease/registry", () => ({
  resolveRoute: () => ({
    name: "test_module",
    module: async () => ({
      status: 200,
      body: { code: 200, ok: true },
      cookie: ["MUSIC_U=token-abc; Path=/; Max-Age=15552000"],
    }),
  }),
  MODULES: {},
  MODULE_COUNT: 1,
}));
vi.mock("@/lib/netease/logger", () => ({ logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }));
vi.mock("@/lib/netease/unblock", () => ({ matchID: vi.fn() }));
vi.mock("@/lib/netease/request", () => ({ createRequest: vi.fn() }));

import { GET } from "@/app/api/netease/[...path]/route";

beforeAll(() => {
  vi.spyOn(fs, "existsSync").mockReturnValue(false);
});

beforeEach(() => {
  dbMock.state.rows.clear();
  dbMock.state.writes.length = 0;
});

const ctx = (p: string) => ({ params: Promise.resolve({ path: [p] }) });

describe("P1-01：显式 cookie 不写全局库", () => {
  it("?cookie= 请求：上游 MUSIC_U 刷新不落 SQLite（全局兜底凭证不可被访客覆盖）", async () => {
    const req = new NextRequest(
      "http://localhost/api/netease/p1?cookie=" + encodeURIComponent("MUSIC_U=mine; os=pc"),
    );
    const res = await GET(req, ctx("p1"));
    expect(res.status).toBe(200);
    expect(dbMock.state.writes.length).toBe(0);
  });
});

describe("原行为保持：非显式请求的登录态闭环", () => {
  it("无显式 cookie、无浏览器凭证：全局 cookie 的上游刷新照常落库", async () => {
    dbMock.state.rows.set("netease", "os=pc");
    const res = await GET(new NextRequest("http://localhost/api/netease/p2"), ctx("p2"));
    expect(res.status).toBe(200);
    expect(dbMock.state.writes).toEqual([
      { kind: "upsert", source: "netease", value: expect.stringContaining("MUSIC_U=token-abc") },
    ]);
  });
});

describe("多用户会话改道回写", () => {
  it("浏览器自带 music_dl_src_netease：刷新合并后经 HttpOnly Set-Cookie 回本浏览器，不写库", async () => {
    const req = new NextRequest("http://localhost/api/netease/p3", {
      headers: { cookie: "music_dl_src_netease=" + encodeURIComponent("MUSIC_U=browser-sess; os=pc") },
    });
    const res = await GET(req, ctx("p3"));
    expect(res.status).toBe(200);
    expect(dbMock.state.writes.length).toBe(0);
    const setCookies = res.headers.getSetCookie();
    expect(
      setCookies.some(
        (c) => c.startsWith("music_dl_src_netease=") && c.includes("HttpOnly") && decodeURIComponent(c).includes("MUSIC_U=token-abc"),
      ),
    ).toBe(true);
  });
});
