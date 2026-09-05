/**
 * 歌词模块 — 移植自 .ref/QQMusicApi qqmusic_api/modules/lyric.py。
 * 歌词字段自动解密（对齐 models/lyric.py 的 _decrypt_lyrics 验证器：
 * GetPlayLyricInfo 的 lyric/trans/roma/singingAnnotationsLyric 四字段与
 * BatchGetMultiStyleTransLyric 的各风格 lyric 字段，解密失败保留原值）。
 */
import type { CgiInvokeOptions } from "../types";
import type { QQClient } from "../client";
import { decryptQRCHex } from "../../qrc";

// \p{Nd} 对齐 Python str.isdecimal()（接受全角等 Unicode 十进制数字）
const isDecimal = (v: string | number) => typeof v === "number" || /^\p{Nd}+$/u.test(String(v));

/** 尝试 QRC 解密，失败保留原值（对齐 contextlib.suppress(ValueError, TypeError)） */
function tryDecrypt(value: unknown): unknown {
  if (typeof value === "string" && value) {
    try {
      return decryptQRCHex(value);
    } catch {
      /* 解密失败保留原值 */
    }
  }
  return value;
}

/** GetPlayLyricInfo 响应的歌词字段自动解密（对齐 GetLyricResponse._decrypt_lyrics） */
function decryptLyricFields(data: any): any {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const out = { ...data };
  for (const field of ["lyric", "trans", "roma", "singingAnnotationsLyric"]) {
    if (field in out) out[field] = tryDecrypt(out[field]);
  }
  return out;
}

/** BatchGetMultiStyleTransLyric 响应的多风格 lyric 字段自动解密（对齐 MultiStyleLyricItem._decrypt_lyric） */
function decryptMultiStyleFields(data: any): any {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const lyrics = data.lyrics;
  if (!Array.isArray(lyrics)) return data;
  return {
    ...data,
    lyrics: lyrics.map((item: any) => (item && typeof item === "object" ? { ...item, lyric: tryDecrypt(item.lyric) } : item)),
  };
}

/** 获取歌词数据（qrc 逐字 / trans 翻译 / roma 罗马音 / singingAnnotations 助唱标注；密文字段自动解密） */
export async function getLyric(
  client: QQClient,
  value: string | number,
  options?: CgiInvokeOptions & { songType?: number; qrc?: boolean; trans?: boolean; roma?: boolean; singingAnnotations?: boolean; raw?: boolean },
) {
  // 对齐参考实现：qrc/trans/roma 显式 int() → 0/1；needSingingAnnotations 保留 bool（preserveBool）
  const params: Record<string, unknown> = {
    crypt: 1,
    lrc_t: 0,
    qrc: options?.qrc ? 1 : 0,
    qrc_t: 0,
    roma: options?.roma ? 1 : 0,
    roma_t: 0,
    trans: options?.trans ? 1 : 0,
    trans_t: 0,
    needSingingAnnotations: options?.singingAnnotations ?? false,
    type: options?.songType ?? 1,
  };
  if (isDecimal(value)) params.songId = Number(value);
  else params.songMid = String(value);
  const data = await client.invoke("music.musichallSong.PlayLyricInfo", "GetPlayLyricInfo", params, {
    preserveBool: true,
    ...options,
  });
  return options?.raw ? data : decryptLyricFields(data);
}

/** 获取助唱标注歌词信息 */
export async function getSingingAnnotationsInfo(client: QQClient, songid: number, options?: CgiInvokeOptions) {
  return client.invoke(
    "music.musichallSong.PlayLyricInfo",
    "GetSingingAnnotationsInfo",
    { songID: songid, needNum: false },
    { preserveBool: true, ...options },
  );
}

/** 获取多风格翻译歌词（诗意、粤语、方言等；各风格 lyric 字段自动解密） */
export async function getMultiStyleTransLyric(
  client: QQClient,
  songid: number,
  options?: CgiInvokeOptions & { raw?: boolean },
) {
  const data = await client.invoke(
    "music.musichallSong.PlayLyricInfo",
    "BatchGetMultiStyleTransLyric",
    { songID: songid },
    options,
  );
  return options?.raw ? data : decryptMultiStyleFields(data);
}

/** 检查是否存在 AI 歌词词典 */
export async function isAIDictExists(client: QQClient, songid: number, options?: CgiInvokeOptions) {
  return client.invoke("music.musichallSong.PlayLyricInfo", "IsAIDictExists", { songID: songid }, options);
}

/** 获取 AI 歌词词典信息 */
export async function getAIDict(client: QQClient, songid: number, options?: CgiInvokeOptions) {
  return client.invoke("music.musichallSong.PlayLyricInfo", "GetAIDictInfo", { songID: songid }, options);
}
