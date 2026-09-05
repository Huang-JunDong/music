/**
 * 生成 data/china_ip_ranges.txt — 中国大陆 IPv4 CIDR 段表（netease 随机国内 IP 用）。
 * 数据源：APNIC delegated stats（官方每日更新）。
 * 用法：node scripts/gen-china-ip-ranges.mjs   （可重复执行刷新）
 * 注意：文件顶格 # 注释行会被 lib/netease/utils.ts loadChinaIPRanges() 跳过。
 */
import fs from "node:fs";
import path from "node:path";

const SOURCE = "https://ftp.apnic.net/apnic/stats/apnic/delegated-apnic-latest";
const OUT = path.join(process.cwd(), "data", "china_ip_ranges.txt");

const ipToInt = (ip) =>
  ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;

const intToIp = (n) =>
  [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");

/** 起始地址 + 地址数 → 对齐 CIDR 块列表（非 2^n 对齐的段自动拆分） */
function toCIDRs(startInt, count) {
  const out = [];
  let s = startInt >>> 0;
  let remaining = count;
  while (remaining > 0) {
    const maxByAlign = s === 0 ? 1 << 30 : s & -s; // 起始地址的对齐粒度
    const maxByRem = 1 << Math.floor(Math.log2(remaining)); // 剩余数量内最大 2^n
    const size = Math.min(maxByAlign, maxByRem);
    out.push(`${intToIp(s)}/${32 - Math.round(Math.log2(size))}`);
    s += size;
    remaining -= size;
  }
  return out;
}

console.log(`fetching ${SOURCE} ...`);
const res = await fetch(SOURCE);
if (!res.ok) {
  console.error(`fetch failed: HTTP ${res.status}`);
  process.exit(1);
}
const text = await res.text();

const cidrs = [];
for (const line of text.split("\n")) {
  // apnic|CN|ipv4|start|count|date|status
  const parts = line.split("|");
  if (parts.length < 5 || parts[0] !== "apnic" || parts[1] !== "CN" || parts[2] !== "ipv4") continue;
  const start = parts[3];
  const count = Number(parts[4]);
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(start) || !Number.isInteger(count) || count <= 0) continue;
  cidrs.push(...toCIDRs(ipToInt(start), count));
}

if (!cidrs.length) {
  console.error("no CN ipv4 records parsed — aborting");
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const header = [
  "# China mainland IPv4 CIDR ranges",
  `# Source: ${SOURCE}`,
  `# Generated: ${new Date().toISOString().slice(0, 10)} by scripts/gen-china-ip-ranges.mjs`,
  `# Entries: ${cidrs.length}`,
];
fs.writeFileSync(OUT, [...header, ...cidrs].join("\n") + "\n");
console.log(`written ${OUT}: ${cidrs.length} CIDR entries`);
