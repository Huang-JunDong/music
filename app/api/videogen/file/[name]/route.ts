import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { videosDir } from "@/lib/videogen";
import { parseRangeHeader } from "@/lib/web-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function nodeStreamBody(stream: fs.ReadStream, signal?: AbortSignal): ReadableStream<Uint8Array> {
  // 手动桥接替代 Readable.toWeb：toWeb 在客户端断开（cancel）后仍可能把已排队的
  // data 事件 enqueue 到已关闭的 controller → ERR_INVALID_STATE uncaughtException。
  // 此处所有 enqueue/close/error 均兜底，cancel/abort 即刻 destroy 源流；
  // desiredSize 背压：下游消费不及则 pause，pull 时 resume。
  return new ReadableStream<Uint8Array>({
    start(controller) {
      stream.on("data", (chunk: Buffer | string) => {
        try {
          controller.enqueue(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
          if (controller.desiredSize !== null && controller.desiredSize <= 0) stream.pause();
        } catch {
          stream.destroy();
        }
      });
      stream.on("end", () => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
      stream.on("error", (err) => {
        try {
          controller.error(err);
        } catch {
          /* already closed */
        }
      });
      if (signal) {
        if (signal.aborted) stream.destroy();
        else signal.addEventListener("abort", () => stream.destroy(), { once: true });
      }
    },
    pull() {
      stream.resume();
    },
    cancel() {
      stream.destroy();
    },
  });
}

/** GET /api/videogen/file/[name] — 渲染结果视频（Range 支持，供 <video>/下载）· 免登录 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
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
    return new NextResponse(nodeStreamBody(fs.createReadStream(filePath, { start: range.start, end: range.end }), req.signal), {
      status: 206,
      headers,
    });
  }
  headers.set("Content-Length", String(stat.size));
  return new NextResponse(nodeStreamBody(fs.createReadStream(filePath), req.signal), { status: 200, headers });
}
