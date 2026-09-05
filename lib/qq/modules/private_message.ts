/**
 * 私信模块 — 移植自 .ref/QQMusicApi qqmusic_api/modules/private_message.py。
 * 全部接口固定 Android 平台。
 */
import type { CgiInvokeOptions } from "../types";
import type { QQClient } from "../client";

const PRIVATE_MSG_READ_MODULE = "music.privateMsg.PrivateMsgRead";
const PRIVATE_MSG_WRITE_MODULE = "music.privateMsg.PrivateMsgWrite";

/** 获取私信会话列表 */
export async function getSessions(
  client: QQClient,
  options?: CgiInvokeOptions & {
    lastId?: string;
    order?: number;
    size?: number;
    lastTime?: number;
    from?: number;
    fansFlag?: number | null;
    encryptFromUin?: string | null;
  },
) {
  const params: Record<string, unknown> = {
    last_id: options?.lastId ?? "",
    order: options?.order ?? 1,
    size: options?.size ?? 20,
    last_time: options?.lastTime ?? 0,
    from: options?.from ?? 0,
  };
  if (options?.encryptFromUin) params.EncryptFromUin = options.encryptFromUin;
  else if (options?.fansFlag !== null) params.FansFlag = options?.fansFlag ?? 1; // 对齐 Python fans_flag 默认 1
  return client.invoke(PRIVATE_MSG_READ_MODULE, "GetSessionList", params, {
    ...options,
    requireLogin: true,
    platform: "android",
  });
}

/** 删除私信会话 */
export async function deleteSession(
  client: QQClient,
  sessionId: string,
  options?: CgiInvokeOptions & { superMsgFlag?: number },
) {
  return client.invoke(
    PRIVATE_MSG_WRITE_MODULE,
    "DeleteSession",
    { session_id: sessionId, super_msg_flag: options?.superMsgFlag ?? 0 },
    { ...options, requireLogin: true, platform: "android" },
  );
}

/** 获取私信聊天消息列表 */
export async function getMessages(
  client: QQClient,
  options?: CgiInvokeOptions & {
    sessionId?: string;
    userId?: string;
    lastId?: string;
    wnsId?: string;
    order?: number;
    size?: number;
    flag?: number;
    locationId?: string | null;
    updateTime?: number | null;
  },
) {
  const params: Record<string, unknown> = {
    order: options?.order ?? 1,
    size: options?.size ?? 50,
    flag: options?.flag ?? 0,
  };
  const optional: Record<string, unknown> = {
    session_id: options?.sessionId ?? "",
    last_id: options?.lastId ?? "",
    wns_id: options?.wnsId ?? "",
    user_id: options?.userId ?? "",
    location_id: options?.locationId ?? null,
    update_time: options?.updateTime ?? null,
  };
  for (const [k, v] of Object.entries(optional)) {
    if (v !== null && v !== "") params[k] = v;
  }
  return client.invoke(PRIVATE_MSG_READ_MODULE, "GetMessage", params, {
    ...options,
    requireLogin: true,
    platform: "android",
  });
}

/** 发送私信消息（starSend=true 使用明星超级私信接口） */
export async function sendMessage(
  client: QQClient,
  userId: string,
  msgType: number,
  options?: CgiInvokeOptions & {
    sessionId?: string;
    lastId?: string;
    lastMsgSeq?: number;
    metaData?: Record<string, unknown> | null;
    entrance?: number;
    clientKey?: string;
    sourceFlag?: number | null;
    msgId?: string | null;
    userInput?: string | null;
    superMsgFlag?: number | null;
    starSend?: boolean;
  },
) {
  const params: Record<string, unknown> = {
    last_msg_seq: options?.lastMsgSeq ?? 0,
    user_id: userId,
    entrance: options?.entrance ?? 0,
    client_key: options?.clientKey ?? "",
    msg_type: msgType,
  };
  const optional: Record<string, unknown> = {
    session_id: options?.sessionId ?? "",
    last_id: options?.lastId ?? "",
    meta_data: options?.metaData ?? null,
    source_flag: options?.sourceFlag ?? null,
    msg_id: options?.msgId ?? null,
    user_input: options?.userInput ?? null,
    super_msg_flag: options?.superMsgFlag ?? 0,
  };
  for (const [k, v] of Object.entries(optional)) {
    if (v !== null && v !== "") params[k] = v;
  }
  return client.invoke(
    PRIVATE_MSG_WRITE_MODULE,
    options?.starSend ? "StarSendSuperMsg" : "SendMessageAsync",
    params,
    { ...options, requireLogin: true, platform: "android" },
  );
}

