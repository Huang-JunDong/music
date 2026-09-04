# 网易云 API 全量接口清单（439 个）

> 来源：[NeteaseCloudMusicApiEnhanced/api-enhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced)（`.ref/api-enhanced`，MIT License）
> 迁移位置：核心运行时 `lib/netease/`，接口模块 `lib/netease/modules/`（439 个接口按功能家族合并为 23 个组文件：account / user / song / album / artist / playlist / search / recommend / fm / video / dj / broadcast / comment / social / cloud / listentogether / vip / yunbei / musician / fanscenter / listening / tools / misc）
> 调用方式：`/api/netease<route>`（如 `/api/netease/login/qr/key`），或进程内 `invokeNcm("<name>", params)`
> 供应链本地化：易盾 v2 checktoken（`register_checktoken_v2`）依赖 jsdom（正式依赖）+ 本地 vendor 脚本 `lib/netease/vendor/dun-tool.min.js`（来源 `acstatic-dun.126.net/tool.min.js`，5168B，SHA-256 `C34E…D91D` 读取时校验；沙箱禁远端子资源加载）

## 分类统计

| 分类 | 数量 |
|---|---|
| 登录与账号 | 27 |
| 其他 | 57 |
| 专辑 | 15 |
| 工具与调试 | 6 |
| 歌手 | 19 |
| 歌曲 | 44 |
| 推荐与榜单 | 25 |
| 广播 | 5 |
| 云盘与声音 | 16 |
| 搜索 | 9 |
| 评论 | 19 |
| 听歌数据 | 17 |
| 用户信息 | 30 |
| 播客与DJ | 30 |
| 动态与社交 | 16 |
| 粉丝中心 | 5 |
| 私人FM | 3 |
| 一起听 | 9 |
| MV与视频 | 22 |
| 音乐人 | 8 |
| 歌单 | 30 |
| VIP中心 | 13 |
| 云贝 | 14 |

## 明细

### 登录与账号（27）

| 接口名 | HTTP 路由 | 所在组文件 |
|---|---|---|
| `activate_init_profile` | `/api/netease/activate/init/profile` | account.ts |
| `captcha_safe_sent` | `/api/netease/captcha/safe/sent` | account.ts |
| `captcha_sent` | `/api/netease/captcha/sent` | account.ts |
| `captcha_sent_v1` | `/api/netease/captcha/sent/v1` | account.ts |
| `captcha_verify` | `/api/netease/captcha/verify` | account.ts |
| `cellphone_existence_check` | `/api/netease/cellphone/existence/check` | account.ts |
| `countries_code_list` | `/api/netease/countries/code/list` | account.ts |
| `login` | `/api/netease/login` | account.ts |
| `login_cellphone` | `/api/netease/login/cellphone` | account.ts |
| `login_qr_check` | `/api/netease/login/qr/check` | account.ts |
| `login_qr_create` | `/api/netease/login/qr/create` | account.ts |
| `login_qr_key` | `/api/netease/login/qr/key` | account.ts |
| `login_refresh` | `/api/netease/login/refresh` | account.ts |
| `login_status` | `/api/netease/login/status` | account.ts |
| `logout` | `/api/netease/logout` | account.ts |
| `nickname_check` | `/api/netease/nickname/check` | account.ts |
| `rebind` | `/api/netease/rebind` | account.ts |
| `register_anonimous` | `/api/netease/register/anonimous` | account.ts |
| `register_cellphone` | `/api/netease/register/cellphone` | account.ts |
| `register_checktoken_v2` | `/api/netease/register/checktoken/v2` | account.ts |
| `register_checktoken_v3` | `/api/netease/register/checktoken/v3` | account.ts |
| `register_xeapikey` | `/api/netease/register/xeapikey` | account.ts |
| `user_binding` | `/api/netease/user/binding` | account.ts |
| `user_bindingcellphone` | `/api/netease/user/bindingcellphone` | account.ts |
| `user_replacephone` | `/api/netease/user/replacephone` | account.ts |
| `verify_getQr` | `/api/netease/verify/getQr` | account.ts |
| `verify_qrcodestatus` | `/api/netease/verify/qrcodestatus` | account.ts |

### 其他（57）

