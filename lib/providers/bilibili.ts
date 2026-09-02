/**
 * Bilibili Provider — 逐行移植自 music-lib/bilibili 包：
 * - bilibili.go：fetchView / fetchPageList / fetchSeasonSongs / fetchSeasonArchiveIndex / 音频直链
 * - song.go：Search（视频搜索取第一分 P）/ Parse
 * - download.go：GetDownloadURL（playurl dash 直链，VIP 请求 4048 高规格）
 * - lyric.go：GetLyrics（B 站无歌词，返回空）
 * - playlist.go：SearchPlaylist / GetPlaylistSongs / ParsePlaylist（合集 season 与分 P multipart）
 * - user_playlist.go：GetUserPlaylists（Go 返回 ErrUserPlaylistsUnsupported → 契约保持 undefined）
 * - playlist.go 中 GetPlaylistCategories / GetCategoryPlaylists（Go 返回 ErrPlaylistCategoriesUnsupported → 契约保持 undefined）
 * - login.go：CreateQRLogin / CheckQRLogin（passport 二维码登录）
 * - account.go：IsVipAccount（nav 接口大会员探测 + 缓存）
 */
import type {
  MusicProvider,
  Song,
  Playlist,
  PlaylistDetail,
  QRLoginSession,
  QRLoginResult,
} from "../types";
import { httpGetText, httpGetJSON, httpRequest, responseCookies, firstNonEmpty } from "../http";
import { getCookie, setCookie } from "../cookies";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0";
const REFERER = "https://www.bilibili.com/";

const BILIBILI_QR_GENERATE_API = "https://passport.bilibili.com/x/passport-login/web/qrcode/generate";
const BILIBILI_QR_POLL_API = "https://passport.bilibili.com/x/passport-login/web/qrcode/poll";

/** 对齐 Go New(cookie)：cookie 为空时使用默认 buvid/SESSDATA */
const DEFAULT_COOKIE = "buvid3=2E109C72-251F-3827-FA8E-921FA0D7EC5291319infoc; SESSDATA=your_sessdata;";

function currentCookie(): string {
  return getCookie("bilibili") || DEFAULT_COOKIE;
}

// ---------------------------------------------------------------------------
// bilibili.go — 响应结构与辅助
// ---------------------------------------------------------------------------

interface BiliPage {
  cid?: number;
  part?: string;
  duration?: number;
}

interface BiliSeasonEpisode {
  bvid?: string;
  cid?: number;
  title?: string;
  cover?: string;
  duration?: number;
  arc?: { pic?: string; title?: string; duration?: number };
  page?: { part?: string; duration?: number };
}

interface BiliSeasonSection {
  episodes?: BiliSeasonEpisode[];
}

interface BiliViewData {
  bvid?: string;
  title?: string;
  pic?: string;
  owner?: { name?: string; mid?: number };
  pages?: BiliPage[];
  ugc_season?: {
    id?: number;
    title?: string;
    cover?: string;
    intro?: string;
    stat?: { view?: number };
    sections?: BiliSeasonSection[];
  } | null;
}

interface BiliViewResponse {
  data?: BiliViewData;
}

interface BiliSeasonArchive {
  bvid?: string;
  title?: string;
  cover?: string;
  duration?: number;
  cid?: number;
}

interface BiliSeasonResp {
  code?: number;
  data?: {
    season?: { id?: number; title?: string; cover?: string; intro?: string };
    page?: { total?: number };
    archives?: BiliSeasonArchive[];
  };
}

interface BiliSeasonArchiveMeta {
  title: string;
  cover: string;
  duration: number;
}

function cleanTitle(t: string): string {
  if (t === "") return "";
  t = t.replaceAll('<em class="keyword">', "");
  t = t.replaceAll("</em>", "");
  return t;
}

function countSeasonEpisodes(sections: BiliSeasonSection[]): number {
  let count = 0;
  for (const sec of sections) {
    count += sec.episodes?.length ?? 0;
  }
  return count;
}

function normalizeCover(cover: string): string {
  if (cover.startsWith("//")) {
    return "https:" + cover;
  }
  return cover;
}

function biliHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "User-Agent": USER_AGENT, Referer: REFERER, Cookie: currentCookie(), ...extra };
}