/** 删除单条私信消息 */
export async function deleteMessage(
  client: QQClient,
  sessionId: string,
  msgId: string,
  options?: CgiInvokeOptions & { superMsgFlag?: number },
) {
  return client.invoke(
    PRIVATE_MSG_WRITE_MODULE,
    "DeleteMessage",
    { session_id: sessionId, msg_id: msgId, super_msg_flag: options?.superMsgFlag ?? 0 },
    { ...options, requireLogin: true, platform: "android" },
  );
}

/** 清空私信会话消息 */
export async function clearSession(
  client: QQClient,
  sessionId: string,
  options?: CgiInvokeOptions & { superMsgFlag?: number },
) {
  return client.invoke(
    PRIVATE_MSG_WRITE_MODULE,
    "ClearSession",
    { session_id: sessionId, super_msg_flag: options?.superMsgFlag ?? 0 },
    { ...options, requireLogin: true, platform: "android" },
  );
}

/** 写入私信配置 */
export async function setConfig(client: QQClient, configType: number, configValue: string, options?: CgiInvokeOptions) {
  return client.invoke(
    PRIVATE_MSG_WRITE_MODULE,
    "SetConfig",
    { config_type: configType, config_value_str: configValue },
    { ...options, requireLogin: true, platform: "android" },
  );
}

/** 读取私信配置 */
export async function getConfig(client: QQClient, configType: number, configValue = "", options?: CgiInvokeOptions) {
  return client.invoke(
    PRIVATE_MSG_READ_MODULE,
    "GetConfig",
    { config_type: configType, config_value_str: configValue },
    { ...options, requireLogin: true, platform: "android" },
  );
}

/** 获取音乐人私信卡片 */
export async function getMusicianMessageCard(client: QQClient, encUin: string, options?: CgiInvokeOptions) {
  return client.invoke(
    "music.privateMsg.MusicianMsgCardSvr",
    "GetMusicianCard",
    { EncUin: encUin },
    { ...options, requireLogin: true, platform: "android" },
  );
}

/** 上报卡片消息操作回调 */
export async function reportCardMessageAction(
  client: QQClient,
  targetUserId: string,
  msgType: number,
  confirm: number,
  msgId: string,
  options?: CgiInvokeOptions & { ext?: Record<string, unknown> | null },
) {
  const params: Record<string, unknown> = {
    target_user_id: targetUserId,
    msg_type: msgType,
    confirm,
    msg_id: msgId,
  };
  if (options?.ext && Object.keys(options.ext).length > 0) params.ext = options.ext; // 对齐 Python `if ext:` 空字典不下发
  return client.invoke(PRIVATE_MSG_WRITE_MODULE, "ActCardMsgCallBack", params, {
    ...options,
    requireLogin: true,
    platform: "android",
  });
}

/** 获取聊天页功能入口 */
export async function getChatEntries(
  client: QQClient,
  scenes: number[],
  options?: CgiInvokeOptions & { fromUserType?: number | null; userId?: string | null; ext?: Record<string, string> | null },
) {
  const params: Record<string, unknown> = {
    Scence: scenes,
    FromUserType: options?.fromUserType ?? null,
    UserID: options?.userId ?? null,
    Ext: options?.ext ?? null,
  };
  for (const [k, v] of Object.entries({ ...params })) {
    if (v === null) delete params[k];
  }
  return client.invoke(PRIVATE_MSG_READ_MODULE, "GetEntries", params, {
    ...options,
    requireLogin: true,
    platform: "android",
  });
}

/** 获取图片或视频消息详情 */
export async function getMediaMessageDetails(
  client: QQClient,
  sessionId: string,
  msgIds: string[],
  options?: CgiInvokeOptions,
) {
  return client.invoke(
    PRIVATE_MSG_READ_MODULE,
    "GetMsgDetails",
    { SessionID: sessionId, MsgIDs: msgIds },
    { ...options, requireLogin: true, platform: "android" },
  );
}

/** 设置私信全部已读 */
export async function markAllMessagesRead(client: QQClient, cmdFlag: number, encryptUin: string, options?: CgiInvokeOptions) {
  return client.invoke(
    PRIVATE_MSG_WRITE_MODULE,
    "SetAllMsgMardRead",
    { CmdFlag: cmdFlag, EncryptUin: encryptUin },
    { ...options, requireLogin: true, platform: "android" },
  );
}

/** 获取私信安全提示 */
export async function getSafetyHint(client: QQClient, encUin: string, close = 0, options?: CgiInvokeOptions) {
  return client.invoke(
    PRIVATE_MSG_READ_MODULE,
    "GetSafetyHint",
    { encUin, close },
    { ...options, requireLogin: true, platform: "android" },
  );
}

/** 获取聊天页好友浮标 */
export async function getFriendshipBadge(client: QQClient, targetEncUin: string, options?: CgiInvokeOptions) {
  return client.invoke(
    "music.dazi.DzEntrySrv",
    "GetFriendFloatingIcon",
    { TargetEncuin: targetEncUin },
    { ...options, requireLogin: true, platform: "android" },
  );
}
