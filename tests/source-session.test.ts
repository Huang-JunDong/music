/**
 * 审核整改 P2-03：浏览器级音源凭证会话（lib/source-session.ts + lib/cookies.ts 写分流）单测。
 * SQLite 经 vi.mock("@/lib/store") 替换为内存 Map（仅覆盖会话/分流分支，不触真实 app.db）；
 * fs.existsSync 恒 false 阻断 cookies.json 迁移探测。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import type { NextRequest } from "next/server";

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
      /* SELECT COUNT(*)（迁移探测）：返回非空表跳过迁移 */
      return { get: () => ({ c: 1 }), all: () => [] as unknown[], run: () => {} };
    },
    transaction: (fn: () => void) => () => fn(),
  };
  return { state, getDB: () => db };
});

vi.mock("@/lib/store", () => ({ getDB: dbMock.getDB }));

import {
  createSourceSessionStore,
  getAllCookies,
  getCookie,
  runWithSourceSession,
  setAllCookies,
} from "@/lib/cookies";
import {
  browserSourceCookies,
  requestIsHttps,
  srcSessionClearCookie,
  srcSessionCookieName,
  srcSessionSetCookie,
  srcSessionSource,
  withBrowserSourceSession,
} from "@/lib/source-session";

beforeAll(() => {
  vi.spyOn(fs, "existsSync").mockReturnValue(false);
});

beforeEach(() => {
  dbMock.state.rows.clear();
  dbMock.state.writes.length = 0;
});

/* ---------------- browserSourceCookies：cookie 头解析（白名单/解码/容错） ---------------- */

describe("browserSourceCookies", () => {
  it("提取白名单源并 decodeURIComponent 解码", () => {
    const req = new Request("http://localhost/", {
      headers: { cookie: "music_dl_src_netease=MUSIC_U%3Dabc%3Bos%3Dpc; music_dl_src_qq=qqkey" },
    });
    expect(browserSourceCookies(req)).toEqual({ netease: "MUSIC_U=abc;os=pc", qq: "qqkey" });
  });

  it("白名单外源与其他 cookie 名一律忽略", () => {
    const req = new Request("http://localhost/", {
      headers: { cookie: "music_dl_src_evil=1; music_dl_session=sig; other=x; music_dl_src_=v" },
    });
    expect(browserSourceCookies(req)).toEqual({});
  });

  it("非法百分号编码与空值忽略（不抛错）", () => {
    const req = new Request("http://localhost/", {
      headers: { cookie: "music_dl_src_netease=%E4%A8; music_dl_src_qq=" },
    });
    expect(browserSourceCookies(req)).toEqual({});
  });

  it("无前缀等号（空源名）忽略", () => {
    const req = new Request("http://localhost/", {
      headers: { cookie: "music_dl_src_=value" },
    });
    expect(browserSourceCookies(req)).toEqual({});
  });

  it("空 cookie 头返回空对象", () => {
    expect(browserSourceCookies(new Request("http://localhost/"))).toEqual({});
  });
});

/* ---------------- 源名归并与 Set-Cookie 格式 ---------------- */

describe("srcSessionSource / srcSessionCookieName", () => {
  it("qq_wx 归并为 qq（对齐服务端存储约定）", () => {
    expect(srcSessionSource("qq_wx")).toBe("qq");
    expect(srcSessionSource("netease")).toBe("netease");
  });

  it("cookie 名带 music_dl_src_ 前缀", () => {
    expect(srcSessionCookieName("netease")).toBe("music_dl_src_netease");
  });
});

