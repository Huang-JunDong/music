/**
 * 易盾反作弊 token — 对齐 api-enhanced module/register_checktoken_v2.js / v3.js
 * v3：直接 HTTP 获取；v2：Watchman SDK（jsdom 依赖 + 本地 vendor 脚本，未就绪时降级空 token）
 *
 * 安全基线（审核 2.7）：脚本固定为仓库内本地文件 lib/netease/vendor/dun-tool.min.js，
 * 不再运行时拉取远端 CDN JS 执行；脚本变更经 git 审查（等效版本固定+哈希管控）。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { APP_CONF } from "./config";

const PRODUCT_NUMBER = "YD00000558929251";
const BUSINESS_ID = "bd5d2f973ef74cd2a61325a412ae54d9";
const TOOL_JS_PATH = path.join(process.cwd(), "lib", "netease", "vendor", "dun-tool.min.js");
/** vendor 脚本指纹登记（2026-09-04 自 acstatic-dun.126.net/tool.min.js 固定，5168 字节）：
 *  SHA-256 = C34EDD7444347DE42869136B510600F8D53F605A2E471C42D4F2EAF99842D91D */
const TOOL_JS_SHA256 = "C34EDD7444347DE42869136B510600F8D53F605A2E471C42D4F2EAF99842D91D";

let cachedToolJs = "";

/** 读取本地 vendor 的易盾 tool.min.js（固定版本，git 管控变更 + SHA-256 校验） */
function getToolJs(): string {
  if (cachedToolJs) return cachedToolJs;
  const content = fs.readFileSync(TOOL_JS_PATH, "utf-8");
  const hash = crypto.createHash("sha256").update(content, "utf-8").digest("hex").toUpperCase();
  if (hash !== TOOL_JS_SHA256) {
    throw new Error(`dun-tool.min.js 指纹不匹配（期望 ${TOOL_JS_SHA256.slice(0, 12)}…，实际 ${hash.slice(0, 12)}…）`);
  }
  cachedToolJs = content;
  return cachedToolJs;
}

/** v3：易盾 v3/b 接口直接获取 token */
export async function getTokenV3(): Promise<string> {
  try {
    const res = await fetch(`${APP_CONF.dunDomainV3}/v3/b?pn=${PRODUCT_NUMBER}`, {
      signal: AbortSignal.timeout(10000),
    });
    const body = await res.text();
    const m = body.match(/null\(\[(\d+),\d+,"([^"]+)"\]\)/);
    if (m && m[1] === "200") return m[2];
    throw new Error("易盾返回异常: " + body.substring(0, 100));
  } catch {
    return "";
  }
}

/** v2：易盾 Watchman SDK（Web 版，跑在 jsdom 模拟的浏览器环境里） */
export async function getTokenV2(): Promise<string> {
  try {
    const { createRequire } = await import("node:module");
    const req = createRequire(import.meta.url);
    const { JSDOM, VirtualConsole } = req("jsdom");
    const HTML = '<!doctype html><html><head><meta charset="UTF-8"></head><body></body></html>';
    const toolJs = getToolJs();

    const virtualConsole = new VirtualConsole();
    virtualConsole.on("jsdomError", () => {});
    const dom = new JSDOM(HTML, {
      url: "https://music.163.com/",
      referrer: "https://music.163.com/",
      contentType: "text/html",
      runScripts: "dangerously",
      // 供应链本地化（审核 2.7）：不启用 resources:"usable"（禁止加载任何远端子资源）；
      // vendor 脚本经 textContent 内联注入执行，若 watchman 初始化因此失败则走 catch 降级空 token。
      pretendToBeVisual: true,
      virtualConsole,
      beforeParse(window: any) {
        Object.defineProperty(window.navigator, "webdriver", { get: () => undefined });
        window.chrome = { runtime: {} };
        window.navigator.languages = ["zh-CN", "zh"];
        window.navigator.plugins = [1, 2, 3, 4, 5];
      },
    });
    const script = dom.window.document.createElement("script");
    script.textContent = toolJs;
    dom.window.document.body.appendChild(script);

    const instance: any = await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("watchman 初始化超时"));
      }, 15000);
      (dom.window as any).initWatchman({
        auto: true,
        productNumber: PRODUCT_NUMBER,
        onload(inst: any) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(inst);
        },
        onerror(...args: unknown[]) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(new Error("watchman 初始化失败"));
        },
      });
    });

    const raw = instance.getInstance();
    await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 15000);
      raw.I(() => {
        clearTimeout(timer);
        resolve(null);
      });
    });
    return await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(""), 15000);
      instance.getToken(BUSINESS_ID, (tk: unknown) => {
        clearTimeout(timer);
        resolve(typeof tk === "string" ? tk : "");
      });
    });
  } catch {
    // jsdom 未安装或初始化失败：降级为空 token（由调用方决定是否重试）
    return "";
  }
}

/** 端点处理器：每次实时获取新 token，不缓存 */
export async function checktokenHandler(version: "v2" | "v3") {
  const token = version === "v3" ? await getTokenV3() : await getTokenV2();
  return {
    status: 200,
    body: { code: 200, token, registered: !!token },
    cookie: [],
  };
}
