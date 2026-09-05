/**
 * Web 层响应映射 — 对齐 .ref/QQMusicApi 响应模型（pydantic Response）的顶层字段重组。
 *
 * 参考仓库 Web 层（router_factory response_model_by_alias=False）输出 = 模型字段名（snake_case）：
 *  - json_schema_extra.jsonpath → 顶层字段从嵌套路径提取（$.a.b / $.a[*].b / $）
 *  - validation_alias → 上游顶层字段重命名为模型字段名（仅输入解析用，输出用字段名）
 *
 * 本模块映射表值两种形式：
 *  - "$..."  → jsonpath 提取
 *  - "key"   → 上游顶层字段重命名（output ← key）
 * 映射外的上游顶层字段原样保留（信息超集：参考字段全部就位，附加原始键便于调试）。
 */

export type ResponseFieldMap = Record<string, string>;

/** 路由 id → 顶层字段映射（与参考仓库 web 路由 response_model 一一对应） */
export const RESPONSE_MAPS: Record<string, ResponseFieldMap> = {
  /* ---------------- album ---------------- */
  // GetAlbumDetailResponse
  "album.get_detail": { album: "basicInfo", singers: "$.singer.singerList" },
  // GetAlbumSongResponse
  "album.get_song": { album_mid: "albumMid", total_num: "totalNum", song_list: "$.songList[*].songInfo" },
  // AlbumFavWriteResponse
  "album.fav_album": { failed_album_id: "v_failedAlbumId" },
  "album.del_fav_album": { failed_album_id: "v_failedAlbumId" },

  /* ---------------- comment ---------------- */
  // CommentCountResponse
  "comment.get_comment_count": {
    biz_type: "$.response.biz_type",
    biz_id: "$.response.biz_id",
    biz_sub_type: "$.response.biz_sub_type",
    count: "$.response.count",
    count_ver: "$.response.count_ver",
    count_view: "$.response.count_view",
    related_id: "$.response.related_id",
    tip: "$.response.tip",
    icon_list: "$.response.icon_list[*]",
    cm_tab_type: "$.cmTabType",
  },
  // CommentListResponse
  "comment.get_hot_comments": commentListMap(),
  "comment.get_new_comments": commentListMap(),
  "comment.get_recommend_comments": commentListMap(),
  // MomentCommentResponse
  "comment.get_moment_comments": {
    comments: "$.CmList[*]",
    has_more: "HasMore",
    next_pos: "NextPos",
    hint: "Hint",
    prev_list_loaded: "PrevListLoaded",
    map_cm_ext: "MapCmExt",
  },
  // AddCommentResponse
  "comment.add_comment": {
    floor: "$.Floor.Num",
    subcode: "SubCode",
    msg: "Msg",
    id: "AddedCmId",
    parent: "ParentCmId",
    verify_url: "VerifyUrl",
  },

  /* ---------------- helper ---------------- */
  // InitUploadResponse / FinishUploadResponse
  "helper.init_upload": { auth_info: "AuthInfo", files: "Files" },
  "helper.finish_upload": { objects: "Objects" },

  /* ---------------- lyric ---------------- */
  // GetLyricResponse
  "lyric.get_lyric": {
    songid: "songID",
    singing_annotations_lyric: "singingAnnotationsLyric",
    singing_annotations_ts: "singingAnnotationsTs",
    has_contributor: "hasContributor",
    has_trans_contributor: "hasTransContributor",
    has_multi_trans: "hasMultiTrans",
  },
  // GetSingingAnnotationsInfoResponse
  "lyric.get_singing_annotations_info": { has_singing_annotations_lyric: "hasSingingAnnotationsLyric" },
  // GetAIDictResponse
  "lyric.get_ai_dict": { dict_list: "dictList" },

  /* ---------------- mv ---------------- */
  // GetMvDetailResponse / GetMvUrlsResponse（data 字段 = 整个响应）
  "mv.get_detail": { data: "$" },
  "mv.get_mv_urls": { data: "$" },
  "mv.get_mv_url": { data: "$" },
  // GetMvListResponse（补充端点）
  "mv.get_mv_list": { items: "list" },

  /* ---------------- private_message ---------------- */
  // PrivateMessageListResponse
  "pm.get_messages": {
    attach: "Attach",
    pat_interval: "PatInterval",
    pat_map: "PatMap",
    encrypt_star: "EncryptStar",
    location_tips: "LocationTips",
    new_msg_cnt: "NewMsgCnt",
  },
  // PrivateChatEntriesResponse
  "pm.get_chat_entries": {
    ret_code: "RetCode",
    ret_msg: "RetMsg",
    entries: "Entries",
    can_be_dazi: "CanBeDazi",
    dz_data: "DzData",
  },
  // PrivateMediaMessageDetailsResponse
  "pm.get_media_message_details": { msg_ids: "MsgIDs" },

  /* ---------------- recommend ---------------- */
  // RecommendFeedCardResponse
  "recommend.get_home_feed": { shelves: "v_shelf" },
  // GuessRecommendResponse
  "recommend.get_guess_recommend": { songs: "tracks" },
  // RadarRecommendResponse
  "recommend.get_radar_recommend": {
    songs: "$.VecSongs[*].Track",
    recommend_song_ids: "RecommendSongIds",
    base_song_ids: "BaseSongIds",
    has_more: "HasMore",
    timestamp: "TimeStamp",
    video_cards: "VideoCards",
  },
  // RecommendSonglistResponse
  "recommend.get_recommend_songlist": {
    songlists: "$.List[*].Playlist.basic",
    has_more: "HasMore",
    from_limit: "FromLimit",
    msg: "Msg",
  },
  // RecommendNewSongResponse
  "recommend.get_recommend_newsong": { songs: "songlist", song_tags: "songTagInfoList" },

  /* ---------------- search ---------------- */
  "search.search_by_type": {
    searchid: "$.meta.searchid",
    perpage: "$.meta.perpage",
    nextpage: "$.meta.nextpage",
    estimate_sum: "$.meta.estimate_sum",
    total_num: "$.meta.sum",
    song: "$.body.item_song",
    singer: "$.body.singer",
    album: "$.body.item_album",
    songlist: "$.body.item_songlist",
    user: "$.body.item_user",
    audio_alum: "$.body.item_audio",
    mv: "$.body.item_mv",
    selectors: "$.body.multi_extern_info.selectors",
  },
  "search.general_search": {
    searchid: "$.meta.sid",
    perpage: "$.meta.perpage",
    nextpage: "$.meta.nextpage",
    nextpage_start: "$.meta.nextpage_start",
    song: "$.body.item_song",
    singer: "$.body.singer",
    mv: "$.body.item_mv",
    album: "$.body.item_album",
    songlist: "$.body.item_songlist",
    audio: "$.body.item_audio",
    direct: "$.body.direct_result.direct_group",
    related: "$.body.item_related",
  },
  "search.quick_search": {
    song: "$.data.song",
    singer: "$.data.singer",
    album: "$.data.album",
    mv: "$.data.mv",
  },

  /* ---------------- singer ---------------- */
  // HomepageTabDetailResponse
  "singer.get_tab_detail": {
    tab_id: "TabID",
    has_more: "HasMore",
    need_show_tab: "NeedShowTab",
    order: "Order",
    tab_list: "TabList",
    introduction_tab: "$.IntroductionTab.List",
    song_tab: "$.SongTab.List[*]",
    album_tab: "$.AlbumTab.AlbumList[*]",
    video_tab: "$.VideoTab.VideoList[*]",
  },
  // HomepageHeaderResponse
  "singer.get_info": {
    status: "Status",
    tab_detail: "TabDetail",
    prompt: "Prompt",
    singer: "$.Info.Singer",
    base_info: "$.Info.BaseInfo",
  },
  // SimilarSingerResponse
  "singer.get_similar": { err_msg: "errMsg" },
  // SingerSongListResponse
  "singer.get_songs_list": {
    singer_mid: "singerMid",
    total_num: "totalNum",
    song_list: "$.songList[*].songInfo",
  },
  // SingerAlbumListResponse
  "singer.get_album_list": { singer_mid: "singerMid", album_list: "albumList" },
  // SingerMvListResponse
  "singer.get_mv_list": { mv_list: "list" },

  /* ---------------- song ---------------- */
  // GetSongDetailResponse
  "song.get_detail": {
    track: "track_info",
    company: "$.info.company.content",
    genre: "$.info.genre.content",
    intro: "$.info.intro.content",
    lan: "$.info.lan.content",
    pub_time: "$.info.pub_time.content",
  },
  // GetSimilarSongResponse
  "song.get_similar_song": { song: "$.vecSongNew", tag: "songTagInfoList" },
  // GetRelatedSonglistResponse
  "song.get_related_songlist": { songlist: "$.vecPlaylistNew[*].playlists[*]", has_more: "hasMore" },
  // GetRelatedMvResponse
  "song.get_related_mv": { has_more: "hasmore", mv: "list" },
  // GetOtherVersionResponse
  "song.get_other_version": { data: "versionList" },
  // GetProducerResponse
  "song.get_producer": { data: "Lst", reinforce_msg: "ReinforceMsg" },
  // GetSheetResponse
  "song.get_sheet": { total_map: "totalMap" },
  // HasSheetMusicResponse
  "song.has_sheet": {
    has_guitar: "hasGuitar",
    has_more: "hasMore",
    has_ldy: "hasLDY",
    has_qrcx: "hasQRCX",
    has_chong_chong: "hasChongChong",
  },
  // GetFavNumResponse
  "song.get_fav_num": { numbers: "m_numbers", show: "m_show" },
  "song.get_fav_num_by_id": { numbers: "m_numbers", show: "m_show" },
  // GetCdnDispatchResponse
  "song.get_cdn_dispatch": { test_file: "keepalivefile", refresh_time: "refreshTime", cache_time: "cacheTime" },
  // GetSongUrlsResponse
  "song.get_song_urls": { data: "midurlinfo" },
  "song.get_song_url": { data: "midurlinfo" },

  /* ---------------- songlist ---------------- */
  // GetSonglistDetailResponse
  "songlist.get_detail": {
    info: "dirinfo",
    size: "songlist_size",
    songs: "songlist",
    total: "total_song_num",
  },
  // CreateDeleteSonglistResp
  "songlist.create": { id: "$.result.tid", dirid: "$.result.dirId", name: "$.result.dirName" },
  "songlist.delete": { id: "$.result.tid", dirid: "$.result.dirId", name: "$.result.dirName" },

  /* ---------------- top ---------------- */
  // TopDetailResponse
  "top.get_detail": {
    info: "data",
    songs: "songInfoList",
    song_tags: "songTagInfoList",
    ext_info_list: "extInfoList",
    index_info_list: "indexInfoList",
  },

  /* ---------------- user ---------------- */
  // UserCreatedSonglistResponse
  "user.get_created_songlist": { playlists: "$.v_playlist[*]", deleted_ids: "v_delTid", finished: "bFinish" },
  // UserFavSonglistResponse
  "user.get_fav_songlist": {
    playlists: "$.v_list",
    deleted_ids: "v_delTids",
    failed_ids: "v_failTids",
  },
  // UserFavAlbumResponse
  "user.get_fav_album": { albums: "$.v_list[*]", failed_album_ids: "v_failAlbumId" },
  // UserFavMvResponse（sub_code ← AliasChoices["subCode","subcode"] 首个）
  "user.get_fav_mv": { sub_code: "subCode", mv_list: "mvlist" },
  // UserMusicGeneResponse
  "user.get_music_gene": {
    user_info_card: "UserInfoCard",
    listening_report: "ListeningReport",
    sort_array: "SortArray",
    is_visit_account: "IsVisitAccount",
  },
  // UserHomepageResponse
  "user.get_homepage": {
    tab_detail: "TabDetail",
    base_info: "$.Info.BaseInfo",
    singer: "$.Info.Singer",
    is_followed: "$.Info.IsFollowed",
  },
  // UserRelationListResponse
  "user.get_fans": userRelationMap(),
  "user.get_follow_singers": userRelationMap(),
  "user.get_follow_user": userRelationMap(),
  // UserFriendListResponse
  "user.get_friend": { friends: "Friends", has_more: "HasMore" },
  // UserVipInfoResponse（同名 alias 忽略，仅列改名字段）
  "user.get_vip_info": {
    can_renew: "canRenew",
    star_start: "starstart",
    star_end: "starend",
    ystar_start: "ystarstart",
    ystar_end: "ystarend",
  },
  // DislikeListData
  "user.get_dislike_list": {
    retcode: "Retcode",
    msg: "Msg",
    singers: "Singers",
    songs: "Songs",
    styles: "Styles",
    page: "Page",
    token: "Token",
  },
};

