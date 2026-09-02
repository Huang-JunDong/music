/**
 * JOOX Provider — 逐行移植自 music-lib/joox（joox.go / song.go / download.go / lyric.go /
 * playlist.go / album.go / user_playlist.go），openjoox v3 API + web 页面 __NEXT_DATA__ 双通道。
 */
import type { MusicProvider, Playlist, PlaylistCategory, PlaylistDetail, Song } from "../types";
import { httpGetJSON, httpGetText } from "../http";
import { getCookie } from "../cookies";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
/** Go 内置兜底 Cookie（未配置 cookie 时使用） */
const DEFAULT_COOKIE =
  "wmid=142420656; user_type=1; country=id; session_key=2a5d97d05dc8fe238150184eaf3519ad;";
const X_FORWARDED_FOR = "36.73.34.109";

function cookie(): string {
  return getCookie("joox") || DEFAULT_COOKIE;
}

function headers(): Record<string, string> {
  return { "User-Agent": UA, Cookie: cookie(), "X-Forwarded-For": X_FORWARDED_FOR };
}

interface JooxArtist {
  id?: string;
  name?: string;
}

interface JooxImage {
  width?: number;
  url?: string;
}

interface JooxAlbumTrack {
  id?: string;
  name?: string;
  title?: string;
  album_id?: string;
  albumId?: string;
  album_name?: string;
  albumName?: string;
  artist_list?: JooxArtist[];
  artistList?: JooxArtist[];
  play_duration?: number;
  playDuration?: number;
  duration?: number;
  images?: JooxImage[];
  imgSrc?: string;
  cover?: string;
  image?: string;
  pic?: string;
}

interface JooxNamedUser {
  name?: string;
  userName?: string;
  nickName?: string;
  nick?: string;
}

interface JooxPlaylistPageData {
  id?: string;
  listId?: string;
  playlistId?: string;
  name?: string;
  title?: string;
  playlistName?: string;
  imgSrc?: string;
  cover?: string;
  image?: string;
  pic?: string;
  creator?: string;
  creatorName?: string;
  userName?: string;
  nickName?: string;
  ownerName?: string;
  author?: string;
  authorName?: string;
  user?: JooxNamedUser;
  owner?: JooxNamedUser;
  creatorInfo?: JooxNamedUser;
  description?: string;
  intro?: string;
  desc?: string;
  trackCount?: number;
  total_count?: number;
  totalCount?: number;
  list_count?: number;
  trackList?: JooxAlbumTrack[];
}

interface JooxAllPlaylistTracks {
  tracks?: {
    items?: JooxAlbumTrack[];
    list_count?: number;
    total_count?: number;
    totalCount?: number;
  };
}

interface JooxAlbumPageData {
  id?: string;
  imgSrc?: string;
  title?: string;
  artistList?: JooxArtist[];
  publishDate?: string;
  description?: string;
  trackList?: { items?: JooxAlbumTrack[]; list_count?: number; total_count?: number };
}

interface JooxCategoryPlaylistItem {
  id?: unknown;
  title?: string;
  picurl?: string;
}

function normalizeJooxID(raw: string): string {
  let id = raw.trim();
  if (!id) return "";
  if (id.includes("%")) {
    try {
      id = decodeURIComponent(id);
    } catch {
      // 对齐 Go：PathUnescape 失败保留原值
    }
    try {
      const decoded = decodeURIComponent(id.replace(/\+/g, "%20"));
      id = decoded.replace(/ /g, "+");
    } catch {
      // 同上
    }
  }
  return id;
}

function firstNonEmptyStr(...values: (string | undefined)[]): string {
  for (const v of values) {
    if (v && v.trim()) return v;
  }
  return "";
}

function firstNonZero(...values: number[]): number {
  for (const v of values) {
    if (v > 0) return v;
  }
  return 0;
}

function joinArtists(artists: JooxArtist[] | undefined): string {
  const names: string[] = [];
  for (const artist of artists ?? []) {
    const name = (artist.name ?? "").trim();
    if (name) names.push(name);
  }
  return names.join(" / ");
}

