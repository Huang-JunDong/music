/**
 * 酷我音乐 Provider — 移植自 music-lib/kuwo
 * 覆盖 Go 版全部能力：song parse / album / playlist / 推荐 / 分类歌单
 * （Go 版 kuwo 不支持 getUserPlaylists / QR 登录，保持不实现）
 */
import type {
  MusicProvider,
  Playlist,
  PlaylistCategory,
  PlaylistDetail,
  Song,
} from "../types";
import {
  httpGetJSON,
  httpGetText,
  httpGetBuffer,
  httpRequest,
  decodeBodyBuffer,
  firstNonEmpty,
} from "../http";
import { decodeKuwoLyric, convertKuwoNewLyric } from "../lyrics";
import { getCookie } from "../cookies";

const UA_PC =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";
const PLAYLIST_PAGE_SIZE = 100;
const PLAYLIST_MAX_PAGES = 500;

function cookieHeaders(): Record<string, string> {
  const cookie = getCookie("kuwo");
  return cookie ? { Cookie: cookie } : {};
}

interface KuwoSearchItem {
  MUSICRID?: string;
  SONGNAME?: string;
  ARTIST?: string;
  ALBUM?: string;
  DURATION?: string;
  hts_MVPIC?: string;
  MINFO?: string;
  bitSwitch?: number;
}

interface MInfoFormat {
  format: string;
  bitrate: string;
  size: number;
}

function parseMInfoFormats(minfo: string): MInfoFormat[] {
  if (!minfo) return [];
  const formats: MInfoFormat[] = [];
  for (const part of minfo.split(";")) {
    const kv: Record<string, string> = {};
    for (const attr of part.split(",")) {
      const [k, v] = attr.split(":");
      if (k && v !== undefined) kv[k] = v;
    }
    const sizeStr = (kv.size ?? "").toLowerCase().replace(/mb$/, "");
    if (!sizeStr) continue;
    const mb = parseFloat(sizeStr);
    if (isNaN(mb)) continue;
    formats.push({ format: kv.format ?? "", bitrate: kv.bitrate ?? "", size: Math.round(mb * 1024 * 1024) });
  }
  return formats;
}

/** 从 MINFO 解析大小（对齐 Go parseSizeFromMInfo：mp3 128→mp3 320→flac→flac 2000→最大） */
function parseSizeFromMInfo(minfo: string): number {
  const formats = parseMInfoFormats(minfo);
  const pick = (pred: (f: MInfoFormat) => boolean): number => {
    const hit = formats.find(pred);
    return hit ? hit.size : 0;
  };
  return (
    pick((f) => f.format === "mp3" && f.bitrate === "128") ||
    pick((f) => f.format === "mp3" && f.bitrate === "320") ||
    pick((f) => f.format === "flac" && f.bitrate === "2000") ||
    pick((f) => f.format === "flac") ||
    formats.reduce((max, f) => Math.max(max, f.size), 0)
  );
}

/** 从 MINFO 解析码率（对齐 Go parseBitrateFromMInfo：128→320→flac2000→flac 其他；空 MINFO 默认 128） */
function parseBitrateFromMInfo(minfo: string): number {
  const formats = parseMInfoFormats(minfo);
  const mp3 = (bitrate: string) => formats.find((f) => f.format === "mp3" && f.bitrate === bitrate);
  if (mp3("128")) return 128;
  if (mp3("320")) return 320;
  const flac2000 = formats.find((f) => f.format === "flac" && f.bitrate === "2000");
  if (flac2000) return parseInt(flac2000.bitrate, 10) || 2000;
  const flacAny = formats.find((f) => f.format === "flac");
  if (flacAny) return parseInt(flacAny.bitrate, 10) || 800;
  return 128;
}

// ---------------------------------------------------------------------------
// 文本/图片规范化（对齐 Go kuwo.go）
// ---------------------------------------------------------------------------

function normalizeKuwoText(value: string | undefined | null): string {
  if (!value) return "";
  let out = value;
  try {
    out = out
      .replace(/&([a-z]+|#\d+);/gi, (ent) => {
        const named: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&nbsp;": " ", "&apos;": "'" };
        return named[ent] ?? ent;
      });
  } catch {
    /* ignore */
  }
  return out
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\\n;/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\n;/g, "\n")
    .trim();
}

function normalizeKuwoImageURL(raw: string): string {
  let url = normalizeKuwoText(raw);
  if (!url) return "";

  if (url.startsWith("//")) {
    url = "http:" + url;
  } else if (!url.startsWith("http://") && !url.startsWith("https://")) {
    if (url.startsWith("img")) {
      url = "http://" + url;
    } else {
      url = "http://img1.kuwo.cn/star/albumcover/" + url.replace(/^\//, "");
    }
  }

  const replacements: [string, string][] = [
    ["/120/", "/500/"],
    ["/150/", "/500/"],
    ["/240/", "/500/"],
    ["_100.", "_500."],
    ["_120.", "_500."],
    ["_150.", "_500."],
    ["_240.", "_500."],
  ];
  for (const [oldStr, newStr] of replacements) {
    if (url.includes(oldStr)) {
      url = url.replace(oldStr, newStr);
    }
  }
  return url;
}

function parseAnyString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Math.round(value));
  return String(value).trim();
}

