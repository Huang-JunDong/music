"use client";

/**
 * 歌曲列表：PC 表格行 / 移动卡片
 * 功能对齐 Go song_list.html + app.js：
 * - 播放（整页入队）/ 换源（行内更新）/ 收藏 / 浏览器下载 / 保存到服务器（save_local）
 * - 逐行音质检测（inspect，100ms 节流队列）
 * - 歌手精确搜索（exact_artist，多歌手拆分）/ 专辑跳转（album_id 或 album_jump 兜底）/ 歌名源站外链
 * - 下载歌词 / 下载封面
 * - 批量模式：全选 / 批量下载（预检 precheck + 并发控制）/ 批量收藏
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import {
  Play, Pause, Download, RefreshCcw, HeartPlus, Loader2, Music4, ListPlus,
  CheckSquare, Square, CheckCheck, FileDown, Gauge, ExternalLink, Disc3,
  FileText, Image as ImageIcon, Server, Plus, HardDrive, Trash2, ShieldAlert, ChevronDown, Clapperboard,
} from "lucide-react";
import { toast } from "sonner";
import type { Song } from "@/lib/types";
import { usePlayer } from "@/lib/client/store";
import { coverUrl, sourceMeta, qualityTag, downloadUrl, switchSourceUrl, downloadLrcUrl } from "@/lib/play-url";
import { fmtTimeClient } from "@/lib/client/ui";
import { ConfirmDialog, Modal } from "@/components/modal";
import {
  apiCollections,
  apiBatchAddToCollection,
  apiCreateCollection,
  apiSaveToLocal,
  apiDownloadsPrecheck,
  apiInspect,
  apiSwitchSource,
  apiLocalMusicBatchMatch,
  apiDeleteLocalMusic,
  type LocalMatchItem,
} from "@/lib/client/api";

/* ---------------- 工具 ---------------- */

/** 多歌手拆分（对齐 Go artistTokens：feat./、，,;& 与 &） */
export function artistTokens(artist: string): string[] {
  return (artist ?? "")
    .split(/(?:\s*(?:feat\.?|ft\.?)\s*)|[\s]*[、，,;&\/]+[\s]*/i)
    .map((t) => t.trim())
    .filter(Boolean);
}

function songKey(s: Song): string {
  return `${s.source}:${s.id}`;
}

function isOnlineSong(s: Song): boolean {
  return s.source !== "local" && s.source !== "local-file";
}

