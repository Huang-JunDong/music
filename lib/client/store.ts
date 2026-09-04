"use client";

/** 全局播放器状态（zustand）：队列 / 控制 / 歌词 / MediaSession / 失效跳过+自动换源 / 播放自动缓存 */
import { create } from "zustand";
import type { Song } from "../types";
import { parseLrcClient, type ClientLyricLine } from "../lrc-client";
import { downloadUrl, streamUrl, lyricUrl, switchSourceUrl } from "../play-url";
import { apiAutoCacheOnPlay } from "./api";

export type PlayMode = "order" | "loop-one" | "shuffle";

/** 倍速档位（对齐 Go playback_rate：0.5–2.0） */
export const PLAY_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/* 播放相关系统设置缓存（页面加载后拉取一次；设置修改后刷新页面生效） */
let playerSettingsCache: { autoSwitchInvalidSources: boolean } | null = null;
let playerSettingsLoading: Promise<void> | null = null;

async function loadPlayerSettings(): Promise<void> {
  if (playerSettingsCache) return;
  if (!playerSettingsLoading) {
    playerSettingsLoading = fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((st) => {
        const v = st as { autoSwitchInvalidSources?: unknown } | null;
        playerSettingsCache = { autoSwitchInvalidSources: v?.autoSwitchInvalidSources !== false };
      })
      .catch(() => {
        playerSettingsCache = { autoSwitchInvalidSources: true };
      });
  }
  await playerSettingsLoading;
}

/** 供设置页保存后刷新缓存（立即生效，无需刷新页面） */
export function refreshPlayerSettings(): void {
  playerSettingsCache = null;
  playerSettingsLoading = null;
  void loadPlayerSettings();
}

async function autoSwitchEnabled(): Promise<boolean> {
  await loadPlayerSettings();
  return playerSettingsCache?.autoSwitchInvalidSources !== false;
}

interface PlayerState {
  queue: Song[];
  index: number;
  playing: boolean;
  loading: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  mode: PlayMode;
  /** 播放倍速 */
  rate: number;
  /** 播放历史（最近 100 首，最新在前） */
  history: Song[];
  lyrics: ClientLyricLine[];
  lyricsLoading: boolean;
  lyricFormat: string;
  /** 当前歌曲换源尝试次数 */
  switchTried: number;

  current: () => Song | null;
  play: (song: Song, list?: Song[]) => void;
  toggle: () => void;
  /** 停止并回到开头（对齐 Go playAllAndJumpTo：pause + seek(0) + 清除当前标记） */
  stop: () => void;
  next: (auto?: boolean) => void;
  prev: () => void;
  seek: (t: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  cycleMode: () => void;
  setRate: (r: number) => void;
  cycleRate: () => void;
  removeFromQueue: (i: number) => void;
  clearQueue: () => void;
  clearHistory: () => void;
  /** 失效自动换源（对齐 Go autoSwitchInvalidSources） */
  autoSwitch: (song: Song) => Promise<Song | null>;
}

/* 模块级 audio 单例 */
let audio: HTMLAudioElement | null = null;
/** 全局 <audio> 单例访问（频谱可视化等需要直连媒体元素的模块使用） */
export function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
  }
  return audio;
}

async function fetchJSON<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

/** 歌词请求序号（审核整改 A-21）：快速切歌时旧歌词响应晚到不覆盖新歌 */
let lyricSeq = 0;

async function loadLyrics(song: Song, set: (p: Partial<PlayerState>) => void) {
  const seq = ++lyricSeq;
  set({ lyrics: [], lyricsLoading: true, lyricFormat: "" });
  try {
    // format=auto：拿 verbatim 原文（karaoke 词级 + roma/ts 独立行），前端解析归并
    // （对齐 Go lyricURLsForPlayback 的 raw_lrc/auto 通道；行级渠道 auto 即原文逐行）
    const resp = await fetch(lyricUrl(song));
    const text = await resp.text();
    const format = resp.headers.get("X-Lyric-Format") ?? "";
    if (seq !== lyricSeq) return; // 曲目已切换：丢弃过期歌词（最后写入胜出）
    const lines = parseLrcClient(text);
    set({ lyrics: lines, lyricsLoading: false, lyricFormat: format });
  } catch {
    if (seq !== lyricSeq) return;
    set({ lyricsLoading: false });
  }
}