function parseAnyInt(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Math.round(value);
  if (typeof value === "string") {
    const n = parseInt(value.trim(), 10);
    return isNaN(n) ? 0 : n;
  }
  const n = parseInt(String(value), 10);
  return isNaN(n) ? 0 : n;
}

function parseStringInt(value: string | undefined): number {
  const n = parseInt((value ?? "").trim(), 10);
  return isNaN(n) ? 0 : n;
}

/** 酷我 legacy r.s 接口：单引号 JSON */
function parseKuwoLegacyJSON<T>(body: string): T {
  return JSON.parse(body.replaceAll("'", '"')) as T;
}

function findSubmatch(input: string, pattern: RegExp): string {
  const match = input.match(pattern);
  return match?.[1] ?? "";
}

function stripKuwoHTMLTags(raw: string): string {
  if (!raw) return "";
  let out = raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n");
  out = out.replace(/<[^>]+>/gis, "");
  return normalizeKuwoText(out);
}

function decodeKuwoEscapedString(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(`"${trimmed}"`) as string;
  } catch {
    return trimmed.replaceAll("\\/", "/");
  }
}

function parseKuwoAlbumPageTitle(title: string): [string, string] {
  const normalized = normalizeKuwoText(title);
  if (!normalized) return ["", ""];
  const parts = normalized.split("_");
  if (parts.length < 2) return ["", ""];
  const name = normalizeKuwoText(parts[0].replace(/专辑$/, ""));
  const artist = normalizeKuwoText(parts[1]);
  return [name, artist];
}

// ---------------------------------------------------------------------------
// 单曲解析（对齐 Go fetchFullSongInfo / Parse）
// ---------------------------------------------------------------------------

async function fetchFullSongInfo(rid: string): Promise<Song> {
  const params = new URLSearchParams({ musicId: rid, httpsStatus: "1" });
  let name = "";
  let artist = "";
  let cover = "";

  try {
    const metaResp = await httpGetJSON<{
      data?: { songinfo?: { songName?: string; artist?: string; pic?: string } };
    }>(`http://m.kuwo.cn/newh5/singles/songinfoandlrc?${params}`, {
      headers: { "User-Agent": UA_PC, ...cookieHeaders() },
    });
    name = (metaResp.data?.songinfo?.songName ?? "").trim();
    artist = (metaResp.data?.songinfo?.artist ?? "").trim();
    cover = (metaResp.data?.songinfo?.pic ?? "").trim();
  } catch {
    /* 元数据失败不阻断 */
  }

  if (!name) name = `Kuwo_Song_${rid}`;

  const audioURL = await kuwo.getStreamUrl({
    source: "kuwo",
    id: rid,
    name,
    artist,
    album: "",
    duration: 0,
    size: 0,
    bitrate: 0,
    url: "",
    cover,
    link: `http://www.kuwo.cn/play_detail/${rid}`,
    extra: { rid },
  });

  return {
    source: "kuwo",
    id: rid,
    name,
    artist,
    album: "",
    duration: 0,
    size: 0,
    bitrate: 0,
    cover,
    url: audioURL,
    link: `http://www.kuwo.cn/play_detail/${rid}`,
    extra: { rid },
  };
}

// ---------------------------------------------------------------------------
// legacy 搜索（歌单/专辑共用，对齐 Go searchCollection）
// ---------------------------------------------------------------------------

async function searchCollection<T>(keyword: string, ft: string): Promise<T> {
  const params = new URLSearchParams({
    all: keyword,
    ft,
    itemset: "web_2013",
    client: "kt",
    pcmp4: "1",
    geo: "c",
    vipver: "1",
    pn: "0",
    rn: "10",
    rformat: "json",
    encoding: "utf8",
  });

  const body = await httpGetText(`http://search.kuwo.cn/r.s?${params}`, {
    headers: { "User-Agent": UA_PC, ...cookieHeaders() },
  });
  return parseKuwoLegacyJSON<T>(body);
}

// ---------------------------------------------------------------------------
// 歌单详情（对齐 Go fetchPlaylistDetail）
// ---------------------------------------------------------------------------

interface KuwoPlaylistMusic {
  id?: string;
  name?: string;
  artist?: string;
  album?: string;
  albumpic?: string;
  duration?: unknown;
  song_name?: string;
  artist_name?: string;
}

