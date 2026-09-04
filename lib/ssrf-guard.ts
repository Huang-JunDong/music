/**
 * SSRF 防护（审核整改 A-02）：出站 URL 私网拦截。
 * 仅放行解析到公网地址的 http(s) URL，拦截环回/私网/链路本地/唯一本地/组播/保留段
 * （IPv4 + IPv6 含 v4 映射地址），对齐审核标准 2.4"服务器不得被用作访问内网的开放代理"。
 * 注：hostname 为域名时做 DNS 解析后校验，可在部署时配合 dns 缓存缓解 rebinding 残余风险
 * （完整防 rebinding 需连接级 IP pinning，已登记审核文档为已知边界）。
 */
import dnsPromises from "node:dns/promises";

const IPV4_PRIVATE: { net: number; bits: number }[] = [
  { net: 0x00000000, bits: 8 },  // 0.0.0.0/8 本网络
  { net: 0x0a000000, bits: 8 },  // 10.0.0.0/8 私网 A
  { net: 0x7f000000, bits: 8 },  // 127.0.0.0/8 环回
  { net: 0xa9fe0000, bits: 16 }, // 169.254.0.0/16 链路本地（含云元数据 169.254.169.254）
  { net: 0xac100000, bits: 12 }, // 172.16.0.0/12 私网 B
  { net: 0xc0a80000, bits: 16 }, // 192.168.0.0/16 私网 C
  { net: 0x64400000, bits: 10 }, // 100.64.0.0/10 CGNAT
  { net: 0xc6120000, bits: 15 }, // 198.18.0.0/15 基准测试
];

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // 解析异常按私网拒绝（fail-closed）
  }
  const value = (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0);
  return IPV4_PRIVATE.some(({ net, bits }) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (net & mask);
  });
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("fe80:")) return true; // 链路本地
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 唯一本地
  if (lower.startsWith("ff")) return true; // 组播
  if (lower.startsWith("100::")) return true; // 丢弃前缀 100::/64
  if (lower.startsWith("::ffff:")) {
    // IPv4 映射地址：按内嵌 IPv4 判定
    const v4 = lower.split(":").pop() ?? "";
    return isPrivateIPv4(v4);
  }
  return false;
}

function isPrivateIP(ip: string): boolean {
  return ip.includes(":") ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
}

/**
 * 校验出站 URL 是否允许访问（公网 only）。
 * 返回 null=放行；否则返回拒绝原因（用于 400/403 响应与日志）。
 */
export async function assertPublicHttpUrl(raw: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "invalid url";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "unsupported protocol";
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) return "empty host";

  // 显式 IP 字面量：直接判定
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) {
    return isPrivateIP(host) ? "private address blocked" : null;
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return "private host blocked";
  }

  // 域名：DNS 解析后逐一校验（任一解析结果为私网即拒绝）
  try {
    const records = await dnsPromises.lookup(host, { all: true });
    if (!records.length) return "host unresolved";
    for (const record of records) {
      if (isPrivateIP(record.address)) return "private address blocked";
    }
    return null;
  } catch {
    return "host unresolved";
  }
}
