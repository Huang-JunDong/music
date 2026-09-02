/**
 * Jamendo Provider — 逐行移植自 music-lib/jamendo（jamendo.go / song.go / download.go /
 * lyric.go / playlist.go / album.go / user_playlist.go），走 www.jamendo.com/api 未公开接口
 * （x-jam-call 签名头）。
 */
import crypto from "node:crypto";
import type { MusicProvider, Playlist, PlaylistDetail, Song } from "../types";
import { httpGetJSON } from "../http";
import { getCookie } from "../cookies";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";
const REFERER = "https://www.jamendo.com/search?q=musicdl";
const X_JAM_VERSION = "4gvfv";
const SEARCH_API = "https://www.jamendo.com/api/search";
const TRACK_API = "https://www.jamendo.com/api/tracks";
const ALBUM_API = "https://www.jamendo.com/api/albums";
const ARTIST_API = "https://www.jamendo.com/api/artists";
const PLAYLIST_API = "https://www.jamendo.com/api/playlists";

interface JamArtist {
  id?: number;
  name?: string;
}

interface JamTrackItem {
  id?: number;
  name?: string;
  duration?: number;
  artistId?: number;
  albumId?: number;
  artist?: JamArtist;
  album?: { id?: number; name?: string };
  cover?: { big?: { size300?: string } };
  download?: Record<string, string>;
  stream?: Record<string, string>;
}

interface JamAlbumItem {
  id?: number;
  name?: string;
  artistId?: number;
  dateReleased?: number;
  description?: Record<string, string>;
  cover?: { big?: { size300?: string } };
  tracks?: { position?: number; id?: number }[];
}

interface JamPlaylistItem {
  id?: number;
  name?: string;
  user_name?: string;
  image?: string;
  description?: string;
  tracks?: { position?: number; id?: number }[];
}

interface TrackMeta {
  artistName: string;
  albumName: string;
  albumID: string;
}

function apiHeaders(path: string): Record<string, string> {
  return {
    "User-Agent": UA,
    Referer: REFERER,
    "x-jam-call": makeXJamCall(path),
    "x-jam-version": X_JAM_VERSION,
    "x-requested-with": "XMLHttpRequest",
    Cookie: getCookie("jamendo"),
  };
}

/** 对齐 makeXJamCall：sha1(path + randStr)，格式 $digest*randStr~ */
function makeXJamCall(path: string): string {
  const randStr = String(Math.random());
  const digest = crypto.createHash("sha1").update(path + randStr, "utf8").digest("hex");
  return `$${digest}*${randStr}~`;
}

function apiGet<T>(apiURL: string, path: string): Promise<T> {
  return httpGetJSON<T>(apiURL, { headers: apiHeaders(path) });
}

function searchByType<T>(keyword: string, searchType: string): Promise<T> {
  const params = new URLSearchParams({
    query: keyword,
    type: searchType,
    limit: "20",
    identities: "www",
  });
  return apiGet<T>(`${SEARCH_API}?${params}`, "/api/search");
}

function firstNonEmptyStr(...values: (string | undefined)[]): string {
  for (const v of values) {
    const t = (v ?? "").trim();
    if (t) return t;
  }
  return "";
}

function albumLink(id: string): string {
  return `https://www.jamendo.com/album/${id}`;
}

function playlistLink(id: string): string {
  return `https://www.jamendo.com/playlist/${id}`;
}

function trackLink(id: string): string {
  return `https://www.jamendo.com/track/${id}`;
}

/** 对齐 pickBestQuality：flac → mp33 → mp32 → mp3 → ogg */
function pickBestQuality(streams: Record<string, string> | undefined): [string, string] {
  if (!streams) return ["", ""];
  for (const key of ["flac", "mp33", "mp32", "mp3", "ogg"]) {
    const url = streams[key];
    if (url) {
      if (key === "mp33" || key === "mp32") return [url, "mp3"];
      return [url, key];
    }
  }
  return ["", ""];
}

