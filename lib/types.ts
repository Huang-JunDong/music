/** 通用模型 — 逐字段对齐 music-lib/model（Song / Playlist / PlaylistCategory / QRLogin） */

export interface Song {
  id: string;
  name: string;
  artist: string;
  album: string;
  /** 某些源特有，用于获取封面 */
  album_id?: string;
  /** 秒 */
  duration: number;
  /** 字节 */
  size: number;
  /** kbps */
  bitrate: number;
  /** netease / qq / kugou / kuwo / migu / qianqian / soda / fivesing / jamendo / joox / bilibili / apple / local */
  source: string;
  /** 真实音频直链（解析后填充） */
  url?: string;
  /** 文件后缀 mp3 / flac ... */
  ext?: string;
  cover: string;
  /** 歌曲原始网页链接 */
  link: string;
  /** 源特有元数据 */
  extra?: Record<string, string>;
  /** Probe 探测后标记无效 */
  is_invalid?: boolean;
  /** 付费 / VIP 曲目标记 */
  is_vip?: boolean;
}

export interface Playlist {
  id: string;
  name: string;
  cover: string;
  track_count: number;
  play_count: number;
  creator: string;
  description: string;
  source: string;
  link: string;
  extra?: Record<string, string>;
}

export interface PlaylistCategory {
  id: string;
  name: string;
  group: string;
  source: string;
  count: number;
  hot?: boolean;
  extra?: Record<string, string>;
}

export type QRLoginStatus = "waiting" | "scanned" | "success" | "expired" | "failed";

export interface QRLoginSession {
  source: string;
  key: string;
  url: string;
  image_url?: string;
  state?: string;
  expires_at?: number;
  extra?: Record<string, string>;
}

export interface QRLoginResult {
  source: string;
  key: string;
  status: QRLoginStatus;
  message?: string;
  cookie?: string;
  cookies?: Record<string, string>;
  extra?: Record<string, string>;
}

/** 上游明确的业务拒绝（密码错误/验证码错误/频率限制等客户端可纠正的错误）。
 *  路由层捕获后映射 400（区别于网络/服务故障的 502），msg 面向用户可读。 */
export class UpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamError";
  }
}

/** Playlist+Song 组合（ParsePlaylist / ParseAlbum 返回） */
export interface PlaylistDetail {
  playlist: Playlist;
  songs: Song[];
}

/** 歌手条目（网易 /api/v1/artist/{id} · QQ UnifiedHomepage 的跨源归一化） */
export interface Artist {
  source: string;
  /** NCM artistId（数字）/ QQ singerMid */
  id: string;
  name: string;
  avatar?: string;
  alias?: string;
  brief?: string;
  song_count?: number;
  album_count?: number;
  mv_count?: number;
  link?: string;
  extra?: Record<string, string>;
}

/** 歌手主页首屏聚合（详情 + 热门歌曲一次拉齐） */
export interface ArtistOverview {
  artist: Artist;
  top_songs: Song[];
}

/** 热搜词条目（网易 /search/hot/detail · QQ HotkeyService 的跨源归一化） */
export interface HotSearch {
  source: string;
  keyword: string;
  score?: number;
  cover?: string;
  description?: string;
}

/** 首页轮播 Banner（网易 /api/v2/banner/get） */
export interface Banner {
  source: string;
  image: string;
  title?: string;
  /** 分类角标（歌曲/歌单/专辑/独家…） */
  tag?: string;
  link?: string;
  /** 站内跳转目标（song 走外链） */
  target?: { type: "playlist" | "album" | "mv"; id: string };
}

/** 签到中心状态（网易专属：每日经验签到 / 云贝签到 / VIP 乐签） */
export interface CheckinStatus {
  /** 每日签到（+经验）；progress 为当月已签日期数字列表 */
  daily?: { signed: boolean; progress: number[] };
  /** 云贝签到 */
  yunbei?: { signed: boolean };
  /** VIP 乐签 */
  vip?: { signed: boolean; total_days?: number };
  /** 需登录网易账号（任一接口 301） */
  need_login?: boolean;
}

/** 源账号登录档案（昵称/头像增强） */
export interface SourceLoginProfile {
  logged_in: boolean;
  nickname?: string;
  avatar?: string;
}

/* =============== P1：用户资产与报告（Wave A） =============== */

