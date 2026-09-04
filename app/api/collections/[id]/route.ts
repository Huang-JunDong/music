import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/store";
import { isImported, loadCollection } from "@/lib/collections";
import { checkWriteGuard } from "@/lib/write-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PUT /api/collections/[id] {name, description, cover} — 仅 manual 可编辑 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guarded = checkWriteGuard(req);
  if (guarded) return guarded;

  const { id } = await params;
  const existing = loadCollection(id);
  if (!existing) {
    return NextResponse.json({ error: "歌单不存在" }, { status: 404 });
  }
  if (isImported(existing)) {
    return NextResponse.json(
      { error: "外部导入歌单/专辑不支持编辑，请删除后重新导入" },
      { status: 400 },
    );
  }

  let body: { name?: string; description?: string; cover?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "参数错误" }, { status: 400 });
  }
  const name = (body?.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "参数错误" }, { status: 400 });
  }

  try {
    getDB()
      .prepare("UPDATE collections SET name = ?, description = ?, cover = ? WHERE id = ?")
      .run(name, (body.description ?? "").trim(), (body.cover ?? "").trim(), existing.id);
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ error: "更新失败" }, { status: 500 });
  }
}

/** DELETE /api/collections/[id] — 级联删除 saved_songs（对齐 Go：不查存在性，幂等 200） */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDB();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM saved_songs WHERE collection_id = ?").run(id);
    db.prepare("DELETE FROM collections WHERE id = ?").run(id);
  });
  try {
    tx();
    return NextResponse.json({ status: "ok" });
  } catch (err) {
    return NextResponse.json(
      { error: `删除失败: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
