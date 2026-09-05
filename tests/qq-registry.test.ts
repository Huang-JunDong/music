/**
 * QQ 音乐 API 路由表完整性测试
 * 保证 QQMusicApi 全部 14 模块接口迁移无遗漏、路径与参考仓库 web 路由 1:1
 */
import { describe, expect, it } from "vitest";
import { QQ_ROUTES, matchRoute, routeInventory, MethodMismatchError } from "../lib/qq/registry";
import { RESPONSE_MAPS, applyResponseMap, wrapSuccess } from "../lib/qq/response-map";

/** 参考仓库 web/src/routes 全部 60 端点（module.method → path） */
const REFERENCE_WEB_ROUTES: Record<string, string> = {
  // login
  "login.check_expired": "/login/check_expired",
  "login.refresh_credential": "/login/refresh_credential",
  "login.qrcode": "/login/qrcode/{login_type}",
  "login.qrcode_status": "/login/qrcode/{login_type}/status",
  "login.phone_authcode": "/login/phone/authcode",
  "login.phone_authorize": "/login/phone/authorize",
  // song
  "song.get_cdn_dispatch": "/song/get_cdn_dispatch",
  "song.get_detail": "/song/{value}/detail",
  "song.get_fav_num": "/song/get_fav_num",
  "song.get_fav_num_by_id": "/song/{id}/fav_num",
  "song.get_labels": "/song/{songid}/labels",
  "song.get_other_version": "/song/{value}/other_versions",
  "song.get_producer": "/song/{value}/producer",
  "song.get_related_mv": "/song/{songid}/related_mv",
  "song.get_related_songlist": "/song/{songid}/related_songlists",
  "song.has_sheet": "/song/{mid}/has_sheet",
  "song.get_sheet": "/song/{mid}/sheet",
  "song.get_similar_song": "/song/{songid}/similar",
  "song.get_song_urls": "/song/get_song_urls",
  "song.get_song_url": "/song/{mid}/url",
  "song.query_song": "/song/query_song",
  // album
  "album.get_detail": "/album/{value}/detail",
  "album.get_song": "/album/{value}/songs",
  // songlist
  "songlist.add_songs": "/songlist/add_songs",
  "songlist.create": "/songlist/create",
  "songlist.del_songs": "/songlist/del_songs",
  "songlist.delete": "/songlist/delete",
  "songlist.get_detail": "/songlist/{songlist_id}/detail",
  // search
  "search.complete": "/search/complete",
  "search.general_search": "/search/general_search",
  "search.get_hotkey": "/search/get_hotkey",
  "search.quick_search": "/search/quick_search",
  "search.search_by_type": "/search/search_by_type",
  // singer
  "singer.get_album_list": "/singer/{mid}/albums",
  "singer.get_desc": "/singer/get_desc",
  "singer.get_desc_by_mid": "/singer/{mid}/desc",
  "singer.get_info": "/singer/{mid}/info",
  "singer.get_mv_list": "/singer/{mid}/mvs",
  "singer.get_similar": "/singer/{mid}/similar",
  "singer.get_singer_list": "/singer/get_singer_list",
  "singer.get_singer_list_index": "/singer/get_singer_list_index",
  "singer.get_songs_list": "/singer/{mid}/songs",
  "singer.get_tab_detail": "/singer/{mid}/tabs/{tab_type}",
  // lyric
  "lyric.get_lyric": "/song/{value}/lyric",
  "lyric.get_multi_style_trans_lyric": "/song/{songid}/lyric/multi_style_trans",
  "lyric.get_singing_annotations_info": "/song/{songid}/lyric/annotations_info",
  "lyric.is_ai_dict_exists": "/song/{songid}/lyric/ai_dict/exists",
  "lyric.get_ai_dict": "/song/{songid}/lyric/ai_dict",
  // mv
  "mv.get_detail": "/mv/get_detail",
  "mv.get_mv_urls": "/mv/get_mv_urls",
  "mv.get_mv_url": "/mv/{vid}/url",
  // top
  "top.get_category": "/top/get_category",
  "top.get_detail": "/top/{top_id}/detail",
  // recommend
  "recommend.get_guess_recommend": "/recommend/get_guess_recommend",
  "recommend.get_home_feed": "/recommend/get_home_feed",
  "recommend.get_radar_recommend": "/recommend/get_radar_recommend",
  "recommend.get_recommend_newsong": "/recommend/get_recommend_newsong",
  "recommend.get_recommend_songlist": "/recommend/get_recommend_songlist",
  // comment
  "comment.get_comment_count": "/song/{biz_id}/comments/count",
  "comment.get_hot_comments": "/song/{biz_id}/comments/hot",
  "comment.get_moment_comments": "/song/{biz_id}/comments/moments",
  "comment.get_new_comments": "/song/{biz_id}/comments/new",
  "comment.get_recommend_comments": "/song/{biz_id}/comments/recommended",
  "comment.add_comment": "/song/{biz_id}/comments",
  "comment.delete_comment": "/comment/{cm_id}",
  // user
  "user.get_created_songlist": "/user/{uin}/created_songlists",
  "user.get_fans": "/user/{euin}/fans",
  "user.get_fav_album": "/user/{euin}/fav/albums",
  "user.get_fav_mv": "/user/{euin}/fav/mvs",
  "user.get_fav_song": "/user/{euin}/fav/songs",
  "user.get_fav_songlist": "/user/{euin}/fav/songlists",
  "user.get_follow_singers": "/user/{euin}/follow/singers",
  "user.get_follow_user": "/user/{euin}/follow/users",
  "user.get_friend": "/user/get_friend",
  "user.get_homepage": "/user/{euin}/homepage",
  "user.get_music_gene": "/user/{euin}/music_gene",
  "user.get_vip_info": "/user/get_vip_info",
  "user.fav_songlist": "/user/fav/songlists",
  "user.unfav_songlist": "/user/fav/songlists/{songlist_id}",
  "user.get_dislike_list": "/user/dislikes",
  "user.add_dislike": "/user/dislikes",
  "user.cancel_dislike": "/user/dislikes",
  "user.cancel_all_dislike_song": "/user/dislikes/songs",
};