/** 用户主页资料（网易 user_detail/user_detail_new/user_level/user_subcount · QQ 登录档案） */
export interface UserProfile {
  source: string;
  id: string;
  nickname: string;
  avatar?: string;
  signature?: string;
  /** 网易等级（QQ 无公开等级体系） */
  level?: number;
  /** 等级进度：当前听歌数 / 下一级所需听歌数 */
  level_progress?: { now: number; next: number };
  listen_song_count?: number;
  create_playlist_count?: number;
  collected_playlist_count?: number;
  follow_count?: number;
  followed_count?: number;
  event_count?: number;
  gender?: number;
  /** 注册至今天数 */
  create_days?: number;
  link?: string;
}

/** VIP 会员信息（网易 vip_info/vip_info_v2/vip_sign_detail/vip_sign_history · QQ vip_login_base） */
export interface UserVipInfo {
  source: string;
  is_vip: boolean;
  /** 会员类型文案（黑胶VIP / 豪华绿钻…） */
  vip_name?: string;
  icon_url?: string;
  /** 到期时间（秒级时间戳） */
  expire_at?: number;
  /** 会员/乐签累计天数 */
  total_days?: number;
  /** 今日是否已签（网易乐签） */
  signed_today?: boolean;
  /** 成长值/成长点 */
  /* 审核整改 R2-#12：移除 growthpoint 死字段（无 provider 产出、无前端消费） */
}

/** 关注/粉丝/互关用户条目（网易 user_follows/user_followeds/user_mutualfollow_get） */
export interface FollowUser {
  source: string;
  id: string;
  nickname: string;
  avatar?: string;
  signature?: string;
  /** 相互关注 */
  mutual?: boolean;
  link?: string;
}

export interface UserFollowsResult {
  users: FollowUser[];
  has_more: boolean;
}

/** 播放排行条目（网易 user_record 周/全部 · listen_data_song_play_rank） */
export interface PlayRecordItem {
  song: Song;
  play_count: number;
  score?: number;
}

/** 听歌数据画像（网易 listen_data_total/today_song · QQ GetProfileReport 音乐基因） */
export interface ListenStats {
  source: string;
  total_listen_days?: number;
  total_listen_count?: number;
  /** 累计收听时长（秒；网易 listen_data_total.totalDuration） */
  total_listen_duration?: number;
  today_listen_count?: number;
  today_songs?: { song: Song; count: number }[];
  /** 画像标签卡片（QQ 音乐基因 / 网易听歌画像） */
  gene_tags?: { name: string; value: string }[];
  /** 最近收听总数（网易 recent_listen_list） */
  recent_listen_count?: number;
}

/** 报告卡片段（网易 summary_annual / listen_data_year_report 的结构化呈现） */
export interface ReportSection {
  key: string;
  title: string;
  cards: { label: string; value: string }[];
}

/** 历史每日推荐（网易 history_recommend_songs/_detail 回忆杀） */
export interface HistoryDailyRecommend {
  date: string;
  songs: Song[];
}

/* =============== P1 Wave B：内容扩展（播客/曲风/云盘/发现） =============== */

/** 播客电台分类（网易 dj_catelist / dj_category_excludehot / dj_category_recommend） */
export interface DjCategory {
  id: string;
  name: string;
  /** 分类下的推荐电台数 */
  radio_count?: number;
  hot?: boolean;
}

/** 播客电台条目（网易 dj_recommend / dj_hot / dj_radio_hot / dj_recommend_type / dj_today_perfered） */
export interface DjRadio {
  id: string;
  name: string;
  pic_url?: string;
  category?: string;
  /** 主播昵称 */
  dj?: string;
  description?: string;
  /** 节目数 */
  program_count?: number;
  /** 订阅数 */
  sub_count?: number;
  play_count?: number;
  /** 电台最新一期节目（可作试听） */
  last_program?: DjProgram;
  link?: string;
}

/** 播客节目（网易 dj_program / dj_program_detail；主歌曲可直接入播放队列） */
export interface DjProgram {
  id: string;
  radio_id?: string;
  name: string;
  cover?: string;
  description?: string;
  duration: number;
  listener_count?: number;
  liked_count?: number;
  publish_time?: string;
  /** 节目主歌曲（可播放） */
  song?: Song;
}

/** 曲风标签（网易 style_list：两级树） */
export interface StyleTag {
  id: string;
  name: string;
  /** 父曲风 id（顶层为空） */
  parent_id?: string;
  /** 是否热门曲风 */
  hot?: boolean;
}

/** 曲风详情页数据（网易 style_detail + 四类资源分参加载） */
export interface StyleDetail {
  id: string;
  name: string;
  description?: string;
  /** 曲风代表封面拼图 */
  covers?: string[];
}