/** 对齐 pickJooxImage：优先 300 → 1000 → 100，兜底第一个 */
function pickJooxImage(images: JooxImage[] | undefined): string {
  for (const preferred of [300, 1000, 100]) {
    for (const image of images ?? []) {
      if (image.width === preferred && (image.url ?? "").trim()) return image.url ?? "";
    }
  }
  for (const image of images ?? []) {
    if ((image.url ?? "").trim()) return image.url ?? "";
  }
  return "";
}

function albumLink(id: string): string {
  return `https://www.joox.com/hk/album/${normalizeJooxID(id)}`;
}

function regionalPlaylistLink(region: string, id: string): string {
  return `https://www.joox.com/${region}/playlist/${normalizeJooxID(id)}`;
}

function playlistLink(id: string): string {
  return regionalPlaylistLink("id", id);
}

function playlistLinks(id: string): string[] {
  return [regionalPlaylistLink("id", id), regionalPlaylistLink("sg", id), regionalPlaylistLink("hk", id)];
}

function songLink(id: string): string {
  return `https://www.joox.com/hk/single/${id}`;
}

/** 对齐 jooxSongFromTrack */
function jooxSongFromTrack(
  item: JooxAlbumTrack,
  fallbackAlbum: string,
  fallbackCover: string,
  fallbackAlbumID: string,
): Song | null {
  const songID = normalizeJooxID(item.id ?? "");
  if (!songID) return null;

  let artists = item.artist_list;
  if (!artists || artists.length === 0) artists = item.artistList;

  const albumID = normalizeJooxID(firstNonEmptyStr(item.album_id, item.albumId, fallbackAlbumID));
  const extra: Record<string, string> = { songid: songID };
  if (albumID) extra.album_id = albumID;

  return {
    source: "joox",
    id: songID,
    name: firstNonEmptyStr(item.name, item.title, "Unknown"),
    artist: firstNonEmptyStr(joinArtists(artists), "Unknown"),
    album: firstNonEmptyStr(item.album_name, item.albumName, fallbackAlbum),
    album_id: albumID,
    duration: firstNonZero(item.play_duration ?? 0, item.playDuration ?? 0, item.duration ?? 0),
    size: 0,
    bitrate: 0,
    url: "",
    cover: firstNonEmptyStr(pickJooxImage(item.images), item.imgSrc, item.cover, item.image, item.pic, fallbackCover),
    link: songLink(songID),
    extra,
  };
}

/** 从页面 HTML 提取 __NEXT_DATA__ JSON */
function extractNextData(html: string): unknown {
  const m = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("joox page data not found");
  return JSON.parse(m[1]);
}

