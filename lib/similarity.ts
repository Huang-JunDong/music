/** 换源匹配算法 — 逐行移植 core/service.go（NormalizeText / SimilarityScore / CalcSongSimilarity / IsDurationClose） */

export function NormalizeText(s: string): string {
  if (!s) return "";
  const lower = s.toLowerCase();
  let out = "";
  for (const ch of lower) {
    // Letter / Number / Han（\p{L}\p{N} 近似 Go 的 unicode.IsLetter/IsNumber/Han）
    if (/\p{L}|\p{N}/u.test(ch)) out += ch;
  }
  return out;
}

/** 归一化编辑距离 → 0..1 相似度（对齐 SimilarityScore） */
export function SimilarityScore(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return Math.max(0, 1 - dist / maxLen);
}

function levenshtein(ra: string, rb: string): number {
  const la = ra.length;
  const lb = rb.length;
  if (la === 0) return lb;
  if (lb === 0) return la;
  let prev = new Array<number>(lb + 1);
  let cur = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = ra[i - 1] === rb[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[lb];
}

/** 歌曲综合相似度：name*0.7 + artist*0.3 */
export function CalcSongSimilarity(
  name: string,
  artist: string,
  candName: string,
  candArtist: string,
): number {
  const nameA = NormalizeText(name);
  const nameB = NormalizeText(candName);
  if (!nameA || !nameB) return 0;
  const nameSim = SimilarityScore(nameA, nameB);

  const artistA = NormalizeText(artist);
  const artistB = NormalizeText(candArtist);
  if (!artistA || !artistB) return nameSim;

  const artistSim = SimilarityScore(artistA, artistB);
  return nameSim * 0.7 + artistSim * 0.3;
}

/** 时长接近判定：diff<=10s 或 diff<=15% */
export function IsDurationClose(a: number, b: number): boolean {
  if (a <= 0 || b <= 0) return true;
  const diff = Math.abs(a - b);
  if (diff <= 10) return true;
  const maxAllowed = Math.max(10, Math.floor(a * 0.15));
  return diff <= maxAllowed;
}