| 接口名 | HTTP 路由 | 所在组文件 |
|---|---|---|
| `ad_get` | `/api/netease/ad/get` | misc.ts |
| `ad_listening_rights` | `/api/netease/ad/listening/rights` | misc.ts |
| `ad_listening_rights_gain` | `/api/netease/ad/listening/rights/gain` | misc.ts |
| `aidj_content_rcmd` | `/api/netease/aidj/content/rcmd` | misc.ts |
| `chart_detail` | `/api/netease/chart/detail` | misc.ts |
| `chart_song_detail` | `/api/netease/chart/song/detail` | misc.ts |
| `creator_authinfo_get` | `/api/netease/creator/authinfo/get` | misc.ts |
| `lbs_city_code` | `/api/netease/lbs/city/code` | misc.ts |
| `middle_play_do_lottery` | `/api/netease/middle/play/do/lottery` | misc.ts |
| `middle_play_lottery_remain_chance` | `/api/netease/middle/play/lottery/remain/chance` | misc.ts |
| `pl_count` | `/api/netease/pl/count` | misc.ts |
| `program_recommend` | `/api/netease/program/recommend` | misc.ts |
| `radio_sport_get` | `/api/netease/radio/sport/get` | misc.ts |
| `rep_ugc_activity_collect` | `/api/netease/rep/ugc/activity/collect` | misc.ts |
| `rep_ugc_activity_get` | `/api/netease/rep/ugc/activity/get` | misc.ts |
| `rep_ugc_exam_info_get` | `/api/netease/rep/ugc/exam/info/get` | misc.ts |
| `rep_ugc_exam_question_single_get` | `/api/netease/rep/ugc/exam/question/single/get` | misc.ts |
| `rep_ugc_exam_result_get` | `/api/netease/rep/ugc/exam/result/get` | misc.ts |
| `rep_ugc_exam_start` | `/api/netease/rep/ugc/exam/start` | misc.ts |
| `rep_ugc_exam_submit` | `/api/netease/rep/ugc/exam/submit` | misc.ts |
| `rep_ugc_user_collect-vip` | `/api/netease/rep/ugc/user/collect-vip` | misc.ts |
| `rep_ugc_user_get` | `/api/netease/rep/ugc/user/get` | misc.ts |
| `rep_ugc_user_sign` | `/api/netease/rep/ugc/user/sign` | misc.ts |
| `rep_ugc_user_vip` | `/api/netease/rep/ugc/user/vip` | misc.ts |
| `resource_like` | `/api/netease/resource/like` | misc.ts |
| `sati_resource_list` | `/api/netease/sati/resource/list` | misc.ts |
| `sati_resource_list_more` | `/api/netease/sati/resource/list/more` | misc.ts |
| `sati_resource_sub` | `/api/netease/sati/resource/sub` | misc.ts |
| `sati_resource_sub_list` | `/api/netease/sati/resource/sub/list` | misc.ts |
| `sati_tag_list` | `/api/netease/sati/tag/list` | misc.ts |
| `sati_timescene_resources_get` | `/api/netease/sati/timescene/resources/get` | misc.ts |
| `setting` | `/api/netease/setting` | misc.ts |
| `sheet_list` | `/api/netease/sheet/list` | misc.ts |
| `sheet_preview` | `/api/netease/sheet/preview` | misc.ts |
| `simi_playlist` | `/api/netease/simi/playlist` | misc.ts |
| `simi_user` | `/api/netease/simi/user` | misc.ts |
| `starpick_comments_summary` | `/api/netease/starpick/comments/summary` | misc.ts |
| `style_album` | `/api/netease/style/album` | misc.ts |
| `style_artist` | `/api/netease/style/artist` | misc.ts |
| `style_detail` | `/api/netease/style/detail` | misc.ts |
| `style_list` | `/api/netease/style/list` | misc.ts |
| `style_playlist` | `/api/netease/style/playlist` | misc.ts |
| `style_preference` | `/api/netease/style/preference` | misc.ts |
| `style_song` | `/api/netease/style/song` | misc.ts |
| `thinktank_audit_resource_detail` | `/api/netease/thinktank/audit/resource/detail` | misc.ts |
| `thinktank_audit_resource_update` | `/api/netease/thinktank/audit/resource/update` | misc.ts |
| `threshold_detail_get` | `/api/netease/threshold/detail/get` | misc.ts |
| `topic_detail` | `/api/netease/topic/detail` | misc.ts |
| `topic_detail_event_hot` | `/api/netease/topic/detail/event/hot` | misc.ts |
| `topic_sublist` | `/api/netease/topic/sublist` | misc.ts |
| `ugc_album_get` | `/api/netease/ugc/album/get` | misc.ts |
| `ugc_artist_get` | `/api/netease/ugc/artist/get` | misc.ts |
| `ugc_artist_search` | `/api/netease/ugc/artist/search` | misc.ts |
| `ugc_detail` | `/api/netease/ugc/detail` | misc.ts |
| `ugc_mv_get` | `/api/netease/ugc/mv/get` | misc.ts |
| `ugc_song_get` | `/api/netease/ugc/song/get` | misc.ts |
| `ugc_user_devote` | `/api/netease/ugc/user/devote` | misc.ts |

### 专辑（15）

| 接口名 | HTTP 路由 | 所在组文件 |
|---|---|---|
| `album` | `/api/netease/album` | album.ts |
| `album_detail` | `/api/netease/album/detail` | album.ts |
| `album_detail_dynamic` | `/api/netease/album/detail/dynamic` | album.ts |
| `album_list` | `/api/netease/album/list` | album.ts |
| `album_list_style` | `/api/netease/album/list/style` | album.ts |
| `album_new` | `/api/netease/album/new` | album.ts |
| `album_newest` | `/api/netease/album/newest` | album.ts |
| `album_privilege` | `/api/netease/album/privilege` | album.ts |
| `album_songsaleboard` | `/api/netease/album/songsaleboard` | album.ts |
| `album_sub` | `/api/netease/album/sub` | album.ts |
| `album_sublist` | `/api/netease/album/sublist` | album.ts |
| `digitalAlbum_detail` | `/api/netease/digitalAlbum/detail` | album.ts |
| `digitalAlbum_ordering` | `/api/netease/digitalAlbum/ordering` | album.ts |
| `digitalAlbum_purchased` | `/api/netease/digitalAlbum/purchased` | album.ts |
| `digitalAlbum_sales` | `/api/netease/digitalAlbum/sales` | album.ts |

### 工具与调试（6）