function commentListMap(): ResponseFieldMap {
  return {
    comments: "$.CommentList.Comments[*]",
    comment_ids: "$.CommentList.CommentIds[*]",
    has_more: "$.CommentList.HasMore",
    next_offset: "$.CommentList.NextOffset",
    total: "$.CommentList.Total",
    total_cm_num: "TotalCmNum",
    comment_tip: "CommentTip",
    comment_h5_page: "CommentH5Page",
    has_ts_cm: "HasTsCm",
    share_cnt: "ShareCnt",
    msg: "Msg",
    sub_code: "SubCode",
  };
}

function userRelationMap(): ResponseFieldMap {
  return {
    users: "$.List[*]",
    total: "Total",
    has_more: "HasMore",
    last_pos: "LastPos",
    msg: "Msg",
    lock_flag: "LockFlag",
    lock_msg: "LockMsg",
  };
}

/** 求值单个 jsonpath（受支持子集）；未命中返回 undefined */
function evalPath(root: unknown, expr: string): unknown {
  if (expr === "$") return root;
  const body = expr.slice(2); // 去掉 "$."
  const tokens = body.split(".");
  let current: unknown = root;
  for (const token of tokens) {
    const wildcard = token.endsWith("[*]");
    const key = wildcard ? token.slice(0, -3) : token;
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      // 数组上下文：逐项取 key 再展平（覆盖 $.a[*].b / $.a[*].b[*] 语义）
      const mapped = (current as unknown[])
        .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>)[key] : undefined))
        .filter((v) => v !== undefined);
      current = wildcard ? mapped.flat() : mapped;
      continue;
    }
    if (typeof current !== "object") return undefined;
    const value = (current as Record<string, unknown>)[key];
    if (value === undefined) return undefined;
    if (wildcard) {
      if (!Array.isArray(value)) return undefined;
      current = value;
    } else {
      current = value;
    }
  }
  return current;
}

