import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider } from "@/lib/registry";
import { getWebSettings } from "@/lib/store";
import { fetchSource } from "@/lib/web-core";
import {
  indexAutoCachedFile,
  isLocalMusicSource,
  localMusicDownloadDir,
  releaseAutoCache,
  reserveAutoCache,
  saveSongToFile,
} from "@/lib/local-music";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AutoCacheRequest {
  id?: string;
  source?: string;
  name?: string;
  artist?: string;
  album?: string;
  cover?: string;
  extra?: unknown;
}

/** extra 兼容 string(JSON) 或对象 map（对齐 parseAutoCacheExtra） */
function parseAutoCacheExtra(raw: unknown): Record<string, string> {
  const extra: Record<string, string> = {};
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === "string") extra[k] = v;
        }
      }
    } catch {
      /* ignore */
    }
    return extra;
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "string") extra[k] = v;
    }
  }
  return extra;
}

/** 同源校验（对齐 Go allowSameOriginWrite：XHR + Origin/Sec-Fetch-Site） */
function allowSameOriginWrite(req: NextRequest): boolean {
  if (req.headers.get("x-requested-with") !== "XMLHttpRequest") return false;
  const origin = (req.headers.get("origin") ?? "").trim();
  if (origin) {
    try {
      return new URL(origin).host.toLowerCase() === req.headers.get("host")?.toLowerCase();
    } catch {
      return false;
    }
  }
  const site = (req.headers.get("sec-fetch-site") ?? "").trim().toLowerCase();
  return site === "" || site === "same-origin" || site === "same-site" || site === "none";
}

/** autoCacheMaxRequestBytes = 64KB（对齐 Go） */
const AUTO_CACHE_MAX_REQUEST_BYTES = 64 * 1024;

/**
 * POST /api/local_music/auto_cache {id, source, ...}
 * 播放时后台缓存到下载目录；AutoCacheOnPlay 控制开关；64KB body 上限 + 单 JSON 文档校验；
 * 返回 started / skipped / busy / in_progress。
 */
export const POST = (req: NextRequest) => withBrowserSourceSession(req, postHandler);

async function postHandler(req: NextRequest) {
  if (!allowSameOriginWrite(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  if (raw.length > AUTO_CACHE_MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: "invalid request" }, { status: 413 });
  }

  let body: AutoCacheRequest;
  try {
    body = JSON.parse(raw) as AutoCacheRequest;
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const id = (body.id ?? "").trim();
  const source = (body.source ?? "").trim();
  if (!id || !source) {
    return NextResponse.json({ error: "missing id or source" }, { status: 400 });
  }
  if (isLocalMusicSource(source)) {
    return NextResponse.json({ status: "skipped", reason: "already local" });
  }

  const settings = getWebSettings();
  if (!settings.autoCacheOnPlay) {
    return NextResponse.json({ status: "skipped", reason: "auto cache disabled" });
  }

  const cacheKey = `${source}:${id}`;
  const reserved = reserveAutoCache(cacheKey);
  if (reserved !== "started") {
    return NextResponse.json({ status: reserved });
  }

  const song = {
    id,
    source,
    name: (body.name ?? "").trim(),
    artist: (body.artist ?? "").trim(),
    album: (body.album ?? "").trim(),
    cover: (body.cover ?? "").trim(),
    extra: parseAutoCacheExtra(body.extra),
  };

  void (async () => {
    try {
      const provider = getProvider(source);
      if (!provider?.getStreamUrl) return;
      const url = await provider.getStreamUrl({
        id,
        source,
        name: song.name || "Unknown",
        artist: song.artist || "Unknown",
        album: song.album,
        cover: song.cover,
        duration: 0,
        size: 0,
        bitrate: 0,
        url: "",
        link: "",
        extra: song.extra,
      });
      const resp = await fetchSource(url, source);
      if (!resp.ok) return;
      const data = Buffer.from(await resp.arrayBuffer());
      const result = await saveSongToFile(
        song,
        settings.downloadDir || localMusicDownloadDir(),
        async () => ({ data, contentType: resp.headers.get("content-type") ?? "", url }),
        settings.downloadFilenameTemplate,
      );
      await indexAutoCachedFile(result.savedPath);
    } catch {
      /* 后台缓存失败静默 */
    } finally {
      releaseAutoCache(cacheKey);
    }
  })();

  return NextResponse.json({ status: "started" });
}
