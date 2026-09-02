import { NextRequest, NextResponse } from "next/server";
import { getProvider, GetSourceDescription } from "@/lib/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/category_playlists?source=&category_id=&category_name= → {playlists:[...]} */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const source = (params.get("source") ?? "").trim();
  const categoryID = (params.get("category_id") ?? "").trim();
  let categoryName = (params.get("category_name") ?? "").trim();
  if (!categoryName) categoryName = categoryID;
  if (!categoryName) categoryName = "全部";

  const provider = getProvider(source);
  if (!source || !provider?.getCategoryPlaylists) {
    return NextResponse.json({ error: "该源不支持歌单分类" }, { status: 400 });
  }

  let playlists;
  try {
    playlists = (await provider.getCategoryPlaylists(categoryID, 1, 120)).map((p) => ({
      ...p,
      source,
    }));
  } catch (err) {
    return NextResponse.json(
      { error: `获取分类歌单失败: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }

  return NextResponse.json({
    playlists,
    source,
    source_name: GetSourceDescription(source),
    category_id: categoryID,
    category_name: categoryName,
  });
}
