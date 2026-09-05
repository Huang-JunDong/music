/**
 * QQ 音乐 API 路由表 — 对齐 .ref/QQMusicApi web/src/routes（12 模块 60 端点）+
 * 核心库未暴露能力的补齐（logout / new_album / fav_album / like_song / mv_list / private_message×15 / helper×2）。
 * 路径与参数命名 1:1 对齐参考仓库（snake_case，{path_param} 占位）。
 */
import type { QQClient } from "./client";
import type { Credential } from "./types";
import { saveCredential, clearCredential, serializeCredentialMasked } from "./credential";
import * as song from "./modules/song";
import * as album from "./modules/album";
import * as songlist from "./modules/songlist";
import * as search from "./modules/search";
import * as singer from "./modules/singer";
import * as lyric from "./modules/lyric";
import * as mv from "./modules/mv";
import * as top from "./modules/top";
import * as recommend from "./modules/recommend";
import * as comment from "./modules/comment";
import * as user from "./modules/user";
import * as pm from "./modules/private_message";
import * as helper from "./modules/helper";
import * as login from "./modules/login";

export type QqAuthPolicy = "none" | "optional" | "required";

export interface QqRouteContext {
  client: QQClient;
  /** 路径参数 + 查询参数 + JSON body 合并视图 */
  params: Record<string, any>;
  query: URLSearchParams;
  body: any;
}

export interface QqRouteDef {
  id: string;
  module: string;
  summary: string;
  path: string;
  method: "GET" | "POST" | "DELETE";
  auth: QqAuthPolicy;
  /** GET 响应缓存秒数（对齐参考仓库 PUBLIC_60/300/600） */
  cacheSec?: number;
  handler: (ctx: QqRouteContext) => Promise<unknown>;
}

/* ---------------- 参数解析辅助 ---------------- */

const toInt = (v: unknown, dflt: number): number => {
  if (v === undefined || v === null || v === "") return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : dflt;
};
const toStr = (v: unknown, dflt = ""): string =>
  v === undefined || v === null ? dflt : String(v);
const toBool = (v: unknown, dflt = false): boolean => {
  if (v === undefined || v === null || v === "") return dflt;
  if (typeof v === "boolean") return v;
  return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
};
/** "1,2,3" | [1,2] | "1" → number[] */
const toIntList = (v: unknown): number[] => {
  if (v === undefined || v === null || v === "") return [];
  if (Array.isArray(v)) return v.map((x) => toInt(x, 0));
  return String(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => toInt(s, 0));
};
const toStrList = (v: unknown): string[] => {
  if (v === undefined || v === null || v === "") return [];
  if (Array.isArray(v)) return v.map(String);
  return String(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
};
const parseJsonParam = <T = any>(v: unknown): T | null => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "object") return v as T;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return null;
  }
};

/* ---------------- 路由表 ---------------- */

function route(def: QqRouteDef): QqRouteDef {
  return def;
}

