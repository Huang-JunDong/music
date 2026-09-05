/**
 * 评论模块 — 移植自 .ref/QQMusicApi qqmusic_api/modules/comment.py。
 */
import type { CgiInvokeOptions } from "../types";
import type { QQClient } from "../client";

/** 评论业务分类 — 对齐参考仓库 models/comment.py CommentBizType */
export const CommentBizType = { SONG: 1, ALBUM: 2, PLAYLIST: 3, MV: 4, SPECIAL_AUDIO: 15 } as const;

interface CommentListOptions extends CgiInvokeOptions {
  pageNum?: number;
  pageSize?: number;
  lastCommentSeqNo?: string;
  bizType?: number;
  bizSubType?: number | null;
}

/** 获取评论数量 */
export async function getCommentCount(
  client: QQClient,
  bizId: number,
  options?: CgiInvokeOptions & { bizType?: number; bizSubType?: number | null },
) {
  const bizType = options?.bizType ?? CommentBizType.SONG;
  const reqData: Record<string, unknown> = { biz_id: String(bizId), biz_type: bizType };
  if (options?.bizSubType !== null && options?.bizSubType !== undefined) {
    reqData.biz_sub_type = options.bizSubType;
  } else if (bizType === CommentBizType.SONG) {
    reqData.biz_sub_type = 2;
  }
  return client.invoke("music.globalComment.CommentCountSrv", "GetCmCount", { request: reqData }, options);
}

/** 获取热评 */
export async function getHotComments(client: QQClient, bizId: number, options?: CommentListOptions) {
  const params: Record<string, unknown> = {
    BizType: options?.bizType ?? CommentBizType.SONG,
    BizId: String(bizId),
    LastCommentSeqNo: options?.lastCommentSeqNo ?? "",
    PageSize: options?.pageSize ?? 15,
    PageNum: (options?.pageNum ?? 1) - 1,
    HotType: 1,
    WithAirborne: 0,
    PicEnable: 1,
  };
  if (options?.bizSubType !== null && options?.bizSubType !== undefined) params.BizSubType = options.bizSubType;
  return client.invoke("music.globalComment.CommentRead", "GetHotCommentList", params, options);
}

/** 获取最新评论 */
export async function getNewComments(client: QQClient, bizId: number, options?: CommentListOptions) {
  const params: Record<string, unknown> = {
    PageSize: options?.pageSize ?? 15,
    PageNum: (options?.pageNum ?? 1) - 1,
    HashTagID: "",
    BizType: options?.bizType ?? CommentBizType.SONG,
    PicEnable: 1,
    LastCommentSeqNo: options?.lastCommentSeqNo ?? "",
    SelfSeeEnable: 1,
    BizId: String(bizId),
    AudioEnable: 1,
  };
  if (options?.bizSubType !== null && options?.bizSubType !== undefined) params.BizSubType = options.bizSubType;
  return client.invoke("music.globalComment.CommentRead", "GetNewCommentList", params, options);
}

/** 获取推荐评论 */
export async function getRecommendComments(client: QQClient, bizId: number, options?: CommentListOptions) {
  const params: Record<string, unknown> = {
    PageSize: options?.pageSize ?? 15,
    PageNum: (options?.pageNum ?? 1) - 1,
    BizType: options?.bizType ?? CommentBizType.SONG,
    PicEnable: 1,
    Flag: 1,
    LastCommentSeqNo: options?.lastCommentSeqNo ?? "",
    CmListUIVer: 1,
    BizId: String(bizId),
    AudioEnable: 1,
  };
  if (options?.bizSubType !== null && options?.bizSubType !== undefined) params.BizSubType = options.bizSubType;
  return client.invoke("music.globalComment.CommentRead", "GetRecCommentList", params, options);
}

/** 获取时刻评论（弹幕式） */
export async function getMomentComments(
  client: QQClient,
  bizId: number,
  options?: CommentListOptions,
) {
  const params: Record<string, unknown> = {
    LastPos: options?.lastCommentSeqNo ?? "",
    HashTagID: "",
    SeekTs: -1,
    Size: options?.pageSize ?? 15,
    BizType: options?.bizType ?? CommentBizType.SONG,
    BizId: String(bizId),
  };
  if (options?.bizSubType !== null && options?.bizSubType !== undefined) params.BizSubType = options.bizSubType;
  return client.invoke("music.globalComment.SongTsComment", "GetSongTsCmList", params, options);
}

/** 添加评论（支持回复指定评论） */
export async function addComment(
  client: QQClient,
  bizId: number,
  content: string,
  options?: CgiInvokeOptions & { replyCmtId?: string | null; bizType?: number; bizSubType?: number | null },
) {
  const reqData: Record<string, unknown> = {
    Content: content,
    BizType: options?.bizType ?? CommentBizType.SONG,
    BizId: String(bizId),
  };
  if (options?.replyCmtId != null) reqData.RepliedCmId = options.replyCmtId; // 对齐 Python `is not None`：空串也下发
  if (options?.bizSubType !== null && options?.bizSubType !== undefined) reqData.BizSubType = options.bizSubType;
  return client.invoke(
    "music.globalComment.CommentWriteServer",
    "AddComment",
    reqData,
    { ...options, requireLogin: true },
  );
}

/** 删除评论（评论不存在也返回成功） */
export async function deleteComment(client: QQClient, cmId: string, options?: CgiInvokeOptions) {
  const data = await client.invoke(
    "music.globalComment.CommentWriteServer",
    "DelComment",
    { CommentId: cmId },
    { ...options, requireLogin: true },
  );
  return ((data as Record<string, unknown>)?.SubCode ?? 0) === 0;
}