function kuwoPlaylistSongFromMusic(item: KuwoPlaylistMusic): Song {
  const name = normalizeKuwoText(item.name) || normalizeKuwoText(item.song_name);
  const artist = normalizeKuwoText(item.artist) || normalizeKuwoText(item.artist_name);
  const songID = (item.id ?? "").trim();

  return {
    source: "kuwo",
    id: songID,
    name,
    artist,
    album: normalizeKuwoText(item.album),
    duration: parseAnyInt(item.duration),
    size: 0,
    bitrate: 0,
    cover: normalizeKuwoImageURL(item.albumpic ?? ""),
    url: "",
    link: `http://www.kuwo.cn/play_detail/${songID}`,
    extra: { rid: songID },
  };
}

async function fetchPlaylistDetail(id: string): Promise<PlaylistDetail> {
  let totalSongs = 0;
  const seen = new Set<string>();
  let playlist: Playlist | null = null;
  const songs: Song[] = [];

  for (let page = 0; page < PLAYLIST_MAX_PAGES; page++) {
    const params = new URLSearchParams({
      op: "getlistinfo",
      pid: id,
      pn: String(page),
      rn: String(PLAYLIST_PAGE_SIZE),
      encode: "utf8",
      keyset: "pl2012",
      identity: "kuwo",
      pcmp4: "1",
      vipver: "1",
      newver: "1",
    });

    const resp = await httpGetJSON<{
      title?: string;
      pic?: string;
      info?: string;
      uname?: string;
      playnum?: unknown;
      total?: unknown;
      validtotal?: unknown;
      musiclist?: KuwoPlaylistMusic[];
    }>(`http://nplserver.kuwo.cn/pl.svc?${params}`, {
      headers: { "User-Agent": UA_PC, ...cookieHeaders() },
    });

    if (page === 0) {
      if (!resp.musiclist?.length) throw new Error("playlist is empty or id is invalid");
      totalSongs = parseAnyInt(resp.total) || parseAnyInt(resp.validtotal);
      playlist = {
        source: "kuwo",
        id,
        name: normalizeKuwoText(resp.title),
        cover: normalizeKuwoImageURL(resp.pic ?? ""),
        track_count: totalSongs,
        play_count: parseAnyInt(resp.playnum),
        creator: normalizeKuwoText(resp.uname),
        description: normalizeKuwoText(resp.info),
        link: `http://www.kuwo.cn/playlist_detail/${id}`,
      };
    }

    if (!resp.musiclist?.length) break;
    for (const item of resp.musiclist) {
      const songID = (item.id ?? "").trim();
      if (!songID || seen.has(songID)) continue;
      seen.add(songID);
      songs.push(kuwoPlaylistSongFromMusic(item));
    }

    if (resp.musiclist.length < PLAYLIST_PAGE_SIZE) break;
    if (totalSongs > 0 && songs.length >= totalSongs) break;
  }

  if (!playlist || !songs.length) throw new Error("playlist is empty or id is invalid");
  if (playlist.track_count === 0) playlist.track_count = songs.length;
  return { playlist, songs };
}

// ---------------------------------------------------------------------------
// 专辑详情（对齐 Go fetchAlbumDetail：legacy API + 网页解析兜底）
// ---------------------------------------------------------------------------

async function fetchAlbumDetail(id: string): Promise<PlaylistDetail> {
  const trimmedID = id.trim();
  if (!trimmedID) throw new Error("album id is empty");

  let legacyResult: PlaylistDetail | null = null;
  let legacyError: unknown = null;
  try {
    legacyResult = await fetchAlbumDetailFromLegacyAPI(trimmedID);
    if (legacyResult.songs.length > 0) return legacyResult;
  } catch (err) {
    legacyError = err;
  }

  let pageResult: PlaylistDetail | null = null;
  let pageError: unknown = null;
  try {
    pageResult = await fetchAlbumDetailFromPage(trimmedID);
    if (pageResult.songs.length > 0) return pageResult;
  } catch (err) {
    pageError = err;
  }

  if (legacyError && pageError) {
    throw new Error(`kuwo album detail failed: legacy api: ${String(legacyError)}; page parse: ${String(pageError)}`);
  }
  if (legacyError) throw legacyError instanceof Error ? legacyError : new Error(String(legacyError));
  if (pageError) throw pageError instanceof Error ? pageError : new Error(String(pageError));
  if (legacyResult) return legacyResult;
  if (pageResult) return pageResult;
  throw new Error("kuwo album detail failed");
}

