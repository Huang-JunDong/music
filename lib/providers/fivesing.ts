/**
 * 5sing 原创音乐 Provider — 逐行移植自 music-lib/fivesing（fivesing.go / song.go /
 * download.go / lyric.go / playlist.go / user_playlist.go）。
 * 歌单详情走 mobileapi + HTML 双通道解析。
 */
import type { MusicProvider, Playlist, PlaylistDetail, Song } from "../types";
import { httpGetJSON, httpGetText } from "../http";
import { getCookie } from "../cookies";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

function headers(): Record<string, string> {
  return { "User-Agent": UA, Cookie: getCookie("fivesing") };
}

/** 常用 HTML 实体反转义（对齐 Go html.UnescapeString 的常见子集） */
function unescapeHtml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

/** 对齐 removeEmTags：去掉搜索结果高亮标签 */
function removeEmTags(s: string): string {
  return s.replaceAll('<em class="keyword">', "").replaceAll("</em>", "").trim();
}

function getFirstValid(...urls: (string | undefined)[]): string {
  for (const u of urls) {
    if (u) return u;
  }
  return "";
}

/** 对齐 fetchAudioLink：getSongUrl，SQ → HQ → LQ（含 backup） */
async function fetchAudioLink(songID: string, songType: string): Promise<string> {
  const params = new URLSearchParams({ songid: songID, songtype: songType });
  const resp = await httpGetJSON<{
    code?: number;
    data?: {
      squrl?: string;
      squrl_backup?: string;
      hqurl?: string;
      hqurl_backup?: string;
      lqurl?: string;
      lqurl_backup?: string;
    };
  }>(`http://mobileapi.5sing.kugou.com/song/getSongUrl?${params}`, { headers: headers() });

  if (resp.code !== 1000) throw new Error("api returned error code");

  const d = resp.data ?? {};
  const sq = getFirstValid(d.squrl, d.squrl_backup);
  if (sq) return sq;
  const hq = getFirstValid(d.hqurl, d.hqurl_backup);
  if (hq) return hq;
  const lq = getFirstValid(d.lqurl, d.lqurl_backup);
  if (lq) return lq;
  throw new Error("no valid download url found");
}

/** 对齐 fetchCreatorName：getsonglist?songfields=user */
async function fetchCreatorName(id: string): Promise<string> {
  const raw = await httpGetJSON<{ data?: unknown }>(
    `http://mobileapi.5sing.kugou.com/song/getsonglist?id=${id}&songfields=user`,
    { headers: { "User-Agent": UA } },
  );
  const data = raw.data;
  // data 为 [] 时表示无数据，返回空名
  if (!data || typeof data !== "object" || Array.isArray(data)) return "";
  return ((data as { user?: { NN?: string } }).user?.NN ?? "").trim();
}

/** 对齐 fetchSongInfo：音频链接 + newget 元数据 */
async function fetchSongInfo(songID: string, songType: string): Promise<Song> {
  const audioURL = await fetchAudioLink(songID, songType);

  const params = new URLSearchParams({ songid: songID, songtype: songType });
  let name = "";
  let artist = "";
  let cover = "";
  try {
    const metaResp = await httpGetJSON<{ data?: { SN?: string; user?: { NN?: string; I?: string } } }>(
      `http://mobileapi.5sing.kugou.com/song/newget?${params}`,
      { headers: headers() },
    );
    name = metaResp.data?.SN ?? "";
    artist = metaResp.data?.user?.NN ?? "";
    cover = metaResp.data?.user?.I ?? "";
  } catch {
    // 对齐 Go：metaBody 为 nil 时忽略
  }

  if (!name) name = `5sing_${songType}_${songID}`;

  return {
    source: "fivesing",
    id: `${songID}|${songType}`,
    name,
    artist,
    album: "",
    duration: 0,
    size: 0,
    bitrate: 0,
    url: audioURL,
    cover,
    link: `http://5sing.kugou.com/${songType}/${songID}.html`,
    extra: { songid: songID, songtype: songType },
  };
}