/** 云盘歌曲（网易 cloud/user_cloud：歌曲 + 云盘统计与匹配信息） */
export interface CloudSong {
  song: Song;
  /** 文件名（云盘原始文件） */
  filename?: string;
  /** 文件大小（字节） */
  file_size?: number;
  add_time?: string;
  /** 云盘歌曲 id（simpleSong 之外的云盘标识） */
  cloud_id?: string;
  /** 匹配状态文案 */
  match_state?: string;
}

export interface CloudListResult {
  songs: CloudSong[];
  has_more: boolean;
  /** 云盘空间统计（字节） */
  size?: number;
  max_size?: number;
}

/** 发现页聚合区块（网易 homepage_block_page · QQ get_home_feed 的统一区块） */
export interface DiscoverBlock {
  key: string;
  title: string;
  /** 横滑卡片（歌单/专辑/MV 链接目标由 extra 区分） */
  playlists?: Playlist[];
  songs?: Song[];
  mvs?: MvItem[];
  banners?: Banner[];
}

/** 精品歌单标签（网易 playlist_highquality_tags） */
export interface HighqualityTag {
  id: string;
  name: string;
  hot?: boolean;
}

/* =============== P1 Wave C：体验增强（百科/关注/评论/播放/搜索/账号/MV） =============== */

/** 歌曲创作人员（网易 song_creators · QQ SongProducer） */
export interface SongCreator {
  name: string;
  /** 角色：作词/作曲/编曲/制作… */
  role: string;
}

/** 歌曲百科聚合（播放页"百科"Tab） */
export interface SongWiki {
  source: string;
  song_id: string;
  /** 图文段落（网易 song_wiki_info/summary） */
  sections: { title: string; content: string }[];
  creators?: SongCreator[];
  /** 发行/时长/质量元信息（网易 song_music_detail） */
  meta?: { label: string; value: string }[];
  /** 精彩（红）评论数（网易 song_red_count） */
  hot_comment_count?: number;
  /** 曲风/语种/场景标签（QQ GetSongLabels） */
  labels?: string[];
  /** 其他版本：Live/伴奏/翻唱（QQ getOtherVersion，可点击切歌） */
  other_versions?: Song[];
  producer?: string;
  /** 版权受限时的替代推荐（网易 song_copyright_rcmd） */
  substitutes?: Song[];
}

/** 已关注歌手（网易 artist_sublist · QQ GetFollowSingerList） */
export interface FollowedArtist extends Artist {
  /** 粉丝数（网易 artist_follow_count 同源） */
  follower_count?: number;
}

/** 最优匹配直达卡（搜索页顶部） */
export interface SearchMatchCard {
  type: "song" | "artist" | "album" | "playlist";
  id: string;
  name: string;
  cover?: string;
  artist?: string;
}

/** 多类型匹配（网易 search_multimatch · QQ quickSearch/generalSearch 聚合） */
export interface SearchMultimatch {
  card?: SearchMatchCard;
  songs?: Song[];
  artists?: Artist[];
  albums?: Playlist[];
  playlists?: Playlist[];
  has_more?: boolean;
}

/** 国际区号（网易 countries_code_list） */
export interface CountryCode {
  code: string;
  name: string;
  zh_name?: string;
}

/** 评论资源目标（多资源评论区：song/album/playlist/mv/video/dj） */
export interface CommentTarget {
  type: "song" | "album" | "playlist" | "mv" | "video" | "dj";
  id: string;
}

/** 评论条目（网易 /api/v1/resource/comments · QQ music.comment.CommentComment 的跨源归一化） */
export interface CommentItem {
  id: string;
  content: string;
  user: string;
  avatar?: string;
  /** 发布时间（ISO 或相对文本） */
  time: string;
  liked_count: number;
  /** 回复对象摘要（"@某某：内容"中的对象） */
  reply_to?: { user: string; content: string };
  /** IP 属地（网易 ipLocation） */
  location?: string;
  /** 评论作者 id（网易 userId · 抱抱 hug_comment 需要） */
  user_id?: string;
  /** 楼层回复数（comment_new 返回；>0 时可展开楼层） */
  reply_count?: number;
}

export interface CommentListResult {
  comments: CommentItem[];
  total: number;
  has_more: boolean;
}

/** MV 条目（网易 /api/mv/* · QQ video.VideoDataServer 的跨源归一化） */
export interface MvItem {
  source: string;
  /** NCM mvid（数字）/ QQ vid（字符串） */
  id: string;
  name: string;
  artist: string;
  cover: string;
  /** 秒 */
  duration: number;
  play_count: number;
  /** 发行/发布日期文本（YYYY-MM-DD） */
  publish_time?: string;
  link?: string;
  extra?: Record<string, string>;
}

/** MV 列表 tab：latest 最新 / exclusive 网易出品 / top MV榜 / all 全部（带筛选） */
export type MvListTab = "latest" | "exclusive" | "top" | "all";