/** 对齐 fetchPlaylistPageDataFromURL */
async function fetchPlaylistPageDataFromURL(
  playlistID: string,
  pageURL: string,
): Promise<PlaylistDetail> {
  const body = await httpGetText(pageURL, { headers: headers() });
  const nextData = extractNextData(body) as {
    props?: {
      pageProps?: {
        allPlaylistTracks?: JooxAllPlaylistTracks;
        playlistDetailList?: JooxPlaylistPageData;
        content?: { page?: { allPlaylistTracks?: JooxAllPlaylistTracks; playlistDetailList?: JooxPlaylistPageData } };
      };
    };
  };
  const pageProps = nextData.props?.pageProps ?? {};

  let detail: JooxPlaylistPageData = pageProps.playlistDetailList ?? {};
  let tracks = pageProps.allPlaylistTracks?.tracks?.items ?? [];
  let trackCount = firstNonZero(
    pageProps.allPlaylistTracks?.tracks?.total_count ?? 0,
    pageProps.allPlaylistTracks?.tracks?.totalCount ?? 0,
    pageProps.allPlaylistTracks?.tracks?.list_count ?? 0,
  );
  if (tracks.length === 0) tracks = detail.trackList ?? [];
  if (tracks.length === 0) {
    const contentPage = pageProps.content?.page;
    detail = contentPage?.playlistDetailList ?? {};
    tracks = contentPage?.allPlaylistTracks?.tracks?.items ?? [];
    trackCount = firstNonZero(
      contentPage?.allPlaylistTracks?.tracks?.total_count ?? 0,
      contentPage?.allPlaylistTracks?.tracks?.totalCount ?? 0,
      contentPage?.allPlaylistTracks?.tracks?.list_count ?? 0,
    );
    if (tracks.length === 0) tracks = detail.trackList ?? [];
  }
  if (tracks.length === 0) throw new Error("playlist has no songs");

  const finalID = normalizeJooxID(firstNonEmptyStr(detail.id, detail.listId, detail.playlistId, playlistID));
  const name = firstNonEmptyStr(detail.name, detail.title, detail.playlistName, finalID);
  const cover = firstNonEmptyStr(detail.imgSrc, detail.cover, detail.image, detail.pic);
  trackCount = firstNonZero(
    trackCount,
    detail.trackCount ?? 0,
    detail.total_count ?? 0,
    detail.totalCount ?? 0,
    detail.list_count ?? 0,
    tracks.length,
  );

  const playlist: Playlist = {
    source: "joox",
    id: finalID,
    name,
    cover,
    track_count: trackCount,
    play_count: 0,
    creator: firstNonEmptyStr(
      detail.creator,
      detail.creatorName,
      detail.userName,
      detail.nickName,
      detail.ownerName,
      detail.author,
      detail.authorName,
      detail.user?.name,
      detail.user?.userName,
      detail.user?.nickName,
      detail.user?.nick,
      detail.owner?.name,
      detail.owner?.userName,
      detail.owner?.nickName,
      detail.owner?.nick,
      detail.creatorInfo?.name,
      detail.creatorInfo?.userName,
      detail.creatorInfo?.nickName,
      detail.creatorInfo?.nick,
    ),
    description: firstNonEmptyStr(detail.description, detail.intro, detail.desc),
    link: pageURL,
    extra: { type: "playlist", playlist_id: finalID },
  };

  const songs: Song[] = [];
  for (const item of tracks) {
    const song = jooxSongFromTrack(item, name, cover, "");
    if (song) songs.push(song);
  }
  if (songs.length === 0) throw new Error("playlist has no playable songs");
  return { playlist, songs };
}

/** 对齐 fetchPlaylistPageData：依次尝试 id/sg/hk 三个区域页面 */
async function fetchPlaylistPageData(id: string): Promise<PlaylistDetail> {
  const playlistID = normalizeJooxID(id);
  if (!playlistID) throw new Error("playlist id is empty");

  let lastErr: Error | null = null;
  for (const pageURL of playlistLinks(playlistID)) {
    try {
      return await fetchPlaylistPageDataFromURL(playlistID, pageURL);
    } catch (err) {
      lastErr = err as Error;
    }
  }
  throw lastErr ?? new Error("joox playlist page data not found");
}

async function fetchPlaylistSongsFromPage(id: string): Promise<Song[]> {
  return (await fetchPlaylistPageData(id)).songs;
}

/** 对齐 fetchPlaylistDetail：页面数据优先，API 兜底 */
async function fetchPlaylistDetail(id: string): Promise<PlaylistDetail> {
  try {
    return await fetchPlaylistPageData(id);
  } catch (err) {
    const playlistID = normalizeJooxID(id);
    if (!playlistID) throw new Error("playlist id is empty");

    const songs = await jooxGetPlaylistSongs(playlistID);

    const playlist: Playlist = {
      source: "joox",
      id: playlistID,
      name: playlistID,
      cover: songs.length > 0 ? songs[0].cover : "",
      track_count: songs.length,
      play_count: 0,
      creator: "",
      description: "",
      link: playlistLink(playlistID),
      extra: { type: "playlist", playlist_id: playlistID },
    };
    return { playlist, songs };
  }
}