/** 对齐 parseSongsFromHTML：从歌单页 HTML 提取歌曲 */
function parseSongsFromHTML(htmlContent: string): Song[] {
  const blockRe = /<li class="p_rel">([\s\S]*?)<\/li>/g;
  const songRe = /href="http:\/\/5sing\.kugou\.com\/(yc|fc|bz)\/(\d+)\.html"[^>]*>([^<]+)<\/a>/;
  const artistRe = /class="s_soner[^"]*".*?>([^<]+)<\/a>/;

  const songs: Song[] = [];
  const seen = new Set<string>();
  let block: RegExpExecArray | null;
  while ((block = blockRe.exec(htmlContent)) !== null) {
    const blockHTML = block[1];

    const songMatch = blockHTML.match(songRe);
    if (!songMatch) continue;
    const kind = songMatch[1];
    const songID = songMatch[2];
    const rawName = songMatch[3];

    let artist = "Unknown";
    const artistMatch = blockHTML.match(artistRe);
    if (artistMatch) artist = artistMatch[1];

    const uniqueKey = `${kind}|${songID}`;
    if (seen.has(uniqueKey)) continue;
    seen.add(uniqueKey);

    const name = unescapeHtml(rawName).trim();
    artist = unescapeHtml(artist).trim();

    songs.push({
      source: "fivesing",
      id: `${songID}|${kind}`,
      name,
      artist,
      album: "",
      duration: 0,
      size: 0,
      bitrate: 0,
      url: "",
      cover: "",
      link: `http://5sing.kugou.com/${kind}/${songID}.html`,
      extra: { songid: songID, songtype: kind },
    });
  }
  if (songs.length === 0) throw new Error("no songs found in playlist html (structure mismatch)");
  return songs;
}

/** 对齐 fetchPlaylistDetail：API 元数据 + HTML 歌曲解析 */
async function fetchPlaylistDetail(id: string): Promise<PlaylistDetail> {
  const raw = await httpGetJSON<{ data?: unknown }>(
    `http://mobileapi.5sing.kugou.com/song/getsonglist?id=${id}&songfields=ID,user`,
    { headers: { "User-Agent": UA } },
  );
  const data = raw.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("playlist info not found or invalid (api returned empty list)");
  }
  const d = data as {
    T?: string;
    C?: string;
    P?: string;
    H?: number;
    E?: number;
    user?: { ID?: number; NN?: string };
  };

  const userId = d.user?.ID ? String(d.user.ID) : "";
  if (!userId) throw new Error("playlist user not found or invalid id");

  const playlist: Playlist = {
    source: "fivesing",
    id,
    name: d.T ?? "",
    cover: d.P ?? "",
    track_count: d.E ?? 0,
    play_count: d.H ?? 0,
    creator: d.user?.NN ?? "",
    description: d.C ?? "",
    link: `http://5sing.kugou.com/${userId}/dj/${id}.html`,
    extra: { user_id: userId },
  };

  let htmlBody: string;
  try {
    htmlBody = await httpGetText(playlist.link, { headers: headers() });
  } catch (err) {
    // 对齐 Go：HTML 拉取失败时返回错误（歌单元数据一起丢弃）
    throw err;
  }

  let songs: Song[] = [];
  try {
    songs = parseSongsFromHTML(htmlBody);
  } catch {
    // 解析失败不影响元数据返回（有些歌单确实为空）
  }
  return { playlist, songs };
}

function songIdParts(song: Song): { songID: string; songType: string } {
  let songID = song.extra?.songid ?? "";
  let songType = song.extra?.songtype ?? "";
  if (!songID || !songType) {
    const parts = song.id.split("|");
    if (parts.length === 2) {
      songID = parts[0];
      songType = parts[1];
    }
  }
  return { songID, songType };
}

