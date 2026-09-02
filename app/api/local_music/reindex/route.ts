import { NextResponse } from "next/server";
import { reindexLocalMusic } from "@/lib/local-music";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/local_music/reindex — 全量重建 SQLite 索引（后台执行） */
export async function POST() {
  void reindexLocalMusic().catch(() => {
    /* ignore */
  });
  return NextResponse.json({ status: "started" });
}