describe("srcSessionSetCookie / srcSessionClearCookie", () => {
  it("下发头含 HttpOnly / SameSite=Lax / Path=/ / 90 天 Max-Age，值经编码", () => {
    const header = srcSessionSetCookie("netease", "MUSIC_U=abc; os=pc");
    expect(header.startsWith("music_dl_src_netease=MUSIC_U%3Dabc%3B%20os%3Dpc")).toBe(true);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toContain(`Max-Age=${90 * 24 * 3600}`);
  });

  it("清除头 Max-Age=0 且值为空", () => {
    const header = srcSessionClearCookie("qq");
    expect(header.startsWith("music_dl_src_qq=;")).toBe(true);
    expect(header).toContain("Max-Age=0");
    expect(header).toContain("HttpOnly");
  });

  it("secure=true 时附 Secure，默认不附（审核整改 P2-02）", () => {
    expect(srcSessionSetCookie("netease", "v", true)).toContain("Secure");
    expect(srcSessionSetCookie("netease", "v", false)).not.toContain("Secure");
    expect(srcSessionSetCookie("netease", "v")).not.toContain("Secure");
  });
});

describe("requestIsHttps", () => {
  it("x-forwarded-proto 首段判定（大小写不敏感、多级代理取首段）", () => {
    expect(requestIsHttps(new Request("http://l/", { headers: { "x-forwarded-proto": "HTTPS, http" } }))).toBe(true);
    expect(requestIsHttps(new Request("http://l/", { headers: { "x-forwarded-proto": "http" } }))).toBe(false);
  });

  it("无代理头时按 URL 协议判定", () => {
    expect(requestIsHttps(new Request("https://l/"))).toBe(true);
    expect(requestIsHttps(new Request("http://l/"))).toBe(false);
  });

  it("https 请求经 withBrowserSourceSession 回写的凭证附 Secure", async () => {
    const req = new Request("https://l/api/lyric", {
      headers: { cookie: "music_dl_src_netease=browser-sess" },
    });
    const res = await withBrowserSourceSession(req as unknown as NextRequest, async () => {
      const { setAllCookies } = await import("@/lib/cookies");
      setAllCookies({ netease: "refreshed" }); // 模拟 provider 内部刷新 → 改道回写
      return new Response("{}", { headers: { "content-type": "application/json" } });
    });
    const setCookies = res.headers.getSetCookie();
    expect(setCookies.some((c) => c.startsWith("music_dl_src_netease=refreshed") && c.includes("Secure"))).toBe(true);
  });
});

/* ---------------- createSourceSessionStore：构造清洗 ---------------- */

describe("createSourceSessionStore", () => {
  it("trim 键值并丢弃空键/空值", () => {
    const store = createSourceSessionStore(
      { " netease ": " MUSIC_U=1 ", qq: "", " ": "x", kugou: "   " },
      false,
    );
    expect([...store.values.entries()]).toEqual([["netease", "MUSIC_U=1"]]);
    expect(store.suppressWrites).toBe(false);
    expect(store.pendingWrites.size).toBe(0);
  });
});

/* ---------------- 写分流（lib/cookies.ts）：会话优先 / pendingWrites / DB 兜底 ---------------- */

describe("会话内 getCookie / getAllCookies", () => {
  it("浏览器凭证命中时优先于 SQLite 且不触库", () => {
    dbMock.state.rows.set("netease", "global-cookie");
    const store = createSourceSessionStore({ netease: "browser-cookie" }, false);
    const value = runWithSourceSession(store, () => getCookie("netease"));
    expect(value).toBe("browser-cookie");
    expect(dbMock.state.writes.length).toBe(0);
  });

  it("未命中的源回退 SQLite", () => {
    dbMock.state.rows.set("qq", "db-qq");
    const store = createSourceSessionStore({ netease: "browser-cookie" }, false);
    expect(runWithSourceSession(store, () => getCookie("qq"))).toBe("db-qq");
  });

  it("DB 历史数据混入 Set-Cookie 属性段时读取即净化（MUSIC_U 保留、属性剥离）", () => {
    dbMock.state.rows.set(
      "netease",
      "MUSIC_U=abc; Max-Age=31536000; Expires=Sun, 12 Sep 2027 00:00:00 GMT; Path=/; Domain=.music.163.com; __csrf=x",
    );
    expect(getCookie("netease")).toBe("MUSIC_U=abc; __csrf=x");
  });

  it("getAllCookies 的 DB 行同样净化", () => {
    dbMock.state.rows.set("qq", "uin=1; Path=/; Max-Age=1");
    const store = createSourceSessionStore({ netease: "browser" }, false);
    const all = runWithSourceSession(store, () => getAllCookies());
    expect(all.qq).toBe("uin=1");
    expect(all.netease).toBe("browser");
  });

  it("getAllCookies：DB 行与会话覆盖值合并（会话优先）", () => {
    dbMock.state.rows.set("netease", "global");
    dbMock.state.rows.set("qq", "db-qq");
    const store = createSourceSessionStore({ netease: "browser" }, false);
    const all = runWithSourceSession(store, () => getAllCookies());
    expect(all).toEqual({ netease: "browser", qq: "db-qq" });
  });
});