function formatSizeBytesClient(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 本地匹配缓存（模块级，跨列表共享，对齐 Go localMusicMatchCache） */
const localMatchCache = new Map<string, LocalMatchItem>();

/** 搜索结果出现后 300ms 防抖批量匹配"本地已有"（对齐 Go scheduleBatchLocalMusicMatch） */
function useLocalMatch(songs: Song[]) {
  const [version, setVersion] = useState(0);
  const key = songs.map(songKey).join("|");

  useEffect(() => {
    const online = songs.filter((s) => isOnlineSong(s));
    if (!online.length) return;
    const targets = online.filter((s) => !localMatchCache.has(songKey(s)));
    if (!targets.length) return;

    const timer = setTimeout(() => {
      apiLocalMusicBatchMatch(targets)
        .then((data) => {
          if (!data.matches?.length) return;
          let changed = false;
          for (const m of data.matches) {
            const song = targets[m.qi];
            if (!song) continue;
            localMatchCache.set(songKey(song), m);
            changed = true;
          }
          if (changed) setVersion((v) => v + 1);
        })
        .catch(() => {
          /* 静默失败，对齐 Go */
        });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { cache: localMatchCache, version };
}

interface InspectState {
  status: "checking" | "done" | "fail";
  size?: string;
  bitrate?: string;
  ext?: string;
}

/** inspect 队列：100ms/条 节流（对齐 Go inspectQueue） */
function useInspectQueue() {
  const [map, setMap] = useState<Record<string, InspectState>>({});
  const queueRef = useRef<{ song: Song; key: string }[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);

  const pump = useCallback(() => {
    if (runningRef.current) return;
    const item = queueRef.current.shift();
    if (!item) return;
    runningRef.current = true;
    setMap((m) => ({ ...m, [item.key]: { status: "checking" } }));
    apiInspect(item.song)
      .then((r) => {
        setMap((m) => ({
          ...m,
          [item.key]: r.valid
            ? { status: "done", size: r.size, bitrate: r.bitrate, ext: "" }
            : { status: "fail" },
        }));
      })
      .catch(() => {
        setMap((m) => ({ ...m, [item.key]: { status: "fail" } }));
      })
      .finally(() => {
        runningRef.current = false;
        pump();
      });
  }, []);

  const enqueue = useCallback(
    (song: Song) => {
      const key = songKey(song);
      setMap((m) => (m[key] ? m : { ...m, [key]: { status: "checking" } }));
      queueRef.current.push({ song, key });
      if (!timerRef.current) {
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          pump();
        }, 100);
      }
    },
    [pump],
  );

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { map, enqueue };
}

/* ---------------- 组件 ---------------- */

/** 大列表增量渲染参数：初始渲染行数与每次追加行数（商业化性能：几千首歌单秒开） */
const INITIAL_RENDER = 200;
const RENDER_CHUNK = 300;

interface SongListProps {
  songs: Song[];
  loading?: boolean;
  emptyHint?: string;
  showIndex?: boolean;
  /** 行内换源后回写列表数据 */
  onSongsChange?: (songs: Song[]) => void;
}

export function SongList({ songs, loading, emptyHint, showIndex = true, onSongsChange }: SongListProps) {
  const router = useRouter();
  const { queue, index, playing, play, toggle } = usePlayer();
  const [switching, setSwitching] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [collectTarget, setCollectTarget] = useState<Song | null>(null);
  const [batchCollect, setBatchCollect] = useState<Song[] | null>(null);
  const [deletingLocal, setDeletingLocal] = useState<Song | null>(null);
  const [busyDeleteLocal, setBusyDeleteLocal] = useState(false);
  /* 行内「更多」受控下拉（点击外部 / Esc / 选择后关闭） */
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuOpenFor) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpenFor(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpenFor(null);
    };
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpenFor]);
  /* 批量下载预检确认（替代 window.confirm） */
  const [batchConfirm, setBatchConfirm] = useState<{ total: number; skipped: number } | null>(null);

  /* 大列表增量渲染：初始 200 行，滚动到底自动追加（几千首歌单不卡顿；选择/批量仍作用于全量） */
  const [visibleCount, setVisibleCount] = useState(INITIAL_RENDER);
  const visibleSongs = useMemo(() => songs.slice(0, visibleCount), [songs, visibleCount]);
  useEffect(() => {
    setVisibleCount(INITIAL_RENDER);
  }, [songs]);
  const moreRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = moreRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCount((v) => v + RENDER_CHUNK);
        }
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const hasMoreRows = songs.length > visibleCount;

  /* 本地匹配只针对可见行（翻页后增量匹配，缓存模块级共享） */
  const inspect = useInspectQueue();
  const localMatch = useLocalMatch(visibleSongs);

  /* 批量模式 */
  const [batchMode, setBatchMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchSwitching, setBatchSwitching] = useState(false);

  const current = index >= 0 ? queue[index] : null;
  const isCurrent = (s: Song) => current?.id === s.id && current?.source === s.source;

  const toggleSelect = (s: Song) => {
    const key = songKey(s);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(songs.map(songKey)));
  const selectNone = () => setSelected(new Set());
  const selectedSongs = useMemo(() => songs.filter((s) => selected.has(songKey(s))), [songs, selected]);

  /** 本地已有 → 播放本地文件版本（对齐 Go playbackSong 构造） */
  const playbackSong = useCallback(
    (s: Song): Song => {
      const m = isOnlineSong(s) ? localMatch.cache.get(songKey(s)) : undefined;
      if (!m?.id) return s;
      return {
        ...s,
        id: m.id,
        source: "local",
        name: m.name || s.name,
        artist: m.artist || s.artist,
        extra: s.extra,
      };
    },
    [localMatch.cache],
  );

  const onPlay = useCallback(
    (s: Song) => {
      if (isCurrent(s)) toggle();
      else play(playbackSong(s), songs.map(playbackSong));
    },
    [current, play, toggle, songs, isCurrent, playbackSong],
  );

  const onDownload = useCallback((s: Song) => {
    const a = document.createElement("a");
    a.href = downloadUrl(s, true);
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.success(`开始下载：${s.name}`);
  }, []);

  /** 保存到服务器目录（save_local，对齐 Go .btn-download） */
  const onSaveLocal = useCallback(async (s: Song) => {
    const key = songKey(s);
    setSaving(key);
    try {
      const r = await apiSaveToLocal(s);
      if (r.skipped) toast.info(`已下载过，跳过：${r.filename}`);
      else toast.success(`已保存到服务器：${r.path}`);
      if (r.warning) toast.warning(r.warning, { duration: 6000 });
      if (r.webdav_error) toast.warning(`WebDAV 上传失败：${r.webdav_error}`, { duration: 6000 });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(null);
    }
  }, []);

  /** 换源：成功后行内更新数据（对齐 Go updateCardWithSong），可选播放 */
  const onSwitch = useCallback(
    async (s: Song, i: number, autoplay = false) => {
      const key = songKey(s);
      setSwitching(key);
      try {
        const body = await apiSwitchSource(s);
        if (!body?.id) throw new Error("未找到匹配");
        toast.success(`已切换 ${sourceMeta(body.source).label} 源：${body.name} - ${body.artist}`);
        if (onSongsChange) {
          const next = [...songs];
          next[i] = body;
          onSongsChange(next);
        }
        if (autoplay) play(body, songs.map((x, xi) => (xi === i ? body : x)));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "换源失败");
      } finally {
        setSwitching(null);
      }
    },
    [play, songs, onSongsChange],
  );

  /** 批量下载执行（并发保存到服务器） */
  const runBatchDownload = useCallback(async (targets: Song[]) => {
    setBatchConfirm(null);
    setBatchRunning(true);
    const CONCURRENCY = 3;
    let done = 0;
    let failed = 0;
    let cursor = 0;
    const toastId = toast.loading(`批量下载 0/${targets.length}…`, { duration: Infinity });
    const worker = async () => {
      while (cursor < targets.length) {
        const song = targets[cursor++];
        try {
          const r = await apiSaveToLocal(song);
          if (!r.skipped) done++;
        } catch {
          failed++;
        }
        toast.loading(`批量下载 ${done + failed}/${targets.length}（失败 ${failed}）…`, {
          id: toastId,
          duration: Infinity,
        });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
    toast.dismiss(toastId);
    if (failed === 0) toast.success(`批量下载完成：成功 ${done} 首`);
    else toast.warning(`批量下载结束：成功 ${done} 首，失败 ${failed} 首`);
    setBatchRunning(false);
    setBatchMode(false);
    selectNone();
  }, []);

  /** 批量下载：预检 → 确认弹窗 → 并发保存到服务器 */
  const onBatchDownload = useCallback(async () => {
    if (!selectedSongs.length) return;
    setBatchRunning(true);
    let skipped = 0;
    try {
      const pre = await apiDownloadsPrecheck(selectedSongs);
      skipped = pre.skipped;
    } catch {
      toast.warning("预检失败，直接开始下载");
    }
    setBatchRunning(false);
    if (skipped > 0) {
      setBatchConfirm({ total: selectedSongs.length, skipped });
      return;
    }
    await runBatchDownload(selectedSongs);
  }, [selectedSongs, runBatchDownload]);

  /** 删除本地歌曲（硬删除：移除下载目录文件 + 清索引；收藏条目保留显示为失效） */
  const onDeleteLocal = useCallback(async () => {
    const target = deletingLocal;
    if (!target) return;
    setBusyDeleteLocal(true);
    try {
      const r = await apiDeleteLocalMusic(target.id);
      const err = (r as { error?: string }).error;
      if (err) throw new Error(err);
      toast.success(`已删除本地文件：${target.name}`);
      onSongsChange?.(songs.filter((x) => !(x.id === target.id && x.source === target.source)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusyDeleteLocal(false);
      setDeletingLocal(null);
    }
  }, [deletingLocal, songs, onSongsChange]);

  /** 选择无效：勾选 inspect 检测为无效（或标记 is_invalid）的歌曲 */
  const onSelectInvalid = useCallback(() => {
    const invalidKeys = songs
      .filter((s) => s.is_invalid || inspect.map[songKey(s)]?.status === "fail")
      .map(songKey);
    if (!invalidKeys.length) {
      toast.info("没有检测到无效音源，可先点「检测音质」");
      return;
    }
    setSelected(new Set(invalidKeys));
    toast.info(`已选择 ${invalidKeys.length} 首无效音源歌曲`);
  }, [songs, inspect.map]);

  /** 批量换源：逐首换源并回写列表；已换源歌曲取消选中，避免重复换源 */
  const onBatchSwitch = useCallback(async () => {
    if (!selectedSongs.length) return;
    setBatchSwitching(true);
    const next = [...songs];
    const switchedKeys = new Set<string>();
    let ok = 0;
    let failed = 0;
    const toastId = toast.loading(`批量换源 0/${selectedSongs.length}…`, { duration: Infinity });
    for (const s of selectedSongs) {
      try {
        const body = await apiSwitchSource(s);
        if (!body?.id) throw new Error("未找到匹配");
        const i = next.findIndex((x) => x.id === s.id && x.source === s.source);
        if (i >= 0) next[i] = body;
        switchedKeys.add(songKey(s));
        ok++;
      } catch {
        failed++;
      }
      toast.loading(`批量换源 ${ok + failed}/${selectedSongs.length}（失败 ${failed}）…`, { id: toastId, duration: Infinity });
    }
    toast.dismiss(toastId);
    onSongsChange?.(next);
    // 换源成功的取消选中，避免重复换源；仍失败的保留选中便于重试
    setSelected((prev) => {
      const remain = new Set(prev);
      for (const k of switchedKeys) remain.delete(k);
      return remain;
    });
    if (failed === 0) toast.success(`批量换源完成：成功 ${ok} 首`);
    else toast.warning(`批量换源结束：成功 ${ok} 首，失败 ${failed} 首`);
    setBatchSwitching(false);
  }, [selectedSongs, songs, onSongsChange]);

  /** 歌手精确搜索 */
  const searchExactArtist = (token: string) => {
    router.push(`/?q=${encodeURIComponent(token)}&type=song&exact_artist=${encodeURIComponent(token)}`);
  };

  /** 专辑跳转（album_id 直跳 / album_jump 兜底） */
  const albumHref = (s: Song): string | null => {
    if (!s.album) return null;
    if (s.album_id) return `/album?id=${encodeURIComponent(s.album_id)}&source=${encodeURIComponent(s.source)}`;
    return `/album_jump?name=${encodeURIComponent(s.name)}&artist=${encodeURIComponent(s.artist)}&source=${encodeURIComponent(s.source)}`;
  };

  /** 跳转歌词视频渲染页（携带曲目参数） */
  const renderHref = (s: Song): string => {
    const p = new URLSearchParams({
      id: s.id,
      source: s.source,
      name: s.name,
      artist: s.artist || "",
      album: s.album || "",
      duration: String(Math.floor(s.duration || 0)),
    });
    if (s.cover) p.set("cover", s.cover);
    return `/render?${p.toString()}`;
  };

  const downloadCover = (s: Song) => {
    if (!s.cover) {
      toast.error("没有封面可下载");
      return;
    }
    const a = document.createElement("a");
    a.href = `/api/download_cover?url=${encodeURIComponent(s.cover)}&name=${encodeURIComponent(s.name)}&artist=${encodeURIComponent(s.artist)}`;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-2" role="status" aria-label="加载中">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="shimmer h-[60px] rounded-xl lg:h-[52px]" style={{ animationDelay: `${i * 60}ms` }} />
        ))}
      </div>
    );
  }

  if (!songs.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.04]">
          <Music4 className="h-7 w-7 text-zinc-500" />
        </span>
        <p className="text-sm text-zinc-500">{emptyHint ?? "暂无歌曲"}</p>
      </div>
    );
  }

  const inspectTag = (s: Song) => {
    if (s.is_invalid) {
      return (
        <span className="text-[10px] text-red-400" title="本地文件已删除，可换源到在线音源恢复播放">
          失效
        </span>
      );
    }
    const st = inspect.map[songKey(s)];
    if (!st) return null;
    if (st.status === "checking")
      return (
        <span className="flex items-center gap-1 text-[10px] text-cyan-300">
          <Loader2 className="h-3 w-3 animate-spin" /> 检测中
        </span>
      );
    if (st.status === "fail") return <span className="text-[10px] text-red-400">无效</span>;
    return (
      <span className="flex items-center gap-1.5 text-[10px] text-emerald-300/90">
        {st.bitrate && st.bitrate !== "-" ? <span>{st.bitrate}</span> : null}
        {st.size && st.size !== "-" ? <span className="text-zinc-500">{st.size}</span> : null}
      </span>
    );
  };

  /** "本地已有"徽章（对齐 Go addLocalMatchBadge：title 显示格式与提示） */
  const localBadge = (s: Song, extraCls = "") => {
    if (!isOnlineSong(s)) return null;
    const m = localMatch.cache.get(songKey(s));
    if (!m) return null;
    const sizeText = formatSizeBytesClient(m.size);
    return (
      <span
        title={`本地已有: ${m.ext || "音频"}${sizeText ? ` (${sizeText})` : ""}，播放将优先使用本地文件`}
        className={`inline-flex w-fit cursor-default items-center gap-1 rounded border border-sky-400/30 bg-sky-400/10 px-1.5 py-px text-[10px] text-sky-300 ${extraCls}`}
      >
        <HardDrive className="h-2.5 w-2.5" aria-hidden="true" />
        本地已有
      </span>
    );
  };

  return (
    <>
      {/* ---------- 工具条 ---------- */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button
          onClick={() => {
            setBatchMode((v) => !v);
            selectNone();
          }}
          aria-pressed={batchMode}
          className={`glass flex min-h-[38px] items-center gap-1.5 rounded-xl border px-3 text-[12.5px] font-medium transition-colors ${
            batchMode ? "border-violet-400/40 text-violet-200" : "border-white/[0.07] text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {batchMode ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
          批量
        </button>
        <button
          onClick={() => {
            if (inspect.map && Object.keys(inspect.map).length >= songs.length) {
              // 重新检测全部
            }
            visibleSongs.forEach((s) => inspect.enqueue(s));
          }}
          title="检测当前已显示的歌曲（滚动加载更多后可继续检测）"
          className="glass flex min-h-[38px] items-center gap-1.5 rounded-xl border border-white/[0.07] px-3 text-[12.5px] font-medium text-zinc-400 transition-colors hover:text-cyan-200"
        >
          <Gauge className="h-4 w-4" />
          检测音质
        </button>

        <AnimatePresence>
          {batchMode && (
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="flex flex-wrap items-center gap-2"
            >
              <button
                onClick={selected.size === songs.length ? selectNone : selectAll}
                className="glass flex min-h-[38px] items-center gap-1.5 rounded-xl border border-white/[0.07] px-3 text-[12.5px] text-zinc-300 hover:text-white"
              >
                <CheckCheck className="h-4 w-4" />
                {selected.size === songs.length ? "取消全选" : "全选"}
              </button>
              <button
                onClick={onSelectInvalid}
                title="勾选检测为无效（或已失效标记）的歌曲"
                className="glass flex min-h-[38px] items-center gap-1.5 rounded-xl border border-white/[0.07] px-3 text-[12.5px] text-zinc-300 hover:text-red-300"
              >
                <ShieldAlert className="h-4 w-4" />
                选择无效
              </button>
              <button
                onClick={() => (selectedSongs.length ? onBatchSwitch() : toast.info("请先选择歌曲"))}
                disabled={batchSwitching}
                title="对选中歌曲逐首跨源换源（相似度+时长+可播验证）"
                className="glass flex min-h-[38px] items-center gap-1.5 rounded-xl border border-white/[0.07] px-3 text-[12.5px] text-zinc-300 transition-colors hover:text-cyan-200 disabled:opacity-50"
              >
                {batchSwitching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                批量换源 {selected.size > 0 && `(${selected.size})`}
              </button>
              <button
                onClick={() => (selectedSongs.length ? setBatchCollect(selectedSongs) : toast.info("请先选择歌曲"))}
                className="glass flex min-h-[38px] items-center gap-1.5 rounded-xl border border-white/[0.07] px-3 text-[12.5px] text-zinc-300 hover:text-fuchsia-200"
              >
                <HeartPlus className="h-4 w-4" />
                收藏 {selected.size > 0 && <span className="text-fuchsia-300">{selected.size}</span>}
              </button>
              <button
                onClick={() => (selectedSongs.length ? onBatchDownload() : toast.info("请先选择歌曲"))}
                disabled={batchRunning}
                className="flex min-h-[38px] items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-3.5 text-[12.5px] font-semibold text-white shadow-lg shadow-fuchsia-500/20 transition-all hover:brightness-110 active:scale-95 disabled:opacity-50"
              >
                {batchRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                下载到服务器 {selected.size > 0 && `(${selected.size})`}
              </button>
              <span className="text-[11px] text-zinc-500">已选 {selected.size}/{songs.length}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ---------- PC 表格 ---------- */}
      <ul className="hidden divide-y divide-white/[0.04] lg:block" aria-label="歌曲列表">
        {visibleSongs.map((s, i) => {
          const meta = sourceMeta(s.source);
          const cur = isCurrent(s);
          const q = qualityTag(s.bitrate, s.ext);
          const swKey = songKey(s);
          const sel = selected.has(swKey);
          const albumLink = albumHref(s);
          const tokens = artistTokens(s.artist);
          return (
            <motion.li
              key={`${s.source}-${s.id}-${i}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.025, 0.5), duration: 0.28 }}
              className={`group grid grid-cols-[36px_44px_1fr_170px_minmax(88px,150px)_60px_190px] items-center gap-3 rounded-xl px-3 py-2 transition-colors ${
                cur ? "bg-gradient-to-r from-violet-500/[0.14] to-fuchsia-500/[0.08]" : sel ? "bg-violet-500/[0.08]" : "hover:bg-white/[0.035]"
              }`}
            >
              {/* 选择框 / 序号 */}
              <div className="flex h-11 w-9 items-center justify-center">
                {batchMode ? (
                  <button onClick={() => toggleSelect(s)} aria-label={`选择 ${s.name}`} aria-pressed={sel} className="flex h-11 w-9 items-center justify-center">
                    {sel ? <CheckSquare className="h-4.5 w-4.5 text-violet-300" /> : <Square className="h-4.5 w-4.5 text-zinc-500" />}
                  </button>
                ) : cur && playing ? (
                  <span className="flex items-end gap-[2px]" aria-hidden="true">
                    {[0, 1, 2].map((k) => (
                      <span key={k} className="eq-bar h-3.5 w-[2.5px] rounded-full bg-fuchsia-300" style={{ animationDelay: `${k * 0.18}s` }} />
                    ))}
                  </span>
                ) : (
                  <span className={`text-[13px] tabular-nums ${cur ? "text-fuchsia-300" : "text-zinc-500"}`}>{showIndex ? i + 1 : ""}</span>
                )}
              </div>
              {/* 播放按钮 */}
              <button
                onClick={() => onPlay(s)}
                aria-label={`播放 ${s.name}`}
                className={`flex h-11 w-11 items-center justify-center rounded-full transition-all active:scale-90 ${
                  cur ? "text-fuchsia-300" : "text-zinc-500 opacity-0 group-hover:opacity-100 hover:text-white"
                }`}
              >
                {cur && playing ? <Pause className="h-4 w-4" fill="currentColor" /> : <Play className="h-4 w-4" fill="currentColor" />}
              </button>
              {/* 标题 */}
              <div className="flex min-w-0 flex-col">
                <span className={`flex items-center gap-1 truncate text-[14px] font-semibold ${cur ? "text-fuchsia-200" : "text-zinc-100"}`}>
                  {s.link ? (
                    <a
                      href={s.link}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate decoration-dotted underline-offset-4 hover:text-white hover:underline"
                      title={`在${meta.label}打开`}
                    >
                      {s.name}
                    </a>
                  ) : (
                    <span className="truncate">{s.name}</span>
                  )}
                  {s.is_vip && <span className="shrink-0 align-middle text-[10px] font-bold text-amber-400/90">VIP</span>}
                  <span className="ml-1 shrink-0">{inspectTag(s)}</span>
                </span>
                <span className="flex truncate text-xs text-zinc-500">
                  {tokens.length > 0 ? tokens.map((t, ti) => (
                    <span key={ti} className="flex items-center">
                      {ti > 0 && <span className="mx-0.5 text-zinc-600">/</span>}
                      <button
                        onClick={() => searchExactArtist(t)}
                        className="max-w-[160px] truncate decoration-dotted underline-offset-4 hover:text-fuchsia-300 hover:underline"
                        title={`精确搜索：${t}`}
                      >
                        {t}
                      </button>
                    </span>
                  )) : "未知歌手"}
                </span>
              </div>
              {/* 专辑 */}
              {albumLink ? (
                <Link className="block truncate text-xs text-zinc-500 decoration-dotted underline-offset-4 hover:text-violet-300 hover:underline" href={albumLink} title={`查看专辑：${s.album}`}>
                  {s.album}
                </Link>
              ) : (
                <span className="truncate text-xs text-zinc-500">{s.album || "—"}</span>
              )}
              {/* 源 */}
              <span className="flex min-w-0 flex-wrap items-center gap-1">
                <span className={`inline-flex w-fit shrink-0 items-center rounded border px-1.5 py-px text-[10px] ${meta.badge}`}>
                  {meta.label}
                  {q ? <span className="ml-1 opacity-70">{q}</span> : null}
                </span>
                {localBadge(s)}
              </span>
              {/* 时长 */}
              <span className="text-right text-xs tabular-nums text-zinc-500">{fmtTimeClient(s.duration)}</span>
              {/* 操作 */}
              <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <button onClick={() => setCollectTarget(s)} aria-label={`收藏 ${s.name}`} title="收藏到歌单" className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-400 transition-all hover:text-fuchsia-300 active:scale-90">
                  <HeartPlus className="h-[17px] w-[17px]" />
                </button>
                <button onClick={() => onSwitch(s, i)} aria-label="换源" disabled={switching === swKey} title="换源匹配" className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-400 transition-all hover:text-cyan-300 active:scale-90 disabled:opacity-40">
                  {switching === swKey ? <Loader2 className="h-[17px] w-[17px] animate-spin" /> : <RefreshCcw className="h-[16px] w-[16px]" />}
                </button>
                {isOnlineSong(s) && (
                  <button onClick={() => onSaveLocal(s)} aria-label="保存到服务器" disabled={saving === swKey} title="保存到服务器下载目录" className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-400 transition-all hover:text-emerald-300 active:scale-90 disabled:opacity-40">
                    {saving === swKey ? <Loader2 className="h-[17px] w-[17px] animate-spin" /> : <Server className="h-[16px] w-[16px]" />}
                  </button>
                )}
                <button onClick={() => onDownload(s)} aria-label={`下载 ${s.name}`} title="浏览器下载" className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-400 transition-all hover:text-violet-300 active:scale-90">
                  <Download className="h-[17px] w-[17px]" />
                </button>
                <div className="relative" ref={menuOpenFor === swKey ? menuRef : undefined}>
                  <button
                    onClick={() => setMenuOpenFor(menuOpenFor === swKey ? null : swKey)}
                    aria-haspopup="menu"
                    aria-expanded={menuOpenFor === swKey}
                    aria-label="更多操作"
                    title="更多"
                    className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-400 transition-all hover:text-white active:scale-90"
                  >
                    <Plus className={`h-[17px] w-[17px] transition-transform duration-200 ${menuOpenFor === swKey ? "rotate-45" : ""}`} />
                  </button>
                  <AnimatePresence>
                    {menuOpenFor === swKey && (
                      <motion.div
                        initial={{ opacity: 0, y: -6, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -6, scale: 0.97 }}
                        transition={{ duration: 0.16 }}
                        role="menu"
                        className="absolute right-0 top-full z-30 mt-1 w-44 rounded-xl border border-white/[0.1] bg-zinc-900/95 p-1 shadow-2xl backdrop-blur-xl"
                      >
                        <a href={downloadLrcUrl(s)} onClick={() => setMenuOpenFor(null)} className="flex min-h-[40px] items-center gap-2 rounded-lg px-3 text-[13px] text-zinc-300 hover:bg-white/[0.06]">
                          <FileText className="h-4 w-4 text-zinc-500" /> 下载歌词
                        </a>
                        <button onClick={() => { downloadCover(s); setMenuOpenFor(null); }} className="flex min-h-[40px] w-full items-center gap-2 rounded-lg px-3 text-left text-[13px] text-zinc-300 hover:bg-white/[0.06]">
                          <ImageIcon className="h-4 w-4 text-zinc-500" /> 下载封面
                        </button>
                        <button onClick={() => { inspect.enqueue(s); setMenuOpenFor(null); }} className="flex min-h-[40px] w-full items-center gap-2 rounded-lg px-3 text-left text-[13px] text-zinc-300 hover:bg-white/[0.06]">
                          <Gauge className="h-4 w-4 text-zinc-500" /> 检测音质
                        </button>
                        <Link href={renderHref(s)} onClick={() => setMenuOpenFor(null)} className="flex min-h-[40px] items-center gap-2 rounded-lg px-3 text-[13px] text-zinc-300 hover:bg-white/[0.06]">
                          <Clapperboard className="h-4 w-4 text-zinc-500" /> 渲染歌词视频
                        </Link>
                        {s.link && (
                          <a href={s.link} target="_blank" rel="noreferrer" onClick={() => setMenuOpenFor(null)} className="flex min-h-[40px] items-center gap-2 rounded-lg px-3 text-[13px] text-zinc-300 hover:bg-white/[0.06]">
                            <ExternalLink className="h-4 w-4 text-zinc-500" /> 源站页面
                          </a>
                        )}
                        {!isOnlineSong(s) && (
                          <button onClick={() => { setDeletingLocal(s); setMenuOpenFor(null); }} className="flex min-h-[40px] w-full items-center gap-2 rounded-lg px-3 text-left text-[13px] text-red-300 hover:bg-red-500/10">
                            <Trash2 className="h-4 w-4" /> 删除本地文件
                          </button>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.li>
          );
        })}
      </ul>

      {/* ---------- 移动卡片 ---------- */}
      <ul className="flex flex-col gap-1.5 lg:hidden" aria-label="歌曲列表">
        {visibleSongs.map((s, i) => {
          const meta = sourceMeta(s.source);
          const cur = isCurrent(s);
          const swKey = songKey(s);
          const sel = selected.has(swKey);
          const tokens = artistTokens(s.artist);
          return (
            <motion.li
              key={`${s.source}-${s.id}-${i}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.6), duration: 0.28 }}
              className={`flex min-h-[64px] items-center gap-3 rounded-2xl px-3 py-2 transition-colors ${
                cur ? "bg-gradient-to-r from-violet-500/[0.16] to-fuchsia-500/[0.08] ring-1 ring-violet-400/25" : sel ? "bg-violet-500/[0.1] ring-1 ring-violet-400/20" : "bg-white/[0.03]"
              }`}
            >
              {batchMode && (
                <button onClick={() => toggleSelect(s)} aria-label={`选择 ${s.name}`} aria-pressed={sel} className="-ml-1 flex h-11 w-9 shrink-0 items-center justify-center">
                  {sel ? <CheckSquare className="h-5 w-5 text-violet-300" /> : <Square className="h-5 w-5 text-zinc-500" />}
                </button>
              )}
              <button
                onClick={() => onPlay(s)}
                aria-label={`播放 ${s.name}`}
                className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-zinc-800"
              >
                {s.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={coverUrl(s)} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <Music4 className="h-5 w-5 text-zinc-500" aria-hidden="true" />
                )}
                <span className={`absolute inset-0 flex items-center justify-center bg-black/50 transition-opacity ${cur ? "opacity-100" : "opacity-0"}`}>
                  {cur && playing ? (
                    <span className="flex items-end gap-[2px]">
                      {[0, 1, 2].map((k) => (
                        <span key={k} className="eq-bar h-3 w-[2.5px] rounded-full bg-fuchsia-300" style={{ animationDelay: `${k * 0.18}s` }} />
                      ))}
                    </span>
                  ) : (
                    <Play className="h-4 w-4 text-white" fill="currentColor" />
                  )}
                </span>
              </button>
              <button onClick={() => onPlay(s)} className="flex min-w-0 flex-1 flex-col items-start text-left">
                <span className={`flex w-full items-center gap-1.5 truncate text-[14px] font-semibold ${cur ? "text-fuchsia-200" : "text-zinc-100"}`}>
                  <span className="truncate">{s.name}</span>
                  {s.is_vip && <span className="shrink-0 text-[9px] font-bold text-amber-400/90">VIP</span>}
                  <span className="shrink-0">{inspectTag(s)}</span>
                </span>
                <span className="flex w-full items-center gap-1.5 text-[11.5px] text-zinc-500">
                  <span className={`shrink-0 rounded border px-1 py-px text-[9px] ${meta.badge}`}>{meta.label}</span>
                  {localBadge(s, "shrink-0 text-[9px]")}
                  {tokens.length > 0 ? (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        searchExactArtist(tokens[0]);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          searchExactArtist(tokens[0]);
                        }
                      }}
                      className="cursor-pointer truncate decoration-dotted underline-offset-4 hover:text-fuchsia-300"
                    >
                      {s.artist}
                    </span>
                  ) : (
                    <span className="truncate">{s.artist || "未知歌手"}</span>
                  )}
                  <span className="shrink-0 tabular-nums">{s.duration ? fmtTimeClient(s.duration) : ""}</span>
                </span>
              </button>
              {!batchMode && (
                <div className="flex shrink-0 items-center gap-0.5">
                  <button onClick={() => setCollectTarget(s)} aria-label="收藏" className="flex h-11 w-9 items-center justify-center text-zinc-500 active:scale-90">
                    <HeartPlus className="h-[18px] w-[18px]" />
                  </button>
                  <button onClick={() => onSwitch(s, i)} aria-label="换源" disabled={switching === swKey} title="换源匹配" className="flex h-11 w-9 items-center justify-center text-zinc-500 active:scale-90 disabled:opacity-40">
                    {switching === swKey ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <RefreshCcw className="h-[17px] w-[17px]" />}
                  </button>
                  {isOnlineSong(s) && (
                    <button onClick={() => onSaveLocal(s)} aria-label="保存到服务器" disabled={saving === swKey} className="flex h-11 w-9 items-center justify-center text-zinc-500 active:scale-90 disabled:opacity-40">
                      {saving === swKey ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Server className="h-[18px] w-[18px]" />}
                    </button>
                  )}
                  <button onClick={() => onDownload(s)} aria-label="下载" className="flex h-11 w-9 items-center justify-center text-zinc-500 active:scale-90">
                    <Download className="h-[18px] w-[18px]" />
                  </button>
                  {!isOnlineSong(s) && (
                    <button onClick={() => setDeletingLocal(s)} aria-label="删除本地文件" title="删除本地文件" className="flex h-11 w-9 items-center justify-center text-zinc-500 active:scale-90">
                      <Trash2 className="h-[18px] w-[18px]" />
                    </button>
                  )}
                </div>
              )}
            </motion.li>
          );
        })}
      </ul>

      {/* 增量渲染：滚动到底自动加载更多（大歌单） */}
      {hasMoreRows && (
        <div ref={moreRef} className="mt-3 flex flex-col items-center gap-1.5 py-2">
          <button
            onClick={() => setVisibleCount((v) => v + RENDER_CHUNK)}
            className="glass flex min-h-[40px] items-center gap-2 rounded-xl border border-white/[0.1] px-5 text-[12.5px] font-medium text-zinc-300 transition-colors hover:border-violet-400/30 active:scale-95"
          >
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
            显示更多（已显示 {visibleSongs.length} / {songs.length}）
          </button>
          <span className="text-[11px] text-zinc-500">继续滚动自动加载</span>
        </div>
      )}

      <CollectSheet song={collectTarget} onClose={() => setCollectTarget(null)} />
      <CollectSheet songs={batchCollect} onClose={() => setBatchCollect(null)} />

      {/* 批量下载预检确认：部分已下载过将被跳过 */}
      <ConfirmDialog
        open={!!batchConfirm}
        onClose={() => setBatchConfirm(null)}
        onConfirm={() => void runBatchDownload(selectedSongs)}
        busy={batchRunning}
        title="批量下载确认"
        confirmText={`下载 ${batchConfirm ? batchConfirm.total - batchConfirm.skipped : 0} 首`}
        description={
          batchConfirm && (
            <>
              选中 {batchConfirm.total} 首，其中 <span className="font-semibold text-amber-200">{batchConfirm.skipped} 首已下载过</span>将被跳过。
              <br />
              <span className="text-zinc-500">将下载剩余 {batchConfirm.total - batchConfirm.skipped} 首到服务器（并发 3）。</span>
            </>
          )
        }
      />

      {/* 删除本地歌曲二次确认（硬删除：移除文件 + 清索引） */}
      <ConfirmDialog
        open={!!deletingLocal}
        onClose={() => setDeletingLocal(null)}
        onConfirm={onDeleteLocal}
        busy={busyDeleteLocal}
        title="删除本地音乐"
        confirmText="删除"
        description={
          <>
            确定删除「{deletingLocal?.name ?? ""}」的本地文件吗？
            <br />
            <span className="text-zinc-500">将移除下载目录中的实际文件并清除索引；收藏过该歌的歌单条目会保留并显示为失效，可换源恢复。</span>
          </>
        }
      />
    </>
  );
}

/* ---------------- 收藏到底部抽屉（支持批量 + 内联新建歌单） ---------------- */

function CollectSheet({
  song,
  songs,
  onClose,
}: {
  song?: Song | null;
  songs?: Song[] | null;
  onClose: () => void;
}) {
  const target: Song[] | null = songs ?? (song ? [song] : null);
  const [collections, setCollections] = useState<{ id: number; name: string; kind: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (target) {
      // 含本地歌曲时只列自建歌单（外部导入歌单不支持直接添加本地音乐，避免服务端 400）
      const hasLocal = target.some((s) => s.source === "local" || s.source === "local-file");
      apiCollections(!hasLocal)
        .then((list) => setCollections(list))
        .catch(() => setCollections([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song, songs]);

  const add = async (id: number, name: string) => {
    if (!target) return;
    setBusy(true);
    try {
      const r = await apiBatchAddToCollection(id, target);
      if (r.duplicate > 0 && r.added === 0) toast.info(`已存在于「${name}」`);
      else toast.success(`已收藏 ${r.added} 首到「${name}」${r.duplicate ? `（${r.duplicate} 首重复跳过）` : ""}`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "收藏失败");
    } finally {
      setBusy(false);
    }
  };

  const createAndAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const c = await apiCreateCollection({ name });
      toast.success(`已创建歌单「${name}」`);
      await add(c.id, name);
    } catch {
      toast.error("创建歌单失败");
    } finally {
      setBusy(false);
      setCreating(false);
      setNewName("");
    }
  };

  return (
    <Modal open={!!target} onClose={busy ? () => undefined : onClose} title={target && target.length > 1 ? `收藏 ${target.length} 首歌曲` : "收藏歌曲"} maxWidth={440}>
      {target && (
        <>
          <p className="mb-3 truncate text-[13px] text-zinc-400">
            {target.length === 1 ? `${target[0].name} — ${target[0].artist}` : "将把选中的歌曲加入目标歌单"}
          </p>

          {creating ? (
            <div className="mb-3 flex gap-2">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createAndAdd()}
                placeholder="新歌单名称"
                aria-label="新歌单名称"
                className="min-h-[46px] flex-1 rounded-xl input-shell px-3 text-sm text-zinc-100"
              />
              <button
                onClick={createAndAdd}
                disabled={busy || !newName.trim()}
                className="flex min-h-[46px] items-center rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                创建并收藏
              </button>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="mb-3 flex min-h-[46px] w-full items-center gap-3 rounded-xl border border-dashed border-white/[0.12] px-3 text-left text-sm text-zinc-400 transition-colors hover:border-violet-400/40 hover:text-zinc-200"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/25 to-fuchsia-500/20">
                <Plus className="h-4 w-4 text-fuchsia-300" />
              </span>
              新建歌单
            </button>
          )}

          <div className="max-h-[46vh] overflow-y-auto">
            {collections.length === 0 && !creating ? (
              <p className="py-6 text-center text-sm text-zinc-500">还没有歌单，点上面新建一个吧</p>
            ) : (
              collections.map((c) => (
                <button
                  key={c.id}
                  onClick={() => add(c.id, c.name)}
                  disabled={busy}
                  className="flex min-h-[52px] w-full items-center gap-3 rounded-xl px-3 text-left transition-colors hover:bg-white/[0.05] disabled:opacity-50"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/25 to-fuchsia-500/20">
                    <ListPlus className="h-4 w-4 text-fuchsia-300" />
                  </span>
                  <span className="flex-1 truncate text-sm font-medium text-zinc-200">{c.name}</span>
                  <span className="text-[10px] text-zinc-500">{c.kind === "imported" ? "导入" : "自建"}</span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
