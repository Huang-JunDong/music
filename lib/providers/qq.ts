/**
 * QQ 音乐 Provider — 基于 lib/qq（移植自 .ref/QQMusicApi）实现 MusicProvider 契约。
 *
 * 底层能力全部切换到 lib/qq 模块：
 * - search/searchAlbum/searchPlaylist → music.search.SearchCgiService.DoSearchForQQMusicMobile
 * - parse/querySong → music.trackInfo.UniformRuleRuleCtrl.CgiGetTrackInfo
 * - getStreamUrl → music.vkey.GetVkey.UrlGetVkey（七档音质降级策略保留）
 * - getLyric → music.musichallSong.PlayLyricInfo.GetPlayLyricInfo + QRC 变体 3DES 解密（lib/qrc.ts 保留复用）
 * - 专辑/歌单详情 → AlbumSongList / CgiGetDiss
 * - 推荐歌单 → music.playlist.PlaylistSquare.GetRecommendFeed
 * - 用户歌单 → GetPlaylistByUin / CgiGetPlaylistFavInfo / CgiGetDiss(dirid=201)
 * - 扫码登录 → lib/qq/modules/login（QQ ptlogin2 / 微信 open.weixin 双通道）
 * 保留的旧链路（本项目特有、参考仓库无对应接口）：歌单分类（fcg_get_diss_tag_conf / fcg_get_diss_by_tag）。
 */
import type {
  MusicProvider,
  Song,
  Playlist,
  PlaylistCategory,
  PlaylistDetail,
  QRLoginSession,
  QRLoginResult,
  SongQuality,
} from "../types";
import { firstNonEmpty } from "../http";
import { decryptQRCHex, parseQRC, convertVerbatimLRC, defaultDisplayOrder, type QrcMultiData } from "../qrc";
import { QQClient } from "../qq/client";
import { loadCredential, saveCredential, credentialToCookie } from "../qq/credential";
import { albumCoverUrl } from "../qq/cover";
import * as qqSong from "../qq/modules/song";
import * as qqAlbum from "../qq/modules/album";
import * as qqSonglist from "../qq/modules/songlist";
import * as qqSearch from "../qq/modules/search";
import * as qqLyric from "../qq/modules/lyric";
import * as qqRecommend from "../qq/modules/recommend";
import * as qqUser from "../qq/modules/user";
import * as qqLogin from "../qq/modules/login";

const QQ_FAVORITE_SONGS_PLAYLIST_ID = "profile:favorites";
const QQ_PROFILE_DIR_PLAYLIST_PREFIX = "profile:dir:";

/** 每次请求取当前登录态（无凭证走游客 comm） */
function client(): QQClient {
  return new QQClient({ credential: loadCredential() });
}

// ---------------------------------------------------------------------------
// 通用辅助（旧链路保留的字段映射逻辑）
// ---------------------------------------------------------------------------

function qqCover(albumMid: string): string {
  if (albumMid === "") return "";
  // photo_new 体系（对齐 models/base.py Album.cover_url：T002 + pmid 回退 + 六档尺寸）
  return albumCoverUrl({ mid: albumMid }, 300);
}

