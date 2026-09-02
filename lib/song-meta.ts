/**
 * 歌手名相似匹配 — 移植 internal/web/song_meta.go + album_match.go
 * splitArtistTokens / filterSongsByExactArtist / pickBestAlbumMatch
 */
import type { Playlist, Song } from "./types";

const artistKeywordSeparatorPattern = /\s+(?:feat(?:uring)?\.?|ft\.?|with|x)\s+/gi;

const EAST_ASIAN_RE = /[\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;

const ARTIST_TRIM_SET = "-_/·•|\\,，、;；&＆";

function trimWithSet(value: string, set: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && set.includes(value[start])) start++;
  while (end > start && set.includes(value[end - 1])) end--;
  return value.slice(start, end);
}

export function normalizeArtistToken(artist: string): string {
  const lower = (artist ?? "").trim().toLowerCase();
  if (!lower) return "";
  return lower.split(/\s+/).join(" ");
}

export function containsEastAsianRune(s: string): boolean {
  return EAST_ASIAN_RE.test(s ?? "");
}

function trimArtistToken(value: string): string {
  return trimWithSet((value ?? "").trim(), ARTIST_TRIM_SET).trim();
}

function replaceCommonSeparators(text: string): string {
  return text.replace(/[、,，;；|]/g, "|");
}

function replaceEastAsianSeparators(text: string): string {
  return text.replace(/[/／&＆]/g, "|");
}

function replaceSpacedSeparators(text: string): string {
  return text.replace(/\s+(?:\/|／|&|＆)\s+/g, "|");
}

/** 拆分歌手名 token：feat/、/,/／/& 等分隔符，去重保序 */
export function splitArtistTokens(artist: string): string[] {
  const text = (artist ?? "").trim();
  if (!text) return [];

  let normalized = text.replace(artistKeywordSeparatorPattern, "|");
  normalized = replaceCommonSeparators(normalized);
  if (containsEastAsianRune(text)) {
    normalized = replaceEastAsianSeparators(normalized);
  } else {
    normalized = replaceSpacedSeparators(normalized);
  }

  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const part of normalized.split("|")) {
    const trimmed = trimArtistToken(part);
    if (!trimmed) continue;
    const key = normalizeArtistToken(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    tokens.push(trimmed);
  }
  return tokens.length ? tokens : [text];
}

/** exact_artist 过滤（对齐 filterSongsByExactArtist） */
export function filterSongsByExactArtist(songs: Song[], exactArtist: string): Song[] {
  const target = normalizeArtistToken(exactArtist);
  if (!target) return songs;
  return songs.filter((song) =>
    splitArtistTokens(song.artist ?? "").some(
      (artist) => normalizeArtistToken(artist) === target,
    ),
  );
}

/* ---------------- album_match.go ---------------- */

const FULLWIDTH_MAP: Record<string, string> = {
  "（": "(",
  "）": ")",
  "【": "[",
  "】": "]",
  "\u201C": '"',
  "\u201D": '"',
  "\u2018": "'",
  "\u2019": "'",
};

export function normalizeLookupText(value: string): string {
  let v = (value ?? "").trim().toLowerCase();
  if (!v) return "";
  v = v.split(/\s+/).join("");
  for (const [from, to] of Object.entries(FULLWIDTH_MAP)) v = v.replaceAll(from, to);
  return v;
}

/** pickBestAlbumMatch 移植：专辑名精确 100 / 包含 60 / 歌手 token 30 / 文本互含 10 */
export function pickBestAlbumMatch(
  name: string,
  artist: string,
  albums: Playlist[],
): Playlist | null {
  if (!albums.length) return null;

  const targetName = normalizeLookupText(name);
  const targetArtists = splitArtistTokens(artist);
  let bestIndex = 0;
  let bestScore = -1;

  for (let i = 0; i < albums.length; i++) {
    const album = albums[i];
    let score = 0;
    const albumName = normalizeLookupText(album.name);
    if (targetName && albumName === targetName) score += 100;
    else if (targetName && (albumName.includes(targetName) || targetName.includes(albumName))) score += 60;

    const creatorTokens = splitArtistTokens(album.creator ?? "");
    const creatorText = normalizeLookupText(album.creator ?? "");
    let scored = false;
    for (const targetArtist of targetArtists) {
      if (scored) break;
      const normalizedTargetArtist = normalizeArtistToken(targetArtist);
      if (!normalizedTargetArtist) continue;
      for (const creator of creatorTokens) {
        if (normalizeArtistToken(creator) === normalizedTargetArtist) {
          score += 30;
          scored = true;
          break;
        }
      }
      if (scored) break;
      const targetText = normalizeLookupText(targetArtist);
      if (targetText && creatorText && (creatorText.includes(targetText) || targetText.includes(creatorText))) {
        score += 10;
        scored = true;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return albums[bestIndex];
}