| 接口名 | HTTP 路由 | 所在组文件 |
|---|---|---|
| `api` | `/api/netease/api` | tools.ts |
| `avatar_upload` | `/api/netease/avatar/upload` | tools.ts |
| `batch` | `/api/netease/batch` | tools.ts |
| `decrypt` | `/api/netease/decrypt` | tools.ts |
| `eapi_decrypt` | `/api/netease/eapi/decrypt` | tools.ts |
| `inner_version` | `/api/netease/inner/version` | tools.ts |

### 歌手（19）

| 接口名 | HTTP 路由 | 所在组文件 |
|---|---|---|
| `artist_album` | `/api/netease/artist/album` | artist.ts |
| `artist_desc` | `/api/netease/artist/desc` | artist.ts |
| `artist_detail` | `/api/netease/artist/detail` | artist.ts |
| `artist_detail_dynamic` | `/api/netease/artist/detail/dynamic` | artist.ts |
| `artist_fans` | `/api/netease/artist/fans` | artist.ts |
| `artist_follow_count` | `/api/netease/artist/follow/count` | artist.ts |
| `artist_list` | `/api/netease/artist/list` | artist.ts |
| `artist_mv` | `/api/netease/artist/mv` | artist.ts |
| `artist_new_mv` | `/api/netease/artist/new/mv` | artist.ts |
| `artist_new_song` | `/api/netease/artist/new/song` | artist.ts |
| `artist_new_song_mv_list_v2` | `/api/netease/artist/new/song/mv/list/v2` | artist.ts |
| `artist_new_song_playall` | `/api/netease/artist/new/song/playall` | artist.ts |
| `artist_songs` | `/api/netease/artist/songs` | artist.ts |
| `artist_sub` | `/api/netease/artist/sub` | artist.ts |
| `artist_sublist` | `/api/netease/artist/sublist` | artist.ts |
| `artist_top_song` | `/api/netease/artist/top/song` | artist.ts |
| `artist_video` | `/api/netease/artist/video` | artist.ts |
| `artists` | `/api/netease/artists` | artist.ts |
| `simi_artist` | `/api/netease/simi/artist` | artist.ts |

### 歌曲（44）

| 接口名 | HTTP 路由 | 所在组文件 |
|---|---|---|
| `audio_match` | `/api/netease/audio/match` | song.ts |
| `check_music` | `/api/netease/check/music` | song.ts |
| `like` | `/api/netease/like` | song.ts |
| `like_v1` | `/api/netease/like/v1` | song.ts |
| `likelist` | `/api/netease/likelist` | song.ts |
| `lyric` | `/api/netease/lyric` | song.ts |
| `lyric_new` | `/api/netease/lyric/new` | song.ts |
| `music_first_listen_info` | `/api/netease/music/first/listen/info` | song.ts |
| `playmode_intelligence_list` | `/api/netease/playmode/intelligence/list` | song.ts |
| `playmode_song_vector` | `/api/netease/playmode/song/vector` | song.ts |
| `relay_play_state_submit` | `/api/netease/relay/play/state/submit` | song.ts |
| `scrobble` | `/api/netease/scrobble` | song.ts |
| `scrobble_v1` | `/api/netease/scrobble/v1` | song.ts |
| `simi_song` | `/api/netease/simi/song` | song.ts |
| `song_chorus` | `/api/netease/song/chorus` | song.ts |
| `song_cloud_download` | `/api/netease/song/cloud/download` | song.ts |
| `song_copyright_rcmd` | `/api/netease/song/copyright/rcmd` | song.ts |
| `song_creators` | `/api/netease/song/creators` | song.ts |
| `song_detail` | `/api/netease/song/detail` | song.ts |
| `song_downlist` | `/api/netease/song/downlist` | song.ts |
| `song_download_url` | `/api/netease/song/download/url` | song.ts |
| `song_download_url_v1` | `/api/netease/song/download/url/v1` | song.ts |
| `song_dynamic_cover` | `/api/netease/song/dynamic/cover` | song.ts |
| `song_like` | `/api/netease/song/like` | song.ts |
| `song_like_check` | `/api/netease/song/like/check` | song.ts |
| `song_lyrics_mark` | `/api/netease/song/lyrics/mark` | song.ts |
| `song_lyrics_mark_add` | `/api/netease/song/lyrics/mark/add` | song.ts |
| `song_lyrics_mark_del` | `/api/netease/song/lyrics/mark/del` | song.ts |
| `song_lyrics_mark_user_page` | `/api/netease/song/lyrics/mark/user/page` | song.ts |
| `song_monthdownlist` | `/api/netease/song/monthdownlist` | song.ts |
| `song_music_detail` | `/api/netease/song/music/detail` | song.ts |
| `song_order_update` | `/api/netease/song/order/update` | song.ts |
| `song_purchased` | `/api/netease/song/purchased` | song.ts |
| `song_red_count` | `/api/netease/song/red/count` | song.ts |
| `song_simi_get` | `/api/netease/song/simi/get` | song.ts |
| `song_singledownlist` | `/api/netease/song/singledownlist` | song.ts |
| `song_url` | `/api/netease/song/url` | song.ts |
| `song_url_match` | `/api/netease/song/url/match` | song.ts |
| `song_url_ncmget` | `/api/netease/song/url/ncmget` | song.ts |
| `song_url_v1` | `/api/netease/song/url/v1` | song.ts |
| `song_url_v1_302` | `/api/netease/song/url/v1/302` | song.ts |
| `song_wiki_info` | `/api/netease/song/wiki/info` | song.ts |
| `song_wiki_summary` | `/api/netease/song/wiki/summary` | song.ts |
| `weblog` | `/api/netease/weblog` | song.ts |

