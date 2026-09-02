import { NextRequest, NextResponse } from "next/server";
import {
  saveUploadedLocalMusic,
  trackJSON,
  upsertLocalMusicIndexRow,
} from "@/lib/local-music";
import { saveDownloadDedupEntry } from "@/lib/download-record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/local_music/upload — multipart file（白名单扩展名，唯一化文件名，music-metadata 读元数据） */
export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "请选择要上传的音乐文件" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请选择要上传的音乐文件" }, { status: 400 });
  }

  let track;
  try {
    const data = Buffer.from(await file.arrayBuffer());
    track = await saveUploadedLocalMusic(file.name || "local-music.mp3", data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  upsertLocalMusicIndexRow(track);
  try {
    saveDownloadDedupEntry(track.name, track.artist);
  } catch (err) {
    return NextResponse.json(
      { error: `音乐文件已保存，但曲库索引写入失败: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ status: "ok", track: trackJSON(track) });
}
