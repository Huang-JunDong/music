/**
 * 用户模块 — 移植自 .ref/QQMusicApi qqmusic_api/modules/user.py。
 */
import type { CgiInvokeOptions, Credential } from "../types";
import { emptyCredential } from "../credential";
import type { QQClient } from "../client";

const PLACEHOLDER_CREDENTIAL: Credential = {
  ...emptyCredential(),
  musicid: 1,
  str_musicid: "1",
  musickey: "placeholder-musickey",
  encryptUin: "00000000000000000000000000000000",
  loginType: 1,
};

/** 获取用户主页头部及统计信息（缺省凭证时自动使用占位凭证） */
export async function getHomepage(client: QQClient, euin: string, options?: CgiInvokeOptions & { credential?: Credential | null }) {
  const credential = options?.credential ?? client.credential;
  const target =
    credential && credential.musicid && credential.musickey ? credential : PLACEHOLDER_CREDENTIAL;
  return client.invoke(
    "music.UnifiedHomepage.UnifiedHomepageSrv",
    "GetHomepageHeader",
    { uin: euin, IsQueryTabDetail: 1 },
    { ...options, credential: target }, // credential 固定占位凭证优先（对齐参考实现，防止调用方以 null 覆盖）
  );
}

/** 获取当前登录账号的 VIP 会员信息 */
export async function getVipInfo(client: QQClient, options?: CgiInvokeOptions) {
  return client.invoke("VipLogin.VipLoginInter", "vip_login_base", {}, { requireLogin: true, ...options });
}

/** 获取用户关注的歌手列表 */
export async function getFollowSingers(
  client: QQClient,
  euin: string,
  options?: CgiInvokeOptions & { page?: number; num?: number },
) {
  const num = options?.num ?? 10;
  return client.invoke(
    "music.concern.RelationList",
    "GetFollowSingerList",
    { HostUin: euin, From: ((options?.page ?? 1) - 1) * num, Size: num },
    { requireLogin: true, ...options },
  );
}

/** 获取用户粉丝列表 */
export async function getFans(
  client: QQClient,
  euin: string,
  options?: CgiInvokeOptions & { page?: number; num?: number },
) {
  const num = options?.num ?? 10;
  return client.invoke(
    "music.concern.RelationList",
    "GetFansList",
    { HostUin: euin, From: ((options?.page ?? 1) - 1) * num, Size: num },
    { requireLogin: true, ...options },
  );
}

/** 获取好友列表 */
export async function getFriend(client: QQClient, options?: CgiInvokeOptions & { page?: number; num?: number }) {
  return client.invoke(
    "music.homepage.Friendship",
    "GetFriendList",
    { PageSize: options?.num ?? 10, Page: (options?.page ?? 1) - 1 },
    { requireLogin: true, ...options },
  );
}

/** 获取关注的用户列表 */
export async function getFollowUser(
  client: QQClient,
  euin: string,
  options?: CgiInvokeOptions & { page?: number; num?: number },
) {
  const num = options?.num ?? 10;
  return client.invoke(
    "music.concern.RelationList",
    "GetFollowUserList",
    { HostUin: euin, From: ((options?.page ?? 1) - 1) * num, Size: num },
    { requireLogin: true, ...options },
  );
}

/** 获取用户创建的歌单列表 */
export async function getCreatedSonglist(client: QQClient, uin: number, options?: CgiInvokeOptions) {
  return client.invoke(
    "music.musicasset.PlaylistBaseRead",
    "GetPlaylistByUin",
    { uin: String(uin) },
    options,
  );
}

/** 获取用户收藏的歌曲列表（"我喜欢"，dirid=201） */
export async function getFavSong(
  client: QQClient,
  euin: string,
  options?: CgiInvokeOptions & { page?: number; num?: number },
) {
  const num = options?.num ?? 10;
  return client.invoke(
    "music.srfDissInfo.DissInfo",
    "CgiGetDiss",
    {
      disstid: 0,
      dirid: 201,
      tag: true,
      song_begin: num * ((options?.page ?? 1) - 1),
      song_num: num,
      userinfo: true,
      orderlist: true,
      enc_host_uin: euin,
    },
    options,
  );
}

/** 获取用户收藏的外部歌单列表 */
export async function getFavSonglist(
  client: QQClient,
  euin: string,
  options?: CgiInvokeOptions & { page?: number; num?: number },
) {
  const num = options?.num ?? 10;
  return client.invoke(
    "music.musicasset.PlaylistFavRead",
    "CgiGetPlaylistFavInfo",
    { uin: euin, offset: ((options?.page ?? 1) - 1) * num, size: num },
    options,
  );
}

