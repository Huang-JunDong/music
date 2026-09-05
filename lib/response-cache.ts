/**
 * 进程内 JSON 响应缓存（短 TTL + 容量上限 + single-flight 并发去重）。
 * 用途：多源聚合接口（search/playlist/album/recommend）重复触发时零回源，
 * 避免上游突发放大（限流/熔断雪崩）；封面类二进制缓存见 cover_proxy 路由内置实现。
 *
 * 注意：这些接口经 withBrowserSourceSession 包装，结果可能随浏览器音源凭证变化，
 * 缓存键必须拼上 sourceCookieFingerprint，防止跨账号串数据。
 */
import { createHash } from "node:crypto";
import { browserSourceCookies } from "./source-session";

/** 请求携带的音源凭证指纹（无凭证 → "anon"）：同凭证共享缓存，不同凭证隔离 */
export function sourceCookieFingerprint(req: Request): string {
  const cookies = browserSourceCookies(req);
  const keys = Object.keys(cookies);
  if (!keys.length) return "anon";
  const raw = keys.sort().map((k) => `${k}=${cookies[k]}`).join("&");
  return createHash("sha1").update(raw).digest("hex").slice(0, 16);
}

export interface TtlCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  /** 缓存命中直接返回；miss 时并发去重执行 fetcher，shouldCache 判定是否入缓存 */
  wrap(key: string, fetcher: () => Promise<T>, shouldCache?: (value: T) => boolean): Promise<T>;
}

export function createTtlCache<T>(ttlMs: number, maxEntries: number): TtlCache<T> {
  const store = new Map<string, { value: T; at: number }>();
  const inflight = new Map<string, Promise<T>>();

  function get(key: string): T | undefined {
    const hit = store.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > ttlMs) {
      store.delete(key);
      return undefined;
    }
    // Map 按插入序维护近似 LRU
    store.delete(key);
    store.set(key, hit);
    return hit.value;
  }

  function set(key: string, value: T): void {
    const prev = store.get(key);
    if (prev) store.delete(key);
    store.set(key, { value, at: Date.now() });
    while (store.size > maxEntries) {
      const oldest = store.keys().next().value as string;
      store.delete(oldest);
    }
  }

  async function wrap(key: string, fetcher: () => Promise<T>, shouldCache?: (value: T) => boolean): Promise<T> {
    const hit = get(key);
    if (hit !== undefined) return hit;
    let flight = inflight.get(key);
    if (!flight) {
      flight = fetcher()
        .then((value) => {
          if (!shouldCache || shouldCache(value)) set(key, value);
          return value;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, flight);
    }
    return flight;
  }

  return { get, set, wrap };
}