export interface MvListOptions {
  tab?: MvListTab;
  /** 中文地区：全部/内地/港台/欧美/日本/韩国（各源自行映射枚举） */
  area?: string;
  page: number;
  limit: number;
}

export interface MvListResult {
  mvs: MvItem[];
  has_more: boolean;
}

/** 排行榜（网易云 /toplist · QQ musicToplist.Toplist.GetAll 的跨源归一化） */
export interface Toplist {
  source: string;
  id: string;
  name: string;
  cover: string;
  /** 更新频率文案（网易"刚刚更新"）或时间文本（QQ updateTime） */
  update_time?: string;
  description?: string;
  /** 前三名摘要：如 ["歌曲A - 歌手甲", ...]（网易 tracks first/second、QQ song 预览） */
  highlights?: string[];
  /** 榜单所属分组（QQ groupName / 网易云无分组 → "官方榜"等自定义） */
  group?: string;
  play_count?: number;
  track_count?: number;
  link?: string;
  extra?: Record<string, string>;
}

/**
 * 播放/下载音质偏好 — 跨源统一抽象（QQ 七档阶梯 / 网易 level 的归一化）：
 * - standard：标准 128k（省流量）
 * - high：较高 320k 封顶
 * - lossless：无损 FLAC 封顶
 * - best：最高档自动降级（默认，等价于不传）
 * provider 各自映射档位；不支持档位选择的源忽略该参数。
 */
export type SongQuality = "standard" | "high" | "lossless" | "best";

/** quality 参数清洗：非法值归一为 undefined（= best 默认行为） */
export function normalizeSongQuality(value: unknown): SongQuality | undefined {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "standard" || v === "high" || v === "lossless" || v === "best" ? v : undefined;
}

/**
 * Provider 完整契约 — 对齐 music-lib/provider/interface.go 的 FullMusicProvider。
 * 可选能力用 `?` 表达：不支持时保持 undefined，路由层据此返回“该源不支持”。
 */
