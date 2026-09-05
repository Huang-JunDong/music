import { NextRequest } from "next/server";
import { handleDownload } from "@/lib/download-handler";
import { withBrowserSourceSession } from "@/lib/source-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/download?id=&source=&name=&artist=&album=&cover=&extra=&stream=1&embed=1&save_local=1
 * 六分支业务（本地文件 / save_local 去重+WebDAV / embed 元数据 / soda 解密 /
 * Range 并行 / 流代理透传）见 lib/download-handler.ts（审核整改 A-26 下沉）。
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, handleDownload);
export const POST = (req: NextRequest) => withBrowserSourceSession(req, handleDownload);