### 推荐与榜单（25）

| 接口名 | HTTP 路由 | 所在组文件 |
|---|---|---|
| `banner` | `/api/netease/banner` | recommend.ts |
| `calendar` | `/api/netease/calendar` | recommend.ts |
| `history_recommend_songs` | `/api/netease/history/recommend/songs` | recommend.ts |
| `history_recommend_songs_detail` | `/api/netease/history/recommend/songs/detail` | recommend.ts |
| `homepage_block_page` | `/api/netease/homepage/block/page` | recommend.ts |
| `homepage_dragon_ball` | `/api/netease/homepage/dragon/ball` | recommend.ts |
| `hot_topic` | `/api/netease/hot/topic` | recommend.ts |
| `personalized` | `/api/netease/personalized` | recommend.ts |
| `personalized_djprogram` | `/api/netease/personalized/djprogram` | recommend.ts |
| `personalized_mv` | `/api/netease/personalized/mv` | recommend.ts |
| `personalized_newsong` | `/api/netease/personalized/newsong` | recommend.ts |
| `personalized_privatecontent` | `/api/netease/personalized/privatecontent` | recommend.ts |
| `personalized_privatecontent_list` | `/api/netease/personalized/privatecontent/list` | recommend.ts |
| `recommend_resource` | `/api/netease/recommend/resource` | recommend.ts |
| `recommend_songs` | `/api/netease/recommend/songs` | recommend.ts |
| `recommend_songs_dislike` | `/api/netease/recommend/songs/dislike` | recommend.ts |
| `top_album` | `/api/netease/top/album` | recommend.ts |
| `top_artists` | `/api/netease/top/artists` | recommend.ts |
| `top_list` | `/api/netease/top/list` | recommend.ts |
| `top_mv` | `/api/netease/top/mv` | recommend.ts |
| `top_song` | `/api/netease/top/song` | recommend.ts |
| `toplist` | `/api/netease/toplist` | recommend.ts |
| `toplist_artist` | `/api/netease/toplist/artist` | recommend.ts |
| `toplist_detail` | `/api/netease/toplist/detail` | recommend.ts |
| `toplist_detail_v2` | `/api/netease/toplist/detail/v2` | recommend.ts |

### 广播（5）

| 接口名 | HTTP 路由 | 所在组文件 |
|---|---|---|
| `broadcast_category_region_get` | `/api/netease/broadcast/category/region/get` | broadcast.ts |
| `broadcast_channel_collect_list` | `/api/netease/broadcast/channel/collect/list` | broadcast.ts |
| `broadcast_channel_currentinfo` | `/api/netease/broadcast/channel/currentinfo` | broadcast.ts |
| `broadcast_channel_list` | `/api/netease/broadcast/channel/list` | broadcast.ts |
| `broadcast_sub` | `/api/netease/broadcast/sub` | broadcast.ts |

### 云盘与声音（16）

| 接口名 | HTTP 路由 | 所在组文件 |
|---|---|---|
| `cloud` | `/api/netease/cloud` | cloud.ts |
| `cloud_import` | `/api/netease/cloud/import` | cloud.ts |
| `cloud_lyric_get` | `/api/netease/cloud/lyric/get` | cloud.ts |
| `cloud_match` | `/api/netease/cloud/match` | cloud.ts |
| `cloud_upload_complete` | `/api/netease/cloud/upload/complete` | cloud.ts |
| `cloud_upload_token` | `/api/netease/cloud/upload/token` | cloud.ts |
| `voice_delete` | `/api/netease/voice/delete` | cloud.ts |
| `voice_detail` | `/api/netease/voice/detail` | cloud.ts |
| `voice_lyric` | `/api/netease/voice/lyric` | cloud.ts |
| `voice_upload` | `/api/netease/voice/upload` | cloud.ts |
| `voicelist_detail` | `/api/netease/voicelist/detail` | cloud.ts |
| `voicelist_list` | `/api/netease/voicelist/list` | cloud.ts |
| `voicelist_list_search` | `/api/netease/voicelist/list/search` | cloud.ts |
| `voicelist_my_created` | `/api/netease/voicelist/my/created` | cloud.ts |
| `voicelist_search` | `/api/netease/voicelist/search` | cloud.ts |
| `voicelist_trans` | `/api/netease/voicelist/trans` | cloud.ts |

### 搜索（9）

| 接口名 | HTTP 路由 | 所在组文件 |
|---|---|---|
| `cloudsearch` | `/api/netease/cloudsearch` | search.ts |
| `search` | `/api/netease/search` | search.ts |
| `search_default` | `/api/netease/search/default` | search.ts |
| `search_hot` | `/api/netease/search/hot` | search.ts |
| `search_hot_detail` | `/api/netease/search/hot/detail` | search.ts |
| `search_match` | `/api/netease/search/match` | search.ts |
| `search_multimatch` | `/api/netease/search/multimatch` | search.ts |
| `search_suggest` | `/api/netease/search/suggest` | search.ts |
| `search_suggest_pc` | `/api/netease/search/suggest/pc` | search.ts |

### 评论（19）

