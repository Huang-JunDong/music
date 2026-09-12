"use client";

/**
 * 红心状态 store（zustand）：源站"我喜欢"集合（网易 likelist · QQ 我喜欢歌单）
 * key = source:id（网易 song.id / QQ mid）；toggle 乐观更新，失败回滚。
 */
import { create } from "zustand";
import { toast } from "sonner";
import type { Song } from "../types";

/** 支持红心的源（provider 实现 LikeProvider 的） */
export const LIKE_SOURCES = new Set(["netease", "qq"]);

interface LikesState {
  /** source → 已喜欢 id 集合 */
  sets: Record<string, Set<string>>;
  loaded: Record<string, boolean>;
  pending: Set<string>;
  load: (source: string) => Promise<void>;
  has: (song: Pick<Song, "source" | "id">) => boolean;
  toggle: (song: Song) => Promise<void>;
}

export const useLikes = create<LikesState>((set, get) => ({
  sets: {},
  loaded: {},
  pending: new Set<string>(),

  load: async (source) => {
    if (!LIKE_SOURCES.has(source) || get().loaded[source]) return;
    set((s) => ({ loaded: { ...s.loaded, [source]: true } }));
    try {
      const r = await fetch(`/api/likes?source=${encodeURIComponent(source)}`, { cache: "no-store" });
      if (!r.ok) {
        /* HTTP 故障与异常同样重置 loaded，允许后续重试（审核整改 P2-4） */
        set((s) => ({ loaded: { ...s.loaded, [source]: false } }));
        return;
      }
      const body = (await r.json()) as { ids?: string[] };
      const ids = Array.isArray(body.ids) ? body.ids : [];
      set((s) => ({ sets: { ...s.sets, [source]: new Set(ids.map(String)) } }));
    } catch {
      /* 失败允许重试：重置 loaded */
      set((s) => ({ loaded: { ...s.loaded, [source]: false } }));
    }
  },

  has: (song) => {
    const setFor = get().sets[song.source];
    return !!setFor && setFor.has(song.id);
  },

  toggle: async (song) => {
    if (!LIKE_SOURCES.has(song.source)) return;
    const { pending } = get();
    if (pending.has(`${song.source}:${song.id}`)) return;
    if (!get().loaded[song.source]) await get().load(song.source);
    const before = !!get().sets[song.source]?.has(song.id);
    const next = !before;

    /* 乐观更新 */
    set((s) => {
      const cur = s.sets[song.source] ?? new Set<string>();
      const copy = new Set(cur);
      if (next) copy.add(song.id);
      else copy.delete(song.id);
      return { sets: { ...s.sets, [song.source]: copy }, pending: new Set([...s.pending, `${song.source}:${song.id}`]) };
    });

    try {
      const resp = await fetch("/api/likes", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({
          id: song.id,
          name: song.name,
          artist: song.artist,
          album: song.album,
          duration: song.duration,
          source: song.source,
          cover: song.cover,
          extra: song.extra ? JSON.stringify(song.extra) : "",
          like: next,
        }),
      });
      const body = (await resp.json().catch(() => ({}))) as { error?: string };
      if (!resp.ok || body.error) throw new Error(body.error || `HTTP ${resp.status}`);
      toast.success(next ? "已加入我喜欢" : "已取消红心");
    } catch (e) {
      /* 回滚 */
      set((s) => {
        const cur = s.sets[song.source] ?? new Set<string>();
        const copy = new Set(cur);
        if (before) copy.add(song.id);
        else copy.delete(song.id);
        return { sets: { ...s.sets, [song.source]: copy } };
      });
      toast.error(e instanceof Error ? e.message : "红心操作失败（可能需要登录对应源账号）");
    } finally {
      set((s) => {
        const copy = new Set(s.pending);
        copy.delete(`${song.source}:${song.id}`);
        return { pending: copy };
      });
    }
  },
}));