// ---------------------------------------------------------------------------
// account.go — 大会员探测（按 cookie 缓存）
// ---------------------------------------------------------------------------

let vipCache: { cookie: string; isVip: boolean } | null = null;

async function isVipAccount(): Promise<boolean> {
  const cookie = currentCookie();
  if (vipCache && vipCache.cookie === cookie) {
    return vipCache.isVip;
  }

  if (cookie === "") {
    vipCache = { cookie, isVip: false };
    return false;
  }

  const body = await httpGetText("https://api.bilibili.com/x/web-interface/nav", {
    headers: biliHeaders(),
  });

  let resp: { code?: number; data?: { isLogin?: boolean; vipStatus?: number; vipType?: number } };
  try {
    resp = JSON.parse(body) as typeof resp;
  } catch (e) {
    throw new Error(`bilibili nav json parse error: ${String(e)}`);
  }

  let isVip = false;
  if (resp.code === 0 && resp.data?.isLogin === true && resp.data?.vipStatus === 1 && (resp.data?.vipType ?? 0) > 0) {
    isVip = true;
  }

  vipCache = { cookie, isVip };
  return isVip;
}

// ---------------------------------------------------------------------------
// bilibili.go — view / pagelist / season
// ---------------------------------------------------------------------------

async function fetchView(bvid: string): Promise<BiliViewResponse> {
  const viewURL = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`;
  const viewBody = await httpGetText(viewURL, {
    headers: { "User-Agent": USER_AGENT, Cookie: currentCookie() },
  });
  return JSON.parse(viewBody) as BiliViewResponse;
}

async function fetchPageList(bvid: string): Promise<BiliPage[]> {
  const pageURL = `https://api.bilibili.com/x/player/pagelist?bvid=${bvid}`;
  const body = await httpGetText(pageURL, {
    headers: biliHeaders(),
  });

  const resp = JSON.parse(body) as { code?: number; data?: BiliPage[] };
  if (resp.code !== 0) {
    throw new Error(`bilibili pagelist api error: ${resp.code ?? 0}`);
  }
  return resp.data ?? [];
}

function buildSongsFromPages(bvid: string, rootTitle: string, author: string, cover: string, pages: BiliPage[]): Song[] {
  const songs: Song[] = [];
  cover = normalizeCover(cover);

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    let displayTitle = page.part ?? "";
    if (pages.length === 1 && displayTitle === "") {
      displayTitle = rootTitle;
    } else if (displayTitle !== rootTitle) {
      displayTitle = `${rootTitle} - ${displayTitle}`;
    }

    songs.push({
      source: "bilibili",
      id: `${bvid}|${page.cid ?? 0}`,
      name: displayTitle,
      artist: author,
      album: bvid,
      duration: page.duration ?? 0,
      size: 0,
      bitrate: 0,
      cover,
      url: "",
      link: `https://www.bilibili.com/video/${bvid}?p=${i + 1}`,
      extra: {
        bvid,
        cid: String(page.cid ?? 0),
      },
    });
  }
  return songs;
}

function buildSongsFromSeasonSections(
  sections: BiliSeasonSection[],
  seasonTitle: string,
  seasonCover: string,
  artistName: string,
  archiveIndex: Map<string, BiliSeasonArchiveMeta>,
): Song[] {
  const songs: Song[] = [];
  if (artistName === "") {
    artistName = seasonTitle;
  }
  for (const sec of sections) {
    for (const ep of sec.episodes ?? []) {
      let cover = ep.cover ?? "";
      let meta = archiveIndex.get(`bvid:${ep.bvid ?? ""}`);
      let hasMeta = meta !== undefined;
      if (!hasMeta && ep.cid !== 0 && ep.cid !== undefined) {
        meta = archiveIndex.get(`cid:${ep.cid}`);
        hasMeta = meta !== undefined;
      }
      if (cover === "") {
        cover = ep.arc?.pic ?? "";
      }
      if (cover === "") {
        cover = seasonCover;
        if (cover === "" && hasMeta) {
          cover = meta!.cover;
        }
      }
      cover = normalizeCover(cover);
      let duration = ep.duration ?? 0;
      if (duration === 0) {
        duration = ep.page?.duration ?? 0;
      }
      if (duration === 0) {
        duration = ep.arc?.duration ?? 0;
      }
      if (duration === 0 && hasMeta) {
        duration = meta!.duration;
      }
      let name = ep.title ?? "";
      if (name === "") {
        name = ep.arc?.title ?? "";
      }
      if (name === "") {
        name = ep.page?.part ?? "";
      }
      if (name === "" && hasMeta) {
        name = meta!.title;
      }
      songs.push({
        source: "bilibili",
        id: `${ep.bvid ?? ""}|${ep.cid ?? 0}`,
        name,
        artist: artistName,
        album: ep.bvid ?? "",
        duration,
        size: 0,
        bitrate: 0,
        cover,
        url: "",
        link: `https://www.bilibili.com/video/${ep.bvid ?? ""}`,
        extra: {
          bvid: ep.bvid ?? "",
          cid: String(ep.cid ?? 0),
        },
      });
    }
  }
  return songs;
}

