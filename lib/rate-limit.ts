/**
 * 进程内速率限制（审核整改 A-11）：滑动窗口计数器，按 key（通常为 IP 或 IP+路径类）。
 * 轻量内存实现（Map 惰性清理），适用单实例部署；多实例部署需换共享存储（已登记审核文档）。
 */

interface WindowBucket {
  at: number;
  count: number;
}

const buckets = new Map<string, WindowBucket>();
const MAX_BUCKETS = 50_000;

/** 周期性修剪过期桶，防止 key 无限增长 */
function sweep(now: number, windowMs: number): void {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (now - bucket.at > windowMs) buckets.delete(key);
  }
}

/**
 * 尝试通过限流：窗口内未超限则计数 +1 并返回 true，否则返回 false。
 * @param key 维度键（如 `cover:1.2.3.4`）
 * @param limit 窗口内允许的最大次数
 * @param windowMs 窗口长度（毫秒）
 */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  sweep(now, windowMs);
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.at > windowMs) {
    buckets.set(key, { at: now, count: 1 });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

/** 提取客户端 IP（x-forwarded-for 首段优先）。
 *  审核整改 P2-01：XFF 可被客户端伪造——生产部署必须置于可信反向代理之后，
 *  由代理覆写 x-forwarded-for/x-real-ip（README「反向代理与限流」）；无代理直连暴露时
 *  限流维度可被伪造头绕过（qr_login 等按 IP 限流接口）。 */
export function requestIP(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}
