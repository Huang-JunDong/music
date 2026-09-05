/**
 * 推荐模块 — 移植自 .ref/QQMusicApi qqmusic_api/modules/recommend.py。
 */
import type { CgiInvokeOptions } from "../types";
import type { QQClient } from "../client";

/** 获取首页推荐 Feed（v_cache = 已曝光卡片 ID，防重复推荐） */
export async function getHomeFeed(
  client: QQClient,
  options?: CgiInvokeOptions & { page?: number; direction?: number; sNum?: number; vCache?: string[] | null },
) {
  return client.invoke(
    "music.recommend.RecommendFeed",
    "get_recommend_feed",
    {
      direction: options?.direction ?? 0,
      page: options?.page ?? 1,
      s_num: options?.sNum ?? 0,
      v_cache: options?.vCache ?? [],
    },
    options,
  );
}

/** 获取猜你喜欢推荐（非 Android 平台需有效凭证） */
export async function getGuessRecommend(client: QQClient, options?: CgiInvokeOptions) {
  return client.invoke(
    "music.radioProxy.MbTrackRadioSvr",
    "get_radio_track",
    { id: 99, num: 5, from: 0, scene: 0, song_ids: [] },
    options,
  );
}

/** 获取雷达推荐 */
export async function getRadarRecommend(client: QQClient, page = 1, options?: CgiInvokeOptions) {
  return client.invoke(
    "music.recommend.TrackRelationServer",
    "GetRadarSong",
    { Page: page, ReqType: 0, FavSongs: [], EntranceSongs: [] },
    options,
  );
}

/** 获取推荐歌单 */
export async function getRecommendSonglist(client: QQClient, page = 1, num = 25, options?: CgiInvokeOptions) {
  return client.invoke(
    "music.playlist.PlaylistSquare",
    "GetRecommendFeed",
    { From: num * (page - 1), Size: num },
    options,
  );
}

/** 获取推荐新歌（type: 1=内地 2=欧美 3=日本 4=韩国 5=最新 6=港台） */
export async function getRecommendNewsong(client: QQClient, type = 5, options?: CgiInvokeOptions) {
  return client.invoke("newsong.NewSongServer", "get_new_song_info", { type }, options);
}