async function fetchSeasonArchiveIndex(
  mid: number,
  seasonID: number,
): Promise<{ index: Map<string, BiliSeasonArchiveMeta>; seasonTitle: string; seasonCover: string }> {
  if (seasonID === 0 || mid === 0) {
    throw new Error("invalid season info");
  }

  const index = new Map<string, BiliSeasonArchiveMeta>();
  let processedArchives = 0;
  let seasonTitle = "";
  let seasonCover = "";
  let pageNum = 1;
  const pageSize = 30;
  for (;;) {
    const apiURL = `https://api.bilibili.com/x/space/ugc/season?mid=${mid}&season_id=${seasonID}&page_num=${pageNum}&page_size=${pageSize}`;
    const body = await httpGetText(apiURL, { headers: biliHeaders() });

    const resp = JSON.parse(body) as BiliSeasonResp;
    if (resp.code !== 0) {
      throw new Error(`bilibili season api error: ${resp.code ?? 0}`);
    }
    if (seasonTitle === "") {
      seasonTitle = resp.data?.season?.title ?? "";
    }
    if (seasonCover === "") {
      seasonCover = resp.data?.season?.cover ?? "";
    }
    const archives = resp.data?.archives ?? [];
    if (archives.length === 0) break;

    for (const arc of archives) {
      const meta: BiliSeasonArchiveMeta = {
        title: arc.title ?? "",
        cover: normalizeCover(arc.cover ?? ""),
        duration: arc.duration ?? 0,
      };
      if ((arc.bvid ?? "") !== "") {
        index.set(`bvid:${arc.bvid}`, meta);
      }
      if ((arc.cid ?? 0) !== 0) {
        index.set(`cid:${arc.cid}`, meta);
      }
    }
    processedArchives += archives.length;

    const total = resp.data?.page?.total ?? 0;
    if (total === 0 || processedArchives >= total) {
      break;
    }
    pageNum++;
  }
  return { index, seasonTitle, seasonCover };
}

async function fetchSeasonSongs(mid: number, seasonID: number): Promise<Song[]> {
  if (seasonID === 0 || mid === 0) {
    throw new Error("invalid season info");
  }

  const allSongs: Song[] = [];
  let processedArchives = 0;
  let seasonTitle = "";
  let seasonCover = "";
  let pageNum = 1;
  const pageSize = 30;
  for (;;) {
    const apiURL = `https://api.bilibili.com/x/space/ugc/season?mid=${mid}&season_id=${seasonID}&page_num=${pageNum}&page_size=${pageSize}`;
    const body = await httpGetText(apiURL, { headers: biliHeaders() });

    const resp = JSON.parse(body) as BiliSeasonResp;
    if (resp.code !== 0) {
      throw new Error(`bilibili season api error: ${resp.code ?? 0}`);
    }
    if (seasonTitle === "") {
      seasonTitle = resp.data?.season?.title ?? "";
    }
    if (seasonCover === "") {
      seasonCover = resp.data?.season?.cover ?? "";
    }
    const archives = resp.data?.archives ?? [];
    if (archives.length === 0) break;

    for (const arc of archives) {
      if ((arc.cid ?? 0) !== 0) {
        let cover = arc.cover ?? "";
        if (cover === "") {
          cover = seasonCover;
        }
        allSongs.push({
          source: "bilibili",
          id: `${arc.bvid ?? ""}|${arc.cid ?? 0}`,
          name: arc.title ?? "",
          artist: "",
          album: seasonTitle,
          duration: arc.duration ?? 0,
          size: 0,
          bitrate: 0,
          cover: normalizeCover(cover),
          url: "",
          link: `https://www.bilibili.com/video/${arc.bvid ?? ""}`,
          extra: {
            bvid: arc.bvid ?? "",
            cid: String(arc.cid ?? 0),
          },
        });
        continue;
      }
    }
    processedArchives += archives.length;

    const total = resp.data?.page?.total ?? 0;
    if (total === 0 || processedArchives >= total) {
      break;
    }
    pageNum++;
  }
  return allSongs;
}