/** 核心库有能力但 Web 层未暴露 → 本项目补齐的端点 */
const SUPPLEMENTED_ROUTES = [
  "/login/logout",
  "/login/qrcode/mobile/poll",
  "/album/get_new_album",
  "/album/fav_album",
  "/songlist/like_song",
  "/songlist/unlike_song",
  "/mv/get_mv_list",
  "/private_message/sessions",
  "/private_message/sessions/{session_id}",
  "/private_message/sessions/{session_id}/clear",
  "/private_message/messages",
  "/private_message/mark_read",
  "/private_message/config",
  "/private_message/musician_card",
  "/private_message/card_action",
  "/private_message/chat_entries",
  "/private_message/media_details",
  "/private_message/safety_hint",
  "/private_message/friendship_badge",
  "/helper/init_upload",
  "/helper/finish_upload",
];

const MODULES_EXPECTED = [
  "login", "song", "album", "songlist", "search", "singer", "lyric",
  "mv", "top", "recommend", "comment", "user", "private_message", "helper",
];

describe("qq registry", () => {
  it("参考仓库 Web 路由全部迁移（60 端点 1:1，不允许遗漏）", () => {
    for (const [id, path] of Object.entries(REFERENCE_WEB_ROUTES)) {
      const found = QQ_ROUTES.find((r) => r.id === id || (r.id === "song.query_song_post" && id === "song.query_song"));
      expect(found, `缺少参考仓库端点: ${id}`).toBeDefined();
      expect(found!.path).toBe(path);
    }
  });

  it("query_song GET/POST 双方法端点都在", () => {
    expect(QQ_ROUTES.filter((r) => r.path === "/song/query_song").length).toBe(2);
  });

  it("核心库未暴露能力已补齐（logout/new_album/like_song/私信/上传）", () => {
    for (const path of SUPPLEMENTED_ROUTES) {
      expect(
        QQ_ROUTES.some((r) => r.path === path),
        `缺少补齐端点: ${path}`,
      ).toBe(true);
    }
  });

  it("14 个模块全覆盖", () => {
    const modules = new Set(QQ_ROUTES.map((r) => r.module));
    for (const m of MODULES_EXPECTED) {
      expect(modules.has(m), `缺少模块: ${m}`).toBe(true);
    }
  });

  it("每个路由定义完整（handler/method/auth）", () => {
    for (const r of QQ_ROUTES) {
      expect(typeof r.handler).toBe("function");
      expect(["GET", "POST", "DELETE"]).toContain(r.method);
      expect(["none", "optional", "required"]).toContain(r.auth);
      expect(r.path.startsWith("/")).toBe(true);
      expect(r.summary.length).toBeGreaterThan(0);
    }
  });

  it("matchRoute 精确匹配 + 路径参数提取", () => {
    const m1 = matchRoute("/song/0039MnYb0qxYhV/lyric", "GET");
    expect(m1?.def.id).toBe("lyric.get_lyric");
    expect(m1?.pathParams.value).toBe("0039MnYb0qxYhV");

    const m2 = matchRoute("/user/123456/created_songlists", "GET");
    expect(m2?.def.id).toBe("user.get_created_songlist");
    expect(m2?.pathParams.uin).toBe("123456");

    const m3 = matchRoute("/singer/004AlRNi2v6XzXD/final/songs", "GET");
    expect(m3).toBeNull();

    expect(matchRoute("/not/exist", "GET")).toBeNull();
  });

  it("方法不匹配抛 MethodMismatchError", () => {
    expect(() => matchRoute("/songlist/create", "GET")).toThrow(MethodMismatchError);
    expect(() => matchRoute("/comment/123", "GET")).toThrow(MethodMismatchError);
  });

  it("同路径多方法（/song/query_song、/user/dislikes、/album/fav_album）按 method 区分", () => {
    expect(matchRoute("/song/query_song", "GET")?.def.id).toBe("song.query_song_get");
    expect(matchRoute("/song/query_song", "POST")?.def.id).toBe("song.query_song_post");
    expect(matchRoute("/user/dislikes", "GET")?.def.id).toBe("user.get_dislike_list");
    expect(matchRoute("/user/dislikes", "POST")?.def.id).toBe("user.add_dislike");
    expect(matchRoute("/user/dislikes", "DELETE")?.def.id).toBe("user.cancel_dislike");
    expect(matchRoute("/album/fav_album", "POST")?.def.id).toBe("album.fav_album");
    expect(matchRoute("/album/fav_album", "DELETE")?.def.id).toBe("album.del_fav_album");
  });

  it("清单输出与路由数一致", () => {
    const inv = routeInventory();
    expect(inv.count).toBe(QQ_ROUTES.length);
    expect(inv.count).toBeGreaterThanOrEqual(105);
    expect(inv.routes.length).toBe(QQ_ROUTES.length);
  });
});

