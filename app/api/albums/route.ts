import { NextRequest, NextResponse } from "next/server";
import { withBrowserSourceSession } from "@/lib/source-session";
import { getProvider } from "@/lib/registry";
import { checkWriteGuard } from "@/lib/write-guard";
import { createTtlCache, sourceCookieFingerprint } from "@/lib/response-cache";
import type { Playlist } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 新碟 5min 缓存（日级更新）；收藏列表 60s（写操作后刷新期望快） */
const newAlbumCache = createTtlCache<Record<string, unknown>>(300_000, 40);
const favAlbumCache = createTtlCache<Record<string, unknown>>(60_000, 20);

const AREAS = new Set(["全部", "华语", "港台", "欧美", "日本", "韩国", "内地"]);

/**
 * GET /api/albums?source=&kind=new|fav&area=&page=&limit= → { albums, has_more, error? }
 * POST /api/albums（JSON: source + album 字段集 + sub）→ { ok }（收藏/取消专辑）
 */
export const GET = (req: NextRequest) => withBrowserSourceSession(req, getHandler);
export const POST = (req: NextRequest) => withBrowserSourceSession(req, postHandler);

function albumFromParams(params: URLSearchParams): Playlist {
  const extraRaw = params.get("extra");
  let extra: Record<string, string> | undefined;
  if (extraRaw) {
    try {
      const parsed = JSON.parse(extraRaw);
      if (parsed && typeof parsed === "object") {
        extra = {};
        for (const [k, v] of Object.entries(parsed)) {
          extra[k] = typeof v === "object" ? JSON.stringify(v) : String(v);
        }
      }
    } catch {
      /* ignore */
    }
  }
  return {
    id: params.get("id") ?? "",
    name: params.get("name") ?? "",
    cover: params.get("cover") ?? "",
    track_count: parseInt(params.get("track_count") ?? "", 10) || 0,
    play_count: parseInt(params.get("play_count") ?? "", 10) || 0,
    creator: params.get("creator") ?? "",
    description: params.get("description") ?? "",
    source: params.get("source") ?? "",
    link: params.get("link") ?? "",
    extra,
  };
}

async function getHandler(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const source = (params.get("source") ?? "netease").trim();
  const kind = params.get("kind") === "fav" ? "fav" : "new";
  const rawArea = (params.get("area") ?? "全部").trim();
  const area = AREAS.has(rawArea) ? rawArea : "全部";
  const page = Math.max(parseInt(params.get("page") ?? "1", 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "30", 10) || 30, 1), 100);

  const provider = getProvider(source);
  if (kind === "new" && !provider?.getNewAlbums) {
    return NextResponse.json({ error: "该源不支持新碟" }, { status: 400 });
  }
  if (kind === "fav" && !provider?.getFavAlbums) {
    return NextResponse.json({ error: "该源不支持收藏专辑" }, { status: 400 });
  }

  const cache = kind === "new" ? newAlbumCache : favAlbumCache;
  const payload = await cache.wrap(
    `${req.nextUrl.search}|${sourceCookieFingerprint(req)}`,
    async (): Promise<Record<string, unknown>> => {
      try {
        const r =
          kind === "new"
            ? await provider!.getNewAlbums!({ area, page, limit })
            : await provider!.getFavAlbums!(page, limit);
        return { albums: r.albums as Playlist[], has_more: r.has_more };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err), albums: [], has_more: false };
      }
    },
    (p) => !p.error,
  );
  return NextResponse.json(payload);
}

async function postHandler(req: NextRequest) {
  const guard = checkWriteGuard(req);
  if (guard) return guard;

  let body: Record<string, string> = {};
  try {
    body = (await req.json()) as Record<string, string>;
  } catch {
    /* ignore */
  }
  const sub = body.sub === "true" || body.sub === "1";
  const album = albumFromParams(new URLSearchParams(body));
  if (!album.id || !album.source) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }
  const provider = getProvider(album.source);
  if (!provider?.subAlbum) {
    return NextResponse.json({ error: "该源不支持收藏专辑" }, { status: 400 });
  }

  try {
    await provider.subAlbum!(album, sub);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "操作失败" },
      { status: 502 },
    );
  }
}
