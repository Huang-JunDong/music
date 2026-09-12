/**
 * 音源凭证串规范化 — 独立小模块（无内部依赖，供 lib/cookies.ts 与 lib/source-session.ts 共用）。
 *
 * 背景：上游登录接口（如网易 login_qr_check）把响应 Set-Cookie 数组 join 成凭证串，
 * 混入 Max-Age/Expires/Path/Domain 属性段。该串作为浏览器单 cookie 值下发时经
 * encodeURIComponent 编码，name+value 极易突破浏览器 4096 硬上限——Set-Cookie 被浏览器
 * 静默丢弃，表现为"扫码/登录成功但页面显示未登录"。
 */

/**
 * 浏览器单 cookie 的 name+value 总大小硬上限为 4096 字符（RFC 6265 与 Chrome/Firefox 实现）。
 * 扣除 cookie 名（music_dl_src_<source> ≤ 26）、固定属性（Path/HttpOnly/SameSite/Max-Age ≈ 46，
 * https 部署另有 Secure 8）与编码膨胀余量后，凭证值（encodeURIComponent 后）的写入预算取 4000。
 */
const COOKIE_VALUE_BUDGET = 4000;

/** Set-Cookie 属性名（小写）——凭证串混入的属性段剥离目标（非 cookie 键值对） */
const SET_COOKIE_ATTR_NAMES = new Set([
  "max-age", "expires", "path", "domain", "secure", "httponly", "samesite", "priority", "partitioned",
]);

/**
 * 规范化上游凭证串：
 * - 剥离 Set-Cookie 属性段（Max-Age/Expires/Path/Domain 等，对后续上游请求是无意义
 *   键值对，且显著膨胀体积）；
 * - k=v 段同名去重（空值删除指令不覆盖已捕获的有效值，对齐 cookieToJson 语义）；
 *   非 k=v 段（纯 token 形态凭证）原样保留；
 * - 超浏览器上限时按出现顺序丢弃放不下的项（登录态键 MUSIC_U/qqkey 等在上游
 *   响应中居首，天然优先保留）。
 */
export function normalizeSourceCookieString(raw: string): string {
  const merged = new Map<string, string>();
  const plain: string[] = [];
  for (const item of raw.split(";")) {
    const part = item.trim();
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq <= 0) {
      plain.push(part);
      continue;
    }
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (!k || SET_COOKIE_ATTR_NAMES.has(k.toLowerCase())) continue;
    if (!v && merged.get(k)) continue;
    merged.set(k, v);
  }
  const segments: string[] = [];
  for (const [k, v] of merged) {
    if (v) segments.push(`${k}=${v}`);
  }
  segments.push(...plain);
  const parts: string[] = [];
  let used = 0;
  for (const piece of segments) {
    /* 整串经 encodeURIComponent 下发：piece 编码后长度 + 分隔符 "; " 编码后 6 字符 */
    const cost = encodeURIComponent(piece).length + (parts.length ? 6 : 0);
    if (used + cost > COOKIE_VALUE_BUDGET) continue;
    parts.push(piece);
    used += cost;
  }
  return parts.join("; ");
}