export const QQ_ROUTES: QqRouteDef[] = [
  /* ================ login 登录 ================ */
  route({
    id: "login.check_expired", module: "login", summary: "检查登录凭证是否已过期",
    path: "/login/check_expired", method: "GET", auth: "optional",
    handler: (c) => login.checkExpired(c.client, c.client.credential),
  }),
  route({
    id: "login.refresh_credential", module: "login", summary: "刷新登录凭证",
    path: "/login/refresh_credential", method: "GET", auth: "required",
    handler: async (c) => {
      const cred = await login.refreshCredential(c.client, c.client.credential);
      saveCredential(cred);
      return serializeCredentialMasked(cred);
    },
  }),
  route({
    id: "login.qrcode", module: "login", summary: "获取登录二维码 (qq/wx/mobile)",
    path: "/login/qrcode/{login_type}", method: "GET", auth: "none",
    handler: async (c) => {
      const loginType = toStr(c.params.login_type).toLowerCase();
      if (!["qq", "wx", "mobile"].includes(loginType)) {
        throw new Error("login_type 仅支持 qq / wx / mobile");
      }
      const qr = await login.getQrcode(c.client, loginType as login.QRLoginType);
      const data = qr.data.toString("base64");
      return {
        qr_type: qr.qrType,
        identifier: qr.identifier,
        mimetype: qr.mimetype,
        data,
        img: `data:${qr.mimetype};base64,${data}`,
      };
    },
  }),
  route({
    id: "login.qrcode_status", module: "login", summary: "检查二维码登录状态",
    path: "/login/qrcode/{login_type}/status", method: "GET", auth: "none",
    handler: async (c) => {
      const loginType = toStr(c.params.login_type).toLowerCase();
      const identifier = toStr(c.params.identifier);
      if (!["qq", "wx"].includes(loginType)) {
        throw new Error("Web 层状态轮询仅支持 qq / wx（mobile 请使用 POST /login/qrcode/mobile/poll）");
      }
      const qr: login.QR = {
        data: Buffer.alloc(0),
        qrType: loginType as login.QRLoginType,
        mimetype: "image/png",
        identifier,
      };
      const result = await login.checkQrcode(c.client, qr);
      if (result.done && result.credential) saveCredential(result.credential);
      return {
        event: login.QR_EVENT_CODES[result.event],
        done: result.done,
        credential: result.credential ? serializeCredentialMasked(result.credential) : null,
        identifier,
        login_type: loginType,
      };
    },
  }),
  route({
    id: "login.qrcode_mobile_poll", module: "login", summary: "手机客户端扫码 MQTT 单次轮询（补充）",
    path: "/login/qrcode/mobile/poll", method: "POST", auth: "none",
    handler: async (c) => {
      const identifier = toStr(c.params.identifier);
      const deadline = c.params.deadline ? Number(c.params.deadline) : Date.now() + 180_000;
      const qr: login.QR = { data: Buffer.alloc(0), qrType: "mobile", mimetype: "image/png", identifier };
      for await (const result of login.checkingMobileQrcode(c.client, qr, deadline)) {
        if (result.done && result.credential) saveCredential(result.credential);
        return {
          event: login.QR_EVENT_CODES[result.event],
          done: result.done,
          credential: result.credential ? serializeCredentialMasked(result.credential) : null,
          identifier,
          login_type: "mobile",
        };
      }
      throw new Error("未收到任何登录事件");
    },
  }),
  route({
    id: "login.phone_authcode", module: "login", summary: "发送手机验证码",
    path: "/login/phone/authcode", method: "GET", auth: "none",
    handler: async (c) => {
      const phone = c.params.encrypted_phone
        ? toStr(c.params.encrypted_phone)
        : toInt(c.params.phone, 0);
      if (!phone) throw new Error("phone 与 encrypted_phone 必须且只能提供一个");
      const countryCode = toInt(c.params.country_code, 86);
      const result = await login.sendAuthcode(c.client, phone, countryCode);
      return { event: login.PHONE_EVENT_CODES[result.event], info: result.info ?? null };
    },
  }),
  route({
    id: "login.phone_authorize", module: "login", summary: "使用手机验证码登录",
    path: "/login/phone/authorize", method: "GET", auth: "none",
    handler: async (c) => {
      const authCode = toStr(c.params.auth_code);
      if (!authCode) throw new Error("缺少 auth_code");
      const phone = c.params.encrypted_phone
        ? toStr(c.params.encrypted_phone)
        : toInt(c.params.phone, 0);
      if (!phone) throw new Error("phone 与 encrypted_phone 必须且只能提供一个");
      const cred = await login.phoneAuthorize(c.client, phone, authCode);
      saveCredential(cred);
      return serializeCredentialMasked(cred);
    },
  }),
  route({
    id: "login.logout", module: "login", summary: "登出当前账号（补充：Web 层未暴露）",
    path: "/login/logout", method: "POST", auth: "required",
    handler: async (c) => {
      await login.logout(c.client);
      clearCredential();
      return true;
    },
  }),

  /* ================ song 歌曲 ================ */
  route({
    id: "song.get_cdn_dispatch", module: "song", summary: "获取音频链接 CDN 信息",
    path: "/song/get_cdn_dispatch", method: "GET", auth: "none",
    handler: (c) => song.getCdnDispatch(c.client),
  }),
  route({
    id: "song.get_detail", module: "song", summary: "获取歌曲详细信息 (ID 或 MID)",
    path: "/song/{value}/detail", method: "GET", auth: "none", cacheSec: 300,
    handler: (c) => song.getDetail(c.client, c.params.value),
  }),
  route({
    id: "song.get_fav_num", module: "song", summary: "批量获取歌曲收藏数量",
    path: "/song/get_fav_num", method: "GET", auth: "none", cacheSec: 60,
    handler: (c) => {
      const ids = toIntList(c.params.song_ids);
      if (!ids.length) throw new Error("缺少 song_ids");
      return song.getFavNum(c.client, ids);
    },
  }),
  route({
    id: "song.get_fav_num_by_id", module: "song", summary: "获取单首歌曲收藏数量",
    path: "/song/{id}/fav_num", method: "GET", auth: "none", cacheSec: 60,
    handler: (c) => song.getFavNum(c.client, [toInt(c.params.id, 0)]),
  }),
  route({
    id: "song.get_labels", module: "song", summary: "获取歌曲标签",
    path: "/song/{songid}/labels", method: "GET", auth: "none", cacheSec: 300,
    handler: (c) => song.getLabels(c.client, toInt(c.params.songid, 0)),
  }),
  route({
    id: "song.get_other_version", module: "song", summary: "获取歌曲其他版本",
    path: "/song/{value}/other_versions", method: "GET", auth: "none", cacheSec: 600,
    handler: (c) => song.getOtherVersion(c.client, c.params.value),
  }),
  route({
    id: "song.get_producer", module: "song", summary: "获取歌曲制作人信息",
    path: "/song/{value}/producer", method: "GET", auth: "none", cacheSec: 300,
    handler: (c) => song.getProducer(c.client, c.params.value),
  }),
  route({
    id: "song.get_related_mv", module: "song", summary: "获取歌曲相关 MV",
    path: "/song/{songid}/related_mv", method: "GET", auth: "none", cacheSec: 600,
    handler: (c) =>
      song.getRelatedMv(c.client, toInt(c.params.songid, 0), c.params.last_mvid ? toStr(c.params.last_mvid) : null),
  }),
  route({
    id: "song.get_related_songlist", module: "song", summary: "获取歌曲相关歌单",
    path: "/song/{songid}/related_songlists", method: "GET", auth: "none", cacheSec: 600,
    handler: (c) =>
      song.getRelatedSonglist(c.client, toInt(c.params.songid, 0), toIntList(c.params.last)),
  }),
  route({
    id: "song.has_sheet", module: "song", summary: "检查歌曲是否有曲谱",
    path: "/song/{mid}/has_sheet", method: "GET", auth: "none", cacheSec: 300,
    handler: (c) => song.hasSheet(c.client, toStr(c.params.mid)),
  }),
  route({
    id: "song.get_sheet", module: "song", summary: "获取歌曲相关曲谱 (ttype: 0/1/2)",
    path: "/song/{mid}/sheet", method: "GET", auth: "none", cacheSec: 300,
    handler: (c) => song.getSheet(c.client, toStr(c.params.mid), toInt(c.params.ttype, 0)),
  }),
  route({
    id: "song.get_similar_song", module: "song", summary: "获取相似歌曲",
    path: "/song/{songid}/similar", method: "GET", auth: "none", cacheSec: 600,
    handler: (c) => song.getSimilarSong(c.client, toInt(c.params.songid, 0)),
  }),
  route({
    id: "song.get_song_urls", module: "song", summary: "批量获取歌曲文件链接",
    path: "/song/get_song_urls", method: "POST", auth: "optional",
    handler: (c) => {
      const fileInfoRaw = c.params.file_info ?? c.body?.file_info;
      if (!Array.isArray(fileInfoRaw) || !fileInfoRaw.length) throw new Error("缺少 file_info");
      const fileInfo: song.SongFileInfo[] = fileInfoRaw.map((item: any) => ({
        mid: toStr(item.mid),
        fileType: song.findSongFileType(item.file_type),
        songType: item.song_type !== undefined && item.song_type !== null ? toInt(item.song_type, 0) : null,
        mediaMid: item.media_mid ?? null,
      }));
      const defaultType = song.findSongFileType(c.params.file_type ?? c.body?.file_type) ?? song.SongFileType.MP3_128;
      return song.getSongUrls(c.client, fileInfo, defaultType);
    },
  }),
  route({
    id: "song.get_song_url", module: "song", summary: "获取单首歌曲文件链接",
    path: "/song/{mid}/url", method: "GET", auth: "optional",
    handler: (c) => {
      const mid = toStr(c.params.mid);
      const fileInfo: song.SongFileInfo[] = [
        {
          mid,
          fileType: song.findSongFileType(c.params.file_type) ?? song.SongFileType.MP3_128,
          songType: c.params.song_type !== undefined && c.params.song_type !== "" ? toInt(c.params.song_type, 0) : null,
          mediaMid: c.params.media_mid ? toStr(c.params.media_mid) : null,
        },
      ];
      return song.getSongUrls(c.client, fileInfo, fileInfo[0].fileType ?? undefined);
    },
  }),
  route({
    id: "song.query_song_get", module: "song", summary: "获取单首歌曲信息 (GET)",
    path: "/song/query_song", method: "GET", auth: "none",
    handler: (c) => {
      const value = toStr(c.params.value);
      if (!value) throw new Error("缺少 value");
      const isId = /^\d+$/.test(value);
      return song.querySong(
        c.client,
        [{ id: isId ? toInt(value, 0) : null, mid: isId ? null : value, songType: c.params.song_type ? toInt(c.params.song_type, 0) : null }],
      );
    },
  }),
  route({
    id: "song.query_song_post", module: "song", summary: "批量查询歌曲 (POST)",
    path: "/song/query_song", method: "POST", auth: "none",
    handler: (c) => {
      const list = c.params.query_info ?? c.body?.query_info;
      if (!Array.isArray(list) || !list.length) throw new Error("缺少 query_info");
      return song.querySong(
        c.client,
        list.map((item: any) => ({
          id: item.id ?? null,
          mid: item.mid ?? null,
          songType: item.song_type ?? null,
        })),
      );
    },
  }),

  /* ================ album 专辑 ================ */
  route({
    id: "album.get_detail", module: "album", summary: "获取专辑详细信息",
    path: "/album/{value}/detail", method: "GET", auth: "none", cacheSec: 300,
    handler: (c) => album.getDetail(c.client, c.params.value),
  }),
  route({
    id: "album.get_song", module: "album", summary: "获取专辑歌曲列表",
    path: "/album/{value}/songs", method: "GET", auth: "none", cacheSec: 300,
    handler: (c) => album.getSong(c.client, c.params.value, toInt(c.params.num, 10), toInt(c.params.page, 1)),
  }),
  route({
    id: "album.get_new_album", module: "album", summary: "获取新碟上架列表（补充）",
    path: "/album/get_new_album", method: "GET", auth: "none", cacheSec: 300,
    handler: (c) =>
      album.getNewAlbum(c.client, toInt(c.params.area, 1), toInt(c.params.num, 20), toInt(c.params.page, 1)),
  }),
  route({
    id: "album.fav_album", module: "album", summary: "收藏专辑（补充）",
    path: "/album/fav_album", method: "POST", auth: "required",
    handler: (c) => album.favAlbum(c.client, toIntList(c.params.album_id)),
  }),
  route({
    id: "album.del_fav_album", module: "album", summary: "取消收藏专辑（补充）",
    path: "/album/fav_album", method: "DELETE", auth: "required",
    handler: (c) => album.delFavAlbum(c.client, toIntList(c.params.album_id)),
  }),

  /* ================ songlist 歌单 ================ */
  route({
    id: "songlist.get_detail", module: "songlist", summary: "获取歌单详细信息和歌曲列表",
    path: "/songlist/{songlist_id}/detail", method: "GET", auth: "none",
    handler: (c) =>
      songlist.getDetail(c.client, toInt(c.params.songlist_id, 0), {
        dirid: toInt(c.params.dirid, 0),
        num: toInt(c.params.num, 10),
        page: toInt(c.params.page, 1),
        onlysong: toBool(c.params.onlysong, false),
        tag: toBool(c.params.tag, true),
        userinfo: toBool(c.params.userinfo, true),
      }),
  }),
  route({
    id: "songlist.create", module: "songlist", summary: "创建歌单",
    path: "/songlist/create", method: "POST", auth: "required",
    handler: (c) => songlist.create(c.client, toStr(c.params.dirname)),
  }),
  route({
    id: "songlist.delete", module: "songlist", summary: "删除歌单",
    path: "/songlist/delete", method: "DELETE", auth: "required",
    handler: (c) => songlist.del(c.client, toInt(c.params.dirid, 0)),
  }),
  route({
    id: "songlist.add_songs", module: "songlist", summary: "添加歌曲到歌单",
    path: "/songlist/add_songs", method: "POST", auth: "required",
    handler: (c) =>
      songlist.addSongs(c.client, toInt(c.params.dirid, 0), pairSongs(c.params), { tid: toInt(c.params.tid, 0) }),
  }),
  route({
    id: "songlist.del_songs", module: "songlist", summary: "删除歌单中的歌曲",
    path: "/songlist/del_songs", method: "POST", auth: "required",
    handler: (c) =>
      songlist.delSongs(c.client, toInt(c.params.dirid, 0), pairSongs(c.params), { tid: toInt(c.params.tid, 0) }),
  }),
  route({
    id: "songlist.like_song", module: "songlist", summary: "红心歌曲到我喜欢（补充）",
    path: "/songlist/like_song", method: "POST", auth: "required",
    handler: (c) => songlist.likeSong(c.client, pairSongs(c.params)),
  }),
  route({
    id: "songlist.unlike_song", module: "songlist", summary: "取消红心歌曲（补充）",
    path: "/songlist/unlike_song", method: "POST", auth: "required",
    handler: (c) => songlist.unlikeSong(c.client, pairSongs(c.params)),
  }),

  /* ================ search 搜索 ================ */
  route({
    id: "search.complete", module: "search", summary: "搜索词补全建议",
    path: "/search/complete", method: "GET", auth: "none", cacheSec: 60,
    handler: (c) => search.complete(c.client, toStr(c.params.keyword)),
  }),
  route({
    id: "search.general_search", module: "search", summary: "综合搜索",
    path: "/search/general_search", method: "GET", auth: "none", cacheSec: 60,
    handler: (c) =>
      search.generalSearch(c.client, toStr(c.params.keyword), {
        page: toInt(c.params.page, 1),
        num: toInt(c.params.num, 15),
        searchid: c.params.searchid ? toStr(c.params.searchid) : null,
        pageStart: parseJsonParam(c.params.page_start),
        highlight: toBool(c.params.highlight, true),
      }),
  }),
  route({
    id: "search.get_hotkey", module: "search", summary: "获取热搜词列表",
    path: "/search/get_hotkey", method: "GET", auth: "none", cacheSec: 600,
    handler: (c) => search.getHotkey(c.client),
  }),
  route({
    id: "search.quick_search", module: "search", summary: "快速搜索",
    path: "/search/quick_search", method: "GET", auth: "none", cacheSec: 60,
    handler: (c) => search.quickSearch(c.client, toStr(c.params.keyword)),
  }),
  route({
    id: "search.search_by_type", module: "search", summary: "类型搜索",
    path: "/search/search_by_type", method: "GET", auth: "none", cacheSec: 60,
    handler: (c) =>
      search.searchByType(c.client, toStr(c.params.keyword), {
        searchType: toInt(c.params.search_type, search.SearchType.SONG),
        num: toInt(c.params.num, 10),
        page: toInt(c.params.page, 1),
        selectors: parseJsonParam<search.SearchSelector[]>(c.params.selectors),
        searchid: c.params.searchid ? toStr(c.params.searchid) : null,
        highlight: toBool(c.params.highlight, true),
      }),
  }),

  /* ================ singer 歌手 ================ */
  route({
    id: "singer.get_album_list", module: "singer", summary: "获取歌手专辑列表",
    path: "/singer/{mid}/albums", method: "GET", auth: "none", cacheSec: 300,
    handler: (c) => singer.getAlbumList(c.client, toStr(c.params.mid), toInt(c.params.num, 10), toInt(c.params.page, 1)),
  }),
  route({
    id: "singer.get_desc", module: "singer", summary: "批量获取歌手描述信息",
    path: "/singer/get_desc", method: "GET", auth: "none", cacheSec: 300,
    handler: (c) =>
      singer.getDesc(c.client, toStrList(c.params.mids), {
        exSinger: toBool(c.params.ex_singer, true),
        wikiSinger: toBool(c.params.wiki_singer, true),
        groupSinger: toBool(c.params.group_singer, true),
        pic: toBool(c.params.pic, true),
        photos: toBool(c.params.photos, true),
      }),
  }),
  route({
    id: "singer.get_desc_by_mid", module: "singer", summary: "获取歌手描述信息",
    path: "/singer/{mid}/desc", method: "GET", auth: "none", cacheSec: 300,
    handler: (c) =>
      singer.getDesc(c.client, [toStr(c.params.mid)], {
        exSinger: toBool(c.params.ex_singer, true),
        wikiSinger: toBool(c.params.wiki_singer, true),
        groupSinger: toBool(c.params.group_singer, true),
        pic: toBool(c.params.pic, true),
        photos: toBool(c.params.photos, true),
      }),
  }),
  route({
    id: "singer.get_info", module: "singer", summary: "获取歌手主页基本信息",
    path: "/singer/{mid}/info", method: "GET", auth: "none", cacheSec: 300,
    handler: (c) => singer.getInfo(c.client, toStr(c.params.mid)),
  }),
  route({
    id: "singer.get_mv_list", module: "singer", summary: "获取歌手 MV 列表",
    path: "/singer/{mid}/mvs", method: "GET", auth: "none", cacheSec: 600,
    handler: (c) => singer.getMvList(c.client, toStr(c.params.mid), toInt(c.params.num, 10), toInt(c.params.page, 1)),
  }),
  route({
    id: "singer.get_similar", module: "singer", summary: "获取相似歌手列表",
    path: "/singer/{mid}/similar", method: "GET", auth: "none", cacheSec: 600,
    handler: (c) => singer.getSimilar(c.client, toStr(c.params.mid), toInt(c.params.number, 10)),
  }),
  route({
    id: "singer.get_singer_list", module: "singer", summary: "获取歌手列表",
    path: "/singer/get_singer_list", method: "GET", auth: "none", cacheSec: 300,
    handler: (c) =>
      singer.getSingerList(c.client, {
        area: toInt(c.params.area, singer.AreaType.ALL),
        sex: toInt(c.params.sex, singer.SexType.ALL),
        genre: toInt(c.params.genre, singer.GenreType.ALL),
      }),
  }),
  route({
    id: "singer.get_singer_list_index", module: "singer", summary: "获取按索引分页的歌手列表",
    path: "/singer/get_singer_list_index", method: "GET", auth: "none", cacheSec: 300,
    handler: (c) =>
      singer.getSingerListIndex(c.client, {
        area: toInt(c.params.area, singer.AreaType.ALL),
        sex: toInt(c.params.sex, singer.SexType.ALL),
        genre: toInt(c.params.genre, singer.GenreType.ALL),
        index: toInt(c.params.index, singer.IndexType.ALL),
        num: toInt(c.params.num, 80),
        page: toInt(c.params.page, 1),
      }),
  }),
  route({
    id: "singer.get_songs_list", module: "singer", summary: "获取歌手的歌曲列表",
    path: "/singer/{mid}/songs", method: "GET", auth: "none", cacheSec: 300,
    handler: (c) => singer.getSongsList(c.client, toStr(c.params.mid), toInt(c.params.num, 10), toInt(c.params.page, 1)),
  }),
  route({
    id: "singer.get_tab_detail", module: "singer", summary: "获取歌手主页 Tab 详情",
    path: "/singer/{mid}/tabs/{tab_type}", method: "GET", auth: "none", cacheSec: 600,
    handler: (c) =>
      singer.getTabDetail(c.client, toStr(c.params.mid), toStr(c.params.tab_type), {
        page: toInt(c.params.page, 1),
        num: toInt(c.params.num, 10),
      }),
  }),

  /* ================ lyric 歌词 ================ */
  route({
    id: "lyric.get_lyric", module: "lyric", summary: "获取歌词原始数据 (qrc/trans/roma/助唱)",
    path: "/song/{value}/lyric", method: "GET", auth: "none", cacheSec: 300,
    handler: (c) =>
      lyric.getLyric(c.client, c.params.value, {
        qrc: toBool(c.params.qrc, false),
        trans: toBool(c.params.trans, false),
        roma: toBool(c.params.roma, false),
        singingAnnotations: toBool(c.params.singing_annotations, false),
        songType: toInt(c.params.song_type, 1),
      }),
  }),
  route({
    id: "lyric.get_multi_style_trans_lyric", module: "lyric", summary: "获取多风格翻译歌词",
    path: "/song/{songid}/lyric/multi_style_trans", method: "GET", auth: "none", cacheSec: 300,
    handler: (c) => lyric.getMultiStyleTransLyric(c.client, toInt(c.params.songid, 0)),
  }),
  route({
    id: "lyric.get_singing_annotations_info", module: "lyric", summary: "获取助唱标注歌词信息",
    path: "/song/{songid}/lyric/annotations_info", method: "GET", auth: "none", cacheSec: 300,
    handler: (c) => lyric.getSingingAnnotationsInfo(c.client, toInt(c.params.songid, 0)),
  }),
  route({
    id: "lyric.is_ai_dict_exists", module: "lyric", summary: "检查是否存在 AI 歌词词典",
    path: "/song/{songid}/lyric/ai_dict/exists", method: "GET", auth: "none", cacheSec: 300,
    handler: (c) => lyric.isAIDictExists(c.client, toInt(c.params.songid, 0)),
  }),
  route({
    id: "lyric.get_ai_dict", module: "lyric", summary: "获取 AI 歌词词典",
    path: "/song/{songid}/lyric/ai_dict", method: "GET", auth: "none", cacheSec: 300,
    handler: (c) => lyric.getAIDict(c.client, toInt(c.params.songid, 0)),
  }),

  /* ================ mv MV ================ */
  route({
    id: "mv.get_detail", module: "mv", summary: "获取 MV 详细信息（批量 VID）",
    path: "/mv/get_detail", method: "GET", auth: "none", cacheSec: 300,
    handler: (c) => mv.getDetail(c.client, toStrList(c.params.vids)),
  }),
  route({
    id: "mv.get_mv_urls", module: "mv", summary: "获取 MV 播放链接（批量 VID）",
    path: "/mv/get_mv_urls", method: "GET", auth: "none",
    handler: (c) => mv.getMvUrls(c.client, toStrList(c.params.vids)),
  }),
  route({
    id: "mv.get_mv_url", module: "mv", summary: "获取单个 MV 播放链接",
    path: "/mv/{vid}/url", method: "GET", auth: "none",
    handler: (c) => mv.getMvUrls(c.client, [toStr(c.params.vid)]),
  }),
  route({
    id: "mv.get_mv_list", module: "mv", summary: "获取 MV 分类列表（补充）",
    path: "/mv/get_mv_list", method: "GET", auth: "none", cacheSec: 300,
    handler: (c) =>
      mv.getMvList(c.client, {
        area: toInt(c.params.area, 15),
        version: toInt(c.params.version, 7),
        order: toInt(c.params.order, 0),
        num: toInt(c.params.num, 10),
        page: toInt(c.params.page, 1),
      }),
  }),

  /* ================ top 排行榜 ================ */
  route({
    id: "top.get_category", module: "top", summary: "获取所有排行榜分类",
    path: "/top/get_category", method: "GET", auth: "none", cacheSec: 300,
    handler: (c) => top.getCategory(c.client),
  }),
  route({
    id: "top.get_detail", module: "top", summary: "获取排行榜详情及歌曲列表",
    path: "/top/{top_id}/detail", method: "GET", auth: "none", cacheSec: 60,
    handler: (c) =>
      top.getDetail(c.client, toInt(c.params.top_id, 0), {
        num: toInt(c.params.num, 10),
        page: toInt(c.params.page, 1),
        tag: toBool(c.params.tag, true),
      }),
  }),

  /* ================ recommend 推荐 ================ */
  route({
    id: "recommend.get_guess_recommend", module: "recommend", summary: "获取猜你喜欢推荐",
    path: "/recommend/get_guess_recommend", method: "GET", auth: "optional",
    handler: (c) => recommend.getGuessRecommend(c.client),
  }),
  route({
    id: "recommend.get_home_feed", module: "recommend", summary: "获取首页推荐 Feed",
    path: "/recommend/get_home_feed", method: "GET", auth: "none", cacheSec: 60,
    handler: (c) =>
      recommend.getHomeFeed(c.client, {
        page: toInt(c.params.page, 1),
        direction: toInt(c.params.direction, 0),
        sNum: toInt(c.params.s_num, 0),
        vCache: toStrList(c.params.v_cache),
      }),
  }),
  route({
    id: "recommend.get_radar_recommend", module: "recommend", summary: "获取雷达推荐",
    path: "/recommend/get_radar_recommend", method: "GET", auth: "none", cacheSec: 60,
    handler: (c) => recommend.getRadarRecommend(c.client, toInt(c.params.page, 1)),
  }),
  route({
    id: "recommend.get_recommend_newsong", module: "recommend", summary: "获取推荐新歌",
    path: "/recommend/get_recommend_newsong", method: "GET", auth: "none", cacheSec: 60,
    handler: (c) => recommend.getRecommendNewsong(c.client, toInt(c.params.type, 5)),
  }),
  route({
    id: "recommend.get_recommend_songlist", module: "recommend", summary: "获取推荐歌单",
    path: "/recommend/get_recommend_songlist", method: "GET", auth: "none", cacheSec: 60,
    handler: (c) => recommend.getRecommendSonglist(c.client, toInt(c.params.page, 1), toInt(c.params.num, 25)),
  }),

  /* ================ comment 评论 ================ */
  route({
    id: "comment.get_comment_count", module: "comment", summary: "获取评论数量",
    path: "/song/{biz_id}/comments/count", method: "GET", auth: "none", cacheSec: 60,
    handler: (c) =>
      comment.getCommentCount(c.client, toInt(c.params.biz_id, 0), {
        bizType: toInt(c.params.biz_type, comment.CommentBizType.SONG),
        bizSubType: c.params.biz_sub_type !== undefined ? toInt(c.params.biz_sub_type, 0) : null,
      }),
  }),
  route({
    id: "comment.get_hot_comments", module: "comment", summary: "获取热评",
    path: "/song/{biz_id}/comments/hot", method: "GET", auth: "none", cacheSec: 60,
    handler: (c) => commentList(c, comment.getHotComments),
  }),
  route({
    id: "comment.get_moment_comments", module: "comment", summary: "获取时刻评论",
    path: "/song/{biz_id}/comments/moments", method: "GET", auth: "none", cacheSec: 60,
    handler: (c) => comment.getMomentComments(c.client, toInt(c.params.biz_id, 0), commentOpts(c)),
  }),
  route({
    id: "comment.get_new_comments", module: "comment", summary: "获取最新评论",
    path: "/song/{biz_id}/comments/new", method: "GET", auth: "none", cacheSec: 60,
    handler: (c) => commentList(c, comment.getNewComments),
  }),
  route({
    id: "comment.get_recommend_comments", module: "comment", summary: "获取推荐评论",
    path: "/song/{biz_id}/comments/recommended", method: "GET", auth: "none", cacheSec: 60,
    handler: (c) => commentList(c, comment.getRecommendComments),
  }),
  route({
    id: "comment.add_comment", module: "comment", summary: "添加评论（支持回复）",
    path: "/song/{biz_id}/comments", method: "POST", auth: "required",
    handler: (c) =>
      comment.addComment(c.client, toInt(c.params.biz_id, 0), toStr(c.params.content), {
        replyCmtId: c.params.reply_cmt_id ? toStr(c.params.reply_cmt_id) : null,
        bizType: toInt(c.params.biz_type, comment.CommentBizType.SONG),
        bizSubType: c.params.biz_sub_type !== undefined ? toInt(c.params.biz_sub_type, 0) : null,
      }),
  }),
  route({
    id: "comment.delete_comment", module: "comment", summary: "删除评论",
    path: "/comment/{cm_id}", method: "DELETE", auth: "required",
    handler: (c) => comment.deleteComment(c.client, toStr(c.params.cm_id)),
  }),

  /* ================ user 用户 ================ */
  route({
    id: "user.get_created_songlist", module: "user", summary: "获取用户创建的歌单列表",
    path: "/user/{uin}/created_songlists", method: "GET", auth: "optional",
    handler: (c) => user.getCreatedSonglist(c.client, toInt(c.params.uin, 0)),
  }),
  route({
    id: "user.get_fans", module: "user", summary: "获取用户粉丝列表",
    path: "/user/{euin}/fans", method: "GET", auth: "required",
    handler: (c) => user.getFans(c.client, toStr(c.params.euin), pageOpts(c)),
  }),
  route({
    id: "user.get_fav_album", module: "user", summary: "获取用户收藏的专辑列表",
    path: "/user/{euin}/fav/albums", method: "GET", auth: "optional",
    handler: (c) => user.getFavAlbum(c.client, toStr(c.params.euin), pageOpts(c)),
  }),
  route({
    id: "user.get_fav_mv", module: "user", summary: "获取用户收藏的 MV 列表",
    path: "/user/{euin}/fav/mvs", method: "GET", auth: "required",
    handler: (c) => user.getFavMv(c.client, toStr(c.params.euin), pageOpts(c)),
  }),
  route({
    id: "user.get_fav_song", module: "user", summary: "获取用户收藏的歌曲列表",
    path: "/user/{euin}/fav/songs", method: "GET", auth: "optional",
    handler: (c) => user.getFavSong(c.client, toStr(c.params.euin), pageOpts(c)),
  }),
  route({
    id: "user.get_fav_songlist", module: "user", summary: "获取用户收藏的歌单列表",
    path: "/user/{euin}/fav/songlists", method: "GET", auth: "optional",
    handler: (c) => user.getFavSonglist(c.client, toStr(c.params.euin), pageOpts(c)),
  }),
  route({
    id: "user.get_follow_singers", module: "user", summary: "获取用户关注的歌手列表",
    path: "/user/{euin}/follow/singers", method: "GET", auth: "required",
    handler: (c) => user.getFollowSingers(c.client, toStr(c.params.euin), pageOpts(c)),
  }),
  route({
    id: "user.get_follow_user", module: "user", summary: "获取关注的用户列表",
    path: "/user/{euin}/follow/users", method: "GET", auth: "required",
    handler: (c) => user.getFollowUser(c.client, toStr(c.params.euin), pageOpts(c)),
  }),
  route({
    id: "user.get_friend", module: "user", summary: "获取好友列表",
    path: "/user/get_friend", method: "GET", auth: "required",
    handler: (c) => user.getFriend(c.client, pageOpts(c)),
  }),
  route({
    id: "user.get_homepage", module: "user", summary: "获取用户主页头部及统计信息",
    path: "/user/{euin}/homepage", method: "GET", auth: "optional",
    handler: (c) => user.getHomepage(c.client, toStr(c.params.euin)),
  }),
  route({
    id: "user.get_music_gene", module: "user", summary: "获取用户音乐基因数据",
    path: "/user/{euin}/music_gene", method: "GET", auth: "optional",
    handler: (c) => user.getMusicGene(c.client, toStr(c.params.euin)),
  }),
  route({
    id: "user.get_vip_info", module: "user", summary: "获取当前账号 VIP 会员信息",
    path: "/user/get_vip_info", method: "GET", auth: "required",
    handler: (c) => user.getVipInfo(c.client),
  }),
  route({
    id: "user.fav_songlist", module: "user", summary: "收藏歌单",
    path: "/user/fav/songlists", method: "POST", auth: "required",
    handler: (c) => user.favSonglist(c.client, toInt(c.params.songlist_id, 0)),
  }),
  route({
    id: "user.unfav_songlist", module: "user", summary: "取消收藏歌单",
    path: "/user/fav/songlists/{songlist_id}", method: "DELETE", auth: "required",
    handler: (c) => user.unfavSonglist(c.client, toInt(c.params.songlist_id, 0)),
  }),
  route({
    id: "user.get_dislike_list", module: "user", summary: "获取不喜欢列表",
    path: "/user/dislikes", method: "GET", auth: "required",
    handler: (c) =>
      user.getDislikeList(c.client, {
        cmd: toInt(c.params.cmd, 3),
        page: toInt(c.params.page, 1),
        lastid: toInt(c.params.lastid, 0),
      }),
  }),
  route({
    id: "user.add_dislike", module: "user", summary: "添加不喜欢",
    path: "/user/dislikes", method: "POST", auth: "required",
    handler: (c) => {
      if (c.params.id_type === undefined || c.params.id_type === null || c.params.id_type === "") {
        throw new Error("缺少必填参数 id_type");
      }
      return user.addDislike(c.client, toInt(c.params.id_type, 1), toIntList(c.params.values));
    },
  }),
  route({
    id: "user.cancel_dislike", module: "user", summary: "取消不喜欢",
    path: "/user/dislikes", method: "DELETE", auth: "required",
    handler: (c) => {
      if (c.params.id_type === undefined || c.params.id_type === null || c.params.id_type === "") {
        throw new Error("缺少必填参数 id_type");
      }
      return user.cancelDislike(c.client, toInt(c.params.id_type, 1), toIntList(c.params.values));
    },
  }),
  route({
    id: "user.cancel_all_dislike_song", module: "user", summary: "清空所有不喜欢歌曲",
    path: "/user/dislikes/songs", method: "DELETE", auth: "required",
    handler: (c) => user.cancelAllDislikeSong(c.client),
  }),

  /* ================ private_message 私信（补充：Web 层未暴露） ================ */
  route({
    id: "pm.get_sessions", module: "private_message", summary: "获取私信会话列表",
    path: "/private_message/sessions", method: "GET", auth: "required",
    handler: (c) =>
      pm.getSessions(c.client, {
        lastId: toStr(c.params.last_id),
        order: toInt(c.params.order, 1),
        size: toInt(c.params.size, 20),
        lastTime: toInt(c.params.last_time, 0),
        from: toInt(c.params.from, 0),
        fansFlag: c.params.fans_flag !== undefined ? toInt(c.params.fans_flag, 1) : 1,
        encryptFromUin: c.params.encrypt_from_uin ? toStr(c.params.encrypt_from_uin) : null,
      }),
  }),
  route({
    id: "pm.delete_session", module: "private_message", summary: "删除私信会话",
    path: "/private_message/sessions/{session_id}", method: "DELETE", auth: "required",
    handler: (c) =>
      pm.deleteSession(c.client, toStr(c.params.session_id), {
        superMsgFlag: toInt(c.params.super_msg_flag, 0),
      }),
  }),
  route({
    id: "pm.clear_session", module: "private_message", summary: "清空私信会话消息",
    path: "/private_message/sessions/{session_id}/clear", method: "POST", auth: "required",
    handler: (c) =>
      pm.clearSession(c.client, toStr(c.params.session_id), {
        superMsgFlag: toInt(c.params.super_msg_flag, 0),
      }),
  }),
  route({
    id: "pm.get_messages", module: "private_message", summary: "获取私信消息列表",
    path: "/private_message/messages", method: "GET", auth: "required",
    handler: (c) =>
      pm.getMessages(c.client, {
        sessionId: toStr(c.params.session_id),
        userId: toStr(c.params.user_id),
        lastId: toStr(c.params.last_id),
        wnsId: toStr(c.params.wns_id),
        order: toInt(c.params.order, 1),
        size: toInt(c.params.size, 50),
        flag: toInt(c.params.flag, 0),
        locationId: c.params.location_id ? toStr(c.params.location_id) : null,
        updateTime: c.params.update_time !== undefined ? toInt(c.params.update_time, 0) : null,
      }),
  }),
  route({
    id: "pm.send_message", module: "private_message", summary: "发送私信消息",
    path: "/private_message/messages", method: "POST", auth: "required",
    handler: (c) =>
      pm.sendMessage(c.client, toStr(c.params.user_id), toInt(c.params.msg_type, 0), {
        sessionId: toStr(c.params.session_id),
        lastId: toStr(c.params.last_id),
        lastMsgSeq: toInt(c.params.last_msg_seq, 0),
        metaData: parseJsonParam(c.params.meta_data),
        entrance: toInt(c.params.entrance, 0),
        clientKey: toStr(c.params.client_key),
        sourceFlag: c.params.source_flag !== undefined ? toInt(c.params.source_flag, 0) : null,
        msgId: c.params.msg_id ? toStr(c.params.msg_id) : null,
        userInput: c.params.user_input ? toStr(c.params.user_input) : null,
        superMsgFlag: toInt(c.params.super_msg_flag, 0),
        starSend: toBool(c.params.star_send, false),
      }),
  }),
  route({
    id: "pm.delete_message", module: "private_message", summary: "删除单条私信消息",
    path: "/private_message/messages", method: "DELETE", auth: "required",
    handler: (c) =>
      pm.deleteMessage(c.client, toStr(c.params.session_id), toStr(c.params.msg_id), {
        superMsgFlag: toInt(c.params.super_msg_flag, 0),
      }),
  }),
  route({
    id: "pm.mark_all_messages_read", module: "private_message", summary: "设置私信全部已读",
    path: "/private_message/mark_read", method: "POST", auth: "required",
    handler: (c) => pm.markAllMessagesRead(c.client, toInt(c.params.cmd_flag, 0), toStr(c.params.encrypt_uin)),
  }),
  route({
    id: "pm.set_config", module: "private_message", summary: "写入私信配置",
    path: "/private_message/config", method: "POST", auth: "required",
    handler: (c) => pm.setConfig(c.client, toInt(c.params.config_type, 0), toStr(c.params.config_value)),
  }),
  route({
    id: "pm.get_config", module: "private_message", summary: "读取私信配置",
    path: "/private_message/config", method: "GET", auth: "required",
    handler: (c) => pm.getConfig(c.client, toInt(c.params.config_type, 0), toStr(c.params.config_value)),
  }),
  route({
    id: "pm.get_musician_message_card", module: "private_message", summary: "获取音乐人私信卡片",
    path: "/private_message/musician_card", method: "GET", auth: "required",
    handler: (c) => pm.getMusicianMessageCard(c.client, toStr(c.params.enc_uin)),
  }),
  route({
    id: "pm.report_card_message_action", module: "private_message", summary: "上报卡片消息操作回调",
    path: "/private_message/card_action", method: "POST", auth: "required",
    handler: (c) =>
      pm.reportCardMessageAction(
        c.client,
        toStr(c.params.target_user_id),
        toInt(c.params.msg_type, 0),
        toInt(c.params.confirm, 0),
        toStr(c.params.msg_id),
        { ext: parseJsonParam(c.params.ext) },
      ),
  }),
  route({
    id: "pm.get_chat_entries", module: "private_message", summary: "获取聊天页功能入口",
    path: "/private_message/chat_entries", method: "GET", auth: "required",
    handler: (c) =>
      pm.getChatEntries(c.client, toIntList(c.params.scenes), {
        fromUserType: c.params.from_user_type !== undefined ? toInt(c.params.from_user_type, 0) : null,
        userId: c.params.user_id ? toStr(c.params.user_id) : null,
        ext: parseJsonParam<Record<string, string>>(c.params.ext),
      }),
  }),
  route({
    id: "pm.get_media_message_details", module: "private_message", summary: "获取图片/视频消息详情",
    path: "/private_message/media_details", method: "GET", auth: "required",
    handler: (c) => pm.getMediaMessageDetails(c.client, toStr(c.params.session_id), toStrList(c.params.msg_ids)),
  }),
  route({
    id: "pm.get_safety_hint", module: "private_message", summary: "获取私信安全提示",
    path: "/private_message/safety_hint", method: "GET", auth: "required",
    handler: (c) => pm.getSafetyHint(c.client, toStr(c.params.enc_uin), toInt(c.params.close, 0)),
  }),
  route({
    id: "pm.get_friendship_badge", module: "private_message", summary: "获取聊天页好友浮标",
    path: "/private_message/friendship_badge", method: "GET", auth: "required",
    handler: (c) => pm.getFriendshipBadge(c.client, toStr(c.params.target_enc_uin)),
  }),

  /* ================ helper 辅助（补充：Web 层未暴露） ================ */
  route({
    id: "helper.init_upload", module: "helper", summary: "初始化 COS 上传获取临时凭证",
    path: "/helper/init_upload", method: "POST", auth: "required",
    handler: (c) => {
      const rawFiles = (c.params.files ?? c.body?.files) as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(rawFiles) || !rawFiles.length) throw new Error("缺少 files");
      // Web 层 snake_case 入参 → COS 协议 PascalCase 字段（file_sha1/file_name/file_size 或 FileSha1/... 均接受）
      const files: helper.InitUploadFile[] = rawFiles.map((f) => ({
        FileSha1: String(f.FileSha1 ?? f.file_sha1 ?? ""),
        FileName: String(f.FileName ?? f.file_name ?? ""),
        FileSize: Number(f.FileSize ?? f.file_size ?? 0),
      }));
      return helper.initUpload(c.client, toStr(c.params.bus_id), files);
    },
  }),
  route({
    id: "helper.finish_upload", module: "helper", summary: "完成 COS 上传并通知服务器验证",
    path: "/helper/finish_upload", method: "POST", auth: "required",
    handler: (c) => {
      const results = (c.params.results ?? c.body?.results) as helper.FinishUploadResult[] | undefined;
      if (!Array.isArray(results) || !results.length) throw new Error("缺少 results");
      return helper.finishUpload(c.client, toStr(c.params.bus_id), results);
    },
  }),
];

