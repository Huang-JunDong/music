import { NextRequest, NextResponse } from "next/server";
import { reindexLocalMusic } from "@/lib/local-music";
import { requireAuth } from "@/lib/auth";
import { checkWriteGuard } from "@/lib/write-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/local_music/reindex — 全量重建 SQLite 索引（后台执行）
 *  审核整改 A-04/A-15：索引重建属管理操作，纳入鉴权 + 写守卫。 */
export async function POST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return NextResponse.json(denied.body, { status: denied.status });
  const guarded = checkWriteGuard(req);
  if (guarded) return guarded;

  void reindexLocalMusic().catch(() => {
    /* ignore */
  });
  return NextResponse.json({ status: "started" });
}