function pickDescription(desc: Record<string, string> | undefined): string {
  if (!desc) return "";
  for (const key of ["en", "fr", "de", "es", "it", "ru", "pt", "pl"]) {
    const value = (desc[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

/** 对齐 buildSong：download 优先，其次 stream */
function buildSong(item: JamTrackItem, meta: TrackMeta): Song | null {
  let streams = item.download;
  if (!streams || Object.keys(streams).length === 0) streams = item.stream;

  const [downloadURL, ext] = pickBestQuality(streams);
  if (!downloadURL) return null;

  const trackID = String(item.id ?? "");
  let albumID = meta.albumID;
  if (!albumID && (item.albumId ?? 0) > 0) albumID = String(item.albumId);

  const extra: Record<string, string> = { track_id: trackID };
  if (albumID) extra.album_id = albumID;

  return {
    source: "jamendo",
    id: trackID,
    name: item.name ?? "",
    artist: firstNonEmptyStr(item.artist?.name, meta.artistName),
    album: firstNonEmptyStr(item.album?.name, meta.albumName),
    album_id: albumID,
    duration: item.duration ?? 0,
    size: 0,
    bitrate: 0,
    url: downloadURL,
    ext,
    cover: item.cover?.big?.size300 ?? "",
    link: trackLink(trackID),
    extra,
  };
}

async function getArtistNameByID(id: number): Promise<string> {
  if (id === 0) return "";
  const results = await apiGet<{ name?: string }[]>(`${ARTIST_API}?id=${id}`, "/api/artists");
  if (!results || results.length === 0) throw new Error("artist not found");
  return results[0].name ?? "";
}

async function getAlbumByID(id: string): Promise<JamAlbumItem> {
  const results = await apiGet<JamAlbumItem[]>(`${ALBUM_API}?id=${id}`, "/api/albums");
  if (!results || results.length === 0) throw new Error("album not found");
  return results[0];
}

async function getPlaylistByID(id: string): Promise<JamPlaylistItem> {
  const results = await apiGet<JamPlaylistItem[]>(`${PLAYLIST_API}?id=${id}`, "/api/playlists");
  if (!results || results.length === 0) throw new Error("playlist not found");
  return results[0];
}

/** 对齐 resolveTrackMeta：缺啥补啥（专辑/歌手名可能要单独请求） */
async function resolveTrackMeta(item: JamTrackItem, meta: TrackMeta): Promise<TrackMeta> {
  const resolved: TrackMeta = { ...meta };
  if (!resolved.albumID && (item.albumId ?? 0) > 0) resolved.albumID = String(item.albumId);
  if (!resolved.albumName) resolved.albumName = (item.album?.name ?? "").trim();
  if (!resolved.artistName) resolved.artistName = (item.artist?.name ?? "").trim();

  if (!resolved.albumName && (item.albumId ?? 0) > 0) {
    const albumItem = await getAlbumByID(String(item.albumId));
    resolved.albumName = albumItem.name ?? "";
    if (!resolved.albumID) resolved.albumID = String(albumItem.id ?? "");
  }

  if (!resolved.artistName && (item.artistId ?? 0) > 0) {
    resolved.artistName = await getArtistNameByID(item.artistId ?? 0);
  }
  return resolved;
}

/** 对齐 getTrackByID */
async function getTrackByID(id: string, meta: TrackMeta): Promise<Song> {
  const results = await apiGet<JamTrackItem[]>(`${TRACK_API}?id=${id}`, "/api/tracks");
  if (!results || results.length === 0) throw new Error("track not found");

  const item = results[0];
  const resolvedMeta = await resolveTrackMeta(item, meta);
  const song = buildSong(item, resolvedMeta);
  if (!song) throw new Error("no valid stream found");
  return song;
}

/** 对齐 fetchAlbumTracks：逐轨拉详情，errgroup 并发 4，结果保持曲目顺序 */
async function fetchTracks(
  trackIDs: { id?: number }[],
  metaFor: (index: number) => TrackMeta,
  emptyError: string,
): Promise<Song[]> {
  const CONCURRENCY = 4;
  const results: (Song | null)[] = new Array<Song | null>(trackIDs.length).fill(null);
  let firstErr: Error | null = null;
  let cursor = 0;
  const worker = async () => {
    while (cursor < trackIDs.length) {
      const idx = cursor++;
      const trackID = trackIDs[idx].id ?? 0;
      if (trackID === 0) continue;
      try {
        results[idx] = await getTrackByID(String(trackID), metaFor(idx));
      } catch (err) {
        if (!firstErr) firstErr = err as Error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, trackIDs.length || 1) }, worker));
  const songs = results.filter((s): s is Song => s !== null);
  if (songs.length === 0) {
    throw firstErr ?? new Error(emptyError);
  }
  return songs;
}

async function fetchAlbumDetail(id: string): Promise<PlaylistDetail> {
  const albumItem = await getAlbumByID(id);

  let creator = "";
  try {
    creator = await getArtistNameByID(albumItem.artistId ?? 0);
  } catch {
    creator = "";
  }

  const tracks = albumItem.tracks ?? [];
  const album: Playlist = {
    source: "jamendo",
    id: String(albumItem.id ?? ""),
    name: albumItem.name ?? "",
    cover: albumItem.cover?.big?.size300 ?? "",
    track_count: tracks.length,
    play_count: 0,
    creator,
    description: pickDescription(albumItem.description),
    link: albumLink(String(albumItem.id ?? "")),
    extra: { album_id: String(albumItem.id ?? "") },
  };
  if ((albumItem.artistId ?? 0) > 0) album.extra!.artist_id = String(albumItem.artistId);

  const songs = await fetchTracks(
    tracks,
    () => ({
      artistName: creator,
      albumName: albumItem.name ?? "",
      albumID: String(albumItem.id ?? ""),
    }),
    "album has no playable tracks",
  );
  if (!album.creator && songs.length > 0) album.creator = songs[0].artist;

  return { playlist: album, songs };
}

async function fetchPlaylistDetail(id: string): Promise<PlaylistDetail> {
  const playlistID = id.trim();
  if (!playlistID) throw new Error("playlist id is empty");

  const playlistItem = await getPlaylistByID(playlistID);
  const songs = await jamendoGetPlaylistSongs(playlistID);

  const playlist: Playlist = {
    source: "jamendo",
    id: String(playlistItem.id ?? ""),
    name: playlistItem.name ?? "",
    cover: playlistItem.image ?? "",
    track_count: songs.length,
    play_count: 0,
    creator: playlistItem.user_name ?? "",
    description: (playlistItem.description ?? "").trim(),
    link: playlistLink(String(playlistItem.id ?? "")),
    extra: { type: "playlist", playlist_id: String(playlistItem.id ?? "") },
  };
  return { playlist, songs };
}

async function jamendoGetPlaylistSongs(id: string): Promise<Song[]> {
  const playlistItem = await getPlaylistByID(id);
  const tracks = playlistItem.tracks ?? [];
  if (tracks.length === 0) throw new Error("playlist is empty or invalid");
  return fetchTracks(tracks, () => ({ artistName: "", albumName: "", albumID: "" }), "playlist has no playable tracks");
}

export const jamendo: MusicProvider = {
  name: "jamendo",
  label: "Jamendo",
  supportsFlac: true,

  /** Search 搜索歌曲 */
  async search(keyword: string): Promise<Song[]> {
    const results = await searchByType<JamTrackItem[]>(keyword, "track");
    const songs: Song[] = [];
    for (const item of results ?? []) {
      const song = buildSong(item, { artistName: "", albumName: "", albumID: "" });
      if (song) songs.push(song);
    }
    return songs;
  },

  /** Parse 解析单曲链接 */
  async parse(link: string): Promise<Song> {
    const m = link.match(/jamendo\.com\/track\/(\d+)/);
    if (!m) throw new Error("invalid jamendo link");
    return getTrackByID(m[1], { artistName: "", albumName: "", albumID: "" });
  },

  /** GetDownloadURL 获取下载链接 */
  async getStreamUrl(song: Song): Promise<string> {
    if (song.source !== "jamendo") throw new Error("source mismatch");
    if (song.url) return song.url;

    const trackID = song.extra?.track_id || song.id;
    if (!trackID) throw new Error("id missing");

    const info = await getTrackByID(trackID, {
      artistName: song.artist,
      albumName: song.album,
      albumID: song.album_id ?? "",
    });
    return info.url ?? "";
  },

  /** GetLyrics：Go 固定返回空字符串 */
  async getLyric(song: Song): Promise<string> {
    if (song.source !== "jamendo") throw new Error("source mismatch");
    return "";
  },

  /** SearchAlbum 搜索专辑 */
  async searchAlbum(keyword: string): Promise<Playlist[]> {
    const results = await searchByType<{ id?: number; name?: string; artist?: JamArtist; cover?: { big?: { size300?: string } } }[]>(
      keyword,
      "album",
    );
    const albums: Playlist[] = [];
    for (const item of results ?? []) {
      const id = item.id ?? 0;
      if (!(id > 0)) continue;
      const albumID = String(id);
      const extra: Record<string, string> = { album_id: albumID };
      if ((item.artist?.id ?? 0) > 0) extra.artist_id = String(item.artist?.id);
      albums.push({
        source: "jamendo",
        id: albumID,
        name: item.name ?? "",
        cover: item.cover?.big?.size300 ?? "",
        track_count: 0,
        play_count: 0,
        creator: item.artist?.name ?? "",
        description: "",
        link: albumLink(albumID),
        extra,
      });
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
    const m = link.match(/jamendo\.com\/album\/(\d+)/);
    if (!m) throw new Error("invalid jamendo album link");
    return fetchAlbumDetail(m[1]);
  },

  /** SearchPlaylist 搜索歌单 */
  async searchPlaylist(keyword: string): Promise<Playlist[]> {
    const results = await searchByType<JamPlaylistItem[]>(keyword, "playlist");
    const playlists: Playlist[] = [];
    for (const item of results ?? []) {
      const id = item.id ?? 0;
      if (!(id > 0)) continue;
      playlists.push({
        source: "jamendo",
        id: String(id),
        name: item.name ?? "",
        cover: item.image ?? "",
        track_count: 0,
        play_count: 0,
        creator: item.user_name ?? "",
        description: "",
        link: playlistLink(String(id)),
      });
    }
    return playlists;
  },

  /** GetPlaylistSongs 获取歌单歌曲 */
  async getPlaylistSongs(id: string): Promise<Song[]> {
    return jamendoGetPlaylistSongs(id);
  },

  /** ParsePlaylist 解析歌单链接 */
  async parsePlaylist(link: string): Promise<PlaylistDetail> {
    const m = link.match(/jamendo\.com\/playlist\/(\d+)/);
    if (m) return fetchPlaylistDetail(m[1]);
    if (link.length > 0 && !link.includes("/")) return fetchPlaylistDetail(link);
    throw new Error("invalid jamendo playlist link");
  },

  // GetPlaylistCategories / GetCategoryPlaylists / GetUserPlaylists：
  // Go 返回 ErrPlaylistCategoriesUnsupported / ErrUserPlaylistsUnsupported → 不实现
};
