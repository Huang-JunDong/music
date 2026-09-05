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

/** Playlist+Song 组合（ParsePlaylist / ParseAlbum 返回） */
export interface PlaylistDetail {
  playlist: Playlist;
  songs: Song[];
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
  /** UserPlaylistProvider */
  getUserPlaylists?(page: number, limit: number): Promise<Playlist[]>;
  /** QRLoginProvider */
  createQRLogin?(): Promise<QRLoginSession>;
  checkQRLogin?(key: string): Promise<QRLoginResult>;
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
