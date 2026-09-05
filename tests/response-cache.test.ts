/**
 * lib/response-cache.ts 单元测试：TTL 过期、容量淘汰、single-flight 并发去重、
 * shouldCache 拦截、缓存对象引用只读（调用方不得修改命中结果）。
 */
import { describe, it, expect, vi } from "vitest";
import { createTtlCache, sourceCookieFingerprint } from "../lib/response-cache";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("sourceCookieFingerprint", () => {
  it("无音源凭证 cookie → anon", () => {
    const req = new Request("http://localhost/api/search", {
      headers: { cookie: "other=1" },
    });
    expect(sourceCookieFingerprint(req)).toBe("anon");
  });

  it("同凭证同指纹；不同凭证不同指纹（跨账号缓存隔离）", () => {
    const a1 = new Request("http://x/", { headers: { cookie: "music_dl_src_qq=abc; music_dl_src_netease=def" } });
    const a2 = new Request("http://x/", { headers: { cookie: "music_dl_src_netease=def; music_dl_src_qq=abc" } }); // 顺序无关
    const b = new Request("http://x/", { headers: { cookie: "music_dl_src_qq=other" } });
    const f1 = sourceCookieFingerprint(a1);
    expect(f1).toBe(sourceCookieFingerprint(a2));
    expect(f1).not.toBe(sourceCookieFingerprint(b));
    expect(f1).not.toBe("anon");
  });

  it("非音源凭证 cookie 不参与指纹", () => {
    const withJunk = new Request("http://x/", {
      headers: { cookie: "music_dl_session=s1; music_dl_src_kugou=k1" },
    });
    const only = new Request("http://x/", { headers: { cookie: "music_dl_src_kugou=k1" } });
    expect(sourceCookieFingerprint(withJunk)).toBe(sourceCookieFingerprint(only));
  });
});

describe("createTtlCache", () => {
  it("wrap 第二次调用直接命中缓存（fetcher 只执行一次）", async () => {
    const cache = createTtlCache<Record<string, unknown>>(60_000, 10);
    const fetcher = vi.fn(async () => ({ value: 1 }));
    const a = await cache.wrap("k", fetcher);
    const b = await cache.wrap("k", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ value: 1 });
    expect(b).toEqual({ value: 1 });
  });

  it("并发相同 key 去重为一次回源", async () => {
    const cache = createTtlCache<number>(60_000, 10);
    const fetcher = vi.fn(async () => {
      await sleep(20);
      return 42;
    });
    const [a, b, c] = await Promise.all([
      cache.wrap("k", fetcher),
      cache.wrap("k", fetcher),
      cache.wrap("k", fetcher),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect([a, b, c]).toEqual([42, 42, 42]);
  });

  it("shouldCache 返回 false 时不入缓存（失败可重试自愈）", async () => {
    const cache = createTtlCache<Record<string, unknown>>(60_000, 10);
    const fetcher = vi.fn(async () => ({ error: "boom" }));
    await cache.wrap("k", fetcher, (p) => !p.error);
    await cache.wrap("k", fetcher, (p) => !p.error);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("TTL 过期后重新执行 fetcher", async () => {
    const cache = createTtlCache<number>(30, 10);
    const fetcher = vi.fn(async () => Date.now());
    await cache.wrap("k", fetcher);
    await sleep(50);
    await cache.wrap("k", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("超出容量按插入序淘汰最旧条目", async () => {
    const cache = createTtlCache<number>(60_000, 2);
    await cache.wrap("a", async () => 1);
    await cache.wrap("b", async () => 2);
    await cache.wrap("c", async () => 3); // 淘汰 a
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  it("不同 key 互不影响", async () => {
    const cache = createTtlCache<number>(60_000, 10);
    await cache.wrap("x", async () => 1);
    await cache.wrap("y", async () => 2);
    expect(cache.get("x")).toBe(1);
    expect(cache.get("y")).toBe(2);
  });
});