/* ---------------- 参数组装辅助 ---------------- */

/** song_id + song_type 两个平行列表 → [songId, songType][]（数量必须一致，对齐 web/src/modules/songlist.py 422 校验） */
function pairSongs(params: Record<string, any>): [number, number][] {
  const ids = toIntList(params.song_id);
  const types = toIntList(params.song_type);
  if (ids.length !== types.length) {
    throw new Error("song_id 与 song_type 数量必须一致");
  }
  return ids.map((id, i) => [id, types[i] ?? 0]);
}

function pageOpts(params: Record<string, any>): { page: number; num: number } {
  return { page: toInt(params.page, 1), num: toInt(params.num, 10) };
}

function commentOpts(params: Record<string, any>) {
  return {
    pageNum: toInt(params.page_num, 1),
    pageSize: toInt(params.page_size, 15),
    lastCommentSeqNo: toStr(params.last_comment_seq_no),
    bizType: toInt(params.biz_type, comment.CommentBizType.SONG),
    bizSubType: params.biz_sub_type !== undefined ? toInt(params.biz_sub_type, 0) : null,
  };
}

function commentList(
  c: QqRouteContext,
  fn: (
    client: QQClient,
    bizId: number,
    opts: ReturnType<typeof commentOpts>,
  ) => Promise<unknown>,
): Promise<unknown> {
  return fn(c.client, toInt(c.params.biz_id, 0), commentOpts(c.params));
}

