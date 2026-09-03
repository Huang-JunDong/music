/**
 * 解灰工具运行时加载 — unblockmusic-utils 内部使用动态 require，
 * 打包器（Turbopack/webpack）无法静态分析，故通过 createRequire 运行时加载。
 * 仅在 song_url_v1 / song_url_match 的 unblock=true 分支使用。
 */
import { createRequire } from "node:module";

type MatchIDFn = (id: string | number, source?: string) => Promise<any>;

let cachedFn: MatchIDFn | null | undefined;

export async function matchID(id: string | number, source?: string): Promise<any> {
  if (cachedFn === undefined) {
    try {
      const req = createRequire(import.meta.url);
      const mod = req("@neteasecloudmusicapienhanced/unblockmusic-utils");
      cachedFn = mod?.matchID ?? mod?.default?.matchID ?? null;
    } catch {
      cachedFn = null;
    }
  }
  if (!cachedFn) {
    throw new Error("unblockmusic-utils 不可用（未安装或加载失败）");
  }
  return cachedFn(id, source);
}