/** 对齐 fetchAlbumPageData：album 页 __NEXT_DATA__ */
async function fetchAlbumPageData(id: string): Promise<JooxAlbumPageData> {
  const albumID = normalizeJooxID(id);
  if (!albumID) throw new Error("album id is empty");

  const body = await httpGetText(albumLink(albumID), { headers: headers() });
  const nextData = extractNextData(body) as {
    props?: { pageProps?: { albumData?: JooxAlbumPageData; content?: { page?: { albumData?: JooxAlbumPageData } } } };
  };
  const pageProps = nextData.props?.pageProps ?? {};

  let albumData = pageProps.albumData ?? {};
  if (normalizeJooxID(albumData.id ?? "") === "") {
    albumData = pageProps.content?.page?.albumData ?? {};
  }
  if (normalizeJooxID(albumData.id ?? "") === "") throw new Error("album data not found");
  return albumData;
}

/** 对齐 fetchAlbumDetail */
async function fetchAlbumDetail(id: string): Promise<PlaylistDetail> {
  const albumData = await fetchAlbumPageData(id);
  const albumID = normalizeJooxID(albumData.id ?? "");
  if (!albumID) throw new Error("album not found");

  const items = albumData.trackList?.items ?? [];
  let trackCount = albumData.trackList?.total_count ?? 0;
  if (trackCount === 0) {
    trackCount =
      (albumData.trackList?.list_count ?? 0) > 0 ? (albumData.trackList?.list_count ?? 0) : items.length;
  }

  let cover = (albumData.imgSrc ?? "").trim();
  if (!cover && items.length > 0) cover = pickJooxImage(items[0].images);

  const album: Playlist = {
    source: "joox",
    id: albumID,
    name: albumData.title ?? "",
    cover,
    track_count: trackCount,
    play_count: 0,
    creator: joinArtists(albumData.artistList),
    description: (albumData.description ?? "").trim(),
    link: albumLink(albumID),
    extra: {
      type: "album",
      album_id: albumID,
      publish_date: (albumData.publishDate ?? "").trim(),
    },
  };

  const songs: Song[] = [];
  for (const item of items) {
    const songID = normalizeJooxID(item.id ?? "");
    if (!songID) continue;
    songs.push({
      source: "joox",
      id: songID,
      name: item.name ?? "",
      artist: joinArtists(item.artist_list ?? item.artistList),
      album: firstNonEmptyStr(item.album_name, item.albumName, albumData.title),
      duration: firstNonZero(item.play_duration ?? 0, item.playDuration ?? 0, item.duration ?? 0),
      size: 0,
      bitrate: 0,
      url: "",
      cover: firstNonEmptyStr(pickJooxImage(item.images), (albumData.imgSrc ?? "").trim()),
      link: songLink(songID),
      extra: { songid: songID, album_id: albumID },
    });
  }
  if (songs.length === 0) throw new Error("album has no songs");
  return { playlist: album, songs };
}

/** 对齐 fetchSongInfo：web_get_songinfo（MusicInfoCallback 剥壳 + kbps_map 校验） */
async function fetchSongInfo(songID: string): Promise<Song> {
  const params = new URLSearchParams({ songid: songID, lang: "zh_cn", country: "sg" });
  let bodyStr = await httpGetText(`https://api.joox.com/web-fcgi-bin/web_get_songinfo?${params}`, {
    headers: headers(),
  });
  if (bodyStr.startsWith("MusicInfoCallback(")) {
    bodyStr = bodyStr.replace(/^MusicInfoCallback\(/, "").replace(/\)$/, "");
  }

  const resp = JSON.parse(bodyStr) as {
    msong?: string;
    msinger?: string;
    malbum?: string;
    img?: string;
    minterval?: number;
    r320Url?: string;
    r192Url?: string;
    mp3Url?: string;
    m4aUrl?: string;
    kbps_map?: unknown;
  };

  let availableQualities: Record<string, unknown> = {};
  if (typeof resp.kbps_map === "string") {
    try {
      availableQualities = JSON.parse(resp.kbps_map) as Record<string, unknown>;
    } catch {
      availableQualities = {};
    }
  } else if (resp.kbps_map && typeof resp.kbps_map === "object") {
    availableQualities = resp.kbps_map as Record<string, unknown>;
  }

  const candidates: { mapKey: string; url: string }[] = [
    { mapKey: "320", url: resp.r320Url ?? "" },
    { mapKey: "192", url: resp.r192Url ?? "" },
    { mapKey: "128", url: resp.mp3Url ?? "" },
    { mapKey: "96", url: resp.m4aUrl ?? "" },
  ];

  let downloadURL = "";
  for (const c of candidates) {
    const val = availableQualities[c.mapKey];
    if (val === undefined) continue;
    let hasSize = false;
    if (typeof val === "string") hasSize = val !== "0" && val !== "";
    else if (typeof val === "number") hasSize = val > 0;
    if (hasSize && c.url) {
      downloadURL = c.url;
      break;
    }
  }

  if (!downloadURL) downloadURL = firstNonEmptyStr(resp.r320Url, resp.r192Url, resp.mp3Url, resp.m4aUrl);
  if (!downloadURL) throw new Error("no valid download url found");

  return {
    source: "joox",
    id: songID,
    name: resp.msong ?? "",
    artist: resp.msinger ?? "",
    album: resp.malbum ?? "",
    duration: resp.minterval ?? 0,
    size: 0,
    bitrate: 0,
    url: downloadURL,
    cover: resp.img ?? "",
    link: songLink(songID),
    extra: { songid: songID },
  };
}

