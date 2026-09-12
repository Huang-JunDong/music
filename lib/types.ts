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
  /** ArtistLibraryProvider（歌手库：筛选+字母索引分页 · 歌手榜） */
  getArtistLibrary?(opts: { area: string; sex: string; initial: string; page: number; limit: number }): Promise<{ artists: Artist[]; has_more: boolean }>;
  getArtistToplist?(type: number): Promise<Artist[]>;
  /** UserPlaylistProvider */
  getUserPlaylists?(page: number, limit: number): Promise<Playlist[]>;
  /** QRLoginProvider */
  createQRLogin?(): Promise<QRLoginSession>;
  checkQRLogin?(key: string): Promise<QRLoginResult>;
  /** 注销上游源账号（网易 logout · QQ login/logout）；本地凭证清理由调用方负责 */
  logout?(): Promise<void>;
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