export const fivesing: MusicProvider = {
  name: "fivesing",
  label: "5sing原创",

  /** Search 搜索歌曲 */
  async search(keyword: string): Promise<Song[]> {
    const params = new URLSearchParams({
      keyword,
      sort: "1",
      page: "1",
      filter: "0",
      type: "0",
    });
    const resp = await httpGetJSON<{
      list?: { songId?: number; songName?: string; singer?: string; songSize?: number; typeEname?: string }[];
    }>(`http://search.5sing.kugou.com/home/json?${params}`, { headers: headers() });

    const songs: Song[] = [];
    for (const item of resp.list ?? []) {
      const name = removeEmTags(unescapeHtml(item.songName ?? ""));
      const artist = removeEmTags(unescapeHtml(item.singer ?? ""));
      const songSize = item.songSize ?? 0;
      const duration = songSize > 0 ? Math.floor((songSize * 8) / 320000) : 0;

      songs.push({
        source: "fivesing",
        id: `${item.songId ?? 0}|${item.typeEname ?? ""}`,
        name,
        artist,
        album: "",
        duration,
        size: songSize,
        bitrate: 0,
        url: "",
        cover: "",
        link: `http://5sing.kugou.com/${item.typeEname ?? ""}/${item.songId ?? 0}.html`,
        extra: { songid: String(item.songId ?? 0), songtype: item.typeEname ?? "" },
      });
    }
    return songs;
  },

  /** Parse 解析单曲链接 */
  async parse(link: string): Promise<Song> {
    const m = link.match(/5sing\.kugou\.com\/(\w+)\/(\d+)\.html/);
    if (!m) throw new Error("invalid 5sing link");
    return fetchSongInfo(m[2], m[1]);
  },

  /** GetDownloadURL 获取下载链接 */
  async getStreamUrl(song: Song): Promise<string> {
    if (song.source !== "fivesing") throw new Error("source mismatch");
    if (song.url) return song.url;

    const { songID, songType } = songIdParts(song);
    if (!songID || !songType) throw new Error("invalid id structure");
    return fetchAudioLink(songID, songType);
  },

  /** GetLyrics 获取动态歌词 */
  async getLyric(song: Song): Promise<string> {
    if (song.source !== "fivesing") throw new Error("source mismatch");

    const { songID, songType } = songIdParts(song);
    if (!songID) throw new Error("invalid id");

    const params = new URLSearchParams({ songid: songID, songtype: songType });
    const resp = await httpGetJSON<{ data?: { dynamicWords?: string } }>(
      `http://mobileapi.5sing.kugou.com/song/newget?${params}`,
      { headers: headers() },
    );
    const lyric = resp.data?.dynamicWords ?? "";
    if (!lyric) throw new Error("lyrics not found");
    return lyric;
  },

  /** SearchPlaylist 搜索歌单 */
  async searchPlaylist(keyword: string): Promise<Playlist[]> {
    const params = new URLSearchParams({
      keyword,
      sort: "1",
      page: "1",
      filter: "0",
      type: "1",
    });
    const resp = await httpGetJSON<{
      list?: {
        songListId?: string;
        title?: string;
        pictureUrl?: string;
        playCount?: number;
        userName?: string;
        songCnt?: number;
        content?: string;
        userId?: string;
      }[];
    }>(`http://search.5sing.kugou.com/home/json?${params}`, { headers: headers() });

    const items = resp.list ?? [];
    // 缺失 creator 的项并行补齐（对齐 Go errgroup 并发；结果顺序不变，失败保留 ID 占位）
    const missing = items.filter((item) => !item.userName && item.songListId);
    const fetchedNames = await Promise.all(
      missing.map((item) =>
        fetchCreatorName(String(item.songListId))
          .then((name) => name || "")
          .catch(() => ""),
      ),
    );
    const nameMap = new Map<string, string>();
    missing.forEach((item, i) => nameMap.set(String(item.songListId), fetchedNames[i] ?? ""));

    const playlists: Playlist[] = [];
    for (const item of items) {
      const title = removeEmTags(unescapeHtml(item.title ?? ""));
      let desc = removeEmTags(unescapeHtml(item.content ?? ""));
      if (desc === "0") desc = "";

      let creator = item.userName ?? "";
      if (!creator) creator = nameMap.get(String(item.songListId)) ?? "";
      if (!creator) creator = "ID: " + (item.userId ?? "");

      playlists.push({
        source: "fivesing",
        id: item.songListId ?? "",
        name: title,
        cover: item.pictureUrl ?? "",
        track_count: item.songCnt ?? 0,
        play_count: item.playCount ?? 0,
        creator,
        description: desc,
        link: `http://5sing.kugou.com/${item.userId ?? ""}/dj/${item.songListId ?? ""}.html`,
        extra: { user_id: item.userId ?? "" },
      });
    }
    return playlists;
  },

  /** GetPlaylistSongs 获取歌单歌曲 */
  async getPlaylistSongs(id: string): Promise<Song[]> {
    return (await fetchPlaylistDetail(id)).songs;
  },

  /** ParsePlaylist 解析歌单链接 */
  async parsePlaylist(link: string): Promise<PlaylistDetail> {
    const m = link.match(/5sing\.kugou\.com\/(?:(\d+)\/)?dj\/([a-zA-Z0-9]+)\.html/);
    if (!m) throw new Error("invalid 5sing playlist link");
    return fetchPlaylistDetail(m[2]);
  },

  // GetPlaylistCategories / GetCategoryPlaylists / SearchAlbum / GetUserPlaylists：
  // Go 返回 ErrPlaylistCategoriesUnsupported / ErrUserPlaylistsUnsupported / 无专辑实现 → 不实现
};
