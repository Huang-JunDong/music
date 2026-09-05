/**
 * MV 模块 — 移植自 .ref/QQMusicApi qqmusic_api/modules/mv.py。
 */
import type { CgiInvokeOptions } from "../types";
import type { QQClient } from "../client";
import { getGuid } from "../utils";

const MV_DETAIL_REQUIRED = [
  "vid", "type", "sid", "cover_pic", "duration", "singers", "video_switch", "msg", "name",
  "desc", "playcnt", "pubdate", "isfav", "gmid", "uploader_headurl", "uploader_nick",
  "uploader_encuin", "uploader_uin", "uploader_hasfollow", "uploader_follower_num",
  "related_songs",
  // 对齐参考实现：原列表含重复的 "uploader_hasfollow"（保留以逐字节一致）
  "uploader_hasfollow",
];

/** 获取 MV 详细信息（批量 VID） */
export async function getDetail(client: QQClient, vids: string[], options?: CgiInvokeOptions) {
  return client.invoke(
    "video.VideoDataServer",
    "get_video_info_batch",
    { vidlist: vids, required: MV_DETAIL_REQUIRED },
    options,
  );
}

/** 获取 MV 播放链接（批量 VID） */
export async function getMvUrls(client: QQClient, vids: string[], options?: CgiInvokeOptions) {
  return client.invoke(
    "music.stream.MvUrlProxy",
    "GetMvUrls",
    {
      vids,
      request_type: 10003,
      guid: getGuid(),
      videoformat: 1,
      format: 265,
      dolby: 1,
      use_new_domain: 1,
      use_ipv6: 1,
    },
    options,
  );
}

/** 获取 MV 分类列表（area: 15=全部 8=内地 5=港台 6=欧美 7=韩国 4=日本；version: 7=全部 8=MV 13=现场 14=翻唱 15=舞蹈 16=影视 17=综艺 18=儿歌） */
export async function getMvList(
  client: QQClient,
  options?: CgiInvokeOptions & { area?: number; version?: number; order?: number; num?: number; page?: number },
) {
  const num = options?.num ?? 10;
  const page = options?.page ?? 1;
  return client.invoke(
    "MvService.MvInfoProServer",
    "GetAllocMvInfo",
    {
      area: options?.area ?? 15,
      version: options?.version ?? 7,
      order: options?.order ?? 0,
      start: num * (page - 1),
      size: num,
    },
    options,
  );
}