describe("setAllCookies 写分流", () => {
  it("会话外：正常落库（upsert 非空、空值转 delete）", () => {
    setAllCookies({ netease: "n1", kugou: "" });
    expect(dbMock.state.writes).toEqual([
      { kind: "upsert", source: "netease", value: "n1" },
      { kind: "delete", source: "kugou" },
    ]);
  });

  it("浏览器自带源改道 pendingWrites，其余源仍落库（全局配置不受访客影响）", () => {
    dbMock.state.rows.set("netease", "old-global");
    const store = createSourceSessionStore({ netease: "browser" }, false);
    runWithSourceSession(store, () => setAllCookies({ netease: "refreshed", kugou: "k2" }));
    expect(store.pendingWrites.get("netease")).toBe("refreshed");
    expect(dbMock.state.writes).toEqual([{ kind: "upsert", source: "kugou", value: "k2" }]);
    expect(dbMock.state.rows.get("netease")).toBe("old-global");
  });

  it("suppressWrites=true：全部改道，不触库", () => {
    const store = createSourceSessionStore({}, true);
    runWithSourceSession(store, () => setAllCookies({ netease: "n", qq: "q" }));
    expect(store.pendingWrites.get("netease")).toBe("n");
    expect(store.pendingWrites.get("qq")).toBe("q");
    expect(dbMock.state.writes.length).toBe(0);
  });

  it("改道写入空串表示清除（pendingWrites 空值语义）", () => {
    const store = createSourceSessionStore({ netease: "browser" }, false);
    runWithSourceSession(store, () => setAllCookies({ netease: "" }));
    expect(store.pendingWrites.get("netease")).toBe("");
    expect(dbMock.state.writes.length).toBe(0);
  });
});

/* ---------------- withBrowserSourceSession：路由包装集成 ---------------- */

describe("withBrowserSourceSession", () => {
  it("浏览器凭证注入会话并优先于全局；改道写入经 Set-Cookie 回写响应", async () => {
    dbMock.state.rows.set("netease", "global");
    const req = new Request("http://localhost/api/lyric", {
      headers: { cookie: "music_dl_src_netease=browser-sess" },
    });
    const res = await withBrowserSourceSession(req as unknown as NextRequest, async () => {
      const effective = getCookie("netease");
      setAllCookies({ netease: "refreshed-by-upstream" }); // provider 内部刷新 → 改道
      return new Response(JSON.stringify({ effective }), { headers: { "content-type": "application/json" } });
    });
    expect(await res.json()).toEqual({ effective: "browser-sess" });
    expect(dbMock.state.writes.length).toBe(0); // 全局库未被触碰
    const setCookies = res.headers.getSetCookie();
    expect(setCookies.some((c) => c.startsWith("music_dl_src_netease=refreshed-by-upstream") && c.includes("HttpOnly"))).toBe(true);
  });

  it("无浏览器凭证时行为与不包装一致（全局兜底），无 Set-Cookie 附加", async () => {
    dbMock.state.rows.set("netease", "global");
    const req = new Request("http://localhost/api/lyric");
    const res = await withBrowserSourceSession(req as unknown as NextRequest, async () =>
      new Response(JSON.stringify({ effective: getCookie("netease") }), {
        headers: { "content-type": "application/json" },
      }),
    );
    expect(await res.json()).toEqual({ effective: "global" });
    expect(res.headers.getSetCookie().length).toBe(0);
  });
});
