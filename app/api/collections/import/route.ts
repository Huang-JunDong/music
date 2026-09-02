import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/store";
import { GetOriginalLink } from "@/lib/original-link";
import {
  COLLECTION_CONTENT_ALBUM,
  COLLECTION_CONTENT_PLAYLIST,
  COLLECTION_KIND_IMPORTED,
} from "@/lib/collections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ImportRequest {
  name?: string;
  description?: string;
  cover?: string;
  creator?: string;
  track_count?: number;
  source?: string;
  external_id?: string;
  link?: string;
  content_type?: string;
}

/** POST /api/collections/import（content_type=playlist|album，source≠local，external_id 必填；查重 duplicate:true） */
export async function POST(req: NextRequest) {
  let body: ImportRequest;
  try {
    body = (await req.json()) as ImportRequest;
  } catch {
    return NextResponse.json({ error: "参数错误" }, { status: 400 });
  }

  const contentType = (body.content_type ?? "").trim();
  if (contentType !== COLLECTION_CONTENT_PLAYLIST && contentType !== COLLECTION_CONTENT_ALBUM) {
    return NextResponse.json({ error: "invalid content_type" }, { status: 400 });
  }
  const source = (body.source ?? "").trim();
  if (!source || source === "local") {
    return NextResponse.json({ error: "invalid source" }, { status: 400 });
  }
  const externalID = (body.external_id ?? "").trim();
  if (!externalID) {
    return NextResponse.json({ error: "missing external_id" }, { status: 400 });
  }

  let name = (body.name ?? "").trim();
  if (!name) name = contentType === COLLECTION_CONTENT_ALBUM ? "导入专辑" : "导入歌单";
  const link = (body.link ?? "").trim() || GetOriginalLink(source, externalID, contentType);

  const db = getDB();
  const existing = db
    .prepare(
      "SELECT id, name FROM collections WHERE kind = ? AND content_type = ? AND source = ? AND external_id = ?",
    )
    .get(COLLECTION_KIND_IMPORTED, contentType, source, externalID) as
    | { id: number; name: string }
    | undefined;
  if (existing) {
    return NextResponse.json({ id: existing.id, name: existing.name, duplicate: true });
  }

  try {
    const result = db
      .prepare(
        `INSERT INTO collections (name, description, cover, kind, content_type, source, external_id, link, creator, track_count)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        name,
        (body.description ?? "").trim(),
        (body.cover ?? "").trim(),
        COLLECTION_KIND_IMPORTED,
        contentType,
        source,
        externalID,
        link,
        (body.creator ?? "").trim(),
        body.track_count ?? 0,
      );
    return NextResponse.json({ id: Number(result.lastInsertRowid), name });
  } catch (err) {
    return NextResponse.json(
      { error: `导入失败: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
