import type { Song, SongQuality } from "./types";

/** 可播性检查结果（前端状态，/api/inspect） */
export interface StreamInfo {
  status: "idle" | "checking" | "ok" | "fail";
  /** 实际音频格式（mp3/flac/m4a…） */
  ext?: string;
  size?: string;
  bitrate?: string;
}

/** 构建歌曲查询参数（/api/download、/api/lyric、/api/inspect 共用，对齐 Go downloadHandler 参数） */
export function songParams(song: Song): URLSearchParams {
  const p = new URLSearchParams({
    source: song.source,
    id: song.id,
    name: song.name,
    artist: song.artist,
    album: song.album,
    cover: song.cover,
    duration: String(song.duration),
  });
  if (song.album_id) p.set("album_id", song.album_id);
  if (song.ext) p.set("ext", song.ext);
  if (song.extra) p.set("extra", JSON.stringify(song.extra));
  return p;
}

/** /api/download 音频流代理地址（<audio> 播放与下载共用，对齐 Go /download）；quality 为音质偏好（best=默认不传） */
export function downloadUrl(song: Song, download = false, quality?: SongQuality): string {
  const p = songParams(song);
  if (download) p.set("download", "1");
  if (quality && quality !== "best") p.set("quality", quality);
  return `/api/download?${p.toString()}`;
}

/** 兼容别名：播放地址（stream=1：流式播放，不走并行分块/落盘/嵌入/WebDAV 缓冲） */
export function streamUrl(song: Song, quality?: SongQuality): string {
  return `${downloadUrl(song, false, quality)}&stream=1`;
}

/** /api/inspect 可播性探测地址 */
export function inspectUrl(song: Song): string {
  return `/api/inspect?${songParams(song).toString()}`;
}

/** /api/lyric 歌词地址 */
export function lyricUrl(song: Song, format?: string): string {
  const p = songParams(song);
  if (format) p.set("format", format);
  return `/api/lyric?${p.toString()}`;
}

/** /api/download_lrc 歌词下载地址 */
export function downloadLrcUrl(song: Song): string {
  return `/api/download_lrc?${songParams(song).toString()}`;
}

/** /api/cover_proxy 封面代理地址（绕防盗链） */
export function coverProxyUrl(url: string, source?: string): string {
  if (!url) return "";
  if (url.startsWith("/api/")) return url; // 已是本站地址（本地音乐封面等）
  return `/api/cover_proxy?url=${encodeURIComponent(url)}${source ? `&source=${source}` : ""}`;
}

export function coverUrl(song: Song): string {
  return coverProxyUrl(song.cover, song.source);
}

/** /api/switch_source 换源地址 */
export function switchSourceUrl(song: Song, target?: string): string {
  const p = new URLSearchParams({
    name: song.name,
    artist: song.artist,
    source: song.source,
    duration: String(song.duration),
  });
  if (target) p.set("target", target);
  return `/api/switch_source?${p.toString()}`;
}

export interface SourceMeta {
  label: string;
  badge: string;
  dot: string;
}

export const SOURCE_META: Record<string, SourceMeta> = {
  netease: { label: "网易云", badge: "border-red-500/30 bg-red-500/10 text-red-300", dot: "bg-red-400" },
  qq: { label: "QQ", badge: "border-sky-500/30 bg-sky-500/10 text-sky-300", dot: "bg-sky-400" },
  qq_wx: { label: "微信", badge: "border-green-500/30 bg-green-500/10 text-green-300", dot: "bg-green-400" },
  kugou: { label: "酷狗", badge: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300", dot: "bg-cyan-400" },
  kuwo: { label: "酷我", badge: "border-amber-500/30 bg-amber-500/10 text-amber-300", dot: "bg-amber-400" },
  migu: { label: "咪咕", badge: "border-pink-500/30 bg-pink-500/10 text-pink-300", dot: "bg-pink-400" },
  qianqian: { label: "千千", badge: "border-orange-500/30 bg-orange-500/10 text-orange-300", dot: "bg-orange-400" },
  soda: { label: "汽水", badge: "border-lime-500/30 bg-lime-500/10 text-lime-300", dot: "bg-lime-400" },
  fivesing: { label: "5sing", badge: "border-teal-500/30 bg-teal-500/10 text-teal-300", dot: "bg-teal-400" },
  jamendo: { label: "Jamendo", badge: "border-indigo-500/30 bg-indigo-500/10 text-indigo-300", dot: "bg-indigo-400" },
  joox: { label: "JOOX", badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300", dot: "bg-emerald-400" },
  bilibili: { label: "B站", badge: "border-blue-500/30 bg-blue-500/10 text-blue-300", dot: "bg-blue-400" },
  apple: { label: "Apple", badge: "border-zinc-400/30 bg-zinc-400/10 text-zinc-300", dot: "bg-zinc-300" },
  local: { label: "本地", badge: "border-violet-500/30 bg-violet-500/10 text-violet-300", dot: "bg-violet-400" },
};

export function sourceMeta(source: string): SourceMeta {
  return (
    SOURCE_META[source] ?? {
      label: source,
      badge: "border-zinc-500/30 bg-zinc-500/10 text-zinc-400",
      dot: "bg-zinc-400",
    }
  );
}

/** 音质标签：无损 / 320K / 192K / … */
export function qualityTag(bitrate: number, ext?: string): string {
  const e = (ext ?? "").toLowerCase();
  if (e.includes("flac") || bitrate >= 900) return "无损";
  if (bitrate >= 320) return "320K";
  if (bitrate >= 192) return "192K";
  if (bitrate > 0) return `${bitrate}K`;
  return "";
}

/** 从 URL 猜测音频格式 */
export function guessExt(url: string): string {
  const m = url.match(/\.(mp3|flac|m4a|aac|ogg|wav)(?:\?|$)/i);
  return m ? m[1].toLowerCase() : "";
}