/**
 * 应用顶层响应映射（jsonpath 提取 + alias 重命名）。
 * 映射字段以参考模型字段名写入；上游其余顶层字段保留（信息超集）。
 * 对齐 models/_validator.py 的 None 规整：带 NoneToEmptyList/NoneToEmptyDict
 * 注解的模型字段在映射输出为 null 时规整为空数组/空对象。
 */
export function applyResponseMap(routeId: string, data: unknown): unknown {
  const map = RESPONSE_MAPS[routeId];
  if (!map || data === null || data === undefined) return data;
  if (typeof data !== "object" || Array.isArray(data)) return data;
  const source = data as Record<string, unknown>;
  const out: Record<string, unknown> = { ...source };
  for (const [field, expr] of Object.entries(map)) {
    if (expr.startsWith("$")) {
      const value = evalPath(source, expr);
      if (value !== undefined) out[field] = value;
      else if (expr === "$") out[field] = source;
      else if (!(field in out)) out[field] = null;
    } else {
      // 上游顶层字段重命名（output ← 上游键；上游键存在时写入，不存在置 null）
      if (expr in source) out[field] = source[expr];
      else if (!(field in out)) out[field] = null;
    }
  }
  normalizeEmptyFields(routeId, out);
  return out;
}

/**
 * None 规整表 — 对齐参考模型中 Annotated[..., NoneToEmptyList] / NoneToEmptyDict] 的顶层字段。
 * null → 空数组 / 空对象（嵌套模型内部字段的同类规整由信息超集策略覆盖，消费方按需兜底）。
 */