/** 对齐 decodeJooxBase64Text：补 padding 后 base64 解码 */
function decodeBase64Text(value: string): string {
  const t = value.trim();
  if (!t) return "";
  let padded = t;
  const rem = padded.length % 4;
  if (rem !== 0) padded += "=".repeat(4 - rem);
  const decoded = Buffer.from(padded, "base64").toString("utf8");
  return decoded.trim();
}

function categoryPlaylistID(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return normalizeJooxID(value);
  if (typeof value === "number") return String(Math.trunc(value));
  return String(value).trim();
}

/** 对齐 fetchJooxPlaylistCategoriesPage：sg/playlist 页 mlList */
async function fetchPlaylistCategoriesPage(): Promise<{ categories: { type?: number; title?: string; itemlist?: JooxCategoryPlaylistItem[] }[] }> {
  const body = await httpGetText("https://www.joox.com/sg/playlist", { headers: headers() });
  const nextData = extractNextData(body) as {
    props?: { pageProps?: { mlList?: { category?: { type?: number; title?: string; itemlist?: JooxCategoryPlaylistItem[] }[] } } };
  };
  const categories = nextData.props?.pageProps?.mlList?.category ?? [];
  if (categories.length === 0) throw new Error("joox playlist categories not found");
  return { categories };
}

async function jooxGetPlaylistSongs(id: string): Promise<Song[]> {
  const params = new URLSearchParams({ id, country: "sg", lang: "zh_cn" });
  let body: string;
  try {
    body = await httpGetText(`https://cache.api.joox.com/openjoox/v3/playlist?${params}`, {
      headers: headers(),
    });
  } catch (err) {
    const fallback = await fetchPlaylistSongsFromPage(id).catch(() => null);
    if (fallback && fallback.length > 0) return fallback;
    throw err;
  }

  let resp: {
    section_list?: {
      item_list?: {
        type?: number;
        song?: {
          song_info?: {
            id?: string;
            name?: string;
            album_name?: string;
            album_id?: string;
            artist_list?: { name?: string }[];
            play_duration?: number;
            images?: { width?: number; url?: string }[];
            vip_flag?: number;
          };
        }[];
      }[];
    }[];
  };
  try {
    resp = JSON.parse(body);
  } catch (err) {
    const fallback = await fetchPlaylistSongsFromPage(id).catch(() => null);
    if (fallback && fallback.length > 0) return fallback;
    throw err;
  }

  const songs: Song[] = [];
  let foundSongs = false;
  for (const section of resp.section_list ?? []) {
    for (const item of section.item_list ?? []) {
      if (item.type !== 5) continue;
      for (const songItem of item.song ?? []) {
        const info = songItem.song_info;
        if (!info?.id) continue;

        const artistNames = (info.artist_list ?? []).map((ar) => ar.name ?? "");
        let cover = "";
        for (const img of info.images ?? []) {
          if (img.width === 300) {
            cover = img.url ?? "";
            break;
          }
        }
        if (!cover && (info.images ?? []).length > 0) cover = info.images?.[0]?.url ?? "";
        if (!cover && info.album_id && info.album_id.length >= 2) {
          cover = `https://imgcache.joox.com/music/joox/photo/mid_album_300/${info.album_id.slice(-2)}/${info.album_id.slice(-1)}/${info.album_id}.jpg`;
        }

        songs.push({
          source: "joox",
          id: info.id,
          name: info.name ?? "",
          artist: artistNames.join(" / "),
          album: info.album_name ?? "",
          duration: info.play_duration ?? 0,
          size: 0,
          bitrate: 0,
          url: "",
          cover,
          link: songLink(info.id),
          extra: { songid: info.id },
        });
        foundSongs = true;
      }
    }
  }

  if (!foundSongs) {
    const fallback = await fetchPlaylistSongsFromPage(id).catch(() => null);
    if (fallback && fallback.length > 0) return fallback;
    throw new Error("no songs found in playlist or invalid playlist ID");
  }
  return songs;
}

