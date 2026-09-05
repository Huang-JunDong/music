/**
 * 客户端级限流与连接重试 — 对齐 .ref/QQMusicApi Client 的 niquests 配置：
 *  - AsyncTokenBucketLimiter(rate=10, capacity=50)：10 请求/秒，突发容量 50
 *  - RetryConfiguration(connect=2, backoff_factor=0.2)：连接建立失败重试 2 次，指数退避 0.2 * 2^n
 */

import { NetworkError } from "./errors";

/** 异步令牌桶限流器 */
export class TokenBucketLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRatePerSec: number;

  constructor(rate = 10, capacity = 50) {
    this.maxTokens = capacity;
    this.refillRatePerSec = rate;
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    if (elapsedSec <= 0) return;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsedSec * this.refillRatePerSec);
    this.lastRefill = now;
  }

  /** 取一个令牌（不足时等待到可用） */
  async acquire(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const deficit = 1 - this.tokens;
      const waitMs = Math.max(1, Math.ceil((deficit / this.refillRatePerSec) * 1000));
      await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 100)));
    }
  }
}

/** 不限流的空实现（rate/capacity 传 0 时使用） */
export class NoopLimiter {
  async acquire(): Promise<void> {
    /* no-op */
  }
}

export interface Limiter {
  acquire(): Promise<void>;
}

export interface FetchRetryOptions {
  /** 连接失败最大重试次数（默认 2，对齐 connect_retries） */
  retries?: number;
  /** 退避基数秒（默认 0.2，对齐 backoff_factor） */
  backoffFactor?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 带连接重试的 fetch：仅对"连接建立失败类"错误重试（网络错误/中断），
 * HTTP 4xx/5xx 状态码不重试（对齐 niquests connect 重试语义）。
 */
export async function fetchWithRetry(
  input: string,
  init: RequestInit,
  options?: FetchRetryOptions,
): Promise<Response> {
  const retries = options?.retries ?? 2;
  const backoff = options?.backoffFactor ?? 0.2;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(input, init);
    } catch (err) {
      lastError = err;
      // 主动中断不重试
      if (init.signal?.aborted) throw err;
      if (attempt < retries) {
        await sleep(backoff * Math.pow(2, attempt) * 1000);
        continue;
      }
    }
  }
  throw new NetworkError(String((lastError as Error)?.message ?? lastError));
}