async function fetchAlbumDetailFromLegacyAPI(id: string): Promise<PlaylistDetail> {
  const pageSize = 100;

  let album: Playlist | null = null;
  let totalSongs = 0;
  const seen = new Set<string>();
  const songs: Song[] = [];

  for (let page = 0; ; page++) {
    const parts = [
      `pn=${page}`,
      `rn=${pageSize}`,
      "stype=albuminfo",
      `albumid=${encodeURIComponent(id)}`,
      "sortby=0",
      "alflac=1",
      "show_copyright_off=1",
      "pcmp4=1",
      "encoding=utf8",
    ];
    const body = await httpGetText(`http://search.kuwo.cn/r.s?${parts.join("&")}`, {
      headers: { "User-Agent": UA_PC, ...cookieHeaders() },
    });
    const resp = parseKuwoLegacyJSON<Record<string, unknown>>(body);

    if (!album) {
      const albumID = firstNonEmpty(parseAnyString(resp.albumid), parseAnyString(resp.id), id);
      totalSongs = parseAnyInt(resp.songnum);
      album = {
        source: "kuwo",
        id: albumID,
        name: normalizeKuwoText(parseAnyString(resp.name)),
        cover: normalizeKuwoImageURL(firstNonEmpty(parseAnyString(resp.hts_img), parseAnyString(resp.img))),
        track_count: totalSongs,
        play_count: 0,
        creator: normalizeKuwoText(firstNonEmpty(parseAnyString(resp.aartist), parseAnyString(resp.artist))),
        description: normalizeKuwoText(parseAnyString(resp.info)),
        link: `http://www.kuwo.cn/album_detail/${albumID}`,
        extra: {
          type: "album",
          album_id: albumID,
          company: normalizeKuwoText(parseAnyString(resp.company)),
          publish_time: parseAnyString(resp.pub).trim(),
          lang: normalizeKuwoText(parseAnyString(resp.lang)),
        },
      };
    }

    const musicList = Array.isArray(resp.musiclist) ? (resp.musiclist as Record<string, unknown>[]) : [];
    if (!musicList.length) {
      if (page === 0) throw new Error(`album ${id} detail api returned empty musiclist`);
      break;
    }

    for (const item of musicList) {
      const rid = firstNonEmpty(parseAnyString(item.id), parseAnyString(item.musicrid));
      if (!rid || seen.has(rid)) continue;
      seen.add(rid);

      let songCover = normalizeKuwoImageURL(firstNonEmpty(parseAnyString(item.pic120), parseAnyString(item.web_albumpic_short)));
      if (!songCover && album) songCover = album.cover;

      const minfo = parseAnyString(item.MINFO);
      const extra: Record<string, string> = { rid };
      if (album) extra.album_id = album.id;
      const track = parseAnyString(item.track).trim();
      if (track) extra.track = track;
      const subtitle = normalizeKuwoText(parseAnyString(item.subtitle));
      if (subtitle) extra.subtitle = subtitle;
      const bitSwitch = parseAnyInt(item.bitSwitch);
      if (bitSwitch > 0) extra.bit_switch = String(bitSwitch);

      const song: Song = {
        source: "kuwo",
        id: rid,
        name: normalizeKuwoText(firstNonEmpty(parseAnyString(item.name), parseAnyString(item.songname))),
        artist: normalizeKuwoText(firstNonEmpty(parseAnyString(item.aartist), parseAnyString(item.artist))),
        album: normalizeKuwoText(firstNonEmpty(parseAnyString(item.album), album?.name ?? "")),
        album_id: album?.id ?? "",
        duration: parseAnyInt(item.duration),
        size: parseSizeFromMInfo(minfo),
        bitrate: parseBitrateFromMInfo(minfo),
        cover: songCover,
        url: "",
        link: `http://www.kuwo.cn/play_detail/${rid}`,
        extra,
      };

      songs.push(song);
    }

    if (musicList.length < pageSize) break;
    if (totalSongs > 0 && songs.length >= totalSongs) break;
  }

  if (!album) throw new Error("album not found");
  if (album.track_count === 0) album.track_count = songs.length;
  return { playlist: album, songs };
}