/** 收藏歌单（他人的公开歌单；已在收藏中也返回成功） */
export async function favSonglist(
  client: QQClient,
  songlistId: number,
  options?: CgiInvokeOptions & { credential?: Credential | null },
) {
  const credential = options?.credential ?? client.credential;
  const data = await client.invoke(
    "music.musicasset.PlaylistFavWrite",
    "FavPlaylist",
    { uin: credential.encryptUin, v_playlistId: [songlistId] },
    { requireLogin: true, ...options },
  );
  const d = data as Record<string, unknown>;
  return d?.result === 0 && !((d?.v_failedPlaylistId as unknown[] | undefined) ?? []).includes(songlistId);
}

/** 取消收藏歌单（本就不在收藏中也返回成功） */
export async function unfavSonglist(
  client: QQClient,
  songlistId: number,
  options?: CgiInvokeOptions & { credential?: Credential | null },
) {
  const credential = options?.credential ?? client.credential;
  const data = await client.invoke(
    "music.musicasset.PlaylistFavWrite",
    "CancelFavPlaylist",
    { uin: credential.encryptUin, v_playlistId: [songlistId] },
    { requireLogin: true, ...options },
  );
  const d = data as Record<string, unknown>;
  return d?.result === 0 && !((d?.v_failedPlaylistId as unknown[] | undefined) ?? []).includes(songlistId);
}

/** 获取用户收藏的专辑列表 */
export async function getFavAlbum(
  client: QQClient,
  euin: string,
  options?: CgiInvokeOptions & { page?: number; num?: number },
) {
  const num = options?.num ?? 10;
  return client.invoke(
    "music.musicasset.AlbumFavRead",
    "CgiGetAlbumFavInfo",
    { euin, offset: ((options?.page ?? 1) - 1) * num, size: num },
    options,
  );
}

/** 获取用户收藏的 MV 列表 */
export async function getFavMv(
  client: QQClient,
  euin: string,
  options?: CgiInvokeOptions & { page?: number; num?: number },
) {
  return client.invoke(
    "music.musicasset.MVFavRead",
    "getMyFavMV_v2",
    { encuin: euin, pagesize: options?.num ?? 10, num: (options?.page ?? 1) - 1 },
    { requireLogin: true, ...options },
  );
}

/** 获取用户的音乐基因数据 */
export async function getMusicGene(client: QQClient, euin: string, options?: CgiInvokeOptions) {
  return client.invoke(
    "music.recommend.UserProfileSettingSvr",
    "GetProfileReport",
    { VisitAccount: euin },
    options,
  );
}

/** 获取用户不喜欢列表（cmd: 2=歌手 3=歌曲 4=风格）— 签名网关 */
export async function getDislikeList(
  client: QQClient,
  options?: CgiInvokeOptions & { cmd?: number; page?: number; lastid?: number },
) {
  const cmd = options?.cmd ?? 3;
  const lastidFields: Record<number, string> = { 2: "SingersLastid", 3: "SongLastid", 4: "StyleLastid" };
  const param: Record<string, unknown> = { Cmd: cmd, Page: options?.page ?? 1 };
  if (options?.lastid) param[lastidFields[cmd]] = options.lastid;
  return client.invoke(
    "music.feedback.FeedbackBlack",
    "GetDislikeList",
    param,
    { requireLogin: true, sign: true, ...options },
  );
}

/** 添加不喜欢（idType: 1=歌曲 2=歌手 3=风格） */
export async function addDislike(
  client: QQClient,
  idType: number,
  values: number[],
  options?: CgiInvokeOptions,
) {
  const keys: Record<number, string> = { 1: "Songs", 2: "Singers", 3: "Styles" };
  const result = await client.invoke(
    "music.feedback.FeedbackBlack",
    "AddDislike",
    { [keys[idType]]: values.map((vid) => ({ ID: String(vid), IdType: idType })) },
    { requireLogin: true, ...options },
  );
  return (result as Record<string, unknown>)?.Retcode === 0;
}

/** 取消不喜欢 */
export async function cancelDislike(
  client: QQClient,
  idType: number,
  values: number[],
  options?: CgiInvokeOptions,
) {
  const keys: Record<number, string> = { 1: "Songs", 2: "Singers", 3: "Styles" };
  const result = await client.invoke(
    "music.feedback.FeedbackBlack",
    "CancelDislike",
    { [keys[idType]]: (values ?? []).map((vid) => ({ ID: String(vid), IdType: idType })) },
    { requireLogin: true, ...options },
  );
  return (result as Record<string, unknown>)?.Retcode === 0;
}

/** 清空所有不喜欢歌曲（两段式：取 Token → DelType=3 确认） */
export async function cancelAllDislikeSong(client: QQClient, options?: CgiInvokeOptions) {
  const first = await client.invoke(
    "music.feedback.FeedbackBlack",
    "CancelAllDislike",
    { ISOnlyGetToken: true },
    { requireLogin: true, preserveBool: true, ...options },
  );
  const token = (first as Record<string, unknown>)?.Token ?? "";
  const second = await client.invoke(
    "music.feedback.FeedbackBlack",
    "CancelAllDislike",
    { DelType: 3, Token: token },
    { requireLogin: true, ...options },
  );
  return (second as Record<string, unknown>)?.Retcode === 0;
}