export const joox: MusicProvider = {
  name: "joox",
  label: "JOOX",

  /** Search 搜索歌曲 */
  async search(keyword: string): Promise<Song[]> {
    const params = new URLSearchParams({ country: "sg", lang: "zh_cn", keyword });
    const resp = await httpGetJSON<{
      section_list?: {
        item_list?: {
          song?: {
            song_info?: {
              id?: string;
              name?: string;
              album_name?: string;
              artist_list?: { name?: string }[];
              play_duration?: number;
              images?: { width?: number; url?: string }[];
              vip_flag?: number;
            };
          }[];
        }[];
      }[];
    }>(`https://cache.api.joox.com/openjoox/v3/search?${params}`, { headers: headers() });

    const songs: Song[] = [];
    for (const section of resp.section_list ?? []) {
      for (const items of section.item_list ?? []) {
        for (const songItem of items.song ?? []) {
          const info = songItem.song_info;
          if (!info?.id) continue;

          const artistNames = (info.artist_list ?? []).map((ar) => ar.name ?? "");
          let cover = "";
          for (const img of info.images ?? []) {
            if (img.width === 300) {
              cover = img.url ?? "";
              break;
            }
          }
          if (!cover && (info.images ?? []).length > 0) cover = info.images?.[0]?.url ?? "";

          songs.push({
            source: "joox",
            id: info.id,
            name: info.name ?? "",
            artist: artistNames.join(" / "),
            album: info.album_name ?? "",
            duration: info.play_duration ?? 0,
            size: 0,
            bitrate: 0,
            url: "",
            cover,
            link: songLink(info.id),
            extra: { songid: info.id },
          });
        }
      }
    }
    return songs;
  },

  /** Parse 解析单曲链接（joox.com 下 single/ 路径或纯 ID） */
  async parse(link: string): Promise<Song> {
    const m = link.match(/joox\.com\/.*\/single\/([^/?#]+)/);
    let songID: string;
    if (m) {
      songID = normalizeJooxID(m[1]);
    } else if (link.length > 10 && !link.includes("/")) {
      songID = link;
    } else {
      throw new Error("invalid joox link");
    }
    return fetchSongInfo(songID);
  },

  /** GetDownloadURL 获取下载链接 */
  async getStreamUrl(song: Song): Promise<string> {
    if (song.source !== "joox") throw new Error("source mismatch");
    if (song.url) return song.url;
    const songID = song.extra?.songid || song.id;
    const info = await fetchSongInfo(songID);
    return info.url ?? "";
  },

  /** GetLyrics 获取歌词（base64 编码的 LRC） */
  async getLyric(song: Song): Promise<string> {
    if (song.source !== "joox") throw new Error("source mismatch");
    const songID = song.extra?.songid || song.id;

    const params = new URLSearchParams({ musicid: songID, country: "sg", lang: "zh_cn" });
    let bodyStr = await httpGetText(`https://api.joox.com/web-fcgi-bin/web_lyric?${params}`, {
      headers: headers(),
    });
    const idx = bodyStr.indexOf("MusicJsonCallback(");
    if (idx >= 0) {
      bodyStr = bodyStr.slice(idx).replace(/^MusicJsonCallback\(/, "").replace(/\)$/, "");
    }

    const resp = JSON.parse(bodyStr) as { lyric?: string };
    if (!resp.lyric) throw new Error("lyric not found or empty");
    return Buffer.from(resp.lyric, "base64").toString("utf8");
  },

  /** SearchPlaylist 搜索歌单（item type=1 Editor Playlist） */
  async searchPlaylist(keyword: string): Promise<Playlist[]> {
    const params = new URLSearchParams({ country: "sg", lang: "zh_cn", keyword });
    const resp = await httpGetJSON<{
      section_list?: {
        section_title?: string;
        section_type?: number;
        item_list?: {
          type?: number;
          editor_playlist?: { id?: string; name?: string; images?: { width?: number; url?: string }[] };
        }[];
      }[];
    }>(`https://cache.api.joox.com/openjoox/v3/search?${params}`, { headers: headers() });

    const playlists: Playlist[] = [];
    for (const section of resp.section_list ?? []) {
      for (const item of section.item_list ?? []) {
        if (item.type !== 1) continue;
        const info = item.editor_playlist;
        const playlistID = normalizeJooxID(info?.id ?? "");
        if (!playlistID) continue;

        let cover = "";
        for (const img of info?.images ?? []) {
          if (img.width === 300) {
            cover = img.url ?? "";
            break;
          }
        }
        if (!cover && (info?.images ?? []).length > 0) cover = info?.images?.[0]?.url ?? "";

        playlists.push({
          source: "joox",
          id: playlistID,
          name: info?.name ?? "",
          cover,
          track_count: 0,
          play_count: 0,
          creator: "",
          description: "",
          link: playlistLink(playlistID),
          extra: { playlist_id: playlistID },
        });
      }
    }
    return playlists;
  },

  /** GetPlaylistSongs 获取歌单歌曲（v3/playlist，失败回退页面解析） */
  async getPlaylistSongs(id: string): Promise<Song[]> {
    return jooxGetPlaylistSongs(id);
  },

  /** ParsePlaylist 解析歌单链接 */
  async parsePlaylist(link: string): Promise<PlaylistDetail> {
    const patterns = [/joox\.com\/.*\/playlist\/([^/?#]+)/, /(?:playlistid|playlist_id|id)=([^&]+)/];
    for (const pattern of patterns) {
      const m = link.match(pattern);
      if (m) return fetchPlaylistDetail(m[1]);
    }
    if (link.length > 8 && !link.includes("/")) {
      return fetchPlaylistDetail(link);
    }
    throw new Error("invalid joox playlist link");
  },

  /** GetPlaylistCategories 歌单分类（sg/playlist 页 mlList，base64 标题） */
  async getPlaylistCategories(): Promise<PlaylistCategory[]> {
    const data = await fetchPlaylistCategoriesPage();
    const categories: PlaylistCategory[] = [
      { source: "joox", id: "", name: "全部", group: "全部", count: 0 },
    ];
    data.categories.forEach((category, index) => {
      const name = decodeBase64Text(category.title ?? "");
      if (!name || !(category.itemlist ?? []).length) return;
      categories.push({
        source: "joox",
        id: String(index),
        name,
        group: "JOOX",
        count: (category.itemlist ?? []).length,
        extra: { title: category.title ?? "", type: String(category.type ?? 0) },
      });
    });
    if (categories.length === 1) throw new Error("no playlist categories found");
    return categories;
  },

  /** GetCategoryPlaylists 分类歌单（内存分页） */
  async getCategoryPlaylists(categoryId: string, page: number, limit: number): Promise<Playlist[]> {
    const catId = categoryId.trim();
    if (page < 1) page = 1;
    if (limit < 1) limit = 20;

    const data = await fetchPlaylistCategoriesPage();

    let items: JooxCategoryPlaylistItem[] = [];
    let categoryName = "全部";
    if (catId === "") {
      const seen = new Set<string>();
      for (const category of data.categories) {
        for (const item of category.itemlist ?? []) {
          const playlistID = categoryPlaylistID(item.id);
          if (!playlistID || seen.has(playlistID)) continue;
          seen.add(playlistID);
          items.push(item);
        }
      }
    } else {
      let found = false;
      data.categories.forEach((category, index) => {
        if (found) return;
        const name = decodeBase64Text(category.title ?? "");
        if (String(index) === catId || name.toLowerCase() === catId.toLowerCase()) {
          items = category.itemlist ?? [];
          categoryName = name;
          found = true;
        }
      });
      if (items.length === 0) throw new Error("playlist category not found");
    }

    const start = (page - 1) * limit;
    if (start >= items.length) throw new Error("no category playlists found");
    const end = Math.min(start + limit, items.length);

    const playlists: Playlist[] = [];
    for (const item of items.slice(start, end)) {
      const playlistID = categoryPlaylistID(item.id);
      const name = decodeBase64Text(item.title ?? "");
      if (!playlistID || !name) continue;
      playlists.push({
        source: "joox",
        id: playlistID,
        name,
        cover: (item.picurl ?? "").replaceAll("%d", "300"),
        track_count: 0,
        play_count: 0,
        creator: "",
        description: "",
        link: playlistLink(playlistID),
        extra: { category_id: catId, category_name: categoryName, playlist_id: playlistID },
      });
    }
    if (playlists.length === 0) throw new Error("no category playlists found");
    return playlists;
  },

  /** SearchAlbum 搜索专辑（section_type=1 + item type=2） */
  async searchAlbum(keyword: string): Promise<Playlist[]> {
    const params = new URLSearchParams({ country: "sg", lang: "zh_cn", keyword });
    const resp = await httpGetJSON<{
      section_list?: {
        section_type?: number;
        item_list?: {
          type?: number;
          album?: {
            id?: string;
            name?: string;
            images?: JooxImage[];
            publish_date?: string;
            artist_list?: JooxArtist[];
          };
        }[];
      }[];
    }>(`https://cache.api.joox.com/openjoox/v3/search?${params}`, { headers: headers() });

    const albums: Playlist[] = [];
    const seen = new Set<string>();
    for (const section of resp.section_list ?? []) {
      if (section.section_type !== 1) continue;
      for (const item of section.item_list ?? []) {
        if (item.type !== 2) continue;
        const albumID = normalizeJooxID(item.album?.id ?? "");
        if (!albumID || seen.has(albumID)) continue;
        seen.add(albumID);

        albums.push({
          source: "joox",
          id: albumID,
          name: item.album?.name ?? "",
          cover: pickJooxImage(item.album?.images),
          track_count: 0,
          play_count: 0,
          creator: joinArtists(item.album?.artist_list),
          description: (item.album?.publish_date ?? "").trim(),
          link: albumLink(albumID),
          extra: {
            type: "album",
            album_id: albumID,
            publish_date: (item.album?.publish_date ?? "").trim(),
          },
        });
      }
    }
    if (albums.length === 0) throw new Error("no albums found");
    return albums;
  },

  /** GetAlbumSongs 获取专辑歌曲 */
  async getAlbumSongs(id: string): Promise<Song[]> {
    return (await fetchAlbumDetail(id)).songs;
  },

  /** ParseAlbum 解析专辑链接 */
  async parseAlbum(link: string): Promise<PlaylistDetail> {
    const patterns = [
      /joox\.com\/.*\/album\/([^/?#]+)/,
      /h_activity_id=([^&]+)/,
      /albumid=([^&]+)/,
    ];
    for (const pattern of patterns) {
      const m = link.match(pattern);
      if (m) return fetchAlbumDetail(m[1]);
    }
    if (link.length > 10 && !link.includes("/")) {
      return fetchAlbumDetail(link);
    }
    throw new Error("invalid joox album link");
  },

  // GetUserPlaylists：Go 返回 ErrUserPlaylistsUnsupported → 不实现
};
