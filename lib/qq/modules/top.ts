/**
 * 排行榜模块 — 移植自 .ref/QQMusicApi qqmusic_api/modules/top.py。
 */
import type { CgiInvokeOptions } from "../types";
import type { QQClient } from "../client";

/** 获取所有排行榜分类 */
export async function getCategory(client: QQClient, options?: CgiInvokeOptions) {
  return client.invoke("music.musicToplist.Toplist", "GetAll", {}, options);
}

/** 获取排行榜详情及其歌曲列表 */
export async function getDetail(
  client: QQClient,
  topId: number,
  options?: CgiInvokeOptions & { num?: number; page?: number; tag?: boolean },
) {
  const num = options?.num ?? 10;
  const param: Record<string, unknown> = {
    topId,
    offset: num * ((options?.page ?? 1) - 1),
    num,
  };
  if (options?.tag ?? true) param.withTags = true;
  return client.invoke("music.musicToplist.Toplist", "GetDetail", param, {
    preserveBool: options?.tag ?? true,
    ...options,
  });
}