| 接口名 | HTTP 路由 | 所在组文件 |
|---|---|---|
| `comment` | `/api/netease/comment` | comment.ts |
| `comment_add` | `/api/netease/comment/add` | comment.ts |
| `comment_album` | `/api/netease/comment/album` | comment.ts |
| `comment_delete` | `/api/netease/comment/delete` | comment.ts |
| `comment_dj` | `/api/netease/comment/dj` | comment.ts |
| `comment_event` | `/api/netease/comment/event` | comment.ts |
| `comment_floor` | `/api/netease/comment/floor` | comment.ts |
| `comment_hot` | `/api/netease/comment/hot` | comment.ts |
| `comment_hug_list` | `/api/netease/comment/hug/list` | comment.ts |
| `comment_info_list` | `/api/netease/comment/info/list` | comment.ts |
| `comment_like` | `/api/netease/comment/like` | comment.ts |
| `comment_music` | `/api/netease/comment/music` | comment.ts |
| `comment_mv` | `/api/netease/comment/mv` | comment.ts |
| `comment_new` | `/api/netease/comment/new` | comment.ts |
| `comment_playlist` | `/api/netease/comment/playlist` | comment.ts |
| `comment_reply` | `/api/netease/comment/reply` | comment.ts |
| `comment_report` | `/api/netease/comment/report` | comment.ts |
| `comment_video` | `/api/netease/comment/video` | comment.ts |
| `hug_comment` | `/api/netease/hug/comment` | comment.ts |

### 听歌数据（17）

| 接口名 | HTTP 路由 | 所在组文件 |
|---|---|---|
| `daily_signin` | `/api/netease/daily_signin` | listening.ts |
| `listen_data_realtime_report` | `/api/netease/listen/data/realtime/report` | listening.ts |
| `listen_data_report` | `/api/netease/listen/data/report` | listening.ts |
| `listen_data_song_play_rank` | `/api/netease/listen/data/song/play/rank` | listening.ts |
| `listen_data_today_song` | `/api/netease/listen/data/today/song` | listening.ts |
| `listen_data_total` | `/api/netease/listen/data/total` | listening.ts |
| `listen_data_year_report` | `/api/netease/listen/data/year/report` | listening.ts |
| `recent_listen_list` | `/api/netease/recent/listen/list` | listening.ts |
| `record_recent_album` | `/api/netease/record/recent/album` | listening.ts |
| `record_recent_dj` | `/api/netease/record/recent/dj` | listening.ts |
| `record_recent_playlist` | `/api/netease/record/recent/playlist` | listening.ts |
| `record_recent_song` | `/api/netease/record/recent/song` | listening.ts |
| `record_recent_video` | `/api/netease/record/recent/video` | listening.ts |
| `record_recent_voice` | `/api/netease/record/recent/voice` | listening.ts |
| `sign_happy_info` | `/api/netease/sign/happy/info` | listening.ts |
| `signin_progress` | `/api/netease/signin/progress` | listening.ts |
| `summary_annual` | `/api/netease/summary/annual` | listening.ts |

### 用户信息（30）

| 接口名 | HTTP 路由 | 所在组文件 |
|---|---|---|
| `device_kickoff` | `/api/netease/device/kickoff` | user.ts |
| `device_list` | `/api/netease/device/list` | user.ts |
| `get_userids` | `/api/netease/get/userids` | user.ts |
| `user_account` | `/api/netease/user/account` | user.ts |
| `user_audio` | `/api/netease/user/audio` | user.ts |
| `user_cloud` | `/api/netease/user/cloud` | user.ts |
| `user_cloud_del` | `/api/netease/user/cloud/del` | user.ts |
| `user_cloud_detail` | `/api/netease/user/cloud/detail` | user.ts |
| `user_comment_history` | `/api/netease/user/comment/history` | user.ts |
| `user_detail` | `/api/netease/user/detail` | user.ts |
| `user_detail_new` | `/api/netease/user/detail/new` | user.ts |
| `user_dj` | `/api/netease/user/dj` | user.ts |
| `user_event` | `/api/netease/user/event` | user.ts |
| `user_event_all` | `/api/netease/user/event/all` | user.ts |
| `user_follow_mixed` | `/api/netease/user/follow/mixed` | user.ts |
| `user_followeds` | `/api/netease/user/followeds` | user.ts |
| `user_follows` | `/api/netease/user/follows` | user.ts |
| `user_level` | `/api/netease/user/level` | user.ts |
| `user_medal` | `/api/netease/user/medal` | user.ts |
| `user_mutualfollow_get` | `/api/netease/user/mutualfollow/get` | user.ts |
| `user_playlist` | `/api/netease/user/playlist` | user.ts |
| `user_playlist_collect` | `/api/netease/user/playlist/collect` | user.ts |
| `user_playlist_create` | `/api/netease/user/playlist/create` | user.ts |
| `user_record` | `/api/netease/user/record` | user.ts |
| `user_social_status` | `/api/netease/user/social/status` | user.ts |
| `user_social_status_edit` | `/api/netease/user/social/status/edit` | user.ts |
| `user_social_status_rcmd` | `/api/netease/user/social/status/rcmd` | user.ts |
| `user_social_status_support` | `/api/netease/user/social/status/support` | user.ts |
| `user_subcount` | `/api/netease/user/subcount` | user.ts |
| `user_update` | `/api/netease/user/update` | user.ts |

