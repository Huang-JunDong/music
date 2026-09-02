import path from "node:path";
import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/store";
import { localMusicDownloadDir } from "@/lib/local-music";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DupItem {
  id: string;
  name: string;
  artist: string;
  size: number;
  duration: number;
  ext: string;
  rel_path: string;
}

interface DupGroup {
  name: string;
  artist: string;
  songs: DupItem[];
}

/** GET /api/local_music/duplicates?page=&page_size= → {groups,total,page,page_size,total_pages} */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  let page = parseInt((params.get("page") ?? "1").trim(), 10) || 1;
  let pageSize = parseInt((params.get("page_size") ?? "10").trim(), 10) || 10;
  if (page < 1) page = 1;
  if (pageSize < 1) pageSize = 10;
  if (pageSize > 50) pageSize = 50;

  const db = getDB();
  const total = (
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM (SELECT name, artist FROM local_music_index GROUP BY name, artist HAVING COUNT(*) > 1)",
      )
      .get() as { c: number }
  ).c;
  let totalPages = 1;
  if (total > 0) totalPages = Math.ceil(total / pageSize);
  if (page > totalPages) page = totalPages;

  const rows = db
    .prepare(
      `SELECT name, artist, COUNT(*) AS count FROM local_music_index
       GROUP BY name, artist HAVING COUNT(*) > 1
       ORDER BY count DESC, name ASC, artist ASC
       LIMIT ? OFFSET ?`,
    )
    .all(pageSize, (page - 1) * pageSize) as { name: string; artist: string }[];

  const rootAbs = path.resolve(localMusicDownloadDir());
  const groups: DupGroup[] = [];
  for (const row of rows) {
    const songs = db
      .prepare("SELECT * FROM local_music_index WHERE name = ? AND artist = ? ORDER BY size DESC")
      .all(row.name, row.artist) as {
      id: string;
      name: string;
      artist: string;
      size: number;
      duration: number;
      ext: string;
      rel_path: string;
    }[];

    const items: DupItem[] = [];
    for (const song of songs) {
      const absPath = path.join(rootAbs, ...song.rel_path.split("/"));
      try {
        if (fs.statSync(absPath).isDirectory()) continue;
      } catch {
        continue;
      }
      items.push({
        id: song.id,
        name: song.name,
        artist: song.artist,
        size: song.size,
        duration: song.duration,
        ext: song.ext,
        rel_path: song.rel_path,
      });
    }
    if (items.length >= 2) {
      groups.push({ name: row.name, artist: row.artist, songs: items });
    }
  }

  return NextResponse.json({
    groups,
    page,
    page_size: pageSize,
    total,
    total_pages: totalPages,
  });
}