describe("qq response map（对齐参考仓库 response_model 行为）", () => {
  it("映射表键全部对应已注册路由 id", () => {
    const ids = new Set(QQ_ROUTES.map((r) => r.id));
    for (const key of Object.keys(RESPONSE_MAPS)) {
      expect(ids.has(key), `映射表存在未知路由: ${key}`).toBe(true);
    }
  });

  it("search_by_type：meta/body 顶层重组（$.meta.* 与 $.body.item_song 提取）", () => {
    const raw = {
      meta: { searchid: "s1", perpage: 10, nextpage: 2, estimate_sum: 100, sum: 98 },
      body: { item_song: [{ id: 1 }], item_album: [{ albumID: 9 }], singer: [] },
    };
    const out = applyResponseMap("search.search_by_type", raw) as Record<string, any>;
    expect(out.searchid).toBe("s1");
    expect(out.total_num).toBe(98);
    expect(out.song).toEqual([{ id: 1 }]);
    expect(out.album).toEqual([{ albumID: 9 }]);
  });

  it("songlist.get_detail：alias 重命名（dirinfo→info / songlist→songs / total_song_num→total）", () => {
    const raw = {
      dirinfo: { title: "歌单" },
      songlist: [{ mid: "m1" }],
      total_song_num: 42,
      songlist_size: 10,
      hasmore: 1,
    };
    const out = applyResponseMap("songlist.get_detail", raw) as Record<string, any>;
    expect(out.info).toEqual({ title: "歌单" });
    expect(out.songs).toEqual([{ mid: "m1" }]);
    expect(out.total).toBe(42);
    expect(out.size).toBe(10);
  });

  it("album.get_song：$.songList[*].songInfo 数组展平提取", () => {
    const raw = { albumMid: "M1", totalNum: 5, songList: [{ songInfo: { mid: "a" } }, { songInfo: { mid: "b" } }] };
    const out = applyResponseMap("album.get_song", raw) as Record<string, any>;
    expect(out.song_list).toEqual([{ mid: "a" }, { mid: "b" }]);
    expect(out.album_mid).toBe("M1");
  });

  it("user.get_created_songlist：$.v_playlist[*] 提取 + v_delTid 重命名", () => {
    const raw = { v_playlist: [{ tid: 1 }], v_delTid: [2], bFinish: true };
    const out = applyResponseMap("user.get_created_songlist", raw) as Record<string, any>;
    expect(out.playlists).toEqual([{ tid: 1 }]);
    expect(out.deleted_ids).toEqual([2]);
    expect(out.finished).toBe(true);
  });

  it("comment 列表：$.CommentList.* 嵌套提取", () => {
    const raw = { CommentList: { Comments: [{ CmId: "1" }], HasMore: 1, Total: 9 }, TotalCmNum: 9, SubCode: 0 };
    const out = applyResponseMap("comment.get_hot_comments", raw) as Record<string, any>;
    expect(out.comments).toEqual([{ CmId: "1" }]);
    expect(out.has_more).toBe(1);
    expect(out.total).toBe(9);
    expect(out.total_cm_num).toBe(9);
  });

  it("mv.get_detail：data = 整个响应（$）", () => {
    const raw = { any: "thing", list: [1] };
    const out = applyResponseMap("mv.get_detail", raw) as Record<string, any>;
    expect(out.data).toBe(raw);
  });

  it("未命中 jsonpath 的字段补 null（biz_sub_type 场景）", () => {
    const out = applyResponseMap("comment.get_comment_count", { response: { biz_type: 1, count: 5 } }) as Record<
      string,
      any
    >;
    expect(out.count).toBe(5);
    expect(out.biz_sub_type).toBeNull();
  });

  it("无映射路由原样返回", () => {
    const raw = { tracks: [{ mid: "x" }] };
    expect(applyResponseMap("song.query_song_get", raw)).toBe(raw);
  });
});

describe("qq ApiResponse 包装（对齐 _wrap_success）", () => {
  it("bool：true → data:null；false → code:-1 操作失败", () => {
    expect(wrapSuccess(true)).toEqual({ code: 0, msg: "ok", data: null });
    expect(wrapSuccess(false)).toEqual({ code: -1, msg: "操作失败", data: null });
  });
  it("对象/数组/null → {code:0,msg:'ok',data}", () => {
    expect(wrapSuccess({ a: 1 })).toEqual({ code: 0, msg: "ok", data: { a: 1 } });
    expect(wrapSuccess([1, 2])).toEqual({ code: 0, msg: "ok", data: [1, 2] });
    expect(wrapSuccess(undefined)).toEqual({ code: 0, msg: "ok", data: null });
  });
});