### 播客与DJ（30）

| 接口名 | HTTP 路由 | 所在组文件 |
|---|---|---|
| `djRadio_top` | `/api/netease/djRadio/top` | dj.ts |
| `dj_banner` | `/api/netease/dj/banner` | dj.ts |
| `dj_category_excludehot` | `/api/netease/dj/category/excludehot` | dj.ts |
| `dj_category_recommend` | `/api/netease/dj/category/recommend` | dj.ts |
| `dj_catelist` | `/api/netease/dj/catelist` | dj.ts |
| `dj_detail` | `/api/netease/dj/detail` | dj.ts |
| `dj_difm_all_style_channel` | `/api/netease/dj/difm/all/style/channel` | dj.ts |
| `dj_difm_channel_subscribe` | `/api/netease/dj/difm/channel/subscribe` | dj.ts |
| `dj_difm_channel_unsubscribe` | `/api/netease/dj/difm/channel/unsubscribe` | dj.ts |
| `dj_difm_playing_tracks_list` | `/api/netease/dj/difm/playing/tracks/list` | dj.ts |
| `dj_difm_subscribe_channels_get` | `/api/netease/dj/difm/subscribe/channels/get` | dj.ts |
| `dj_hot` | `/api/netease/dj/hot` | dj.ts |
| `dj_paygift` | `/api/netease/dj/paygift` | dj.ts |
| `dj_personalize_recommend` | `/api/netease/dj/personalize/recommend` | dj.ts |
| `dj_program` | `/api/netease/dj/program` | dj.ts |
| `dj_program_detail` | `/api/netease/dj/program/detail` | dj.ts |
| `dj_program_toplist` | `/api/netease/dj/program/toplist` | dj.ts |
| `dj_program_toplist_hours` | `/api/netease/dj/program/toplist/hours` | dj.ts |
| `dj_radio_hot` | `/api/netease/dj/radio/hot` | dj.ts |
| `dj_recommend` | `/api/netease/dj/recommend` | dj.ts |
| `dj_recommend_type` | `/api/netease/dj/recommend/type` | dj.ts |
| `dj_sub` | `/api/netease/dj/sub` | dj.ts |
| `dj_sublist` | `/api/netease/dj/sublist` | dj.ts |
| `dj_subscriber` | `/api/netease/dj/subscriber` | dj.ts |
| `dj_today_perfered` | `/api/netease/dj/today/perfered` | dj.ts |
| `dj_toplist` | `/api/netease/dj/toplist` | dj.ts |
| `dj_toplist_hours` | `/api/netease/dj/toplist/hours` | dj.ts |
| `dj_toplist_newcomer` | `/api/netease/dj/toplist/newcomer` | dj.ts |
| `dj_toplist_pay` | `/api/netease/dj/toplist/pay` | dj.ts |
| `dj_toplist_popular` | `/api/netease/dj/toplist/popular` | dj.ts |

### 动态与社交（16）

| 接口名 | HTTP 路由 | 所在组文件 |
|---|---|---|
| `event` | `/api/netease/event` | social.ts |
| `event_del` | `/api/netease/event/del` | social.ts |
| `event_forward` | `/api/netease/event/forward` | social.ts |
| `event_privacy` | `/api/netease/event/privacy` | social.ts |
| `follow` | `/api/netease/follow` | social.ts |
| `msg_comments` | `/api/netease/msg/comments` | social.ts |
| `msg_forwards` | `/api/netease/msg/forwards` | social.ts |
| `msg_notices` | `/api/netease/msg/notices` | social.ts |
| `msg_private` | `/api/netease/msg/private` | social.ts |
| `msg_private_history` | `/api/netease/msg/private/history` | social.ts |
| `msg_recentcontact` | `/api/netease/msg/recentcontact` | social.ts |
| `send_album` | `/api/netease/send/album` | social.ts |
| `send_playlist` | `/api/netease/send/playlist` | social.ts |
| `send_song` | `/api/netease/send/song` | social.ts |
| `send_text` | `/api/netease/send/text` | social.ts |
| `share_resource` | `/api/netease/share/resource` | social.ts |

### 粉丝中心（5）

| 接口名 | HTTP 路由 | 所在组文件 |
|---|---|---|
| `fanscenter_basicinfo_age_get` | `/api/netease/fanscenter/basicinfo/age/get` | fanscenter.ts |
| `fanscenter_basicinfo_gender_get` | `/api/netease/fanscenter/basicinfo/gender/get` | fanscenter.ts |
| `fanscenter_basicinfo_province_get` | `/api/netease/fanscenter/basicinfo/province/get` | fanscenter.ts |
| `fanscenter_overview_get` | `/api/netease/fanscenter/overview/get` | fanscenter.ts |
| `fanscenter_trend_list` | `/api/netease/fanscenter/trend/list` | fanscenter.ts |

### 私人FM（3）

| 接口名 | HTTP 路由 | 所在组文件 |
|---|---|---|
| `fm_trash` | `/api/netease/fm_trash` | fm.ts |
| `personal_fm` | `/api/netease/personal_fm` | fm.ts |
| `personal_fm_mode` | `/api/netease/personal/fm/mode` | fm.ts |

### 一起听（9）