export interface MusicProvider {
  name: string;
  label: string;
  /** 是否支持无损 flac */
  supportsFlac?: boolean;
  /** SongSearcher */
  search(keyword: string): Promise<Song[]>;
  /** SongParser（单曲分享链接 → Song） */
  parse?(link: string): Promise<Song>;
  /** SongDownloader：返回可直接请求的音频直链（quality 为音质偏好，源不支持时忽略） */
  getStreamUrl(song: Song, quality?: SongQuality): Promise<string>;
  /** LyricProvider：返回 LRC 文本 */
  getLyric?(song: Song): Promise<string>;
  /** AlbumProvider */
  searchAlbum?(keyword: string): Promise<Playlist[]>;
  getAlbumSongs?(id: string): Promise<Song[]>;
  parseAlbum?(link: string): Promise<PlaylistDetail>;
  /** PlaylistProvider */
  searchPlaylist?(keyword: string): Promise<Playlist[]>;
  getPlaylistSongs?(id: string): Promise<Song[]>;
  parsePlaylist?(link: string): Promise<PlaylistDetail>;
  /** RecommendedPlaylistProvider */
  getRecommendedPlaylists?(): Promise<Playlist[]>;
  /** PlaylistCategoryProvider */
  getPlaylistCategories?(): Promise<PlaylistCategory[]>;
  getCategoryPlaylists?(categoryId: string, page: number, limit: number): Promise<Playlist[]>;
  /** ToplistProvider（排行榜） */
  getToplists?(): Promise<Toplist[]>;
  getToplistSongs?(toplistId: string): Promise<Song[]>;
  /** MvProvider（MV） */
  getMvList?(opts: MvListOptions): Promise<MvListResult>;
  getMvDetail?(mvId: string): Promise<MvItem>;
  /** resolution 为清晰度偏好（480/720/1080，源不支持时忽略） */
  getMvUrl?(mvId: string, resolution?: number): Promise<string>;
  /** ArtistProvider（歌手主页） */
  getArtistOverview?(artistId: string): Promise<ArtistOverview>;
  getArtistSongs?(artistId: string, page: number, limit: number): Promise<{ songs: Song[]; has_more: boolean }>;
  getArtistAlbums?(artistId: string, page: number, limit: number): Promise<{ albums: Playlist[]; has_more: boolean }>;
  getArtistMvs?(artistId: string, page: number, limit: number): Promise<{ mvs: MvItem[]; has_more: boolean }>;
  getSimilarArtists?(artistId: string): Promise<Artist[]>;
  /** SearchEnhancementProvider（热搜/联想/歌手搜索/默认搜索词） */
  getHotSearches?(): Promise<HotSearch[]>;
  getSearchSuggest?(keyword: string): Promise<string[]>;
  /** 默认搜索词（网易 search_default；QQ 无独立接口，用热搜首位） */
  getDefaultSearchKeyword?(): Promise<string | null>;
  searchArtists?(keyword: string): Promise<Artist[]>;
  /** FmProvider（私人电台：网易 personal_fm · QQ 雷达推荐） */
  getFmSongs?(mode?: string): Promise<Song[]>;
  trashFmSong?(songId: string): Promise<void>;
  /** CommentProvider（歌曲评论） */
  getSongComments?(song: Song, opts: { sort: "hot" | "new"; page: number; limit: number }): Promise<CommentListResult>;
  addSongComment?(song: Song, content: string, replyTo?: string): Promise<void>;
  /** 删除自己的评论（上游校验仅本人评论可删） */
  deleteSongComment?(song: Song, commentId: string): Promise<void>;
  /** LikeProvider（源站红心：网易 like · QQ 我喜欢歌单 dirid=201） */
  getLikeList?(): Promise<string[]>;
  likeSong?(song: Song, like: boolean): Promise<void>;
  /** AlbumDiscoveryProvider（新碟架：网易 album_new/sub/sublist · QQ newalbum.NewAlbumServer） */
  getNewAlbums?(opts: { area?: string; page: number; limit: number }): Promise<{ albums: Playlist[]; has_more: boolean }>;
  getFavAlbums?(page: number, limit: number): Promise<{ albums: Playlist[]; has_more: boolean }>;
  /** album 携带 extra.album_id（QQ 数字 ID） */
  subAlbum?(album: Playlist, sub: boolean): Promise<void>;
  /** CheckinProvider（签到中心，网易专属） */
  getCheckinStatus?(): Promise<CheckinStatus>;
  doCheckin?(kind: "daily" | "yunbei" | "vip"): Promise<void>;
  /** DiscoveryProvider（首页发现：banner / 新歌速递 / 每日推荐） */
  getBanners?(): Promise<Banner[]>;
  getNewSongs?(): Promise<Song[]>;
  getDailySongs?(): Promise<Song[]>;
  /** SimilarProvider（相似推荐：相似歌曲 / 包含此歌的歌单） */
  getSimilarSongs?(song: Song): Promise<Song[]>;
  getRelatedPlaylists?(song: Song): Promise<Playlist[]>;
  /** RecentProvider（源账号最近播放 + 听歌埋点，网易专属） */
  getRecentSongs?(limit: number): Promise<Song[]>;
  getRecentAlbums?(limit: number): Promise<Playlist[]>;
  getRecentPlaylists?(limit: number): Promise<Playlist[]>;
  scrobbleSong?(song: Pick<Song, "id" | "duration" | "source">): Promise<void>;
  /** PlaylistManageProvider（源站歌单管理：创建/删除/加歌/删歌，需登录） */
  createPlaylist?(name: string): Promise<string>;
  deletePlaylist?(playlistId: string): Promise<void>;
  addSongsToPlaylist?(playlistId: string, songs: Song[]): Promise<void>;
  removeSongsFromPlaylist?(playlistId: string, songs: Song[]): Promise<void>;
  /** 编辑源站歌单信息（网易 playlist_update；QQ 无对应接口）。name 必传防上游清空 */
  updatePlaylistInfo?(playlistId: string, info: { name: string; desc?: string; tags?: string[] }): Promise<void>;
  /** PhoneLoginProvider（手机号登录 + 登录档案，返回 cookie 串供浏览器凭证写入） */
  getLoginProfile?(): Promise<SourceLoginProfile>;
  loginByPhonePassword?(phone: string, password: string, countryCode?: number): Promise<string>;
  sendPhoneCode?(phone: string, countryCode?: number): Promise<void>;
  loginByPhoneCode?(phone: string, code: string, countryCode?: number): Promise<string>;
  /** ArtistLibraryProvider（歌手库：筛选+字母索引分页 · 歌手榜）；genre 为 QQ 风格筛选（GetSingerList） */
  getArtistLibrary?(opts: { area: string; sex: string; initial: string; page: number; limit: number; genre?: string }): Promise<{ artists: Artist[]; has_more: boolean }>;
  getArtistToplist?(type: number): Promise<Artist[]>;
  /** UserPlaylistProvider */
  getUserPlaylists?(page: number, limit: number): Promise<Playlist[]>;
  /** QRLoginProvider */
  createQRLogin?(): Promise<QRLoginSession>;
  checkQRLogin?(key: string): Promise<QRLoginResult>;
  /** 注销上游源账号（网易 logout · QQ login/logout）；本地凭证清理由调用方负责 */
  logout?(): Promise<void>;
  /* =============== P1 Wave A：用户资产 =============== */
  /** 用户详情（网易 user_detail(+_new)/user_level/user_subcount；uid 省略 = 当前登录用户） */
  getUserProfile?(uid?: string): Promise<UserProfile>;
  /** VIP 会员信息（网易 vip_info(_v2)+vip_sign_detail/history · QQ vip_login_base） */
  getUserVipInfo?(): Promise<UserVipInfo>;
  /** 关注/粉丝/互关列表（网易 user_follows/user_followeds/user_mutualfollow_get） */
  getUserFollows?(uid: string, kind: "follows" | "followeds" | "mutual", page: number, limit: number): Promise<UserFollowsResult>;
  /** 他人主页：创建的歌单（网易 user_playlist_create · QQ 复用 getUserPlaylists） */
  getUserCreatedPlaylists?(uid: string, page: number, limit: number): Promise<Playlist[]>;
  /** 他人主页：收藏的歌单（网易 user_playlist_collect · QQ 复用 getFavSonglist） */
  getUserCollectedPlaylists?(uid: string, page: number, limit: number): Promise<Playlist[]>;
  /** 听歌排行（网易 user_record：type 1=周榜 0=全部） */
  getUserPlayRecord?(type: 0 | 1): Promise<PlayRecordItem[]>;
  /** 听歌数据画像（网易 listen_data_* · QQ GetProfileReport） */
  getListenStats?(): Promise<ListenStats>;
  /** 年度/周期报告（网易 summary_annual + listen_data_year_report） */
  getAnnualReport?(): Promise<ReportSection[]>;
  /** 历史每日推荐（网易 history_recommend_songs(_detail)；date=YYYY-MM-DD 回溯指定日） */
  getHistoryDailyRecommends?(date?: string): Promise<HistoryDailyRecommend[]>;
  /* =============== P1 Wave B：内容扩展 =============== */
  /** 播客分类（网易 dj_catelist/dj_category_excludehot/dj_category_recommend；QQ 无播客体系） */
  getDjCategories?(): Promise<DjCategory[]>;
  /** 电台列表（网易 dj_recommend/dj_personalize_recommend/dj_hot/dj_today_perfered/dj_recommend_type/dj_radio_hot） */
  getDjRadios?(kind: "recommend" | "hot" | "today", categoryId?: string, page?: number, limit?: number): Promise<{ radios: DjRadio[]; has_more: boolean }>;
  /** 电台详情（网易 dj_detail） */
  getDjRadioDetail?(radioId: string): Promise<DjRadio>;
  /** 电台节目分页（网易 dj_program；节目主歌曲可直接入播放队列） */
  getDjPrograms?(radioId: string, page: number, limit: number): Promise<{ programs: DjProgram[]; has_more: boolean }>;
  /** 节目详情（网易 dj_program_detail） */
  getDjProgramDetail?(programId: string): Promise<DjProgram>;
  /** 曲风树（网易 style_list） */
  getStyles?(): Promise<StyleTag[]>;
  /** 曲风详情（网易 style_detail） */
  getStyleDetail?(styleId: string): Promise<StyleDetail>;
  getStyleSongs?(styleId: string, page: number, limit: number): Promise<{ songs: Song[]; has_more: boolean }>;
  getStyleAlbums?(styleId: string, page: number, limit: number): Promise<{ albums: Playlist[]; has_more: boolean }>;
  getStyleArtists?(styleId: string, page: number, limit: number): Promise<{ artists: Artist[]; has_more: boolean }>;
  getStylePlaylists?(styleId: string, page: number, limit: number): Promise<{ playlists: Playlist[]; has_more: boolean }>;
  /** 曲风偏好读取（网易 style_preference 为读取接口 /api/tag/my/preference/get） */
  getStylePreferences?(): Promise<string[]>;
  /** 歌曲标签（QQ GetSongLabels：曲风/语种/场景交叉入口） */
  getSongLabels?(songId: string): Promise<string[]>;
  /** 云盘列表（网易 cloud 主 + user_cloud 双版本；含空间统计） */
  getCloudSongs?(page: number, limit: number): Promise<CloudListResult>;
  /** 云盘单条详情（网易 user_cloud_detail） */
  getCloudSongDetail?(cloudId: string): Promise<CloudSong>;
  /** 云盘歌曲匹配纠错（网易 cloud_match，关联正版曲库信息） */
  matchCloudSong?(cloudId: string, songId: string): Promise<void>;
  /** 云盘歌曲歌词（网易 cloud_lyric_get） */
  getCloudLyric?(cloudId: string): Promise<string>;
  /** 删除云盘歌曲（网易 user_cloud_del；高危操作，路由层需频控+确认） */
  deleteCloudSong?(cloudId: string): Promise<void>;
  /** 首页区块聚合（网易 homepage_block_page · QQ get_home_feed，双源合并） */
  getHomepageBlocks?(): Promise<DiscoverBlock[]>;
  /** 每日推荐歌单（网易 recommend_resource，需登录） */
  getDailyRecommendPlaylists?(): Promise<Playlist[]>;
  /** 独家放送（网易 personalized_privatecontent/_list） */
  getPrivateContents?(): Promise<Banner[]>;
  /** 推荐 MV（网易 personalized_mv） */
  getRecommendedMvs?(): Promise<MvItem[]>;
  /** 精品歌单标签（网易 playlist_highquality_tags） */
  getHighqualityTags?(): Promise<HighqualityTag[]>;
  /** 精品歌单列表（网易 top_playlist_highquality hi-res 专区） */
  getHighqualityPlaylists?(tag: string, page: number, limit: number): Promise<{ playlists: Playlist[]; has_more: boolean }>;
  /** 热门歌单分类标签（网易 playlist_hot） */
  getHotPlaylistTags?(): Promise<PlaylistCategory[]>;
  /** 收藏/取消收藏歌单（网易 playlist_subscribe · QQ favSonglist/unfavSonglist） */
  subscribePlaylist?(playlistId: string, sub: boolean): Promise<void>;
  /** 我喜欢的歌单（网易 playlist_mylike） */
  getMyLikedPlaylists?(): Promise<Playlist[]>;
  /** 专辑列表（网易 album_list/album_list_style 语种流派筛选，新碟架二期） */
  getAlbumList?(area: string, style: string, page: number, limit: number): Promise<{ albums: Playlist[]; has_more: boolean }>;
  /** 歌单动态数（网易 playlist_detail_dynamic：收藏/评论/分享徽标） */
  getPlaylistDynamic?(playlistId: string): Promise<{ play_count?: number; subscribed_count?: number; comment_count?: number; share_count?: number }>;
  /** 专辑动态数（网易 album_detail_dynamic） */
  getAlbumDynamic?(albumId: string): Promise<{ comment_count?: number; share_count?: number; on_sale?: boolean }>;
  /* =============== P1 Wave C：体验增强 =============== */
  /** 歌曲百科图文（网易 song_wiki_info/song_wiki_summary） */
  getSongWiki?(song: Song): Promise<SongWiki>;
  /** 创作人员名单（网易 song_creators：词曲/编曲/制作） */
  getSongCreators?(song: Song): Promise<SongCreator[]>;
  /** 歌曲详细信息（网易 song_music_detail：发行/时长/质量） */
  getSongMusicDetail?(song: Song): Promise<{ label: string; value: string }[]>;
  /** 精彩评论数（网易 song_red_count） */
  getSongRedCount?(song: Song): Promise<number>;
  /** 版权受限替代推荐（网易 song_copyright_rcmd） */
  getCopyrightSubstitutes?(song: Song): Promise<Song[]>;
  /** 制作人（QQ SongProducer） */
  getProducer?(song: Song): Promise<string>;
  /** 其他版本 Live/伴奏/翻唱（QQ getOtherVersion） */
  getOtherVersions?(song: Song): Promise<Song[]>;
  /** 单曲收藏数（QQ GetSongFansNumberById） */
  getSongFavNum?(song: Song): Promise<number>;
  /** 歌手头部统计与长文简介（网易 artist_detail+artist_detail_dynamic+artist_follow_count · QQ GetSingerDetail+GetHomepageTabDetail） */
  getArtistWiki?(artistId: string): Promise<{ desc: string; follower_count?: number }>;
  /** 关注/取关歌手（网易 artist_sub） */
  followArtist?(artistId: string, follow: boolean): Promise<void>;
  /** 已关注歌手列表（网易 artist_sublist · QQ GetFollowSingerList） */
  getFollowedArtists?(page: number, limit: number): Promise<{ artists: FollowedArtist[]; has_more: boolean }>;
  /** 歌手视频（网易 artist_video） */
  getArtistVideos?(artistId: string, page: number, limit: number): Promise<{ videos: MvItem[]; has_more: boolean }>;
  /** 新版评论（网易 comment_new 楼层树 + comment_* 多资源；解析失败由 provider 内部回退旧版） */
  getCommentsV2?(target: CommentTarget, opts: { sort: "hot" | "new" | "recommended"; page: number; limit: number }): Promise<CommentListResult>;
  /** 楼层回复详情（网易 comment_floor） */
  getCommentFloor?(target: CommentTarget, parentCommentId: string, page: number, limit: number): Promise<CommentListResult>;
  /** 点赞评论（网易 comment_like） */
  likeComment?(target: CommentTarget, commentId: string, like: boolean): Promise<void>;
  /** 抱抱评论（网易 hug_comment） */
  hugComment?(target: CommentTarget, commentId: string, targetUserId: string): Promise<void>;
  /** 推荐评论（QQ GetRecommendComments，sort=recommended） */
  getRecommendedComments?(song: Song, opts: { page: number; limit: number }): Promise<CommentListResult>;
  /** 评论总数（QQ GetCommentCount，百科徽标） */
  getSongCommentCount?(song: Song): Promise<number>;
  /** 心动模式智能队列（网易 playmode_intelligence_list，以种子歌曲生成） */
  getIntelligenceList?(seed: Song): Promise<Song[]>;
  /** 大歌单增量分页（网易 playlist_track_all） */
  getAllPlaylistTracks?(playlistId: string, page: number, limit: number): Promise<{ songs: Song[]; has_more: boolean }>;
  /** 歌单排序（网易 playlist_order_update） */
  updatePlaylistOrder?(playlistIds: string[]): Promise<void>;
  /** 红心歌曲排序（网易 song_order_update） */
  updateLikedSongOrder?(songIds: string[]): Promise<void>;
  /** 听过此歌的用户（网易 simi_user，相似弹窗扩展） */
  getSimilarUsers?(song: Song): Promise<FollowUser[]>;
  /** 多类型匹配（网易 search_multimatch） */
  getSearchMultimatch?(keyword: string): Promise<SearchMultimatch>;
  /** 即时搜索（QQ smartbox） */
  quickSearch?(keyword: string): Promise<SearchMultimatch>;
  /** 综合搜索聚合（QQ do_search_v2） */
  generalSearch?(keyword: string, page: number, limit: number): Promise<SearchMultimatch>;
  /** 刷新登录态（网易 login_refresh） */
  refreshLogin?(): Promise<void>;
  /** 匿名注册兜底凭证（网易 register_anonimous，返回 cookie 串） */
  registerAnonymous?(): Promise<string>;
  /** 国际区号列表（网易 countries_code_list） */
  getCountryCodes?(): Promise<CountryCode[]>;
  /** 凭证过期探测（QQ login.checkExpired） */
  checkCredentialExpired?(): Promise<boolean>;
  /** 凭证续期（QQ login.refreshCredential） */
  refreshCredential?(): Promise<void>;
  /** 收藏/取消收藏 MV（网易 mv_sub） */
  subMv?(mvId: string, sub: boolean): Promise<void>;
  /** 收藏 MV 列表（网易 mv_sublist） */
  getSubbedMvs?(page: number, limit: number): Promise<{ mvs: MvItem[]; has_more: boolean }>;
  /** 相似 MV（网易 simi_mv） */
  getSimilarMvs?(mvId: string): Promise<MvItem[]>;
  /** 视频详情（网易 video_detail + video_detail_info 统计） */
  getVideoDetail?(videoId: string): Promise<MvItem>;
  /** 视频播放链接（网易 video_url 多分辨率） */
  getVideoUrl?(videoId: string, resolution?: number): Promise<string>;
  /** 相关视频（网易 related_allvideo） */
  getRelatedVideos?(videoId: string): Promise<MvItem[]>;
  /** 歌曲相关 MV（QQ GetRelatedMvInfo，播放页入口） */
  getRelatedMvs?(songId: string): Promise<MvItem[]>;
}

/** 纯函数错误：源不支持某能力（对应 Go 的 ErrXxxUnsupported） */
export class UnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedError";
  }
}

export function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return "-";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "-";
  // 对齐 Go FormatSize：一位小数
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatBitrate(kbps: number): string {
  if (!kbps || kbps <= 0) return "-";
  return `${kbps} kbps`;
}

/** 文件名：歌手 - 歌名.ext（对齐 model.Song.Filename，注意顺序与 Go 一致：Name - Artist） */
export function songFilename(song: Pick<Song, "name" | "artist" | "ext">): string {
  const ext = song.ext || "mp3";
  return sanitizeFilename(`${song.name} - ${song.artist}.${ext}`);
}

/** 对齐 utils.SanitizeFilename：去除文件系统非法字符（元数据中的斜杠等安全替换为 _） */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .replace(/_{2,}/g, "_")
    .trim()
    .slice(0, 180);
}
