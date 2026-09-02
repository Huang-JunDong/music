import { NextRequest, NextResponse } from "next/server";
import { GetAllSourceNames, GetDefaultSourceNames, getProvider } from "@/lib/registry";
import { CalcSongSimilarity, IsDurationClose } from "@/lib/similarity";
import { fetchSource, intAbs } from "@/lib/web-core";
import { isLocalMusicSource } from "@/lib/local-music";
import type { Song } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SWITCH_MAX_CANDIDATES_PER_SOURCE = 8;
const SWITCH_SOURCE_SEARCH_TIMEOUT = 6_000;
const SWITCH_HIGH_CONFIDENCE_SCORE = 0.98;
const SWITCH_PARALLEL_VALIDATION_LIMIT = 12;
const SWITCH_PARALLEL_VALIDATION_PARALLEL = 6;

interface SwitchCandidate {
  song: Song;
  score: number;
  durDiff: number;
}

function emptySong(id: string, source: string): Song {
  return {
    id,
    name: "",
    artist: "",
    album: "",
    duration: 0,
    size: 0,
    bitrate: 0,
    source,
    url: "",
    cover: "",
    link: "",
  };
}

/** ValidatePlayable 移植：getStreamUrl + bytes=0-1 探测（5s 超时） */
async function validatePlayable(song: Pick<Song, "id" | "source">): Promise<boolean> {
  if (!song.id || !song.source) return false;
  if (song.source === "soda" || song.source === "fivesing" || isLocalMusicSource(song.source)) {
    return false;
  }
  const provider = getProvider(song.source);
  if (!provider?.getStreamUrl) return false;
  let url: string;
  try {
    url = await provider.getStreamUrl(emptySong(song.id, song.source));
  } catch {
    return false;
  }
  if (!url) return false;
  try {
    const resp = await fetchSource(url, song.source, "bytes=0-1", 5_000);
    return resp.status === 200 || resp.status === 206;
  } catch {
    return false;
  }
}

function sortCandidates(candidates: SwitchCandidate[]): SwitchCandidate[] {
  return [...candidates].sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.durDiff - b.durDiff;
  });
}

function isSwitchSourceAllowed(source: string, current: string): boolean {
  if (!source || source === current) return false;
  if (source === "soda" || source === "fivesing") return false;
  if (isLocalMusicSource(source)) return false;
  return true;
}

function switchCandidateSources(current: string, target: string): string[] {
  if (target) {
    if (isSwitchSourceAllowed(target, current) && getProvider(target)?.search) return [target];
    return [];
  }
  const seen = new Set<string>();
  const sources: string[] = [];
  const add = (source: string) => {
    if (!source || seen.has(source)) return;
    if (!isSwitchSourceAllowed(source, current)) return;
    if (!getProvider(source)?.search) return;
    seen.add(source);
    sources.push(source);
  };
  for (const source of GetDefaultSourceNames()) add(source);
  for (const source of GetAllSourceNames()) add(source);
  return sources;
}

function searchWithTimeout(keyword: string, source: string): Promise<Song[]> {
  const provider = getProvider(source);
  if (!provider?.search) return Promise.resolve([]);
  return new Promise<Song[]>((resolve) => {
    const timer = setTimeout(() => resolve([]), SWITCH_SOURCE_SEARCH_TIMEOUT);
    provider!
      .search(keyword)
      .then((songs) => {
        clearTimeout(timer);
        resolve(songs);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve([]);
      });
  });
}

async function searchSwitchSourceCandidates(
  source: string,
  keyword: string,
  name: string,
  artist: string,
  origDuration: number,
): Promise<SwitchCandidate[]> {
  let res = await searchWithTimeout(keyword, source);
  if ((!res || !res.length) && artist) {
    res = await searchWithTimeout(name, source);
  }
  if (!res?.length) return [];

  const limit = Math.min(res.length, SWITCH_MAX_CANDIDATES_PER_SOURCE);
  const candidates: SwitchCandidate[] = [];
  for (let i = 0; i < limit; i++) {
    const cand = { ...res[i], source };
    const score = CalcSongSimilarity(name, artist, cand.name ?? "", cand.artist ?? "");
    if (score <= 0) continue;

    let durDiff = 0;
    if (origDuration > 0 && cand.duration > 0) {
      durDiff = intAbs(origDuration - cand.duration);
      if (!IsDurationClose(origDuration, cand.duration)) continue;
    }
    candidates.push({ song: cand, score, durDiff });
  }
  return candidates;
}

