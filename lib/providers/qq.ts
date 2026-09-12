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
  Toplist,
  MvItem,
  MvListOptions,
  MvListResult,
  Artist,
  ArtistOverview,
  HotSearch,
  CommentItem,
  CommentListResult,
  SourceLoginProfile,
} from "../types";
import { UpstreamError } from "../types";
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
import * as qqTop from "../qq/modules/top";
import * as qqMv from "../qq/modules/mv";
import * as qqSinger from "../qq/modules/singer";
import * as qqComment from "../qq/modules/comment";
import { singerCoverUrl } from "../qq/cover";

const QQ_FAVORITE_SONGS_PLAYLIST_ID = "profile:favorites";
const QQ_PROFILE_DIR_PLAYLIST_PREFIX = "profile:dir:";

/** 中文地区 → QQ GetAllocMvInfo area 枚举（15=全部 8=内地 5=港台 6=欧美 7=韩国 4=日本） */
const QQ_MV_AREA: Record<string, number> = { 全部: 15, 内地: 8, 港台: 5, 欧美: 6, 韩国: 7, 日本: 4 };

/** GetAllocMvInfo 列表条目（对齐 .ref models/mv.py MvListItem） */
interface QqMvListItem {
  vid?: string;
  name?: string;
  title?: string;
  singers?: { name?: string }[];
  picurl?: string;
  playcnt?: number;
  pubdate?: number;
  duration?: number;
}

/** get_video_info_batch 详情条目（对齐 .ref models/mv.py MvDetail） */
interface QqMvDetailItem {
  name?: string;
  cover_pic?: string;
  duration?: number;
  singers?: { name?: string }[];
  playcnt?: number;
  pubdate?: number;
  desc?: string;
  msg?: string;
}

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

