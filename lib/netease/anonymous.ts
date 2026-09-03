/**
 * 匿名游客 token 管理 — 对齐 api-enhanced module/register_anonimous.js + generateConfig.js
 * 惰性注册 + 内存/文件（data/netease-anonymous-token.json）双缓存
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { logger } from "./logger";
import { generateDeviceId } from "./utils";
import { ncmGlobals } from "./global-state";
import { createOption } from "./option";

const ID_XOR_KEY_1 = "3go8&$8*3*3h0k(2)2";
const TOKEN_FILE = path.join(process.cwd(), "data", "netease-anonymous-token.json");

let memoryToken = "";
let registering: Promise<string> | null = null;

function cloudmusicDllEncodeId(someId: string): string {
  let xoredString = "";
  for (let i = 0; i < someId.length; i++) {
    const charCode = someId.charCodeAt(i) ^ ID_XOR_KEY_1.charCodeAt(i % ID_XOR_KEY_1.length);
    xoredString += String.fromCharCode(charCode);
  }
  return crypto.createHash("md5").update(xoredString, "utf8").digest("base64");
}

function loadFromFile(): string {
  try {
    const parsed = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8")) as { MUSIC_A?: string };
    return (parsed.MUSIC_A ?? "").trim();
  } catch {
    return "";
  }
}

function saveToFile(token: string): void {
  try {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, JSON.stringify({ MUSIC_A: token }, null, 2), "utf-8");
  } catch {
    /* 持久化失败不阻断 */
  }
}

/** register_anonimous 模块主体（依赖 request 注入，避免与 request.ts 循环引用）
 *  返回完整上游 result（对齐 module/register_anonimous.js：保留 body 全部字段） */
async function registerAnonymousToken(
  request: (uri: string, data: any, options: any) => Promise<any>,
  query: Record<string, any> = {},
): Promise<any> {
  const deviceId = generateDeviceId();
  logger.info(`Successfully registered anonimous token, deviceId: ${deviceId}`);
  ncmGlobals.deviceId = deviceId;
  const encodedId = Buffer.from(`${deviceId} ${cloudmusicDllEncodeId(deviceId)}`, "utf8").toString("base64");

  return request("/api/register/anonimous", { username: encodedId }, createOption(query, "xeapi"));
}

/** 确保匿名 token 可用（惰性注册；request.ts 注入 request fn） */
export async function ensureAnonymousToken(
  requestFn: (uri: string, data: any, options: any) => Promise<any>,
): Promise<string> {
  if (memoryToken) return memoryToken;
  const fromFile = loadFromFile();
  if (fromFile) {
    memoryToken = fromFile;
    return memoryToken;
  }
  if (!registering) {
    registering = (async () => {
      try {
        const result = await registerAnonymousToken(requestFn);
        if (result.body.code !== 200) {
          throw new Error(`register anonimous failed: code=${result.body.code}`);
        }
        const m = (result.cookie || []).join(";").match(/MUSIC_A=([^;]+)/);
        const token = m ? m[1] : "";
        if (token) {
          memoryToken = token;
          saveToFile(token);
        }
        return token;
      } catch (e) {
        logger.warn("[anonymous]", (e as Error).message);
        return "";
      } finally {
        registering = null;
      }
    })();
  }
  return registering;
}

export function getAnonymousToken(): string {
  return memoryToken || loadFromFile();
}

export { registerAnonymousToken };