async function fetchAlbumDetailFromPage(id: string): Promise<PlaylistDetail> {
  const pageURL = `https://www.kuwo.cn/album_detail/${id}`;
  const html = await httpGetText(pageURL, { headers: { "User-Agent": UA_PC, ...cookieHeaders() } });

  let [albumName, artistName] = parseKuwoAlbumPageTitle(findSubmatch(html, /<title>([\s\S]*?)<\/title>/is));
  if (!albumName) {
    albumName = normalizeKuwoText(stripKuwoHTMLTags(findSubmatch(html, /<p class="song_name"[^>]*>([\s\S]*?)<\/p>/is)));
  }
  if (!artistName) {
    artistName = normalizeKuwoText(stripKuwoHTMLTags(findSubmatch(html, /<p class="artist_name"[^>]*>([\s\S]*?)<\/p>/is)));
  }

  const infoBlock = findSubmatch(html, /<p class="song_info"[^>]*>([\s\S]*?)<\/p>/is);
  const infoTips = [...infoBlock.matchAll(/<span class="tip"[^>]*>([\s\S]*?)<\/span>/gis)].map((m) => m[1]);
  const lang = infoTips.length > 0 ? normalizeKuwoText(stripKuwoHTMLTags(infoTips[0])) : "";
  const publishTime = infoTips.length > 1 ? normalizeKuwoText(stripKuwoHTMLTags(infoTips[1])) : "";

  const description = normalizeKuwoText(
    stripKuwoHTMLTags(findSubmatch(html, /<p class="intr_txt"[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/is)),
  );
  let cover = normalizeKuwoImageURL(decodeKuwoEscapedString(findSubmatch(html, /hts_img:"([^"]+)"/)));
  if (!cover) {
    cover = normalizeKuwoImageURL(decodeKuwoEscapedString(findSubmatch(html, /img:"([^"]*albumcover[^"]+)"/)));
  }
  const company = normalizeKuwoText(decodeKuwoEscapedString(findSubmatch(html, /company:"([^"]+)"/)));

  const songBlocks = html.match(/<li class="song_item[^"]*"[^>]*>[\s\S]*?<\/li>/gis) ?? [];
  if (!songBlocks.length) throw new Error("album page returned no songs");

  const album: Playlist = {
    source: "kuwo",
    id,
    name: albumName,
    cover,
    track_count: songBlocks.length,
    play_count: 0,
    creator: artistName,
    description,
    link: pageURL,
    extra: {
      type: "album",
      album_id: id,
      company,
      publish_time: publishTime,
      lang,
    },
  };

  const songs: Song[] = [];
  const seen = new Set<string>();
  for (const block of songBlocks) {
    const rid = findSubmatch(block, /href="\/play_detail\/(\d+)"/);
    if (!rid || seen.has(rid)) continue;
    seen.add(rid);

    const name = normalizeKuwoText(
      stripKuwoHTMLTags(
        firstNonEmpty(
          findSubmatch(block, /title="([^"]+)"/),
          findSubmatch(block, /<a[^>]*class="name"[^>]*>([\s\S]*?)<\/a>/is),
        ),
      ),
    );
    const artist = normalizeKuwoText(
      stripKuwoHTMLTags(
        firstNonEmpty(
          findSubmatch(block, /<div class="song_artist"[^>]*>[\s\S]*?<span[^>]*title="([^"]+)"/is),
          findSubmatch(block, /<div class="song_artist"[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/is),
          artistName,
        ),
      ),
    );
    const track = firstNonEmpty(
      findSubmatch(block, /<div class="rank_num"[^>]*>[\s\S]*?<span style="display:;?"[^>]*>\s*(\d+)\s*<\/span>/is),
      findSubmatch(block, /<div class="rank_num"[^>]*>[\s\S]*?<span[^>]*>\s*(\d+)\s*<\/span>/is),
    );

    const song: Song = {
      source: "kuwo",
      id: rid,
      name,
      artist,
      album: album.name,
      album_id: album.id,
      duration: 0,
      size: 0,
      bitrate: 0,
      cover: album.cover,
      url: "",
      link: `http://www.kuwo.cn/play_detail/${rid}`,
      extra: track ? { rid, album_id: album.id, track } : { rid, album_id: album.id },
    };
    songs.push(song);
  }

  if (!songs.length) throw new Error("album page parsed zero songs");
  album.track_count = songs.length;
  return { playlist: album, songs };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export const kuwo: MusicProvider = {
  name: "kuwo",
  label: "酷我音乐",

  async search(keyword: string): Promise<Song[]> {
    const params = new URLSearchParams({
      vipver: "1",
      client: "kt",
      ft: "music",
      cluster: "0",
      strategy: "2012",
      encoding: "utf8",
      rformat: "json",
      mobi: "1",
      issubtitle: "1",
      show_copyright_off: "1",
      pn: "0",
      rn: "10",
      all: keyword,
    });
    // 对齐 Go：搜索请求带登录 Cookie
    const cookie = getCookie("kuwo");
    const resp = await httpGetJSON<{ abslist?: KuwoSearchItem[] }>(
      `http://www.kuwo.cn/search/searchMusicBykeyWord?${params}`,
      { headers: { "User-Agent": UA_PC, ...(cookie ? { Cookie: cookie } : {}) } },
    );

    const songs: Song[] = [];
    for (const item of resp.abslist ?? []) {
      if (item.bitSwitch === 0) continue;
      const rid = (item.MUSICRID ?? "").replace("MUSIC_", "").trim();
      if (!rid) continue;
      const duration = parseInt(item.DURATION ?? "0", 10) || 0;
      const size = parseSizeFromMInfo(item.MINFO ?? "");
      const bitrate = parseBitrateFromMInfo(item.MINFO ?? "");
      songs.push({
        source: "kuwo",
        id: rid,
        name: (item.SONGNAME ?? "").trim(),
        artist: (item.ARTIST ?? "").trim(),
        album: (item.ALBUM ?? "").trim(),
        duration,
        size,
        bitrate,
        cover: (item.hts_MVPIC ?? "").trim(),
        link: `http://www.kuwo.cn/play_detail/${rid}`,
        extra: { rid },
      });
    }
    return songs;
  },

  async parse(link: string): Promise<Song> {
    const match = link.match(/play_detail\/(\d+)/);
    if (!match) throw new Error("invalid kuwo link, rid not found");
    return fetchFullSongInfo(match[1]);
  },

  async getStreamUrl(song: Song): Promise<string> {
    // 对齐 Go GetDownloadURL：已带直链的 Song 直接返回，避免重复触发上游取流/风控
    const directURL = (song.url ?? "").trim();
    if (directURL) return directURL;
    const rid = song.extra?.rid || song.id;
    // 对齐 Go fetchAudioURL：128 优先（320 易触发风控），带 Cookie
    const qualities = ["128kmp3", "320kmp3", "flac", "2000kflac"];

    for (const br of qualities) {
      const params = new URLSearchParams({
        f: "web",
        source: "kwplayercar_ar_6.0.0.9_B_jiakong_vh.apk",
        from: "PC",
        type: "convert_url_with_sign",
        br,
        rid,
        user: `C_APK_guanwang_${Date.now()}${Math.floor(Math.random() * 1000000)}`,
      });
      try {
        const resp = await httpGetJSON<{ data?: { url?: string } }>(`https://mobi.kuwo.cn/mobi.s?${params}`, {
          headers: { "User-Agent": UA_PC, ...cookieHeaders() },
          timeoutMs: 8_000,
        });
        if (resp.data?.url) return resp.data.url;
      } catch {
        /* try next quality */
      }
    }

    // Web API 兜底（对齐 Go：合并已有 cookie，缺 kw_token 才补 secret_token）
    try {
      const cookie = getCookie("kuwo");
      const cookieWithSecret = cookie.includes("kw_token") ? cookie : `${cookie}; kw_token=secret_token`;
      const resp = await httpGetJSON<{ code?: number; data?: { url?: string } }>(
        `http://www.kuwo.cn/api/v1/www/music/playUrl?mid=${rid}&type=music&httpsStatus=1`,
        {
          headers: {
            "User-Agent": UA_PC,
            Secret: "kuwo_web_secret",
            Cookie: cookieWithSecret,
            Referer: "http://www.kuwo.cn/",
          },
          timeoutMs: 8_000,
        },
      );
      if (resp.data?.url) return resp.data.url;
    } catch {
      /* ignore */
    }
    throw new Error("kuwo: 未获取到播放链接（可能是版权受限）");
  },

  async getLyric(song: Song): Promise<string> {
    const rid = song.extra?.rid || song.id;
    const rawParams = `user=12345,web,web,web&requester=localhost&req=1&rid=MUSIC_${rid}&lrcx=1`;
    // 与 key "yeelion" 循环 XOR 后 base64
    const key = Buffer.from("yeelion", "utf8");
    const bytes = Buffer.from(rawParams, "utf8");
    const xored = Buffer.allocUnsafe(bytes.length);
    for (let i = 0; i < bytes.length; i++) xored[i] = bytes[i] ^ key[i % key.length];
    const encoded = xored.toString("base64");

    // 对齐 Go：newlyric 失败/为空时降级 m.kuwo.cn songinfoandlrc 拼行级 LRC
    try {
      // httpRequest：统一封装（默认 15s 超时，避免上游挂起拖死歌词请求）
      const resp = await httpRequest(`http://newlyric.kuwo.cn/newlyric.lrc?${encoded}`, {
        headers: { "User-Agent": UA_PC, ...cookieHeaders() },
      });
      if (resp.ok) {
        const body = Buffer.from(await resp.arrayBuffer());
        const raw = decodeKuwoLyric(body);
        // 对齐 Go convertKuwoNewLyric：原文行后追加独立 roma/translation 行，保留 tag 行
        const converted = convertKuwoNewLyric(raw);
        if (converted.trim()) return converted;
      }
    } catch {
      /* fallthrough to mobile API */
    }

    const fallback = await httpGetJSON<{ data?: { lrclist?: { time?: string; lineLyric?: string }[] } }>(
      `http://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${rid}&httpsStatus=1`,
      { headers: { "User-Agent": UA_PC, ...cookieHeaders() } },
    );
    const lrclist = fallback.data?.lrclist ?? [];
    if (!lrclist.length) throw new Error("kuwo: 歌词内容为空");

    let out = "";
    for (const line of lrclist) {
      const secs = parseFloat(line.time ?? "0") || 0;
      const m = Math.floor(Math.floor(secs) / 60);
      const s = Math.floor(secs) % 60;
      const ms = Math.floor((secs - Math.floor(secs)) * 100);
      out += `[${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(2, "0")}]${line.lineLyric ?? ""}\n`;
    }
    return out.trimEnd();
  },

  // ---- AlbumProvider ----

  async searchAlbum(keyword: string): Promise<Playlist[]> {
    const resp = await searchCollection<{
      albumlist?: {
        albumid?: string;
        id?: string;
        name?: string;
        artist?: string;
        aartist?: string;
        hts_img?: string;
        img?: string;
        musiccnt?: string;
        info?: string;
        company?: string;
        pub?: string;
        PLAYCNT?: string;
      }[];
    }>(keyword, "album");

    const albums: Playlist[] = [];
    for (const item of resp.albumlist ?? []) {
      const albumID = firstNonEmpty(item.albumid, item.id);
      if (!albumID) continue;

      albums.push({
        source: "kuwo",
        id: albumID,
        name: normalizeKuwoText(item.name),
        cover: normalizeKuwoImageURL(firstNonEmpty(item.hts_img, item.img)),
        track_count: parseStringInt(item.musiccnt),
        play_count: parseStringInt(item.PLAYCNT),
        creator: normalizeKuwoText(firstNonEmpty(item.aartist, item.artist)),
        description: normalizeKuwoText(item.info),
        link: `http://www.kuwo.cn/album_detail/${albumID}`,
        extra: {
          type: "album",
          album_id: albumID,
          company: normalizeKuwoText(item.company),
          publish_time: (item.pub ?? "").trim(),
        },
      });
    }

    if (!albums.length) throw new Error("no albums found");
    return albums;
  },

  async getAlbumSongs(id: string): Promise<Song[]> {
    return (await fetchAlbumDetail(id)).songs;
  },

  async parseAlbum(link: string): Promise<PlaylistDetail> {
    const patterns = [/album_detail\/(\d+)/, /album\/(\d+)/, /albumid=(\d+)/];
    for (const pattern of patterns) {
      const match = link.match(pattern);
      if (match) return fetchAlbumDetail(match[1]);
    }
    throw new Error("invalid kuwo album link");
  },

  // ---- PlaylistProvider ----

  async searchPlaylist(keyword: string): Promise<Playlist[]> {
    const resp = await searchCollection<{
      abslist?: {
        playlistid?: string;
        name?: string;
        pic?: string;
        songnum?: string;
        intro?: string;
        nickname?: string;
      }[];
    }>(keyword, "playlist");

    const playlists: Playlist[] = [];
    for (const item of resp.abslist ?? []) {
      const count = parseStringInt(item.songnum);
      let cover = item.pic ?? "";
      if (cover) {
        cover = cover.replace("_150.", "_700.");
        if (!cover.startsWith("http")) cover = "http://" + cover;
      }
      playlists.push({
        source: "kuwo",
        id: (item.playlistid ?? "").trim(),
        name: normalizeKuwoText(item.name),
        cover,
        track_count: count,
        play_count: 0,
        creator: normalizeKuwoText(item.nickname),
        description: normalizeKuwoText(item.intro),
        link: `http://www.kuwo.cn/playlist_detail/${(item.playlistid ?? "").trim()}`,
      });
    }
    return playlists;
  },

  async getPlaylistSongs(id: string): Promise<Song[]> {
    return (await fetchPlaylistDetail(id)).songs;
  },

  async parsePlaylist(link: string): Promise<PlaylistDetail> {
    const match = link.match(/playlist_detail\/(\d+)/);
    if (!match) throw new Error("invalid kuwo playlist link");
    return fetchPlaylistDetail(match[1]);
  },

  // ---- RecommendedPlaylistProvider ----

  async getRecommendedPlaylists(): Promise<Playlist[]> {
    const params = new URLSearchParams({ pn: "0", rn: "30", order: "hot" });
    const resp = await httpGetJSON<{
      code?: number;
      data?: {
        data?: {
          id?: unknown;
          name?: string;
          img?: string;
          listencnt?: unknown;
          songnum?: unknown;
          total?: unknown;
          count?: unknown;
          musicnum?: unknown;
          uname?: string;
          desc?: string;
        }[];
      };
    }>(`http://wapi.kuwo.cn/api/pc/classify/playlist/getRcmPlayList?${params}`, {
      headers: { "User-Agent": UA_PC, ...cookieHeaders() },
    });

    if (resp.code !== 200) throw new Error(`kuwo api error code: ${resp.code}`);

    const playlists: Playlist[] = [];
    for (const item of resp.data?.data ?? []) {
      const playlistID = parseAnyString(item.id);
      const name = normalizeKuwoText(item.name);
      if (!playlistID || !name) continue;

      let cover = item.img ?? "";
      if (cover && !cover.startsWith("http")) cover = "http://" + cover;

      const trackCount =
        parseAnyInt(item.songnum) || parseAnyInt(item.total) || parseAnyInt(item.count) || parseAnyInt(item.musicnum);

      playlists.push({
        source: "kuwo",
        id: playlistID,
        name,
        cover,
        track_count: trackCount,
        play_count: parseAnyInt(item.listencnt),
        creator: normalizeKuwoText(item.uname),
        description: normalizeKuwoText(item.desc),
        link: `http://www.kuwo.cn/playlist_detail/${playlistID}`,
      });
    }

    if (!playlists.length) throw new Error("no recommended playlists found");
    return playlists;
  },

  // ---- PlaylistCategoryProvider ----

  async getPlaylistCategories(): Promise<PlaylistCategory[]> {
    const params = new URLSearchParams({
      cmd: "rcm_keyword_playlist",
      user: "0",
      prod: "kwplayer_pc_9.1.1.2",
      vipver: "9.1.1.2",
      source: "kwplayer_pc_9.1.1.2",
      loginUid: "0",
      loginSid: "0",
      appUid: "38668888",
    });
    const body = await httpGetBuffer(`http://wapi.kuwo.cn/api/pc/classify/playlist/getTagList?${params}`, {
      headers: { "User-Agent": UA_PC, ...cookieHeaders() },
    });

    const resp = JSON.parse(decodeBodyBuffer(body)) as {
      code?: number;
      msg?: string;
      data?: {
        id?: string;
        name?: string;
        mdigest?: string;
        data?: { id?: string; name?: string; digest?: string; extend?: string; isnew?: string }[];
      }[];
    };
    if (resp.code !== 200) {
      throw new Error(`kuwo playlist category api error: ${resp.msg} (code ${resp.code})`);
    }

    const categories: PlaylistCategory[] = [
      { source: "kuwo", id: "", name: "全部", group: "全部", count: 0 },
    ];
    for (const group of resp.data ?? []) {
      const groupName = normalizeKuwoText(group.name);
      for (const item of group.data ?? []) {
        const id = (item.id ?? "").trim();
        const name = normalizeKuwoText(item.name);
        const digest = (item.digest ?? "").trim();
        if (!id || !name || (digest && digest !== "10000")) continue;
        categories.push({
          source: "kuwo",
          id,
          name,
          group: groupName,
          count: 0,
          hot: (item.extend ?? "").toUpperCase().includes("HOT"),
          extra: {
            group_id: group.id ?? "",
            mdigest: group.mdigest ?? "",
            digest,
            is_new: item.isnew ?? "",
          },
        });
      }
    }
    if (categories.length === 1) throw new Error("no playlist categories found");
    return categories;
  },

  async getCategoryPlaylists(categoryId: string, page: number, limit: number): Promise<Playlist[]> {
    const categoryID = categoryId.trim();
    if (page < 1) page = 1;
    if (limit < 1) limit = 20;

    const params = new URLSearchParams({
      loginUid: "0",
      loginSid: "0",
      appUid: "38668888",
      pn: String(page),
      rn: String(limit),
    });

    let endpoint = "getRcmPlayList";
    if (!categoryID) {
      params.set("order", "hot");
    } else {
      endpoint = "getTagPlayList";
      params.set("id", categoryID);
    }

    const body = await httpGetBuffer(`http://wapi.kuwo.cn/api/pc/classify/playlist/${endpoint}?${params}`, {
      headers: { "User-Agent": UA_PC, ...cookieHeaders() },
    });

    const resp = JSON.parse(decodeBodyBuffer(body)) as {
      code?: number;
      msg?: string;
      data?: {
        data?: {
          id?: unknown;
          name?: string;
          img?: string;
          listencnt?: unknown;
          songnum?: unknown;
          total?: unknown;
          count?: unknown;
          musicnum?: unknown;
          uname?: string;
          desc?: string;
          info?: string;
        }[];
      };
    };
    if (resp.code !== 200) {
      throw new Error(`kuwo category playlist api error: ${resp.msg} (code ${resp.code})`);
    }

    const playlists: Playlist[] = [];
    for (const item of resp.data?.data ?? []) {
      const playlistID = parseAnyString(item.id);
      const name = normalizeKuwoText(item.name);
      if (!playlistID || !name) continue;

      const trackCount =
        parseAnyInt(item.songnum) || parseAnyInt(item.total) || parseAnyInt(item.count) || parseAnyInt(item.musicnum);

      playlists.push({
        source: "kuwo",
        id: playlistID,
        name,
        cover: normalizeKuwoImageURL(item.img ?? ""),
        track_count: trackCount,
        play_count: parseAnyInt(item.listencnt),
        creator: normalizeKuwoText(item.uname),
        description: normalizeKuwoText(firstNonEmpty(item.desc, item.info)),
        link: `http://www.kuwo.cn/playlist_detail/${playlistID}`,
        extra: { category_id: categoryID },
      });
    }
    if (!playlists.length) throw new Error("no category playlists found");
    return playlists;
  },
};