/** QQ 秒级时间戳 → 相对时间文本 */
function relativeTimeQQ(sec: number): string {
  if (!sec || sec <= 0) return "";
  const ts = sec * 1000;
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min}分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}天前`;
  const date = new Date(ts);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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

  // ---------------- 排行榜（musicToplist.Toplist） ----------------
  // GetAll 结构对齐 .ref models/top.py：group[{groupId,groupName,toplist[{topId,title,updateTime,song[]...}]}]
  async getToplists(): Promise<Toplist[]> {
    const c = client();
    const resp = (await qqTop.getCategory(c)) as {
      group?: {
        groupId?: number;
        groupName?: string;
        toplist?: {
          topId?: number | string;
          title?: string;
          intro?: string;
          period?: string;
          updateTime?: string;
          listenNum?: number;
          totalNum?: number;
          frontPicUrl?: string;
          headPicUrl?: string;
          /** 预览曲目（rank/title/singerName） */
          song?: { rank?: number; title?: string; singerName?: string }[];
        }[];
      }[];
    };

    const toplists: Toplist[] = [];
    for (const g of resp?.group ?? []) {
      const groupName = (g?.groupName ?? "").trim();
      for (const item of g?.toplist ?? []) {
        const id = String(item?.topId ?? "").trim();
        const name = stripEm(String(item?.title ?? "")).trim();
        if (id === "" || id === "0" || name === "") continue;
        const highlights = (item?.song ?? [])
          .slice(0, 3)
          .map((s) => {
            const title = stripEm(String(s?.title ?? "")).trim();
            const singer = stripEm(String(s?.singerName ?? "")).trim();
            return singer ? `${title} - ${singer}` : title;
          })
          .filter(Boolean);
        toplists.push({
          source: "qq",
          id,
          name,
          cover: normalizeQQCover(item?.frontPicUrl ?? item?.headPicUrl ?? ""),
          update_time: (item?.updateTime ?? item?.period ?? "").trim(),
          description: (item?.intro ?? "").trim(),
          highlights,
          group: groupName,
          play_count: item?.listenNum ?? 0,
          track_count: item?.totalNum ?? 0,
          link: `https://y.qq.com/n/ryqq/toplist/${id}`,
          extra: { group_id: String(g?.groupId ?? 0) },
        });
      }
    }
    if (!toplists.length) throw new Error("no toplist found");
    return toplists;
  },

  // GetDetail：songInfoList 为完整 QQTrack（base.py Song 模型），info(data) 为榜单信息
  async getToplistSongs(toplistId: string): Promise<Song[]> {
    const c = client();
    const songs: Song[] = [];
    let page = 1;
    for (;;) {
      const resp = (await qqTop.getDetail(c, atoi(toplistId), { num: 100, page })) as {
        data?: { totalNum?: number };
        songInfoList?: QQTrack[];
      };
      const list = resp?.songInfoList ?? [];
      for (const track of list) songs.push(trackToSong(track));
      const total = resp?.data?.totalNum ?? 0;
      if (!list.length || songs.length >= total || page >= 5) break;
      page++;
    }
    return songs;
  },

  // ---------------- MV（MvService.MvInfoProServer 列表 + video.VideoDataServer 详情/链接） ----------------

  async getMvList(opts: MvListOptions): Promise<MvListResult> {
    const c = client();
    const limit = Math.min(Math.max(opts.limit, 1), 50);
    const areaName = (opts.area ?? "").trim() || "全部";
    const area = QQ_MV_AREA[areaName] ?? 15;
    const resp = (await qqMv.getMvList(c, { area, version: 7, order: 0, num: limit, page: opts.page })) as {
      data?: { list?: QqMvListItem[]; total?: number };
      list?: QqMvListItem[];
    };
    const list = resp?.data?.list ?? resp?.list ?? [];
    const mvs: MvItem[] = [];
    for (const item of list) {
      const vid = String(item?.vid ?? "").trim();
      const name = stripEm(String(item?.name ?? item?.title ?? "")).trim();
      if (!vid || !name) continue;
      mvs.push({
        source: "qq",
        id: vid,
        name,
        artist: (item?.singers ?? []).map((s) => stripEm(String(s?.name ?? ""))).filter(Boolean).join("、"),
        cover: normalizeQQCover(item?.picurl ?? ""),
        duration: item?.duration ?? 0,
        play_count: item?.playcnt ?? 0,
        publish_time: item?.pubdate ? new Date(item.pubdate * 1000).toISOString().slice(0, 10) : undefined,
        link: `https://y.qq.com/n/ryqq/mv/${vid}`,
        extra: { vid },
      });
    }
    return { mvs, has_more: mvs.length >= limit };
  },

  async getMvDetail(mvId: string): Promise<MvItem> {
    const c = client();
    const resp = (await qqMv.getDetail(c, [mvId])) as { data?: Record<string, QqMvDetailItem> };
    const d = resp?.data?.[mvId];
    if (!d) throw new Error("qq mv not found");
    const name = stripEm(String(d.name ?? "")).trim();
    if (!name) throw new Error("qq mv not found");
    return {
      source: "qq",
      id: mvId,
      name,
      artist: (d.singers ?? []).map((s) => stripEm(String(s?.name ?? ""))).filter(Boolean).join("、"),
      cover: normalizeQQCover(d.cover_pic ?? ""),
      duration: d.duration ?? 0,
      play_count: d.playcnt ?? 0,
      publish_time: d.pubdate ? new Date(d.pubdate * 1000).toISOString().slice(0, 10) : undefined,
      link: `https://y.qq.com/n/ryqq/mv/${mvId}`,
      extra: { desc: (d.desc ?? d.msg ?? "").slice(0, 500) },
    };
  },

  async getMvUrl(mvId: string): Promise<string> {
    const c = client();
    const resp = (await qqMv.getMvUrls(c, [mvId])) as {
      data?: Record<string, { mp4?: { url?: string[] }[]; hls?: { m3u8?: string; url?: string[] }[] }>;
    };
    const set = resp?.data?.[mvId];
    const mp4 = set?.mp4?.[0]?.url?.[0] ?? set?.mp4?.flatMap((m) => m.url ?? []).find(Boolean);
    const url = (mp4 ?? set?.hls?.[0]?.url?.[0] ?? "").trim();
    if (!url) throw new Error("该 MV 暂无法播放（可能需要 VIP 或已下架）");
    return normalizeQQCover(url);
  },

  // ---------------- 歌手主页（UnifiedHomepage 概览 + 歌曲库分页 + 相似歌手） ----------------

  /** GetHomepageHeader：Info.Singer（头像/名称）+ TabDetail（歌曲/专辑/视频/简介 首屏） */
  async getArtistOverview(artistId: string): Promise<ArtistOverview> {
    const c = client();
    const resp = (await qqSinger.getInfo(c, artistId)) as {
      Status?: number;
      Info?: {
        Singer?: { SingerID?: number | string; SingerMid?: string; Name?: string; SingerPic?: string; SingerPMid?: string };
        BaseInfo?: { Name?: string; Avatar?: string; BackgroundImage?: string };
      };
      TabDetail?: {
        SongTab?: { List?: { songInfo?: QQTrack }[]; TotalNum?: number };
        AlbumTab?: { AlbumList?: { totalNum?: number }[]; TotalNum?: number };
        VideoTab?: { VideoList?: { total?: number }[]; Total?: number };
        IntroductionTab?: { List?: { title?: string; value?: string }[] };
      };
    };
    const s = resp?.Info?.Singer;
    const name = stripEm(String(s?.Name ?? resp?.Info?.BaseInfo?.Name ?? "")).trim();
    if (!s?.SingerMid && !name) throw new Error("qq singer not found");

    const tabs = resp?.TabDetail;
    const artist: Artist = {
      source: "qq",
      id: s?.SingerMid || artistId,
      name,
      avatar:
        normalizeQQCover(s?.SingerPic ?? "") ||
        normalizeQQCover(resp?.Info?.BaseInfo?.Avatar ?? "") ||
        singerCoverUrl({ mid: s?.SingerPMid || s?.SingerMid || artistId }, 500),
      brief: (tabs?.IntroductionTab?.List ?? [])
        .map((seg) => `${(seg?.title ?? "").trim()}：${(seg?.value ?? "").trim()}`)
        .filter((line) => !line.endsWith("："))
        .join("\n")
        .slice(0, 800),
      song_count: tabs?.SongTab?.TotalNum ?? tabs?.SongTab?.List?.length ?? 0,
      album_count: tabs?.AlbumTab?.TotalNum ?? tabs?.AlbumTab?.AlbumList?.length ?? 0,
      mv_count: tabs?.VideoTab?.Total ?? tabs?.VideoTab?.VideoList?.length ?? 0,
      link: `https://y.qq.com/n/ryqq/singer/${s?.SingerMid || artistId}`,
      extra: { singer_id: String(s?.SingerID ?? 0) },
    };

    const topSongs = (tabs?.SongTab?.List ?? [])
      .map((e) => e?.songInfo)
      .filter((t): t is QQTrack => !!t)
      .map(trackToSong);

    /* 匿名请求 UnifiedHomepage 常不返回 SongTab.List：降级用歌曲库首页补"热门50" */
    if (!topSongs.length) {
      try {
        const fb = (await qqSinger.getSongsList(c, artistId, 50, 1)) as {
          songList?: { songInfo?: QQTrack }[];
        };
        return {
          artist,
          top_songs: (fb?.songList ?? [])
            .map((e) => e?.songInfo)
            .filter((t): t is QQTrack => !!t)
            .map(trackToSong),
        };
      } catch {
        /* 降级失败维持空列表 */
      }
    }
    return { artist, top_songs: topSongs };
  },

  async getArtistSongs(artistId: string, page: number, limit: number): Promise<{ songs: Song[]; has_more: boolean }> {
    const c = client();
    const l = Math.min(Math.max(limit, 1), 100);
    const resp = (await qqSinger.getSongsList(c, artistId, l, page)) as {
      totalNum?: number;
      songList?: { songInfo?: QQTrack }[];
    };
    const songs = (resp?.songList ?? [])
      .map((e) => e?.songInfo)
      .filter((t): t is QQTrack => !!t)
      .map(trackToSong);
    const total = resp?.totalNum ?? 0;
    return { songs, has_more: songs.length >= l || (total > 0 && page * l < total) };
  },

  async getArtistAlbums(artistId: string, page: number, limit: number): Promise<{ albums: Playlist[]; has_more: boolean }> {
    const c = client();
    const l = Math.min(Math.max(limit, 1), 100);
    const resp = (await qqSinger.getAlbumList(c, artistId, l, page)) as {
      total?: number;
      albumList?: { albumID?: number | string; albumMid?: string; albumName?: string; publishDate?: string; totalNum?: number }[];
    };
    const albums: Playlist[] = [];
    for (const item of resp?.albumList ?? []) {
      const mid = String(item?.albumMid ?? "").trim();
      const name = stripEm(String(item?.albumName ?? "")).trim();
      if (!mid || !name) continue;
      albums.push({
        source: "qq",
        id: mid,
        name,
        cover: qqCover(mid),
        track_count: item?.totalNum ?? 0,
        play_count: 0,
        creator: "",
        description: (item?.publishDate ?? "").slice(0, 10),
        link: `https://y.qq.com/n/ryqq/albumDetail/${mid}`,
        extra: { album_mid: mid },
      });
    }
    const total = resp?.total ?? 0;
    return { albums, has_more: albums.length >= l || (total > 0 && page * l < total) };
  },

  async getArtistMvs(artistId: string, page: number, limit: number): Promise<{ mvs: MvItem[]; has_more: boolean }> {
    const c = client();
    const l = Math.min(Math.max(limit, 1), 50);
    const resp = (await qqSinger.getMvList(c, artistId, l, page)) as {
      total?: number;
      list?: { mvid?: number | string; vid?: string; title?: string; picurl?: string; playcnt?: number; pubdate?: number; duration?: number; singerName?: string }[];
    };
    const mvs: MvItem[] = [];
    for (const item of resp?.list ?? []) {
      const vid = String(item?.vid ?? "").trim();
      const name = stripEm(String(item?.title ?? "")).trim();
      if (!vid || !name) continue;
      mvs.push({
        source: "qq",
        id: vid,
        name,
        artist: stripEm(String(item?.singerName ?? "")).trim(),
        cover: normalizeQQCover(item?.picurl ?? ""),
        duration: item?.duration ?? 0,
        play_count: item?.playcnt ?? 0,
        publish_time: item?.pubdate ? new Date(item.pubdate * 1000).toISOString().slice(0, 10) : undefined,
        link: `https://y.qq.com/n/ryqq/mv/${vid}`,
        extra: { vid },
      });
    }
    const total = resp?.total ?? 0;
    return { mvs, has_more: mvs.length >= l || (total > 0 && page * l < total) };
  },

  async getSimilarArtists(artistId: string): Promise<Artist[]> {
    const c = client();
    const resp = (await qqSinger.getSimilar(c, artistId, 12)) as {
      code?: number;
      singerlist?: { singerId?: number | string; singerMid?: string; singerName?: string; singerPic?: string; pic_mid?: string }[];
    };
    return (resp?.singerlist ?? [])
      .filter((s) => (s?.singerMid ?? "").trim())
      .map((s) => ({
        source: "qq",
        id: String(s.singerMid),
        name: stripEm(String(s?.singerName ?? "")).trim(),
        avatar:
          normalizeQQCover(s?.singerPic ?? "") || singerCoverUrl({ pmid: s?.pic_mid, mid: s.singerMid }, 300),
        link: `https://y.qq.com/n/ryqq/singer/${s.singerMid}`,
      }));
  },

  // ---------------- 搜索增强（HotkeyService 热搜 · SmartBox 联想 · SINGER 类型搜索） ----------------

  async getHotSearches(): Promise<HotSearch[]> {
    const c = client();
    const resp = (await qqSearch.getHotkey(c)) as {
      vec_hotkey?: { query?: string; score?: string | number; pic_url?: string; cover_pic_url?: string; need_top?: number }[];
    };
    const out: HotSearch[] = [];
    for (const item of resp?.vec_hotkey ?? []) {
      const keyword = (item?.query ?? "").trim();
      if (!keyword) continue;
      out.push({
        source: "qq",
        keyword,
        score: atoi(String(item?.score ?? "0")),
        cover: normalizeQQCover(item?.cover_pic_url ?? item?.pic_url ?? ""),
      });
      if (out.length >= 20) break;
    }
    return out;
  },

  async getSearchSuggest(keyword: string): Promise<string[]> {
    const q = keyword.trim();
    if (!q) return [];
    const c = client();
    const resp = (await qqSearch.complete(c, q)) as {
      data?: {
        item?: { hint?: string }[];
        items?: { hint?: string }[];
        vec_related_items?: { hint?: string }[];
      };
    };
    /* 上游字段名多变（item / items / vec_related_items），合并去重 */
    const raw = [...(resp?.data?.items ?? []), ...(resp?.data?.item ?? []), ...(resp?.data?.vec_related_items ?? [])];
    return raw
      .map((m) => stripEm(String(m?.hint ?? "")).trim())
      .filter(Boolean)
      .filter((k, i, arr) => arr.indexOf(k) === i)
      .slice(0, 8);
  },

  async searchArtists(keyword: string): Promise<Artist[]> {
    const q = keyword.trim();
    if (!q) return [];
    const c = client();
    const resp = (await qqSearch.searchByType(c, q, {
      searchType: qqSearch.SearchType.SINGER,
      num: 8,
      highlight: false,
    })) as {
      body?: {
        /* SINGER 类型实际返回 body.singer[]（body.item_singer 不存在） */
        singer?: { singerID?: number | string; singerMID?: string; singerName?: string; singerPic?: string }[];
        item_singer?: { singerID?: number | string; singerMID?: string; singerName?: string; singerPic?: string }[];
      };
    };
    return (resp?.body?.singer ?? resp?.body?.item_singer ?? [])
      .filter((s) => (s?.singerMID ?? "").trim())
      .map((s) => ({
        source: "qq",
        id: String(s.singerMID),
        name: stripEm(String(s?.singerName ?? "")).trim(),
        avatar: normalizeQQCover(s?.singerPic ?? "") || singerCoverUrl({ mid: s.singerMID }, 300),
        link: `https://y.qq.com/n/ryqq/singer/${s.singerMID}`,
      }));
  },

  // ---------------- 新碟架（newalbum.NewAlbumServer · FavAlbum 收藏列表/收藏切换） ----------------

  /** 中文地区 → QQ area 枚举（1=内地 2=港台 3=欧美 4=韩国 5=日本；QQ 无"全部"，全部/华语均映射内地） */
  async getNewAlbums(opts): Promise<{ albums: Playlist[]; has_more: boolean }> {
    const c = client();
    const l = Math.min(Math.max(opts.limit, 1), 100);
    const areaMap: Record<string, number> = { 全部: 1, 华语: 1, 内地: 1, 港台: 2, 欧美: 3, 韩国: 4, 日本: 5 };
    const area = areaMap[(opts.area ?? "全部").trim()] ?? 1;
    const resp = (await qqAlbum.getNewAlbum(c, area, l, opts.page)) as {
      total?: number;
      albums?: {
        /* 上游实际为短命名（id/mid/name/release_time），兼容长命名变体 */
        id?: number | string;
        albumID?: number | string;
        mid?: string;
        albumMid?: string;
        name?: string;
        albumName?: string;
        singers?: { name?: string }[];
        release_time?: string;
        publishDate?: string;
        totalNum?: number;
      }[];
    };
    const albums: Playlist[] = [];
    for (const a of resp?.albums ?? []) {
      const mid = String(a?.mid ?? a?.albumMid ?? "").trim();
      const name = stripEm(String(a?.name ?? a?.albumName ?? "")).trim();
      if (!mid || !name) continue;
      albums.push({
        source: "qq",
        id: mid,
        name,
        cover: qqCover(mid),
        track_count: a?.totalNum ?? 0,
        play_count: 0,
        creator: (a?.singers ?? []).map((s) => stripEm(String(s?.name ?? ""))).join("、"),
        description: (a?.release_time ?? a?.publishDate ?? "").slice(0, 10),
        link: `https://y.qq.com/n/ryqq/albumDetail/${mid}`,
        extra: { album_mid: mid, album_id: String(a?.id ?? a?.albumID ?? 0) },
      });
    }
    const total = resp?.total ?? 0;
    return { albums, has_more: albums.length >= l || (total > 0 && opts.page * l < total) };
  },

  async getFavAlbums(page: number, limit: number): Promise<{ albums: Playlist[]; has_more: boolean }> {
    const c = client();
    const cred = c.credential;
    if (!cred.encryptUin) throw new Error("收藏专辑需要登录QQ音乐账号");
    const l = Math.min(Math.max(limit, 1), 100);
    const resp = (await qqUser.getFavAlbum(c, cred.encryptUin, { page, num: l })) as {
      total?: number;
      hasmore?: number | boolean;
      v_list?: { albumID?: number | string; albumMid?: string; albumName?: string; v_singer?: { name?: string }[]; songnum?: number; pubtime?: number }[];
    };
    const albums: Playlist[] = [];
    for (const a of resp?.v_list ?? []) {
      const mid = String(a?.albumMid ?? "").trim();
      const name = stripEm(String(a?.albumName ?? "")).trim();
      if (!mid || !name) continue;
      albums.push({
        source: "qq",
        id: mid,
        name,
        cover: qqCover(mid),
        track_count: a?.songnum ?? 0,
        play_count: 0,
        creator: (a?.v_singer ?? []).map((s) => stripEm(String(s?.name ?? ""))).join("、"),
        description: a?.pubtime ? new Date(a.pubtime * 1000).toISOString().slice(0, 10) : "",
        link: `https://y.qq.com/n/ryqq/albumDetail/${mid}`,
        extra: { album_mid: mid, album_id: String(a?.albumID ?? 0) },
      });
    }
    const hasMore = resp?.hasmore === true || resp?.hasmore === 1;
    return { albums, has_more: hasMore || albums.length >= l };
  },

  async subAlbum(album, sub: boolean): Promise<void> {
    const c = client();
    if (!c.credential.encryptUin) throw new Error("收藏专辑需要登录QQ音乐账号");
    const idNum = atoi(album.extra?.album_id ?? album.id);
    if (!idNum) throw new Error("qq album fav requires numeric album_id");
    const ok = sub ? await qqAlbum.favAlbum(c, [idNum]) : await qqAlbum.delFavAlbum(c, [idNum]);
    if (ok === false) throw new Error("操作失败");
  },

  // ---------------- 红心（我喜欢歌单 dirid=201：addSongs/delSongs 通道） ----------------

  async getLikeList(): Promise<string[]> {
    try {
      const c = client();
      const cred = c.credential;
      if (!cred.encryptUin) return [];
      const resp = (await qqUser.getFavSong(c, cred.encryptUin, { num: 500, page: 1 })) as SonglistRaw;
      return (resp?.songlist ?? [])
        .map((t) => String(t?.mid ?? "").trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  },

  async likeSong(song, like): Promise<void> {
    const c = client();
    if (!c.credential.encryptUin) throw new Error("红心需要登录QQ音乐账号");
    const songId = atoi(song.extra?.song_id ?? song.id);
    if (!songId) throw new Error("qq like requires numeric song_id");
    const pairs: [number, number][] = [[songId, 0]];
    const ok = like ? await qqSonglist.likeSong(c, pairs) : await qqSonglist.unlikeSong(c, pairs);
    if (ok === false) throw new Error("操作失败");
  },

  // ---------------- 歌曲评论（CommentRead 热评/最新 · CommentWrite 发表） ----------------
  // QQ 评论 bizId 用数字 song_id（Song.extra.song_id）；响应 CommentList.Comments[*]（对齐 .ref models/comment.py）

  async getSongComments(song, opts): Promise<CommentListResult> {
    const bizId = atoi(song.extra?.song_id ?? song.id);
    if (!bizId) throw new Error("qq comment requires numeric song_id");
    const c = client();
    const l = Math.min(Math.max(opts.limit, 1), 50);
    const fn = opts.sort === "hot" ? qqComment.getHotComments : qqComment.getNewComments;
    const resp = (await fn(c, bizId, { pageNum: opts.page, pageSize: l })) as {
      CommentList?: {
        Comments?: {
          CmId?: string | number;
          Nick?: string;
          Avatar?: string;
          Content?: string;
          PubTime?: number;
          PraiseNum?: number;
          ReplyCnt?: number;
          SubComments?: { CmId?: string; Nick?: string; Content?: string }[];
        }[];
      };
      commenttotal?: number;
      CommentTotal?: number;
      hasmore?: number | boolean;
      HasMore?: number | boolean;
    };
    const comments: CommentItem[] = [];
    for (const item of resp?.CommentList?.Comments ?? []) {
      const id = String(item?.CmId ?? "").trim();
      const content = stripEm(String(item?.Content ?? "")).trim();
      if (!id || !content) continue;
      const sub = item?.SubComments?.[0];
      comments.push({
        id,
        content,
        user: stripEm(String(item?.Nick ?? "")).trim() || "QQ用户",
        avatar: normalizeQQCover(item?.Avatar ?? ""),
        time: item?.PubTime ? relativeTimeQQ(item.PubTime) : "",
        liked_count: item?.PraiseNum ?? 0,
        reply_to: sub?.Nick ? { user: stripEm(String(sub.Nick)), content: stripEm(String(sub?.Content ?? "")).slice(0, 120) } : undefined,
      });
    }
    const total = resp?.commenttotal ?? resp?.CommentTotal ?? comments.length;
    const hasMore = resp?.hasmore === true || resp?.hasmore === 1 || resp?.HasMore === true || resp?.HasMore === 1;
    return { comments, total, has_more: hasMore || (comments.length >= l && total > opts.page * l) };
  },

  async addSongComment(song, content, replyTo?): Promise<void> {
    const bizId = atoi(song.extra?.song_id ?? song.id);
    if (!bizId) throw new Error("qq comment requires numeric song_id");
    const c = client();
    await qqComment.addComment(c, bizId, content, {
      replyCmtId: replyTo ?? null,
    });
  },

  /** 删除自己的评论（DeleteComment；上游仅允许删本人评论） */
  async deleteSongComment(song, commentId: string): Promise<void> {
    const cmId = commentId.trim();
    if (!cmId) throw new Error("qq delete comment requires comment_id");
    const c = client();
    await qqComment.deleteComment(c, cmId);
  },

  // ---------------- 手机号登录（PhoneLogin：验证码发送/鉴权 + Homepage 档案 + 注销） ----------------

  /** 注销 QQ 账号凭证（login/logout；未登录静默跳过；本地 credential 清理由路由层负责） */
  async logout(): Promise<void> {
    const c = client();
    if (!c.credential.encryptUin) return;
    await qqLogin.logout(c, c.credential);
  },

  async getLoginProfile(): Promise<SourceLoginProfile> {
    try {
      const c = client();
      if (!c.credential.encryptUin) return { logged_in: false };
      const resp = (await qqUser.getHomepage(c, c.credential.encryptUin)) as {
        head?: { nick?: string; picurl?: string };
      };
      const nick = stripEm(String(resp?.head?.nick ?? "")).trim();
      return nick
        ? { logged_in: true, nickname: nick, avatar: normalizeQQCover(resp?.head?.picurl ?? "") }
        : { logged_in: true };
    } catch {
      return { logged_in: false };
    }
  },

  async sendPhoneCode(phone: string, countryCode?: number): Promise<void> {
    const c = client();
    const n = Number(phone.replace(/\D/g, ""));
    const result = await qqLogin.sendAuthcode(c, n, countryCode ?? 86);
    if (result.event === "CAPTCHA") {
      throw new UpstreamError("触发安全验证，请改用扫码登录");
    }
    if (result.event !== "SEND") {
      throw new UpstreamError("验证码发送过于频繁，请稍后再试");
    }
  },

  async loginByPhoneCode(phone: string, code: string): Promise<string> {
    const c = client();
    const n = Number(phone.replace(/\D/g, ""));
    const cred = await qqLogin.phoneAuthorize(c, n, code);
    /* 保存凭证（会话抑制由路由层控制：匿名时仅浏览器） */
    saveCredential(cred);
    return credentialToCookie(cred);
  },

  // ---------------- 歌单管理（PlaylistBaseWrite/DetailWrite：创建/删除/增删曲目，需登录） ----------------

  async createPlaylist(name: string): Promise<string> {
    const c = client();
    if (!c.credential.encryptUin) throw new Error("创建歌单需要登录QQ音乐账号");
    const resp = (await qqSonglist.create(c, name)) as { code?: number; dirid?: number | string };
    const dirid = Number(resp?.dirid ?? 0);
    if (!dirid) throw new Error(`创建失败 (code: ${resp?.code ?? 0})`);
    return String(dirid);
  },

  async deletePlaylist(playlistId: string): Promise<void> {
    const c = client();
    if (!c.credential.encryptUin) throw new Error("删除歌单需要登录QQ音乐账号");
    const resp = (await qqSonglist.del(c, atoi(playlistId))) as { dirid?: number };
    if (Number(resp?.dirid ?? 0) === 0) throw new Error("删除失败（歌单不存在或权限不足）");
  },

  async addSongsToPlaylist(playlistId: string, songs: Song[]): Promise<void> {
    const c = client();
    if (!c.credential.encryptUin) throw new Error("需要登录QQ音乐账号");
    const pairs: [number, number][] = songs
      .map((s) => atoi(s.extra?.song_id ?? s.id))
      .filter((id) => id > 0)
      .map((id) => [id, 0]);
    if (!pairs.length) throw new Error("缺少有效的数字 song_id");
    const ok = await qqSonglist.addSongs(c, atoi(playlistId), pairs);
    if (ok === false) throw new Error("歌曲已在歌单中");
  },

  async removeSongsFromPlaylist(playlistId: string, songs: Song[]): Promise<void> {
    const c = client();
    if (!c.credential.encryptUin) throw new Error("需要登录QQ音乐账号");
    const pairs: [number, number][] = songs
      .map((s) => atoi(s.extra?.song_id ?? s.id))
      .filter((id) => id > 0)
      .map((id) => [id, 0]);
    if (!pairs.length) throw new Error("缺少有效的数字 song_id");
    await qqSonglist.delSongs(c, atoi(playlistId), pairs);
  },

  // ---------------- 歌手库（SingerList：地区/性别/字母索引分页） ----------------

  /** 统一筛选 → QQ 枚举（AreaType/SexType/IndexType 对齐 modules/singer.ts） */
  async getArtistLibrary(opts): Promise<{ artists: Artist[]; has_more: boolean }> {
    const c = client();
    const l = Math.min(Math.max(opts.limit, 1), 100);
    const areaMap: Record<string, number> = {
      全部: qqSinger.AreaType.ALL,
      华语: qqSinger.AreaType.CHINA,
      港台: qqSinger.AreaType.TAIWAN,
      欧美: qqSinger.AreaType.AMERICA,
      日本: qqSinger.AreaType.JAPAN,
      韩国: qqSinger.AreaType.KOREA,
    };
    const sexMap: Record<string, number> = {
      全部: qqSinger.SexType.ALL,
      男: qqSinger.SexType.MALE,
      女: qqSinger.SexType.FEMALE,
      组合: qqSinger.SexType.GROUP,
    };
    const area = areaMap[opts.area] ?? qqSinger.AreaType.ALL;
    const sex = sexMap[opts.sex] ?? qqSinger.SexType.ALL;
    const index = /^[a-zA-Z]$/.test(opts.initial)
      ? (qqSinger.IndexType as Record<string, number>)[opts.initial.toUpperCase()]
      : opts.initial === "#"
        ? qqSinger.IndexType.HASH
        : qqSinger.IndexType.ALL;

    const resp = (await qqSinger.getSingerListIndex(c, {
      area,
      sex,
      index,
      page: opts.page,
      num: l,
    })) as {
      singers?: { singer_id?: number | string; singer_mid?: string; singer_name?: string; singer_pic?: string; country?: string }[];
      singerlist?: { singer_id?: number | string; singer_mid?: string; singer_name?: string; singer_pic?: string }[];
      total?: number;
      more?: boolean | number;
      hasNext?: number | boolean;
    };
    const raw = resp?.singers ?? resp?.singerlist ?? [];
    const artists: Artist[] = [];
    for (const s of raw) {
      const mid = String(s?.singer_mid ?? "").trim();
      const name = stripEm(String(s?.singer_name ?? "")).trim();
      if (!mid || !name) continue;
      artists.push({
        source: "qq",
        id: mid,
        name,
        avatar: normalizeQQCover(s?.singer_pic ?? "") || singerCoverUrl({ mid }, 300),
        link: `https://y.qq.com/n/ryqq/singer/${mid}`,
        extra: { singer_id: String(s?.singer_id ?? 0) },
      });
    }
    const hasMore =
      resp?.more === true || resp?.more === 1 || resp?.hasNext === true || resp?.hasNext === 1 || artists.length >= l;
    return { artists, has_more: hasMore };
  },

  // ---------------- 相似推荐（TrackRelationServer：相似歌曲 + 相关歌单） ----------------

  async getSimilarSongs(song): Promise<Song[]> {
    const c = client();
    const songId = atoi(song.extra?.song_id ?? song.id);
    if (!songId) throw new Error("qq similar requires numeric song_id");
    /* GetSimilarSongs：vecSongNew[].songs[].track（对齐 .ref models/song.py jsonpath） */
    const resp = (await qqSong.getSimilarSong(c, songId)) as {
      vecSongNew?: { songs?: { track?: QQTrack }[] }[];
    };
    const tracks = (resp?.vecSongNew ?? []).flatMap((g) => (g?.songs ?? []).map((e) => e?.track));
    return tracks.filter((t): t is QQTrack => !!t).map(trackToSong).slice(0, 12);
  },

  async getRelatedPlaylists(song): Promise<Playlist[]> {
    const c = client();
    const songId = atoi(song.extra?.song_id ?? song.id);
    if (!songId) throw new Error("qq related songlist requires numeric song_id");
    const resp = (await qqSong.getRelatedSonglist(c, songId, null)) as {
      songlist?: ({ basic?: { dissid?: string | number; dissname?: string; picurl?: string; logo?: string; song_cnt?: number; listen_num?: number } })[];
    };
    const playlists: Playlist[] = [];
    for (const item of resp?.songlist ?? []) {
      const b = item?.basic ?? {};
      const id = String(b.dissid ?? "").trim();
      const name = stripEm(String(b.dissname ?? "")).trim();
      if (!id || !name) continue;
      playlists.push({
        source: "qq",
        id,
        name,
        cover: normalizeQQCover(b.picurl ?? b.logo ?? ""),
        track_count: b.song_cnt ?? 0,
        play_count: b.listen_num ?? 0,
        creator: "",
        description: "",
        link: `https://y.qq.com/n/ryqq/playlist/${id}`,
      });
    }
    return playlists.slice(0, 9);
  },

  // ---------------- 首页发现（RecommendNewsong 新歌速递；banner/每日推荐网易专属） ----------------

  async getNewSongs(): Promise<Song[]> {
    const c = client();
    const resp = (await qqRecommend.getRecommendNewsong(c, 5)) as {
      songlist?: QQTrack[];
    };
    return (resp?.songlist ?? []).map(trackToSong);
  },

  // ---------------- 私人电台（RadarRecommend 雷达推荐作 FM 曲库） ----------------

  async getFmSongs(): Promise<Song[]> {
    const c = client();
    const resp = (await qqRecommend.getRadarRecommend(c, 1)) as {
      VecSongs?: { Track?: QQTrack }[];
      HasMore?: boolean;
    };
    const songs = (resp?.VecSongs ?? [])
      .map((e) => e?.Track)
      .filter((t): t is QQTrack => !!t)
      .map(trackToSong);
    if (!songs.length) throw new Error("qq radar recommend empty");
    return songs;
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