const NORMALIZE_EMPTY: Record<string, Record<string, "array" | "object">> = {
  "pm.get_messages": { attach: "object", pat_map: "object" },
  "top.get_detail": { song_tags: "array", ext_info_list: "array", index_info_list: "array" },
  "singer.get_tab_detail": {
    tab_list: "array",
    introduction_tab: "array",
    song_tab: "array",
    album_tab: "array",
    video_tab: "array",
  },
  "singer.get_songs_list": { song_list: "array" },
  "singer.get_album_list": { album_list: "array" },
  "singer.get_mv_list": { mv_list: "array" },
  "user.get_dislike_list": { singers: "array", songs: "array", styles: "array" },
};

function normalizeEmptyFields(routeId: string, out: Record<string, unknown>): void {
  const rules = NORMALIZE_EMPTY[routeId];
  if (!rules) return;
  for (const [field, kind] of Object.entries(rules)) {
    if (out[field] === null || out[field] === undefined) {
      out[field] = kind === "array" ? [] : {};
    }
  }
}

/** 对齐 web/src/routing/executor.py _wrap_success：bool → success(None)/操作失败；其余 → {code:0,msg:"ok",data} */
export function wrapSuccess(result: unknown): { code: number; msg: string; data: unknown } {
  if (typeof result === "boolean") {
    return result ? { code: 0, msg: "ok", data: null } : { code: -1, msg: "操作失败", data: null };
  }
  return { code: 0, msg: "ok", data: result ?? null };
}