function atoi(value: string | number): number {
  if (typeof value === "number") return Math.trunc(value) || 0;
  if (!/^[+-]?\d+$/.test(String(value).trim())) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** 128/320/Flac → (size, bitrate) */
function pickQuality(size128: number, size320: number, sizeFlac: number, interval: number): { size: number; bitrate: number } {
  let fileSize = size128;
  let bitrate = 128;
  if (sizeFlac > 0) {
    fileSize = sizeFlac;
    bitrate = interval > 0 ? Math.trunc((fileSize * 8) / 1000 / interval) : 800;
  } else if (size320 > 0) {
    fileSize = size320;
    bitrate = 320;
  }
  return { size: fileSize, bitrate };
}

function normalizeQQCover(cover: string): string {
  cover = (cover ?? "").trim();
  if (cover.startsWith("//")) return "https:" + cover;
  if (cover.startsWith("http://")) return cover.replace("http://", "https://");
  return cover;
}

/** 上游 Song 结构（lib/qq 响应，对齐参考仓库 models/base.py Song） */
interface QQTrack {
  id?: number;
  mid?: string;
  name?: string;
  singer?: { name?: string; mid?: string; id?: number }[];
  album?: { id?: number; mid?: string; name?: string; title?: string };
  interval?: number;
  file?: Record<string, number | string | undefined>;
  pay?: { pay_play?: number; payplay?: number; pay_month?: number };
  type?: number;
}

function trackToSong(item: QQTrack): Song {
  const mid = item.mid ?? "";
  const songId = item.id ?? 0;
  const albumMid = item.album?.mid ?? "";
  const file = (item.file ?? {}) as Record<string, number | undefined>;
  const { size, bitrate } = pickQuality(
    Number(file.size_128mp3 ?? 0),
    Number(file.size_320mp3 ?? 0),
    Number(file.size_flac ?? 0),
    item.interval ?? 0,
  );
  const payPlay = item.pay?.pay_play ?? item.pay?.payplay ?? 0;
  return {
    source: "qq",
    id: mid || String(songId),
    name: stripEm(String(item.name ?? "")),
    artist: (item.singer ?? []).map((s) => stripEm(String(s.name ?? ""))).join("、"),
    album: stripEm(String(item.album?.name ?? item.album?.title ?? "")),
    album_id: albumMid,
    duration: item.interval ?? 0,
    size,
    bitrate,
    cover: qqCover(albumMid),
    url: "",
    link: `https://y.qq.com/n/ryqq/songDetail/${mid}`,
    ext: Number(file.size_flac ?? 0) > 0 ? "flac" : "mp3",
    is_vip: payPlay === 1,
    extra: {
      songmid: mid,
      song_id: String(songId),
    },
  };
}

/** querySong（CgiGetTrackInfo）→ Song */
async function queryTrackSong(c: QQClient, value: string | number, byId?: boolean): Promise<Song> {
  const isId = byId ?? /^\d+$/.test(String(value));
  const resp = (await qqSong.querySong(
    c,
    isId
      ? [{ id: atoi(value), mid: null, songType: null }]
      : [{ id: null, mid: String(value), songType: null }],
  )) as { tracks?: QQTrack[] };
  const track = resp?.tracks?.[0];
  if (!track) throw new Error("qq song not found");
  return trackToSong(track);
}

// ---------------------------------------------------------------------------
// VIP 探测（结果按凭证缓存，凭证变化即失效；固定试听曲 M500 探测 purl）
// ---------------------------------------------------------------------------

let vipCache: { credKey: string; isVip: boolean } | null = null;

async function isVipAccount(c: QQClient): Promise<boolean> {
  const cred = c.credential;
  const credKey = `${cred.musicid}:${cred.musickey}`;
  if (vipCache && vipCache.credKey === credKey) return vipCache.isVip;
  if (!cred.musicid || !cred.musickey) {
    vipCache = { credKey, isVip: false };
    return false;
  }
  try {
    const songMID = "004YZbkL2MNHoY";
    const resp = (await qqSong.getSongUrls(c, [{ mid: songMID }], qqSong.SongFileType.MP3_128)) as {
      midurlinfo?: { purl?: string }[];
    };
    const isVip = Boolean(resp?.midurlinfo?.[0]?.purl);
    vipCache = { credKey, isVip };
    return isVip;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 扫码登录会话（QQ 通道：qrsig 会话存内存；结果凭证写回 SQLite）
// ---------------------------------------------------------------------------

interface QrSession {
  qrType: qqLogin.QRLoginType;
  identifier: string;
  at: number;
}

/** 扫码会话保留 30 分钟（审核整改 P3-04：过期清扫，防常驻内存累积） */
const QR_SESSION_TTL_MS = 30 * 60 * 1000;
const qrSessions = new Map<string, QrSession>();

function sweepSessions<T extends { at: number }>(map: Map<string, T>): void {
  const now = Date.now();
  for (const [k, v] of map) {
    if (now - v.at > QR_SESSION_TTL_MS) map.delete(k);
  }
}

export const qq: MusicProvider = {
  name: "qq",
  label: "QQ音乐",
  supportsFlac: true,

  // ---------------- 搜索 ----------------
  async search(keyword: string): Promise<Song[]> {
    const c = client();
    const resp = (await qqSearch.searchByType(c, keyword, {
      searchType: qqSearch.SearchType.SONG,
      num: 30,
      highlight: false,
    })) as { body?: { item_song?: QQTrack[] } };
    const items = resp?.body?.item_song ?? [];
    const isVip = await isVipAccount(c).catch(() => false);
    const songs: Song[] = [];
    for (const item of items) {
      const payPlay = item.pay?.pay_play ?? item.pay?.payplay ?? 0;
      if (!isVip && payPlay === 1) continue;
      songs.push(trackToSong(item));
    }
    return songs;
  },

  // ---------------- 分享链接解析（URL 提取逻辑保留） ----------------
  async parse(link: string): Promise<Song> {
    const c = client();
    let songMID = "";
    const m = link.match(/songDetail\/(\w+)/);
    if (m) songMID = m[1] ?? "";
    if (songMID === "") {
      try {
        const u = new URL(link);
        const id = u.searchParams.get("songid") ?? "";
        if (id !== "") {
          const song = await queryTrackSong(c, id, true);
          try {
            song.url = await qq.getStreamUrl!(song);
          } catch {
            /* keep URL empty */
          }
          return song;
        }
        songMID = u.searchParams.get("songmid") ?? "";
      } catch {
        /* url parse error — fallthrough */
      }
    }
    if (songMID === "") throw new Error("invalid qq music link");
    const song = await queryTrackSong(c, songMID, false);
    try {
      song.url = await qq.getStreamUrl!(song);
    } catch {
      /* keep URL empty */
    }
    return song;
  },

  // ---------------- 直链（七档降级策略保留，走新 getSongUrls；支持音质偏好过滤） ----------------
  async getStreamUrl(song: Song, quality?: SongQuality): Promise<string> {
    if (song.source !== "qq") throw new Error("source mismatch");
    const c = client();
    let songMID = song.id;
    if (song.extra && song.extra["songmid"] !== "") songMID = song.extra["songmid"];

    const isVip = await isVipAccount(c).catch(() => false);
    // 档位从优到劣：Master / Atmos5.1 / Atmos2.0 / FLAC / OGG640 / 320k / 128k；非 VIP 仅 320k/128k
    const fullLadder: qqSong.SongFileTypeDef[] = isVip
      ? [
          qqSong.SongFileType.MASTER,
          qqSong.SongFileType.ATMOS_51,
          qqSong.SongFileType.ATMOS_2,
          qqSong.SongFileType.FLAC,
          qqSong.SongFileType.OGG_640,
          qqSong.SongFileType.MP3_320,
          qqSong.SongFileType.MP3_128,
        ]
      : [qqSong.SongFileType.MP3_320, qqSong.SongFileType.MP3_128];
    // 音质偏好截断阶梯（不可用档位自动向下降级）：
    // standard=128 封顶 / high=320 封顶 / lossless=FLAC 封顶 / best=全阶梯自动
    let ladder = fullLadder;
    if (quality === "standard") {
      ladder = [qqSong.SongFileType.MP3_128];
    } else if (quality === "high") {
      ladder = fullLadder.filter((t) => t === qqSong.SongFileType.MP3_320 || t === qqSong.SongFileType.MP3_128);
    } else if (quality === "lossless") {
      ladder = fullLadder.filter(
        (t) =>
          t === qqSong.SongFileType.FLAC ||
          t === qqSong.SongFileType.OGG_640 ||
          t === qqSong.SongFileType.MP3_320 ||
          t === qqSong.SongFileType.MP3_128,
      );
    }
    if (!ladder.length) ladder = fullLadder;

    const resp = (await qqSong.getSongUrls(
      c,
      ladder.map((t) => ({ mid: songMID, fileType: t, songType: 0 })),
      ladder[0],
    )) as { midurlinfo?: { filename?: string; purl?: string }[] };
    const infos = resp?.midurlinfo ?? [];
    // 按请求顺序取第一个有 purl 的文件名
    for (const t of ladder) {
      const expected = `${t.s}${songMID}${songMID}${t.e}`;
      for (const info of infos) {
        if (info.filename === expected && info.purl) {
          return `https://ws.stream.qqmusic.qq.com/${info.purl}`;
        }
      }
    }
    throw new Error("no valid download url found or vip required");
  },

  // ---------------- 歌词（QRC 变体 3DES 解密链路保留复用） ----------------
  async getLyric(song: Song): Promise<string> {
    if (song.source !== "qq") throw new Error("source mismatch");
    const c = client();
    let songMID = song.id;
    if (song.extra && song.extra["songmid"] !== "") songMID = song.extra["songmid"];
    let songID = atoi(song.extra?.["song_id"] ?? song.id);
    if (songID === 0) {
      const parsed = await queryTrackSong(c, songMID, false);
      if (parsed.extra && parsed.extra["song_id"] !== "") songID = atoi(parsed.extra["song_id"]);
      if (song.name === "") song.name = parsed.name;
      if (song.artist === "") song.artist = parsed.artist;
      if (song.album === "") song.album = parsed.album;
      if (song.duration === 0) song.duration = parsed.duration;
    }
    if (songID === 0) throw new Error("qq song id not found");

    const data = (await qqLyric.getLyric(c, songID, {
      qrc: true,
      trans: true,
      roma: true,
      songType: 1,
    })) as { lyric?: string; trans?: string; roma?: string };
    if (!data?.lyric) throw new Error("lyric is empty or not found");

    const tags: Record<string, string> = { ti: song.name, ar: song.artist, al: song.album };
    const qrcData: QrcMultiData = {};
    for (const item of [
      { key: "orig", raw: data.lyric ?? "" },
      { key: "ts", raw: data.trans ?? "" },
      { key: "roma", raw: data.roma ?? "" },
    ]) {
      if (item.raw.trim() === "") continue;
      let decrypted: string;
      try {
        decrypted = decryptQRCHex(item.raw);
      } catch {
        // 模块层已按 Python 验证器语义自动解密（对齐 _decrypt_lyrics），此处兜底视原文为明文
        decrypted = item.raw;
      }
      const [qrcTags, parsed] = parseQRC(decrypted);
      if (item.key === "orig") {
        for (const [k, v] of Object.entries(qrcTags)) {
          if ((tags[k] ?? "").trim() === "") tags[k] = v;
        }
      }
      qrcData[item.key] = parsed;
    }
    if (!qrcData["orig"] || qrcData["orig"].length === 0) {
      throw new Error("lyric is empty or qrc decrypt failed");
    }
    return convertVerbatimLRC(tags, qrcData, defaultDisplayOrder());
  },

  // ---------------- 专辑 ----------------
  async searchAlbum(keyword: string): Promise<Playlist[]> {
    const c = client();
    const resp = (await qqSearch.searchByType(c, keyword, {
      searchType: qqSearch.SearchType.ALBUM,
      num: 20,
      highlight: false,
    })) as {
      body?: {
        // item_album 真实字段：id / albummid（全小写）/ name / singer_list / description(发行日期) / pic
        item_album?: {
          id?: number;
          albummid?: string;
          name?: string;
          singer_list?: { name?: string }[];
          description?: string;
          pic?: string;
        }[];
      };
    };
    const playlists: Playlist[] = [];
    for (const item of resp?.body?.item_album ?? []) {
      const albumID = String(item.id ?? 0);
      const albumMID = item.albummid ?? "";
      const name = stripEm(String(item.name ?? "")).trim();
      if (albumID === "0" || name === "") continue;
      const artists = (item.singer_list ?? []).map((s) => stripEm(String(s.name ?? ""))).join("、");
      playlists.push({
        source: "qq",
        id: albumID,
        name,
        cover: normalizeQQCover(item.pic ?? "") || qqCover(albumMID),
        track_count: 0,
        play_count: 0,
        creator: artists,
        description: item.description ?? "",
        link: `https://y.qq.com/n/ryqq/albumDetail/${albumMID}`,
        extra: { album_mid: albumMID, album_id: albumID },
      });
    }
    return playlists;
  },

  async getAlbumSongs(id: string): Promise<Song[]> {
    const c = client();
    const songs: Song[] = [];
    let page = 1;
    // 分页拉全（每页 100，最多 10 页防御）；GetAlbumSongList 结构：songList[*].songInfo
    for (;;) {
      const resp = (await qqAlbum.getSong(c, id, 100, page)) as {
        totalNum?: number;
        songList?: { songInfo?: QQTrack }[];
      };
      const list = resp?.songList ?? [];
      for (const entry of list) {
        if (entry?.songInfo) songs.push(trackToSong(entry.songInfo));
      }
      const total = resp?.totalNum ?? 0;
      if (!list.length || songs.length >= total || page >= 10) break;
      page++;
    }
    return songs;
  },

  async parseAlbum(link: string): Promise<PlaylistDetail> {
    let albumID = "";
    let albumMID = "";
    const m = link.match(/albumDetail\/(\w+)/);
    if (m) albumMID = m[1] ?? "";
    if (albumMID === "") {
      try {
        const u = new URL(link);
        albumID = u.searchParams.get("albumid") ?? "";
        albumMID = u.searchParams.get("albummid") ?? "";
      } catch {
        /* fallthrough */
      }
    }
    const value = albumID !== "" ? albumID : albumMID;
    if (value === "") throw new Error("invalid qq album link");
    const c = client();
    // GetAlbumDetail 结构：basicInfo（专辑信息）+ singer.singerList（歌手）
    const detail = (await qqAlbum.getDetail(c, value)) as {
      basicInfo?: { albumID?: number; albumMid?: string; albumName?: string; publishDate?: string };
      singer?: { singerList?: { name?: string }[] };
    };
    const mid = detail?.basicInfo?.albumMid ?? albumMID;
    const id = String(detail?.basicInfo?.albumID ?? albumID ?? 0);
    const songs = await qq.getAlbumSongs!(id !== "0" ? id : mid);
    return {
      playlist: {
        source: "qq",
        id: id !== "0" ? id : mid,
        name: detail?.basicInfo?.albumName ?? "",
        cover: qqCover(mid),
        track_count: songs.length,
        play_count: 0,
        creator: (detail?.singer?.singerList ?? []).map((s) => s.name ?? "").join("、"),
        description: detail?.basicInfo?.publishDate ?? "",
        link: `https://y.qq.com/n/ryqq/albumDetail/${mid}`,
        extra: { album_mid: mid, album_id: id },
      },
      songs,
    };
  },

  // ---------------- 歌单 ----------------
  async searchPlaylist(keyword: string): Promise<Playlist[]> {
    const c = client();
    const resp = (await qqSearch.searchByType(c, keyword, {
      searchType: qqSearch.SearchType.SONGLIST,
      num: 20,
      highlight: false,
    })) as {
      body?: {
        item_songlist?: {
          dissid?: string | number;
          dissname?: string;
          imgurl?: string;
          logo?: string;
          songnum?: number;
          listennum?: number;
          nickname?: string;
        }[];
      };
    };
    const playlists: Playlist[] = [];
    for (const item of resp?.body?.item_songlist ?? []) {
      const id = String(item.dissid ?? "").trim();
      const name = stripEm(String(item.dissname ?? "")).trim();
      if (id === "" || name === "") continue;
      playlists.push({
        source: "qq",
        id,
        name,
        cover: normalizeQQCover(item.imgurl ?? item.logo ?? ""),
        track_count: item.songnum ?? 0,
        play_count: item.listennum ?? 0,
        creator: stripEm(String(item.nickname ?? "")),
        description: "",
        link: `https://y.qq.com/n/ryqq/playlist/${id}`,
      });
    }
    return playlists;
  },

  async getPlaylistSongs(id: string): Promise<Song[]> {
    // 虚拟歌单：我喜欢（dirid=201）/ 目录歌单
    if (id === QQ_FAVORITE_SONGS_PLAYLIST_ID) {
      const c = client();
      const cred = c.credential;
      if (!cred.encryptUin) throw new Error("qq favorites require login");
      const resp = (await qqUser.getFavSong(c, cred.encryptUin, { num: 500, page: 1 })) as SonglistRaw;
      return (resp?.songlist ?? []).map(trackToSong);
    }
    if (id.startsWith(QQ_PROFILE_DIR_PLAYLIST_PREFIX)) {
      const dirid = atoi(id.slice(QQ_PROFILE_DIR_PLAYLIST_PREFIX.length));
      const c = client();
      const resp = (await qqSonglist.getDetail(c, 0, { dirid, num: 500, page: 1 })) as SonglistRaw;
      return (resp?.songlist ?? []).map(trackToSong);
    }
    const c = client();
    const songs: Song[] = [];
    let page = 1;
    for (;;) {
      const resp = (await qqSonglist.getDetail(c, atoi(id), { num: 100, page })) as SonglistRaw;
      const list = resp?.songlist ?? [];
      for (const track of list) songs.push(trackToSong(track));
      const total = resp?.total_song_num ?? 0;
      if (!list.length || songs.length >= total || page >= 10) break;
      page++;
    }
    return songs;
  },

  async parsePlaylist(link: string): Promise<PlaylistDetail> {
    // 链接 ID 提取逻辑保留（含短链 digits 容错）
    let playlistID = "";
    const m = link.match(/playlist\/(\d+)/);
    if (m) playlistID = m[1] ?? "";
    if (playlistID === "") {
      try {
        const u = new URL(link);
        playlistID = u.searchParams.get("id") ?? "";
      } catch {
        const digits = link.match(/(\d{6,})/);
        if (digits) playlistID = digits[1] ?? "";
      }
    }
    if (playlistID === "") throw new Error("invalid qq playlist link");
    const c = client();
    const resp = (await qqSonglist.getDetail(c, atoi(playlistID), { num: 1, page: 1 })) as SonglistRaw & {
      dirinfo?: { title?: string; picurl?: string; songnum?: number; listennum?: number; desc?: string };
    };
    const info = resp?.dirinfo ?? {};
    const name = stripEm(String(info.title ?? "")).trim();
    if (name === "") throw new Error("qq playlist not found");
    const songs = await qq.getPlaylistSongs!(playlistID);
    return {
      playlist: {
        source: "qq",
        id: playlistID,
        name,
        cover: normalizeQQCover(info.picurl ?? ""),
        track_count: info.songnum ?? songs.length,
        play_count: info.listennum ?? 0,
        creator: "",
        description: info.desc ?? "",
        link: `https://y.qq.com/n/ryqq/playlist/${playlistID}`,
      },
      songs,
    };
  },

  // ---------------- 推荐歌单（PlaylistSquare.GetRecommendFeed） ----------------
  // 结构对齐参考 jsonpath：songlists ← $.List[*].Playlist.basic；picurl ← $.cover.default_url；creator_nick ← $.creator.nick
  async getRecommendedPlaylists(): Promise<Playlist[]> {
    const c = client();
    const resp = (await qqRecommend.getRecommendSonglist(c, 1, 30)) as {
      List?: {
        Playlist?: {
          basic?: {
            tid?: number | string;
            title?: string;
            desc?: string;
            // cover 为对象：{ id, mid, small_url, default_url }
            cover?: { small_url?: string; default_url?: string };
            song_cnt?: number;
            play_cnt?: number;
            creator?: { nick?: string };
          };
        };
      }[];
    };
    const playlists: Playlist[] = [];
    for (const entry of resp?.List ?? []) {
      const item = entry?.Playlist?.basic;
      if (!item) continue;
      const id = String(item.tid ?? "").trim();
      const name = stripEm(String(item.title ?? "")).trim();
      if (id === "" || id === "0" || name === "") continue;
      playlists.push({
        source: "qq",
        id,
        name,
        cover: normalizeQQCover(item.cover?.default_url ?? item.cover?.small_url ?? ""),
        track_count: item.song_cnt ?? 0,
        play_count: item.play_cnt ?? 0,
        creator: stripEm(String(item.creator?.nick ?? "")),
        description: item.desc ?? "",
        link: `https://y.qq.com/n/ryqq/playlist/${id}`,
      });
    }
    if (!playlists.length) throw new Error("no recommended playlists found");
    return playlists;
  },

  // ---------------- 歌单分类（本项目特有链路保留；参考仓库无对应接口） ----------------
  async getPlaylistCategories(): Promise<PlaylistCategory[]> {
    const c = client();
    const res = await c.raw({
      method: "GET",
      url: "https://c.y.qq.com/splcloud/fcgi-bin/fcg_get_diss_tag_conf.fcg",
      params: { format: "json", inCharset: "utf8", outCharset: "utf-8" },
      headers: { Referer: "https://y.qq.com/" },
    });
    const resp = res.json<{
      code?: number;
      data?: { categories?: { categoryGroupName?: string; items?: { categoryId?: number; categoryName?: string; usable?: number }[] }[] };
    }>();
    if (!resp || (resp.code ?? 0) !== 0) throw new Error(`qq playlist category api error (code ${resp?.code ?? "parse"})`);
    const categories: PlaylistCategory[] = [{ source: "qq", id: "", name: "全部", group: "全部", count: 0 }];
    for (const group of resp.data?.categories ?? []) {
      const groupName = (group.categoryGroupName ?? "").trim();
      for (const item of group.items ?? []) {
        if (item.usable === 0 || item.categoryId === 0 || item.categoryId === 10000000) continue;
        const name = (item.categoryName ?? "").trim();
        if (name === "") continue;
        const categoryID = String(item.categoryId ?? 0);
        categories.push({
          source: "qq",
          id: categoryID,
          name,
          group: groupName,
          count: 0,
          extra: { category_id: categoryID },
        });
      }
    }
    return categories;
  },

  async getCategoryPlaylists(categoryID: string, page: number, limit: number): Promise<Playlist[]> {
    categoryID = categoryID.trim();
    if (categoryID === "") categoryID = "10000000";
    if (page < 1) page = 1;
    if (limit < 1) limit = 20;
    const offset = (page - 1) * limit;
    const c = client();
    const res = await c.raw({
      method: "GET",
      url: "https://c.y.qq.com/splcloud/fcgi-bin/fcg_get_diss_by_tag.fcg",
      params: {
        picmid: "1",
        rnd: "0.1",
        g_tk: "5381",
        loginUin: "0",
        hostUin: "0",
        format: "json",
        inCharset: "utf8",
        outCharset: "utf-8",
        notice: "0",
        platform: "yqq.json",
        needNewCode: "0",
        categoryId: categoryID,
        sortId: "5",
        sin: String(offset),
        ein: String(offset + limit - 1),
      },
      headers: { Referer: "https://y.qq.com/" },
    });
    const resp = res.json<{
      code?: number;
      data?: {
        list?: {
          dissid?: string;
          dissname?: string;
          imgurl?: string;
          introduction?: string;
          listennum?: number;
          song_count?: number;
          song_num?: number;
          creator?: { name?: string };
        }[];
      };
    }>();
    if (!resp || (resp.code ?? 0) !== 0) throw new Error(`qq category playlist api error (code ${resp?.code ?? "parse"})`);
    const playlists: Playlist[] = [];
    for (const item of resp.data?.list ?? []) {
      const id = (item.dissid ?? "").trim();
      const name = (item.dissname ?? "").trim();
      if (id === "" || name === "") continue;
      playlists.push({
        source: "qq",
        id,
        name,
        cover: normalizeQQCover(item.imgurl ?? ""),
        track_count: item.song_count ?? item.song_num ?? 0,
        play_count: item.listennum ?? 0,
        creator: item.creator?.name ?? "",
        description: item.introduction ?? "",
        link: `https://y.qq.com/n/ryqq/playlist/${id}`,
        extra: { category_id: categoryID },
      });
    }
    if (!playlists.length) throw new Error("no category playlists found");
    return playlists;
  },

  // ---------------- 用户歌单（GetPlaylistByUin + 收藏歌单 + 虚拟歌单聚合） ----------------
  async getUserPlaylists(page: number, limit: number): Promise<Playlist[]> {
    const c = client();
    const cred = c.credential;
    if (!cred.musicid || !cred.musickey) throw new Error("qq user playlists require cookie");
    const uin = cred.str_musicid || String(cred.musicid);
    const euin = cred.encryptUin;
    if (page < 1) page = 1;
    if (limit <= 0) limit = 30;
    if (limit > 100) limit = 100;
    const playlists: Playlist[] = [];
    const seen = new Set<string>();
    const add = (p: Playlist) => {
      p.id = String(p.id ?? "").trim();
      p.name = stripEm(String(p.name ?? "")).trim();
      if (p.id === "" || p.name === "" || seen.has(p.id)) return;
      seen.add(p.id);
      playlists.push(p);
    };

    // 我喜欢（dirid=201 虚拟歌单）
    if (euin) {
      try {
        const fav = (await qqUser.getFavSong(c, euin, { num: 1, page: 1 })) as SonglistRaw;
        const total = fav?.total_song_num ?? 0;
        if (total > 0) {
          add({
            source: "qq",
            id: QQ_FAVORITE_SONGS_PLAYLIST_ID,
            name: "我喜欢",
            cover: qqCover(""),
            track_count: total,
            play_count: 0,
            creator: "",
            description: "QQ音乐收藏歌曲",
            link: "https://y.qq.com/portal/profile.html",
          });
        }
      } catch {
        /* ignore favorite summary error */
      }
    }

    // 自建歌单 + 目录歌单（GetPlaylistByUin）
    try {
      const created = (await qqUser.getCreatedSonglist(c, atoi(uin))) as {
        v_playlist?: {
          dirid?: number;
          tid?: number | string;
          dissid?: number | string;
          dss_id?: number | string;
          dirName?: string;
          diss_name?: string;
          title?: string;
          logo?: string;
          picurl?: string;
          song_cnt?: number;
          songnum?: number;
          song_count?: number;
          listen_num?: number;
          diss_desc?: string;
          dirType?: number;
        }[];
      };
      for (const item of created?.v_playlist ?? []) {
        const tid = String(item.tid ?? item.dissid ?? item.dss_id ?? "0");
        const dirid = item.dirid ?? 0;
        const name = stripEm(String(firstNonEmpty(item.dirName, item.diss_name, item.title) ?? "")).trim();
        // 目录歌单（无 tid 或 tid=0）→ profile:dir:{dirid} 虚拟歌单
        const id = tid !== "" && tid !== "0" ? tid : dirid > 0 ? `${QQ_PROFILE_DIR_PLAYLIST_PREFIX}${dirid}` : "";
        if (id === "" || name === "") continue;
        let trackCount = item.song_cnt ?? item.song_count ?? 0;
        if (trackCount === 0) trackCount = item.songnum ?? 0;
        add({
          source: "qq",
          id,
          name,
          cover: normalizeQQCover(item.logo ?? item.picurl ?? ""),
          track_count: trackCount,
          play_count: item.listen_num ?? 0,
          creator: "",
          description: item.diss_desc ?? "",
          link: `https://y.qq.com/n/ryqq/playlist/${tid !== "0" ? tid : ""}`,
        });
      }
    } catch {
      /* ignore created error */
    }

    // 收藏歌单（CgiGetPlaylistFavInfo）
    if (euin) {
      try {
        const favList = (await qqUser.getFavSonglist(c, euin, { page, num: limit })) as {
          v_list?: {
            tid?: number | string;
            dss_id?: number | string;
            dissname?: string;
            title?: string;
            logo?: string;
            song_cnt?: number;
            songnum?: number;
            listen_num?: number;
            nickname?: string;
          }[];
        };
        for (const item of favList?.v_list ?? []) {
          const id = String(item.tid ?? item.dss_id ?? "").trim();
          const name = (item.dissname ?? item.title ?? "").trim();
          if (id === "" || id === "0" || name === "") continue;
          add({
            source: "qq",
            id,
            name,
            cover: normalizeQQCover(item.logo ?? ""),
            track_count: item.song_cnt ?? item.songnum ?? 0,
            play_count: item.listen_num ?? 0,
            creator: item.nickname ?? "",
            description: "",
            link: `https://y.qq.com/n/ryqq/playlist/${id}`,
          });
        }
      } catch {
        /* ignore fav error */
      }
    }
    return playlists;
  },

  // ---------------- QQ 扫码登录（lib/qq login 模块，QQ 通道） ----------------
  async createQRLogin(): Promise<QRLoginSession> {
    const c = client();
    const qr = await qqLogin.getQrcode(c, "qq");
    const key = `qq:${qr.identifier}`;
    sweepSessions(qrSessions);
    qrSessions.set(key, { qrType: "qq", identifier: qr.identifier, at: Date.now() });
    return {
      source: "qq",
      key,
      url: qr.identifier,
      image_url: `data:${qr.mimetype};base64,${qr.data.toString("base64")}`,
      state: "waiting",
      extra: { qrsig: qr.identifier },
    };
  },

  async checkQRLogin(key: string): Promise<QRLoginResult> {
    const c = client();
    sweepSessions(qrSessions);
    const session = qrSessions.get(key);
    const identifier = session?.identifier ?? (key.startsWith("qq:") ? key.slice(3) : key);
    const result = await qqLogin.checkQrcode(c, {
      data: Buffer.alloc(0),
      qrType: session?.qrType ?? "qq",
      mimetype: "image/png",
      identifier,
    });
    const statusMap: Record<qqLogin.QRCodeEvent, QRLoginResult["status"]> = {
      DONE: "success",
      SCAN: "waiting",
      CONF: "scanned",
      TIMEOUT: "expired",
      REFUSE: "failed",
    };
    const status = statusMap[result.event] ?? "failed";
    const loginResult: QRLoginResult = {
      source: "qq",
      key,
      status,
      message: result.event,
      extra: { event: result.event },
    };
    if (result.done && result.credential) {
      /* 全局库写入失败降级为仅浏览器会话（登录成果不被存储层故障吞掉，对齐路由层既定策略） */
      try {
        saveCredential(result.credential);
      } catch {
        /* 凭证仍经响应 Set-Cookie 下发浏览器 */
      }
      vipCache = null;
      qrSessions.delete(key);
      loginResult.cookie = credentialToCookie(result.credential);
    }
    return loginResult;
  },
};

/** 歌单详情原始结构（CgiGetDiss 响应） */
interface SonglistRaw {
  dirinfo?: Record<string, unknown>;
  songlist?: QQTrack[];
  total_song_num?: number;
  songlist_size?: number;
}

function stripEm(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

// ---------------------------------------------------------------------------
// 微信扫码通道（独立导出：qr_login 路由 qq_wx 源使用；登录态与 QQ 同库存储）
// ---------------------------------------------------------------------------

const wxSessions = new Map<string, { uuid: string; at: number }>();

export async function createWXQRLogin(): Promise<QRLoginSession> {
  const c = client();
  const qr = await qqLogin.getQrcode(c, "wx");
  const key = `qqwx:${qr.identifier}`;
  sweepSessions(wxSessions);
  wxSessions.set(key, { uuid: qr.identifier, at: Date.now() });
  return {
    source: "qq_wx",
    key,
    url: qr.identifier,
    image_url: `data:${qr.mimetype};base64,${qr.data.toString("base64")}`,
    state: "waiting",
  };
}

export async function checkWXQRLogin(key: string): Promise<QRLoginResult> {
  const c = client();
  sweepSessions(wxSessions);
  const uuid = wxSessions.get(key)?.uuid ?? (key.startsWith("qqwx:") ? key.slice(5) : key);
  const result = await qqLogin.checkQrcode(c, {
    data: Buffer.alloc(0),
    qrType: "wx",
    mimetype: "image/jpeg",
    identifier: uuid,
  });
  const statusMap: Record<qqLogin.QRCodeEvent, QRLoginResult["status"]> = {
    DONE: "success",
    SCAN: "waiting",
    CONF: "scanned",
    TIMEOUT: "expired",
    REFUSE: "failed",
  };
  const loginResult: QRLoginResult = {
    source: "qq_wx",
    key,
    status: statusMap[result.event] ?? "failed",
    message: result.event,
    extra: { event: result.event },
  };
  if (result.done && result.credential) {
    /* 同 checkQRLogin：全局库写入失败降级为仅浏览器会话 */
    try {
      saveCredential(result.credential);
    } catch {
      /* 凭证仍经响应 Set-Cookie 下发浏览器 */
    }
    vipCache = null;
    wxSessions.delete(key);
    loginResult.cookie = credentialToCookie(result.credential);
  }
  return loginResult;
}
