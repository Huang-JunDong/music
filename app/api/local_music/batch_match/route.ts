import { NextRequest, NextResponse } from "next/server";
import { findLocalMusicMatch } from "@/lib/local-music";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MatchItem {
  qi: number;
  id: string;
  name: string;
  artist: string;
  size: number;
  ext: string;
}

/** POST /api/local_music/batch_match [{name,artist}] → {matches:[{qi,id,name,artist,size,ext}]} */
export async function POST(req: NextRequest) {
  let body: { name?: string; artist?: string }[];
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  if (!Array.isArray(body) || body.length === 0) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const matches: MatchItem[] = [];
  for (let i = 0; i < body.length; i++) {
    const name = (body[i]?.name ?? "").trim();
    const artist = (body[i]?.artist ?? "").trim();
    if (!name) continue;
    const hit = findLocalMusicMatch(name, artist);
    if (!hit) continue;
    matches.push({
      qi: i,
      id: hit.row.id,
      name: hit.row.name,
      artist: hit.row.artist,
      size: hit.row.size,
      ext: hit.row.ext,
    });
  }

  return NextResponse.json({ matches });
}
