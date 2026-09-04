import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import { videosDir } from "@/lib/videogen";
import { parseRangeHeader } from "@/lib/web-core";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function nodeStreamBody(stream: fs.ReadStream): ReadableStream<Uint8Array> {
  return Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
}

/** GET /api/videogen/file/[name] — 渲染结果视频（Range 支持，供 <video>/下载）
 *  审核整改 A-04：纳入鉴权（渲染会话产物，与会话创建方同权限）。 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const denied = requireAuth(req);
  if (denied) return NextResponse.json(denied.body, { status: denied.status });

  const { name } = await params;
  const safeName = path.basename((name ?? "").trim());
  if (!safeName || safeName.startsWith(".")) {
    return new NextResponse("Not found", { status: 404 });
  }
  const filePath = path.join(videosDir(), safeName);
  if (!filePath.startsWith(videosDir())) {
    return new NextResponse("Not found", { status: 404 });
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error("not a file");
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }

  const headers = new Headers({
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
  });
  const range = parseRangeHeader(req.headers.get("range"), stat.size);
  if (range === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${stat.size}`);
    return new NextResponse(null, { status: 416, headers });
  }
  if (range && range !== "invalid") {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${stat.size}`);
    headers.set("Content-Length", String(range.end - range.start + 1));
    return new NextResponse(nodeStreamBody(fs.createReadStream(filePath, { start: range.start, end: range.end })), {
      status: 206,
      headers,
    });
  }
  headers.set("Content-Length", String(stat.size));
  return new NextResponse(nodeStreamBody(fs.createReadStream(filePath)), { status: 200, headers });
}