function applyMediaSession(song: Song, state: PlayerState) {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.name,
    artist: song.artist,
    album: song.album,
    artwork: song.cover ? [{ src: song.cover, sizes: "512x512" }] : [],
  });
  navigator.mediaSession.setActionHandler("play", () => state.toggle());
  navigator.mediaSession.setActionHandler("pause", () => state.toggle());
  navigator.mediaSession.setActionHandler("previoustrack", () => state.prev());
  navigator.mediaSession.setActionHandler("nexttrack", () => state.next(true));
}

export const usePlayer = create<PlayerState>((set, get) => {
  const a = () => {
    if (typeof window === "undefined") throw new Error("no window");
    return getAudio();
  };

  const startSong = (i: number) => {
    const { queue } = get();
    if (i < 0 || i >= queue.length) {
      set({ playing: false });
      return;
    }
    const song = queue[i];
    set({ index: i, playing: true, loading: true, currentTime: 0, duration: song.duration || 0, switchTried: 0 });
    // 播放历史：最新在前，去重（同源同曲），上限 100
    const prevHistory = get().history;
    const history = [song, ...prevHistory.filter((h) => !(h.id === song.id && h.source === song.source))].slice(0, 100);
    set({ history });
    try {
      const el = a();
      el.src = streamUrl(song);
      el.playbackRate = get().rate;
      el.play().catch(() => set({ playing: false, loading: false }));
    } catch {
      /* SSR */
    }
    applyMediaSession(song, get());
    void loadLyrics(song, set);
    // 播放自动缓存（autoCacheOnPlay 开关由服务端控制；本地源与静默失败均跳过）
    if (song.source !== "local" && song.source !== "local-file") {
      void apiAutoCacheOnPlay(song);
    }
  };

  return {
    queue: [],
    index: -1,
    playing: false,
    loading: false,
    currentTime: 0,
    duration: 0,
    volume: 0.9,
    muted: false,
    mode: "order",
    rate: 1,
    history: [],
    lyrics: [],
    lyricsLoading: false,
    lyricFormat: "",
    switchTried: 0,

    current: () => {
      const { queue, index } = get();
      return index >= 0 && index < queue.length ? queue[index] : null;
    },

    play: (song, list) => {
      let queue = get().queue;
      if (list && list.length) {
        queue = list;
        set({ queue });
      }
      let i = queue.findIndex(
        (s) => s.id === song.id && s.source === song.source,
      );
      if (i < 0) {
        queue = [...queue, song];
        set({ queue });
        i = queue.length - 1;
      }
      const cur = get();
      if (cur.index === i && cur.playing) {
        // 对齐 Go：正在播放时再点当前曲 = 停止并回到开头
        get().stop();
        return;
      }
      startSong(i);
    },

    toggle: () => {
      try {
        const el = a();
        if (el.paused) {
          el.play().catch(() => undefined);
          set({ playing: true });
        } else {
          el.pause();
          set({ playing: false });
        }
      } catch {
        /* ignore */
      }
    },

    stop: () => {
      try {
        const el = a();
        el.pause();
        el.currentTime = 0;
      } catch {
        /* ignore */
      }
      lyricSeq++; // 审核整改 A-21：停播后使在途歌词请求失效，不再落地
      set({ index: -1, playing: false, currentTime: 0, loading: false });
    },

    next: (auto = false) => {
      const { queue, index, mode } = get();
      if (!queue.length) return;
      if (mode === "loop-one" && auto) {
        startSong(index);
        return;
      }
      let nextIdx: number;
      if (mode === "shuffle") {
        nextIdx = queue.length > 1 ? (() => {
          let n = Math.floor(Math.random() * queue.length);
          if (n === index) n = (n + 1) % queue.length;
          return n;
        })() : 0;
      } else {
        nextIdx = index + 1;
        if (nextIdx >= queue.length) nextIdx = 0;
      }
      startSong(nextIdx);
    },

    prev: () => {
      const { queue, index } = get();
      if (!queue.length) return;
      const prevIdx = index - 1 < 0 ? queue.length - 1 : index - 1;
      startSong(prevIdx);
    },

    seek: (t) => {
      try {
        const el = a();
        el.currentTime = t;
        set({ currentTime: t });
      } catch {
        /* ignore */
      }
    },

    setVolume: (v) => {
      try {
        a().volume = v;
        set({ volume: v, muted: v === 0 });
      } catch {
        /* ignore */
      }
    },

    toggleMute: () => {
      try {
        const el = a();
        el.muted = !el.muted;
        set({ muted: el.muted });
      } catch {
        /* ignore */
      }
    },

    cycleMode: () => {
      const order: PlayMode[] = ["order", "loop-one", "shuffle"];
      const cur = get().mode;
      set({ mode: order[(order.indexOf(cur) + 1) % order.length] });
    },

    setRate: (r) => {
      try {
        a().playbackRate = r;
      } catch {
        /* ignore */
      }
      set({ rate: r });
    },

    cycleRate: () => {
      const cur = get().rate;
      const idx = PLAY_RATES.findIndex((r) => Math.abs(r - cur) < 0.01);
      const nextRate = PLAY_RATES[(idx + 1) % PLAY_RATES.length] ?? 1;
      get().setRate(nextRate);
    },

    clearHistory: () => set({ history: [] }),

    removeFromQueue: (i) => {
      const { queue, index } = get();
      const nextQueue = queue.filter((_, idx) => idx !== i);
      let nextIndex = index;
      if (i < index) nextIndex = index - 1;
      else if (i === index) nextIndex = Math.min(index, nextQueue.length - 1);
      set({ queue: nextQueue, index: nextIndex });
    },

    clearQueue: () => {
      try {
        a().pause();
        a().removeAttribute("src");
      } catch {
        /* ignore */
      }
      lyricSeq++; // 审核整改 A-21：清空队列后使在途歌词请求失效
      set({ queue: [], index: -1, playing: false, lyrics: [] });
    },

    autoSwitch: async (song) => {
      const { switchTried } = get();
      // 对齐语义：自动换源只处理当前无效项一次，防死循环
      if (switchTried >= 1) return null;
      set({ switchTried: switchTried + 1 });
      const result = await fetchJSON<Song>(switchSourceUrl(song));
      if (!result || !result.id) return null;
      // 替换队列当前位置
      const { queue, index } = get();
      if (index >= 0 && index < queue.length) {
        const nextQueue = [...queue];
        nextQueue[index] = result;
        set({ queue: nextQueue });
        startSong(index);
      }
      return result;
    },
  };
});

