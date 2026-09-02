/**
 * 源注册表 — 对齐 core/service.go 的 GetAllSourceNames / GetDefaultSourceNames 等，
 * 以及 DetectSource 链接来源识别。
 */
import type { MusicProvider, Song } from "./types";
import { netease } from "./providers/netease";
import { qq } from "./providers/qq";
import { kugou } from "./providers/kugou";
import { kuwo } from "./providers/kuwo";
import { migu } from "./providers/migu";
import { qianqian } from "./providers/qianqian";
import { soda } from "./providers/soda";
import { fivesing } from "./providers/fivesing";
import { jamendo } from "./providers/jamendo";
import { joox } from "./providers/joox";
import { bilibili } from "./providers/bilibili";
import { apple } from "./providers/apple";

export const providers: Record<string, MusicProvider> = {
  netease,
  qq,
  kugou,
  kuwo,
  migu,
  fivesing,
  jamendo,
  joox,
  qianqian,
  soda,
  bilibili,
  apple,
  // local 源由 local music 模块直接处理（文件系统扫描），不在此注册
};

export function GetAllSourceNames(): string[] {
  return [
    "netease", "qq", "kugou", "kuwo", "migu", "fivesing", "jamendo",
    "joox", "qianqian", "soda", "bilibili", "apple", "local",
  ];
}

export function GetPlaylistSourceNames(): string[] {
  return ["netease", "qq", "kugou", "kuwo", "migu", "jamendo", "joox", "qianqian", "bilibili", "soda", "fivesing", "apple"];
}

export function GetAlbumSourceNames(): string[] {
  return ["netease", "qq", "kugou", "kuwo", "migu", "jamendo", "joox", "qianqian", "soda", "apple"];
}

export function GetPlaylistCategorySourceNames(): string[] {
  return ["netease", "qq", "kugou", "kuwo", "migu", "qianqian", "joox", "apple"];
}

/** 默认搜索源：排除 bilibili / joox / jamendo / fivesing / local（对齐 Go） */
export function GetDefaultSourceNames(): string[] {
  return ["netease", "qq", "kugou", "kuwo", "migu", "qianqian", "soda", "apple"];
}

export function GetSourceDescription(source: string): string {
  const descriptions: Record<string, string> = {
    netease: "网易云音乐",
    qq: "QQ音乐",
    kugou: "酷狗音乐",
    kuwo: "酷我音乐",
    migu: "咪咕音乐",
    fivesing: "5sing",
    jamendo: "Jamendo (CC)",
    joox: "JOOX",
    qianqian: "千千音乐",
    soda: "汽水音乐",
    bilibili: "Bilibili",
    apple: "Apple Music",
    local: "本地音乐",
  };
  return descriptions[source] ?? source;
}

export function getProvider(name: string): MusicProvider | undefined {
  return providers[name?.trim()];
}

/** 解析请求的源列表：为空回退默认源；支持逗号分隔或重复 query 参数 */
export function resolveSources(requested?: string | string[] | null): string[] {
  let list: string[];
  if (Array.isArray(requested)) {
    list = requested.flatMap((s) => s.split(","));
  } else {
    list = (requested ?? "").split(",");
  }
  const valid = list.map((s) => s.trim()).filter((s) => s && providers[s]);
  return valid.length ? valid : GetDefaultSourceNames().filter((s) => providers[s]);
}

/** 链接 → 源（对齐 core.DetectSource） */
export function DetectSource(link: string): string {
  const has = (sub: string) => link.includes(sub);
  if (has("163.com")) return "netease";
  if (has("qq.com")) return "qq";
  if (has("5sing")) return "fivesing";
  if (has("kugou.com")) return "kugou";
  if (has("kuwo.cn")) return "kuwo";
  if (has("migu.cn")) return "migu";
  if (has("joox.com")) return "joox";
  if (has("bilibili.com") || has("b23.tv")) return "bilibili";
  if (has("douyin.com") || has("qishui")) return "soda";
  if (has("91q.com")) return "qianqian";
  if (has("music.apple.com")) return "apple";
  if (has("jamendo.com")) return "jamendo";
  return "";
}

/** 从查询参数重建 Song（供 stream / lyric / download 等接口使用） */
export function songFromParams(query: URLSearchParams): Song {
  let extra: Record<string, string> | undefined;
  const rawExtra = query.get("extra");
  if (rawExtra) {
    try {
      const parsed = JSON.parse(rawExtra);
      if (parsed && typeof parsed === "object") {
        extra = {};
        for (const [k, v] of Object.entries(parsed)) {
          extra[k] = typeof v === "object" ? JSON.stringify(v) : String(v);
        }
      }
    } catch {
      /* ignore invalid extra */
    }
  }
  return {
    id: query.get("id") ?? "",
    name: query.get("name") ?? "",
    artist: query.get("artist") ?? "",
    album: query.get("album") ?? "",
    album_id: query.get("album_id") ?? "",
    duration: parseInt(query.get("duration") ?? "0", 10) || 0,
    size: parseInt(query.get("size") ?? "0", 10) || 0,
    bitrate: parseInt(query.get("bitrate") ?? "0", 10) || 0,
    source: query.get("source") ?? "",
    url: "",
    ext: query.get("ext") ?? "",
    cover: query.get("cover") ?? "",
    link: query.get("link") ?? "",
    extra,
  };
}
