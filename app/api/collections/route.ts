import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/store";
import type { CollectionRow } from "@/lib/collections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/collections?include_imported=1 → 全部；默认仅 manual */
export async function GET(req: NextRequest) {
  const db = getDB();
  const includeImported = req.nextUrl.searchParams.get("include_imported") === "1";
  const rows = includeImported
    ? (db.prepare("SELECT * FROM collections ORDER BY id DESC").all() as CollectionRow[])
    : (db
        .prepare(
          "SELECT * FROM collections WHERE kind = 'manual' OR kind = '' OR kind IS NULL ORDER BY id DESC",
        )
        .all() as CollectionRow[]);
  return NextResponse.json(rows);
}

/** POST /api/collections {name, description, cover} → 创建 manual 歌单 */
export async function POST(req: NextRequest) {
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