| 接口名 | HTTP 路由 | 所在组文件 |
|---|---|---|
| `listentogether_accept` | `/api/netease/listentogether/accept` | listentogether.ts |
| `listentogether_end` | `/api/netease/listentogether/end` | listentogether.ts |
| `listentogether_heatbeat` | `/api/netease/listentogether/heatbeat` | listentogether.ts |
| `listentogether_play_command` | `/api/netease/listentogether/play/command` | listentogether.ts |
| `listentogether_room_check` | `/api/netease/listentogether/room/check` | listentogether.ts |
| `listentogether_room_create` | `/api/netease/listentogether/room/create` | listentogether.ts |
| `listentogether_status` | `/api/netease/listentogether/status` | listentogether.ts |
| `listentogether_sync_list_command` | `/api/netease/listentogether/sync/list/command` | listentogether.ts |
| `listentogether_sync_playlist_get` | `/api/netease/listentogether/sync/playlist/get` | listentogether.ts |

### MV与视频（22）

| 接口名 | HTTP 路由 | 所在组文件 |
|---|---|---|
| `mlog_music_rcmd` | `/api/netease/mlog/music/rcmd` | video.ts |
| `mlog_to_video` | `/api/netease/mlog/to/video` | video.ts |
| `mlog_url` | `/api/netease/mlog/url` | video.ts |
| `mv_all` | `/api/netease/mv/all` | video.ts |
| `mv_detail` | `/api/netease/mv/detail` | video.ts |
| `mv_detail_info` | `/api/netease/mv/detail/info` | video.ts |
| `mv_exclusive_rcmd` | `/api/netease/mv/exclusive/rcmd` | video.ts |
| `mv_first` | `/api/netease/mv/first` | video.ts |
| `mv_sub` | `/api/netease/mv/sub` | video.ts |
| `mv_sublist` | `/api/netease/mv/sublist` | video.ts |
| `mv_url` | `/api/netease/mv/url` | video.ts |
| `related_allvideo` | `/api/netease/related/allvideo` | video.ts |
| `simi_mv` | `/api/netease/simi/mv` | video.ts |
| `video_category_list` | `/api/netease/video/category/list` | video.ts |
| `video_detail` | `/api/netease/video/detail` | video.ts |
| `video_detail_info` | `/api/netease/video/detail/info` | video.ts |
| `video_group` | `/api/netease/video/group` | video.ts |
| `video_group_list` | `/api/netease/video/group/list` | video.ts |
| `video_sub` | `/api/netease/video/sub` | video.ts |
| `video_timeline_all` | `/api/netease/video/timeline/all` | video.ts |
| `video_timeline_recommend` | `/api/netease/video/timeline/recommend` | video.ts |
| `video_url` | `/api/netease/video/url` | video.ts |

### 音乐人（8）

| 接口名 | HTTP 路由 | 所在组文件 |
|---|---|---|
| `musician_cloudbean` | `/api/netease/musician/cloudbean` | musician.ts |
| `musician_cloudbean_obtain` | `/api/netease/musician/cloudbean/obtain` | musician.ts |
| `musician_data_overview` | `/api/netease/musician/data/overview` | musician.ts |
| `musician_play_trend` | `/api/netease/musician/play/trend` | musician.ts |
| `musician_sign` | `/api/netease/musician/sign` | musician.ts |
| `musician_tasks` | `/api/netease/musician/tasks` | musician.ts |
| `musician_tasks_new` | `/api/netease/musician/tasks/new` | musician.ts |
| `musician_vip_tasks` | `/api/netease/musician/vip/tasks` | musician.ts |

### 歌单（30）

| 接口名 | HTTP 路由 | 所在组文件 |
|---|---|---|
| `playlist_category_list` | `/api/netease/playlist/category/list` | playlist.ts |
| `playlist_catlist` | `/api/netease/playlist/catlist` | playlist.ts |
| `playlist_cover_update` | `/api/netease/playlist/cover/update` | playlist.ts |
| `playlist_create` | `/api/netease/playlist/create` | playlist.ts |
| `playlist_delete` | `/api/netease/playlist/delete` | playlist.ts |
| `playlist_desc_update` | `/api/netease/playlist/desc/update` | playlist.ts |
| `playlist_detail` | `/api/netease/playlist/detail` | playlist.ts |
| `playlist_detail_dynamic` | `/api/netease/playlist/detail/dynamic` | playlist.ts |
| `playlist_detail_rcmd_get` | `/api/netease/playlist/detail/rcmd/get` | playlist.ts |
| `playlist_highquality_tags` | `/api/netease/playlist/highquality/tags` | playlist.ts |
| `playlist_hot` | `/api/netease/playlist/hot` | playlist.ts |
| `playlist_import_name_task_create` | `/api/netease/playlist/import/name/task/create` | playlist.ts |
| `playlist_import_task_status` | `/api/netease/playlist/import/task/status` | playlist.ts |
| `playlist_mylike` | `/api/netease/playlist/mylike` | playlist.ts |
| `playlist_name_update` | `/api/netease/playlist/name/update` | playlist.ts |
| `playlist_order_update` | `/api/netease/playlist/order/update` | playlist.ts |
| `playlist_privacy` | `/api/netease/playlist/privacy` | playlist.ts |
| `playlist_subscribe` | `/api/netease/playlist/subscribe` | playlist.ts |
| `playlist_subscribers` | `/api/netease/playlist/subscribers` | playlist.ts |
| `playlist_tags_update` | `/api/netease/playlist/tags/update` | playlist.ts |
| `playlist_track_add` | `/api/netease/playlist/track/add` | playlist.ts |
| `playlist_track_all` | `/api/netease/playlist/track/all` | playlist.ts |
| `playlist_track_delete` | `/api/netease/playlist/track/delete` | playlist.ts |
| `playlist_tracks` | `/api/netease/playlist/tracks` | playlist.ts |
| `playlist_update` | `/api/netease/playlist/update` | playlist.ts |
| `playlist_update_playcount` | `/api/netease/playlist/update/playcount` | playlist.ts |
| `playlist_video_recent` | `/api/netease/playlist/video/recent` | playlist.ts |
| `related_playlist` | `/api/netease/related/playlist` | playlist.ts |
| `top_playlist` | `/api/netease/top/playlist` | playlist.ts |
| `top_playlist_highquality` | `/api/netease/top/playlist/highquality` | playlist.ts |

