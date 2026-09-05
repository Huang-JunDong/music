import { NextRequest, NextResponse } from "next/server";
import { reindexLocalMusic } from "@/lib/local-music";
import { checkWriteGuard } from "@/lib/write-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/local_music/reindex — 全量重建 SQLite 索引（后台执行）
 *  本地音乐模块免登录，仅保留 CSRF 写守卫。 */
export async function POST(req: NextRequest) {
  const guarded = checkWriteGuard(req);
  if (guarded) return guarded;

  void reindexLocalMusic().catch(() => {
    /* ignore */
  });
  return NextResponse.json({ status: "started" });
}