// ---------------------------------------------------------------------------
// bilibili.go — fetchAudioURL
// ---------------------------------------------------------------------------

async function fetchAudioURL(bvid: string, cid: string, isVip: boolean): Promise<string> {
  let fnval = 80;
  if (isVip) {
    // 4048 allows requesting FLAC/Hi-Res/Dolby formats instead of default standard 80
    fnval = 4048;
  }

  const apiURL = `https://api.bilibili.com/x/player/playurl?fnval=${fnval}&qn=127&bvid=${bvid}&cid=${cid}`;
  const body = await httpGetText(apiURL, { headers: biliHeaders() });

  interface DashAudio {
    id?: number;
    baseUrl?: string;
  }
  const resp = JSON.parse(body) as {
    data?: {
      durl?: { url?: string }[];
      dash?: {
        audio?: DashAudio[];
        flac?: { audio?: DashAudio };
        dolby?: { audio?: DashAudio[] };
      };
    };
  };
  const dash = resp.data?.dash;
  const durl = resp.data?.durl ?? [];

  // 1. Highest Priority: Hi-Res FLAC format specifically marked by id 30251
  const flacURL = dash?.flac?.audio?.baseUrl ?? "";
  if (dash?.flac?.audio?.id === 30251 && flacURL !== "") {
    return flacURL;
  }

  // 2. Secondary Priority: Dolby Atmos format specifically marked by id 30250
  for (const a of dash?.dolby?.audio ?? []) {
    const url = a.baseUrl ?? "";
    if (a.id === 30250 && url !== "") {
      return url;
    }
  }

  // 3. Loop through standard DASH audio evaluating the highest ID quality natively
  let bestURL = "";
  let highestID = -1;
  for (const a of dash?.audio ?? []) {
    const url = a.baseUrl ?? "";
    if ((a.id ?? -1) > highestID && url !== "") {
      highestID = a.id!;
      bestURL = url;
    }
  }
  if (bestURL !== "") {
    return bestURL;
  }

  // 4. Fallback to generic unsegmented DURL format if no Dash
  if (durl.length > 0) {
    return durl[0]!.url ?? "";
  }

  throw new Error("no audio found");
}

// ---------------------------------------------------------------------------
// provider 主体
// ---------------------------------------------------------------------------