### VIP中心（13）

| 接口名 | HTTP 路由 | 所在组文件 |
|---|---|---|
| `vip_growthpoint` | `/api/netease/vip/growthpoint` | vip.ts |
| `vip_growthpoint_details` | `/api/netease/vip/growthpoint/details` | vip.ts |
| `vip_growthpoint_get` | `/api/netease/vip/growthpoint/get` | vip.ts |
| `vip_growthpoint_getall` | `/api/netease/vip/growthpoint/getall` | vip.ts |
| `vip_info` | `/api/netease/vip/info` | vip.ts |
| `vip_info_v2` | `/api/netease/vip/info/v2` | vip.ts |
| `vip_sign` | `/api/netease/vip/sign` | vip.ts |
| `vip_sign_detail` | `/api/netease/vip/sign/detail` | vip.ts |
| `vip_sign_history` | `/api/netease/vip/sign/history` | vip.ts |
| `vip_sign_info` | `/api/netease/vip/sign/info` | vip.ts |
| `vip_tasks` | `/api/netease/vip/tasks` | vip.ts |
| `vip_tasks_v1` | `/api/netease/vip/tasks/v1` | vip.ts |
| `vip_timemachine` | `/api/netease/vip/timemachine` | vip.ts |

### 云贝（14）

| 接口名 | HTTP 路由 | 所在组文件 |
|---|---|---|
| `yunbei` | `/api/netease/yunbei` | yunbei.ts |
| `yunbei_expense` | `/api/netease/yunbei/expense` | yunbei.ts |
| `yunbei_info` | `/api/netease/yunbei/info` | yunbei.ts |
| `yunbei_rcmd_song` | `/api/netease/yunbei/rcmd/song` | yunbei.ts |
| `yunbei_rcmd_song_history` | `/api/netease/yunbei/rcmd/song/history` | yunbei.ts |
| `yunbei_receipt` | `/api/netease/yunbei/receipt` | yunbei.ts |
| `yunbei_sign` | `/api/netease/yunbei/sign` | yunbei.ts |
| `yunbei_task_finish` | `/api/netease/yunbei/task/finish` | yunbei.ts |
| `yunbei_task_finish_v1` | `/api/netease/yunbei/task/finish/v1` | yunbei.ts |
| `yunbei_task_list_v1` | `/api/netease/yunbei/task/list/v1` | yunbei.ts |
| `yunbei_task_recommend_song` | `/api/netease/yunbei/task/recommend/song` | yunbei.ts |
| `yunbei_tasks` | `/api/netease/yunbei/tasks` | yunbei.ts |
| `yunbei_tasks_todo` | `/api/netease/yunbei/tasks/todo` | yunbei.ts |
| `yunbei_today` | `/api/netease/yunbei/today` | yunbei.ts |

---

## 类型安全边界声明（审核 5.3 / A-26 豁免登记）

> 依据《商业化上线审核标准》5.3"any 仅限与上游交互的边界处且收敛在 adapter 层"，`lib/netease/` 目录（含 `modules/` 生成文件）整体定位为 [NeteaseCloudMusicApiEnhanced/api-enhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced)（MIT）的 **adapter 移植层**，登记以下整目录豁免，替代逐处修改：

- **豁免范围**：`lib/netease/**`（运行时 request/crypto/option/logger + `modules/` 23 个组文件）中约 73+ 处 `any` / `as any` / `Record<string, any>`。性质为上游 JS 库的动态结构边界（加密通道参数、上游响应体、模块 query），与被仿对象逐一核对签名后保留。
- **不改写 `modules/` 生成文件的约束**：`lib/netease/modules/*.ts` 由 `scripts/convert-netease-modules.mjs` 自动转换生成（文件头标注"请勿手工修改"），其中 `process.env.PROXY_URL` / `ENABLE_PROXY` 直读（song.ts 等）维持上游语义原样保留；如需收敛应改转换脚本并重新生成，而非手改产物。手工维护部分（request.ts / option.ts / logger.ts / checktoken.ts 等）的环境变量已接入 `lib/env.ts` 集中读取（审核 A-27）。
- **防护锚点**：注册表完整性由 `tests/netease-registry.test.ts`（439 项防遗漏/防路由漂移）锚定；`tsc --noEmit` 全仓零错误（该目录不含 `@ts-nocheck` / 文件级 eslint-disable，豁免仅为 any 收敛策略的登记，非类型检查豁免）。
- **约束**：新代码不得再引入新的非边界 `any`；上游同步再生成时需重跑 `npx tsc --noEmit` 与注册表测试。