/** 在应用根部绑定 audio 事件（只调用一次） */
export function bindAudioEvents() {
  if (typeof window === "undefined") return;
  const el = getAudio();
  el.volume = usePlayer.getState().volume;

  el.addEventListener("timeupdate", () => {
    usePlayer.setState({ currentTime: el.currentTime });
  });
  el.addEventListener("durationchange", () => {
    if (Number.isFinite(el.duration) && el.duration > 0) {
      usePlayer.setState({ duration: el.duration });
    }
  });
  el.addEventListener("playing", () => usePlayer.setState({ playing: true, loading: false }));
  el.addEventListener("pause", () => usePlayer.setState({ playing: false }));
  el.addEventListener("waiting", () => usePlayer.setState({ loading: true }));
  el.addEventListener("canplay", () => usePlayer.setState({ loading: false }));
  el.addEventListener("ended", () => {
    const st = usePlayer.getState();
    st.next(true);
  });
  el.addEventListener("error", () => {
    // 失效曲目：按「音源失效时自动换源」设置决定是否换源（对齐 Go autoSwitchInvalidSources），失败则跳下一首
    const st = usePlayer.getState();
    const song = st.current();
    if (song) {
      void autoSwitchEnabled().then((enabled) => {
        if (!enabled) {
          st.next(true);
          return;
        }
        void st.autoSwitch(song).then((switched) => {
          if (!switched) st.next(true);
        });
      });
    } else {
      st.next(true);
    }
  });
}

/** 空格键播放/暂停（对齐 Go Web 行为：焦点在输入框 / 按钮或弹窗打开时不触发，避免误操作与双重触发） */
export function bindSpaceToggle() {
  if (typeof window === "undefined") return;
  window.addEventListener("keydown", (e) => {
    if (e.code !== "Space") return;
    const target = e.target as HTMLElement;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLButtonElement ||
      target instanceof HTMLSelectElement ||
      target.isContentEditable
    ) {
      return;
    }
    // 弹窗打开时不触发（Modal / CollectSheet / NowPlaying 均渲染 role=dialog）
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    e.preventDefault();
    usePlayer.getState().toggle();
  });
}