/** findBestSwitchSong 移植 */
async function findBestSwitchSong(
  name: string,
  artist: string,
  current: string,
  target: string,
  origDuration: number,
): Promise<{ song: Song; score: number } | { error: string }> {
  const keyword = artist ? `${name} ${artist}` : name;
  const sources = switchCandidateSources(current, target);
  if (!sources.length) return { error: "no match" };

  const allCandidates: SwitchCandidate[] = [];

  // 高分捷径（流式，对齐 Go channel 语义）：每个源搜索完成即验其最佳候选，
  // 分数 ≥0.98 且时长差 ≤3s 且可播放 → 立即返回，不等其余源。
  const earlyHit = await new Promise<SwitchCandidate | null>((resolve) => {
    let pending = sources.length;
    let done = false;
    const finish = (value: SwitchCandidate | null) => {
      if (!done) {
        done = true;
        resolve(value);
      }
    };
    if (!sources.length) {
      finish(null);
      return;
    }
    for (const source of sources) {
      searchSwitchSourceCandidates(source, keyword, name, artist, origDuration)
        .then(async (sourceCandidates) => {
          if (done) return;
          allCandidates.push(...sourceCandidates);
          if (sourceCandidates.length) {
            const sorted = sortCandidates(sourceCandidates);
            const best = sorted[0];
            const highConfidence =
              best.score >= SWITCH_HIGH_CONFIDENCE_SCORE &&
              !(origDuration > 0 && best.song.duration > 0 && best.durDiff > 3);
            if (highConfidence && (await validatePlayable(best.song))) {
              finish(best);
              return;
            }
          }
          pending -= 1;
          if (pending === 0) finish(null);
        })
        .catch(() => {
          if (done) return;
          pending -= 1;
          if (pending === 0) finish(null);
        });
    }
  });

  if (earlyHit) return { song: earlyHit.song, score: earlyHit.score };

  if (!allCandidates.length) return { error: "no match" };

  // 全局排序后并行验证前 12 个候选（6 并发）；
  // 对齐 Go validateSwitchCandidates：收集全部验证结果后按排序序取第一个可播放的
  // （而非"最先验证完成"的，保证返回的是最优可播候选）。
  const limited = sortCandidates(allCandidates).slice(0, SWITCH_PARALLEL_VALIDATION_LIMIT);
  let cursor = 0;
  const worker = async (): Promise<number | null> => {
    while (cursor < limited.length) {
      const index = cursor++;
      if (await validatePlayable(limited[index].song)) return index;
    }
    return null;
  };
  const workers = Array.from(
    { length: Math.min(SWITCH_PARALLEL_VALIDATION_PARALLEL, limited.length) },
    () => worker(),
  );
  const settled = await Promise.all(workers);
  const hitIndex = settled.filter((i): i is number => i !== null).sort((a, b) => a - b)[0];
  if (hitIndex !== undefined) {
    return { song: limited[hitIndex].song, score: limited[hitIndex].score };
  }
  return { error: "no playable match" };
}

/** GET /api/switch_source?name=&artist=&source=&target=&duration= */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const name = (params.get("name") ?? "").trim();
  const artist = (params.get("artist") ?? "").trim();
  const current = (params.get("source") ?? "").trim();
  const target = (params.get("target") ?? "").trim();
  const origDuration = parseInt((params.get("duration") ?? "").trim(), 10) || 0;

  if (!name) {
    return NextResponse.json({ error: "missing name" }, { status: 400 });
  }

  const result = await findBestSwitchSong(name, artist, current, target, origDuration);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  const { song, score } = result;
  return NextResponse.json({
    id: song.id,
    name: song.name,
    artist: song.artist,
    album: song.album,
    album_id: song.album_id ?? "",
    duration: song.duration,
    source: song.source,
    cover: song.cover,
    extra: song.extra ?? null,
    score,
    link: song.link ?? "",
  });
}
