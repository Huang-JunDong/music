import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/store";
import type { CollectionRow } from "@/lib/collections";
import { checkWriteGuard } from "@/lib/write-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/collections?include_imported=1 → 全部；默认仅 manual
 *  track_count：manual 歌单按 saved_songs 实时计数（收藏/删除即时反映），
 *  导入歌单无本地明细，保留导入时的快照值 */
export async function GET(req: NextRequest) {
  const db = getDB();
  const includeImported = req.nextUrl.searchParams.get("include_imported") === "1";
  const selectSql = `
    SELECT c.*, CASE WHEN c.kind = 'manual' OR c.kind = '' OR c.kind IS NULL
      THEN (SELECT COUNT(*) FROM saved_songs WHERE collection_id = c.id)
      ELSE c.track_count END AS track_count
    FROM collections c`;
  const rows = includeImported
    ? (db.prepare(`${selectSql} ORDER BY c.id DESC`).all() as CollectionRow[])
    : (db
        .prepare(`${selectSql} WHERE c.kind = 'manual' OR c.kind = '' OR c.kind IS NULL ORDER BY c.id DESC`)
        .all() as CollectionRow[]);
  return NextResponse.json(rows);
}

/** POST /api/collections {name, description, cover} → 创建 manual 歌单 */
export async function POST(req: NextRequest) {
  const guarded = checkWriteGuard(req);
  if (guarded) return guarded;

  let body: { name?: string; description?: string; cover?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "参数错误，必须提供歌单名" }, { status: 400 });
  }
  const name = (body?.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "参数错误，必须提供歌单名" }, { status: 400 });
  }

  try {
    const result = getDB()
      .prepare(
        "INSERT INTO collections (name, description, cover, kind, content_type, source) VALUES (?,?,?,?,?,?)",
      )
      .run(name, (body.description ?? "").trim(), (body.cover ?? "").trim(), "manual", "playlist", "local");
    return NextResponse.json({ id: Number(result.lastInsertRowid), name });
  } catch (err) {
    return NextResponse.json(
      { error: `创建失败: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