/* ---------------- 路由匹配 ---------------- */

interface CompiledRoute extends QqRouteDef {
  regex: RegExp;
  paramNames: string[];
}

let compiled: CompiledRoute[] | null = null;

function compileRoutes(): CompiledRoute[] {
  if (compiled) return compiled;
  compiled = QQ_ROUTES.map((r) => {
    const paramNames: string[] = [];
    const pattern = r.path.replace(/\{(\w+)\}/g, (_, name) => {
      paramNames.push(name);
      return "([^/]+)";
    });
    return { ...r, regex: new RegExp(`^${pattern}$`), paramNames };
  });
  return compiled;
}

export interface MatchedRoute {
  def: QqRouteDef;
  pathParams: Record<string, string>;
}

/** 精确匹配（method + path） */
export function matchRoute(path: string, method: string): MatchedRoute | null {
  const wanted = (method || "GET").toUpperCase();
  let pathOnlyMatch: { def: QqRouteDef; pathParams: Record<string, string> } | null = null;
  for (const r of compileRoutes()) {
    const m = r.regex.exec(path);
    if (!m) continue;
    const pathParams: Record<string, string> = {};
    r.paramNames.forEach((name, i) => {
      pathParams[name] = decodeURIComponent(m[i + 1]);
    });
    if (r.method === wanted) return { def: r, pathParams };
    if (!pathOnlyMatch) pathOnlyMatch = { def: r, pathParams };
  }
  if (pathOnlyMatch) {
    throw new MethodMismatchError(pathOnlyMatch.def.method, wanted);
  }
  return null;
}

export class MethodMismatchError extends Error {
  constructor(public readonly expected: string, public readonly actual: string) {
    super(`方法不匹配: 该路径需要 ${expected}，收到 ${actual}`);
    this.name = "MethodMismatchError";
  }
}

export interface QQRouteInventoryEntry {
  id: string;
  module: string;
  summary: string;
  path: string;
  method: string;
  auth: QqAuthPolicy;
}

export function routeInventory(): { count: number; routes: QQRouteInventoryEntry[] } {
  return {
    count: QQ_ROUTES.length,
    routes: QQ_ROUTES.map((r) => ({
      id: r.id,
      module: r.module,
      summary: r.summary,
      path: r.path,
      method: r.method,
      auth: r.auth,
    })),
  };
}