export const bilibili: MusicProvider = {
  name: "bilibili",
  label: "Bilibili",
  supportsFlac: true,

  // song.go — Search
  async search(keyword: string): Promise<Song[]> {
    const params = new URLSearchParams({
      search_type: "video",
      keyword,
      page: "1",
      page_size: "20",
    });

    const searchURL = `https://api.bilibili.com/x/web-interface/search/type?${params.toString()}`;
    const body = await httpGetText(searchURL, { headers: biliHeaders() });

    let searchResp: {
      data?: { result?: { bvid?: string; title?: string; author?: string; pic?: string }[] };
    };
    try {
      searchResp = JSON.parse(body) as typeof searchResp;
    } catch (e) {
      throw new Error(`bilibili search json error: ${String(e)}`);
    }

    const songs: Song[] = [];
    for (const item of searchResp.data?.result ?? []) {
      const rootTitle = cleanTitle(item.title ?? "");
      let viewResp: BiliViewResponse;
      try {
        viewResp = await fetchView(item.bvid ?? "");
      } catch {
        continue;
      }
      if (!viewResp.data?.pages || viewResp.data.pages.length === 0) {
        continue;
      }

      const cover = normalizeCover(item.pic ?? "");
      const page = viewResp.data.pages[0]!;
      let displayTitle = page.part ?? "";
      if (displayTitle === "") {
        displayTitle = rootTitle;
      } else if (displayTitle !== rootTitle) {
        displayTitle = `${rootTitle} - ${displayTitle}`;
      }

      songs.push({
        source: "bilibili",
        id: `${item.bvid ?? ""}|${page.cid ?? 0}`,
        name: displayTitle,
        artist: item.author ?? "",
        album: item.bvid ?? "",
        duration: page.duration ?? 0,
        size: 0,
        bitrate: 0,
        cover,
        url: "",
        link: `https://www.bilibili.com/video/${item.bvid}?p=1`,
        extra: {
          bvid: item.bvid ?? "",
          cid: String(page.cid ?? 0),
        },
      });
    }
    return songs;
  },

  // song.go — Parse
  async parse(link: string): Promise<Song> {
    // 1. 提取 BVID
    const bvidMatch = /(BV\w+)/.exec(link);
    if (!bvidMatch || bvidMatch.length < 2) {
      throw new Error("invalid bilibili link: bvid not found");
    }
    const bvid = bvidMatch[1]!;

    // 2. 提取 Page (p=X), 默认为 1
    let page = 1;
    const pageMatch = /[?&]p=(\d+)/.exec(link);
    if (pageMatch && pageMatch.length >= 2) {
      const p = parseInt(pageMatch[1]!, 10);
      if (!Number.isNaN(p) && p > 0) {
        page = p;
      }
    }

    // 3. 调用 View 接口获取元数据
    const viewResp = await fetchView(bvid);
    const data = viewResp.data ?? {};
    if (data.ugc_season != null || (data.pages?.length ?? 0) > 1) {
      throw new Error("playlist link detected");
    }
    if ((data.pages?.length ?? 0) <= 1) {
      let pages: BiliPage[] | null = null;
      try {
        pages = await fetchPageList(bvid);
      } catch {
        pages = null;
      }
      if (pages && pages.length > 1) {
        throw new Error("playlist link detected");
      }
    }
    if (!data.pages || data.pages.length === 0) {
      throw new Error("no video pages found");
    }

    if (page > data.pages.length) {
      page = 1;
    }
    const targetPage = data.pages[page - 1]!;

    let displayTitle = targetPage.part ?? "";
    if (data.pages.length === 1 && displayTitle === "") {
      displayTitle = data.title ?? "";
    } else if (displayTitle !== data.title) {
      displayTitle = `${data.title ?? ""} - ${displayTitle}`;
    }

    let cover = data.pic ?? "";
    if (cover.startsWith("//")) {
      cover = "https:" + cover;
    }

    const cidStr = String(targetPage.cid ?? 0);

    // 4. 立即获取下载链接
    const isVip = await isVipAccount().catch(() => false);
    let audioURL = "";
    try {
      audioURL = await fetchAudioURL(bvid, cidStr, isVip);
    } catch {
      /* 忽略错误，尽可能返回元数据 */
    }

    return {
      source: "bilibili",
      id: `${data.bvid ?? ""}|${targetPage.cid ?? 0}`,
      name: displayTitle,
      artist: data.owner?.name ?? "",
      album: data.bvid ?? "",
      duration: targetPage.duration ?? 0,
      size: 0,
      bitrate: 0,
      cover,
      url: audioURL,
      link: `https://www.bilibili.com/video/${data.bvid ?? ""}?p=${page}`,
      extra: {
        bvid: data.bvid ?? "",
        cid: cidStr,
      },
    };
  },

  // download.go — GetDownloadURL
  async getStreamUrl(song: Song): Promise<string> {
    if (song.source !== "bilibili") {
      throw new Error("source mismatch");
    }

    if (song.url) {
      return song.url;
    }

    let bvid = "";
    let cid = "";
    if (song.extra) {
      bvid = song.extra["bvid"] ?? "";
      cid = song.extra["cid"] ?? "";
    }

    if (bvid === "" || cid === "") {
      const parts = song.id.split("|");
      if (parts.length === 2) {
        bvid = parts[0]!;
        cid = parts[1]!;
      } else {
        throw new Error("invalid id structure");
      }
    }

    const isVip = await isVipAccount().catch(() => false);
    return fetchAudioURL(bvid, cid, isVip);
  },

  // lyric.go — GetLyrics（B 站无歌词，返回空字符串，对齐 Go）
  async getLyric(song: Song): Promise<string> {
    if (song.source !== "bilibili") {
      throw new Error("source mismatch");
    }
    return "";
  },

  // playlist.go — SearchPlaylist
  async searchPlaylist(keyword: string): Promise<Playlist[]> {
    const params = new URLSearchParams({
      search_type: "video",
      keyword,
      page: "1",
      page_size: "20",
    });

    const searchURL = `https://api.bilibili.com/x/web-interface/search/type?${params.toString()}`;
    const body = await httpGetText(searchURL, { headers: biliHeaders() });

    let searchResp: {
      data?: { result?: { bvid?: string; title?: string; author?: string; pic?: string }[] };
    };
    try {
      searchResp = JSON.parse(body) as typeof searchResp;
    } catch (e) {
      throw new Error(`bilibili search json error: ${String(e)}`);
    }

    const plMap = new Set<string>();
    const playlists: Playlist[] = [];
    for (const item of searchResp.data?.result ?? []) {
      let viewResp: BiliViewResponse;
      try {
        viewResp = await fetchView(item.bvid ?? "");
      } catch {
        continue;
      }
      const data = viewResp.data ?? {};

      const cover = normalizeCover(item.pic ?? "");
      if (data.ugc_season != null) {
        const seasonID = data.ugc_season.id ?? 0;
        const mid = data.owner?.mid ?? 0;
        const key = `season:${seasonID}:${mid}:${item.bvid ?? ""}`;
        if (plMap.has(key)) {
          continue;
        }
        plMap.add(key);

        let seasonName = data.ugc_season.title ?? "";
        if (seasonName === "") {
          seasonName = cleanTitle(item.title ?? "");
        }
        let seasonCover = data.ugc_season.cover ?? "";
        if (seasonCover === "") {
          seasonCover = cover;
        }

        let trackCount = countSeasonEpisodes(data.ugc_season.sections ?? []);
        if (trackCount === 0 && seasonID !== 0 && mid !== 0) {
          try {
            const seasonSongs = await fetchSeasonSongs(mid, seasonID);
            trackCount = seasonSongs.length;
          } catch {
            /* ignore */
          }
        }

        playlists.push({
          source: "bilibili",
          id: key,
          name: seasonName,
          cover: normalizeCover(seasonCover),
          track_count: trackCount,
          play_count: data.ugc_season.stat?.view ?? 0,
          creator: data.owner?.name ?? "",
          description: data.ugc_season.intro ?? "",
          link: `https://www.bilibili.com/video/${item.bvid ?? ""}`,
          extra: {
            season_id: String(seasonID),
            mid: String(mid),
            bvid: item.bvid ?? "",
            type: "season",
          },
        });
        continue;
      }

      if ((data.pages?.length ?? 0) > 1) {
        const plID = `bvid:${item.bvid ?? ""}`;
        if (plMap.has(plID)) {
          continue;
        }
        plMap.add(plID);
        playlists.push({
          source: "bilibili",
          id: plID,
          name: cleanTitle(item.title ?? ""),
          cover,
          track_count: data.pages?.length ?? 0,
          play_count: 0,
          creator: data.owner?.name ?? "",
          description: "",
          link: `https://www.bilibili.com/video/${item.bvid ?? ""}`,
          extra: {
            bvid: item.bvid ?? "",
            type: "multipart",
          },
        });
      }
    }
    return playlists;
  },

  // playlist.go — GetPlaylistSongs
  async getPlaylistSongs(id: string): Promise<Song[]> {
    if (id.startsWith("season:")) {
      const parts = id.split(":");
      if (parts.length < 3) {
        throw new Error("invalid season id");
      }
      const seasonID = Number(parts[1]);
      const mid = Number(parts[2]);
      const bvid = parts.length >= 4 ? parts[3]! : "";
      if (bvid !== "") {
        try {
          const viewResp = await fetchView(bvid);
          const season = viewResp.data?.ugc_season;
          if (season != null) {
            const sections = season.sections ?? [];
            let archiveIndex = new Map<string, BiliSeasonArchiveMeta>();
            let seasonTitle = season.title ?? "";
            let seasonCover = season.cover ?? "";
            try {
              const idx = await fetchSeasonArchiveIndex(mid, seasonID);
              archiveIndex = idx.index;
              if (seasonTitle === "") {
                seasonTitle = idx.seasonTitle;
              }
              if (seasonCover === "") {
                seasonCover = idx.seasonCover;
              }
            } catch {
              /* ignore index error */
            }
            const songs = buildSongsFromSeasonSections(
              sections,
              seasonTitle,
              seasonCover,
              viewResp.data?.owner?.name ?? "",
              archiveIndex,
            );
            if (songs.length > 0) {
              return songs;
            }
          }
        } catch {
          /* fallthrough to fetchSeasonSongs */
        }
      }
      return fetchSeasonSongs(mid, seasonID);
    }

    const bvid = id.replace(/^bvid:/, "");
    if (bvid === "") {
      throw new Error("invalid playlist id");
    }
    const viewResp = await fetchView(bvid);
    const data = viewResp.data ?? {};
    const rootTitle = data.title ?? "";
    let pages = data.pages ?? [];
    if (pages.length <= 1) {
      try {
        const pageList = await fetchPageList(bvid);
        if (pageList.length > 0) {
          pages = pageList;
        }
      } catch {
        /* ignore pagelist error */
      }
    }
    if (pages.length === 0) {
      throw new Error("no video pages found");
    }
    return buildSongsFromPages(bvid, rootTitle, data.owner?.name ?? "", data.pic ?? "", pages);
  },

  // playlist.go — ParsePlaylist
  async parsePlaylist(link: string): Promise<PlaylistDetail> {
    const bvidMatch = /(BV\w+)/.exec(link);
    if (bvidMatch && bvidMatch.length >= 2) {
      const bvid = bvidMatch[1]!;
      const viewResp = await fetchView(bvid);
      const data = viewResp.data ?? {};
      if (data.ugc_season != null) {
        const seasonID = data.ugc_season.id ?? 0;
        const mid = data.owner?.mid ?? 0;
        let trackCount = countSeasonEpisodes(data.ugc_season.sections ?? []);
        const playlist: Playlist = {
          source: "bilibili",
          id: `season:${seasonID}:${mid}:${bvid}`,
          name: data.ugc_season.title ?? "",
          cover: normalizeCover(data.ugc_season.cover ?? ""),
          track_count: trackCount,
          play_count: data.ugc_season.stat?.view ?? 0,
          creator: data.owner?.name ?? "",
          description: data.ugc_season.intro ?? "",
          link: `https://www.bilibili.com/video/${bvid}`,
          extra: {
            season_id: String(seasonID),
            mid: String(mid),
            bvid,
            type: "season",
          },
        };
        const sections = data.ugc_season.sections ?? [];
        let archiveIndex = new Map<string, BiliSeasonArchiveMeta>();
        let seasonTitle = data.ugc_season.title ?? "";
        let seasonCover = data.ugc_season.cover ?? "";
        try {
          const idx = await fetchSeasonArchiveIndex(mid, seasonID);
          archiveIndex = idx.index;
          if (seasonTitle === "") {
            seasonTitle = idx.seasonTitle;
          }
          if (seasonCover === "") {
            seasonCover = idx.seasonCover;
          }
          if (trackCount === 0) {
            trackCount = archiveIndex.size;
            playlist.track_count = trackCount;
          }
        } catch {
          /* ignore index error */
        }
        const songs = buildSongsFromSeasonSections(sections, seasonTitle, seasonCover, data.owner?.name ?? "", archiveIndex);
        if (songs.length > 0) {
          return { playlist, songs };
        }
        const fallbackSongs = await fetchSeasonSongs(mid, seasonID);
        return { playlist, songs: fallbackSongs };
      }

      if ((data.pages?.length ?? 0) > 1) {
        const playlist: Playlist = {
          source: "bilibili",
          id: `bvid:${bvid}`,
          name: data.title ?? "",
          cover: normalizeCover(data.pic ?? ""),
          track_count: data.pages?.length ?? 0,
          play_count: 0,
          creator: data.owner?.name ?? "",
          description: "",
          link: `https://www.bilibili.com/video/${bvid}`,
          extra: {
            bvid,
            type: "multipart",
          },
        };
        const songs = buildSongsFromPages(bvid, data.title ?? "", data.owner?.name ?? "", data.pic ?? "", data.pages ?? []);
        return { playlist, songs };
      }

      if ((data.pages?.length ?? 0) === 1) {
        const playlist: Playlist = {
          source: "bilibili",
          id: `bvid:${bvid}`,
          name: data.title ?? "",
          cover: normalizeCover(data.pic ?? ""),
          track_count: 1,
          play_count: 0,
          creator: data.owner?.name ?? "",
          description: "",
          link: `https://www.bilibili.com/video/${bvid}`,
          extra: {
            bvid,
            type: "single",
          },
        };
        const songs = buildSongsFromPages(bvid, data.title ?? "", data.owner?.name ?? "", data.pic ?? "", data.pages ?? []);
        return { playlist, songs };
      }
    }

    throw new Error("invalid bilibili playlist link");
  },

  // login.go — CreateQRLogin
  async createQRLogin(): Promise<QRLoginSession> {
    const resp = await httpGetJSON<{
      code?: number;
      message?: string;
      data?: { url?: string; qrcode_key?: string };
    }>(BILIBILI_QR_GENERATE_API, {
      headers: { "User-Agent": USER_AGENT, Referer: REFERER },
    });
    if (resp.code !== 0 || (resp.data?.qrcode_key ?? "").trim() === "") {
      throw new Error(`bilibili qr generate api error: code=${resp.code ?? 0} message=${resp.message ?? ""}`);
    }
    return {
      source: "bilibili",
      key: resp.data!.qrcode_key!,
      url: resp.data!.url ?? "",
      expires_at: Math.floor(Date.now() / 1000) + 3 * 60,
    };
  },

  // login.go — CheckQRLogin
  async checkQRLogin(key: string): Promise<QRLoginResult> {
    key = key.trim();
    if (key === "") {
      throw new Error("bilibili qr login key is empty");
    }
    const params = new URLSearchParams({ qrcode_key: key });
    const resp = await httpRequest(`${BILIBILI_QR_POLL_API}?${params.toString()}`, {
      headers: { "User-Agent": USER_AGENT, Referer: REFERER },
    });
    if (!resp.ok) {
      throw new Error(`bilibili qr poll http status ${resp.status}`);
    }
    const body = await resp.text();
    const payload = JSON.parse(body) as {
      code?: number;
      message?: string;
      data?: { url?: string; refresh_token?: string; timestamp?: number; code?: number; message?: string };
    };
    const result: QRLoginResult = {
      source: "bilibili",
      key,
      status: mapBilibiliQRStatus(payload.data?.code ?? 0),
      message: firstNonEmpty(payload.data?.message, payload.message),
      extra: {
        code: String(payload.data?.code ?? 0),
      },
    };
    if (result.status === "success") {
      const cookies = responseCookies(resp);
      result.cookies = cookies;
      result.cookie = joinCookieMapBilibili(cookies);
      setCookie("bilibili", result.cookie);
      vipCache = null; // 对齐 Go: b.isVipCache = nil
      if ((payload.data?.refresh_token ?? "") !== "") {
        result.extra!["refresh_token"] = payload.data!.refresh_token!;
      }
    }
    return result;
  },
};

// ---------------------------------------------------------------------------
// login.go 辅助
// ---------------------------------------------------------------------------

function mapBilibiliQRStatus(code: number): QRLoginResult["status"] {
  switch (code) {
    case 0:
      return "success";
    case 86038:
      return "expired";
    case 86090:
      return "scanned";
    case 86101:
      return "waiting";
    default:
      return "failed";
  }
}

function joinCookieMapBilibili(cookies: Record<string, string>): string {
  return Object.keys(cookies)
    .filter((key) => key.trim() !== "")
    .sort()
    .map((key) => `${key}=${cookies[key]}`)
    .join("; ");
}
