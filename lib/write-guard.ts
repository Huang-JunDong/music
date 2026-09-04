/**
 * write_guard + Web 资产保存 — 移植 internal/web/write_guard.go 与 saveWebAssetResponse。
 * save_local=1 的请求必须 POST + XHR + 同源，落盘资产统一返回 JSON。
 */
import { NextRequest, NextResponse } from "next/server";
import { saveWebAssetToLocal } from "./download-flow";

export function wantsSaveLocal(req: NextRequest): boolean {
  return (req.nextUrl.searchParams.get("save_local") ?? "").trim() === "1";
}

function allowSameOriginWrite(req: NextRequest): boolean {
  if (req.headers.get("x-requested-with") !== "XMLHttpRequest") return false;
  const origin = (req.headers.get("origin") ?? "").trim();
  if (origin) {
    try {
      return new URL(origin).host.toLowerCase() === req.headers.get("host")?.toLowerCase();
    } catch {
      return false;
    }
  }
  const site = (req.headers.get("sec-fetch-site") ?? "").trim().toLowerCase();
  return site === "" || site === "same-origin" || site === "same-site" || site === "none";
}

/** 对齐 Go allowSaveLocalRequest：save_local 必须 POST + XHR + 同源，否则 405/403 */
export function checkSaveLocalGuard(req: NextRequest): NextResponse | null {
  if (!wantsSaveLocal(req)) return null;
  if (req.method !== "POST") {
    return NextResponse.json({ error: "save_local requires POST" }, { status: 405 });
  }
  if (!allowSameOriginWrite(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}

/**
 * 通用写守卫（审核整改 A-15）：POST/PUT/DELETE/PATCH 一律要求 XHR + 同源（CSRF 防护）。
 * 与 checkSaveLocalGuard 的区别：不依赖 save_local 参数，适用于所有有副作用的写路由。
 * curl/脚本调用需附带 `X-Requested-With: XMLHttpRequest` 头（README 已登记）。
 */
export function checkWriteGuard(req: NextRequest): NextResponse | null {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;
  if (!allowSameOriginWrite(req)) {
    return NextResponse.json({ error: "forbidden (XHR + same-origin required)" }, { status: 403 });
  }
  return null;
}

/** saveWebAssetResponse 移植：保存到下载目录并返回 JSON */
export function saveWebAssetResponse(filename: string, data: Buffer): NextResponse {
  try {
    const { savedPath, savedFilename } = saveWebAssetToLocal(filename, data);
    return NextResponse.json({
      status: "ok",
      saved: true,
      path: savedPath,
      filename: savedFilename,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 502 });
  }
}
