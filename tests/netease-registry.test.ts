/**
 * 网易云 API 注册表完整性测试
 * 保证 api-enhanced 全部 439 个接口迁移无遗漏、路由映射与 server.js 规则 1:1
 */
import { describe, expect, it } from "vitest";
import { MODULES, MODULE_COUNT, ROUTES, CATEGORY_ORDER, resolveRoute } from "../lib/netease/registry";

const EXPECTED_TOTAL = 439;

/** server.js 规则：文件名下划线转斜杠；3 个特殊路由原样 */
function expectedRoute(name: string): string {
  const special: Record<string, string> = {
    daily_signin: "/daily_signin",
    fm_trash: "/fm_trash",
    personal_fm: "/personal_fm",
  };
  return special[name] ?? "/" + name.replace(/_/g, "/");
}

describe("netease registry", () => {
  it("迁移接口总数为 439（不允许遗漏）", () => {
    expect(MODULE_COUNT).toBe(EXPECTED_TOTAL);
    expect(Object.keys(MODULES).length).toBe(EXPECTED_TOTAL);
    expect(Object.keys(ROUTES).length).toBe(EXPECTED_TOTAL);
  });

  it("每个模块都是可调用函数", () => {
    for (const entry of Object.values(MODULES)) {
      expect(typeof entry.module).toBe("function");
      expect(entry.name).toBeTruthy();
      expect(entry.route.startsWith("/")).toBe(true);
      expect(CATEGORY_ORDER).toContain(entry.category);
    }
  });

  it("路由规则与 server.js 一致（下划线转斜杠 + 3 个特殊路由）", () => {
    expect(ROUTES["/daily_signin"]).toBe("daily_signin");
    expect(ROUTES["/fm_trash"]).toBe("fm_trash");
    expect(ROUTES["/personal_fm"]).toBe("personal_fm");
    for (const [name, entry] of Object.entries(MODULES)) {
      expect(entry.route).toBe(expectedRoute(name));
      expect(ROUTES[entry.route]).toBe(name);
    }
  });

  it("代表性接口全部就位", () => {
    const mustHave = [
      "login_cellphone",
      "login_qr_key",
      "login_qr_create",
      "login_qr_check",
      "login_status",
      "logout",
      "register_anonimous",
      "register_checktoken_v2",
      "register_checktoken_v3",
      "register_xeapikey",
      "cloudsearch",
      "search",
      "search_match",
      "song_detail",
      "song_url",
      "song_url_v1",
      "song_url_v1_302",
      "song_url_match",
      "song_download_url_v1",
      "lyric",
      "lyric_new",
      "album",
      "album_detail_dynamic",
      "digitalAlbum_ordering",
      "artists",
      "artist_songs",
      "artist_new_song_mv_list_v2",
      "playlist_detail",
      "playlist_track_all",
      "playlist_catlist",
      "top_playlist_highquality",
      "personalized_newsong",
      "personal_fm",
      "fm_trash",
      "mv_all",
      "mv_url",
      "video_url",
      "mlog_url",
      "dj_toplist",
      "dj_difm_all_style_channel",
      "broadcast_channel_list",
      "comment_new",
      "comment_hug_list",
      "event_forward",
      "msg_private_history",
      "user_cloud",
      "cloud_upload_token",
      "cloud_import",
      "listentogether_room_create",
      "vip_timemachine",
      "yunbei_task_finish_v1",
      "musician_cloudbean_obtain",
      "fanscenter_trend_list",
      "listen_data_year_report",
      "summary_annual",
      "daily_signin",
      "record_recent_voice",
      "scrobble_v1",
      "weblog",
      "batch",
      "decrypt",
      "eapi_decrypt",
      "api",
      "avatar_upload",
      "voice_upload",
      "voicelist_trans",
      "ugc_artist_search",
      "sati_resource_list",
      "style_playlist",
      "sheet_preview",
      "starpick_comments_summary",
      "thinktank_audit_resource_update",
      "threshold_detail_get",
      "topic_detail_event_hot",
      "radio_sport_get",
      "ad_listening_rights_gain",
      "aidj_content_rcmd",
      "audio_match",
      "inner_version",
      "lbs_city_code",
      "get_userids",
      "pl_count",
      "chart_song_detail",
      "creator_authinfo_get",
      "middle_play_do_lottery",
      "rep_ugc_user_collect-vip",
      "related_playlist",
      "related_allvideo",
      "user_event_all",
      "user_social_status_edit",
      "verify_qrcodestatus",
      "nickname_check",
      "check_music",
      "like_v1",
      "likelist",
      "simi_user",
      "toplist_detail_v2",
      "personal_fm_mode",
      "song_lyrics_mark_user_page",
      "music_first_listen_info",
      "history_recommend_songs_detail",
      "homepage_dragon_ball",
      "calendar",
      "hot_topic",
      "countries_code_list",
      "captcha_verify",
      "cellphone_existence_check",
      "device_kickoff",
      "user_replacephone",
      "rebind",
      "activate_init_profile",
    ];
    for (const name of mustHave) {
      expect(MODULES[name], `缺少接口: ${name}`).toBeDefined();
    }
  });

  it("resolveRoute 正反解析", () => {
    expect(resolveRoute("/login/qr/check")?.name).toBe("login_qr_check");
    expect(resolveRoute("/song/url/v1")?.name).toBe("song_url_v1");
    expect(resolveRoute("/rep/ugc/user/collect-vip")?.name).toBe("rep_ugc_user_collect-vip");
    expect(resolveRoute("/daily_signin")?.name).toBe("daily_signin");
    expect(resolveRoute("/not/exist")).toBeUndefined();
  });
});
