"use client";

/**
 * 本地歌单详情（?id=）
 * 头部卡（全部播放 / 批量导入本地音乐 / 导入源跳转）+ SongList
 * 自建歌单支持「管理视图」删除单曲；导入歌单显示来源徽章与原链
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import {
  ArrowLeft,
  Play,
  HardDrive,
  ExternalLink,
  ListMusic,
  Loader2,
  Trash2,
  Music4,
  Check,
  ListChecks,
} from "lucide-react";
import { toast } from "sonner";
import { Modal, ConfirmDialog } from "@/components/modal";
import { SongList } from "@/components/song-list";
import {
  apiCollections,
  apiCollectionSongs,
  apiRemoveSongFromCollection,
  apiLocalMusic,
  apiAddLocalMusicBatch,
  type LocalCollection,
  type LocalTrack,
} from "@/lib/client/api";
import { usePlayer } from "@/lib/client/store";
import { coverProxyUrl, sourceMeta } from "@/lib/play-url";
import { fmtTimeClient } from "@/lib/client/ui";
import type { Song } from "@/lib/types";

/** LocalTrack → Song（播放/收藏用） */
function trackToSong(t: LocalTrack): Song {
  return {
    id: t.id,
    name: t.name,
    artist: t.artist,
    album: t.album,
    duration: t.duration,
    size: t.size,
    bitrate: 0,
    source: "local",
    url: "",
    cover: t.cover,
    link: "",
    ext: t.ext,
    extra: t.extra,
  };
}

export default function CollectionPage() {
  return (
    <Suspense fallback={<CollectionFallback />}>
      <CollectionDetailInner />
    </Suspense>
  );
}

function CollectionDetailInner() {
  const router = useRouter();
  const params = useSearchParams();
  const idNum = Number(params.get("id"));

  const [meta, setMeta] = useState<LocalCollection | null>(null);
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [manage, setManage] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Song | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const { play } = usePlayer();

  const load = useCallback(() => {
    if (!Number.isFinite(idNum) || idNum <= 0) {
      setNotFound(true);
      return;
    }
    setError("");
    Promise.all([apiCollections(true), apiCollectionSongs(idNum)])
      .then(([cols, ss]) => {
        const m = cols.find((c) => c.id === idNum) ?? null;
        setMeta(m);
        setSongs(ss);
        if (!m) setNotFound(true);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"));
  }, [idNum]);

  useEffect(() => {
    load();
  }, [load]);

  const onRemove = async (s: Song) => {
    // 二次确认（对齐 Go removeSongFromCollection 的 confirm）
    setRemoveTarget(s);
  };

  const doRemove = async () => {
    const s = removeTarget;
    if (!s) return;
    const key = `${s.source}:${s.id}`;
    setRemoving(key);
    try {
      const r = await apiRemoveSongFromCollection(idNum, s.id, s.source);
      const err = (r as { error?: string }).error;
      if (err) throw new Error(err);
      toast.success(`已移出「${s.name}」`);
      setSongs((prev) => (prev ? prev.filter((x) => !(x.id === s.id && x.source === s.source)) : prev));
      setMeta((m) => (m ? { ...m, track_count: Math.max(0, m.track_count - 1) } : m));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "移除失败");
    } finally {
      setRemoving(null);
      setRemoveTarget(null);
    }
  };

  if (notFound) {
    return (
      <div className="mx-auto w-full max-w-[1200px] px-4 py-6 lg:px-8 lg:py-10">
        <button
          onClick={() => router.back()}
          className="-ml-2 mb-4 flex h-11 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> 返回
        </button>
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.04]">
            <ListMusic className="h-7 w-7 text-zinc-500" aria-hidden="true" />
          </span>
          <p className="text-sm text-zinc-400">歌单不存在或已被删除</p>
          <Link
            href="/collections"
            className="mt-1 flex h-11 items-center rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 text-sm font-semibold text-white hover:brightness-110 active:scale-95"
          >
            回我的歌单
          </Link>
        </div>
      </div>
    );
  }

  const isManual = meta?.kind === "manual";
  const srcMeta = meta ? sourceMeta(meta.source) : null;

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 lg:px-8 lg:py-10">
      <button
        onClick={() => router.back()}
        className="-ml-2 mb-4 flex h-11 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-zinc-100"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> 返回
      </button>

      {error ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10">
            <Music4 className="h-7 w-7 text-red-300/80" aria-hidden="true" />
          </span>
          <p className="text-sm text-zinc-400">{error}</p>
          <button
            onClick={load}
            className="mt-1 flex h-11 items-center rounded-xl border border-white/[0.12] bg-white/[0.04] px-5 text-sm font-medium text-zinc-200 hover:bg-white/[0.08] active:scale-95"
          >
            重试
          </button>
        </div>
      ) : !meta || songs === null ? (
        <CollectionFallback />
      ) : (
        <>
          {/* ---------- 头部卡 ---------- */}
          <motion.section
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            aria-label={`歌单信息：${meta.name}`}
            className="glass rounded-3xl border border-white/[0.1] p-4 lg:p-6"
          >
            <div className="flex flex-col gap-5 sm:flex-row">
              <div className="h-40 w-40 shrink-0 self-center overflow-hidden rounded-2xl bg-zinc-800/80 ring-1 ring-white/10 sm:self-start lg:h-44 lg:w-44">
                {meta.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={coverProxyUrl(meta.cover, meta.source)} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center bg-gradient-to-br from-violet-500/15 via-fuchsia-500/10 to-cyan-400/10">
                    <ListMusic className="h-11 w-11 text-zinc-500" aria-hidden="true" />
                  </div>
                )}
              </div>

              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex flex-wrap items-center gap-2">
                  {meta.kind === "imported" && srcMeta ? (
                    <span className={`rounded border px-1.5 py-px text-[10px] ${srcMeta.badge}`}>
                      来自 {srcMeta.label} 的导入歌单
                    </span>
                  ) : (
                    <span className="rounded border border-white/[0.1] bg-white/[0.04] px-1.5 py-px text-[10px] text-zinc-400">
                      自建歌单
                    </span>
                  )}
                </div>
                <h1 className="mt-2 text-xl font-extrabold leading-snug text-zinc-50 lg:text-2xl">{meta.name}</h1>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
                  <span className="tabular-nums">{songs.length || meta.track_count || 0} 首</span>
                  {meta.creator && <span>· {meta.creator}</span>}
                  <span>· 创建于 {fmtDate(meta.created_at)}</span>
                </p>
                {meta.description && <p className="mt-2.5 line-clamp-2 text-xs leading-relaxed text-zinc-500" title={meta.description}>{meta.description}</p>}

                {/* 操作 */}
                <div className="mt-4 flex flex-wrap items-center gap-2.5">
                  <button
                    onClick={() => songs.length && play(songs[0], songs)}
                    disabled={!songs.length}
                    className="flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-6 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/25 transition-all hover:brightness-110 active:scale-95 disabled:opacity-50"
                  >
                    <Play className="h-4 w-4" fill="currentColor" aria-hidden="true" /> 全部播放
                  </button>

                  {isManual && (
                    <>
                      <button
                        onClick={() => setImportOpen(true)}
                        className="flex h-11 items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] px-5 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.08] active:scale-95"
                      >
                        <HardDrive className="h-4 w-4" aria-hidden="true" /> 导入本地音乐
                      </button>
                      {/* 播放 / 管理视图切换 */}
                      <div className="glass inline-flex rounded-xl border border-white/[0.07] p-1" role="tablist" aria-label="视图切换">
                        {([
                          { key: false, label: "播放视图" },
                          { key: true, label: "管理歌曲" },
                        ] as const).map((v) => (
                          <button
                            key={String(v.key)}
                            role="tab"
                            aria-selected={manage === v.key}
                            onClick={() => setManage(v.key)}
                            className={`relative flex min-h-[36px] items-center rounded-lg px-3 text-xs font-medium transition-colors ${
                              manage === v.key ? "text-white" : "text-zinc-400 hover:text-zinc-200"
                            }`}
                          >
                            {manage === v.key && (
                              <motion.span
                                layoutId="collection-view-pill"
                                className="absolute inset-0 rounded-lg bg-gradient-to-r from-violet-500/25 to-fuchsia-500/20 ring-1 ring-violet-400/30"
                                transition={{ type: "spring", stiffness: 420, damping: 34 }}
                              />
                            )}
                            <span className="relative">{v.label}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  {meta.kind === "imported" && meta.link && (
                    <a
                      href={meta.link}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="在源站打开"
                      title="在源站打开"
                      className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.12] bg-white/[0.04] text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-zinc-100 active:scale-95"
                    >
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </a>
                  )}
                </div>
              </div>
            </div>
          </motion.section>

          {/* ---------- 曲目 ---------- */}
          <div className="mt-5">
            {isManual && manage ? (
              <ManageList songs={songs} removing={removing} onRemove={onRemove} onPlay={(s) => play(s, songs)} />
            ) : (
              <>
                <div className="mb-3 mt-2 flex items-baseline gap-2">
                  <h2 className="text-[15px] font-bold text-zinc-100">曲目</h2>
                  <span className="text-xs tabular-nums text-zinc-500">{songs.length} 首</span>
                </div>
                <SongList
                  songs={songs}
                  emptyHint={isManual ? "空歌单：点上方「导入本地音乐」，或在任意歌曲里收藏进来" : "该歌单没有曲目"}
                  onSongsChange={setSongs}
                />
              </>
            )}
          </div>
        </>
      )}

      {/* ---------- 移出歌曲二次确认 ---------- */}
      <ConfirmDialog
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={doRemove}
        busy={!!removing}
        title="移出歌曲"
        confirmText="移出"
        description={<>确定将「{removeTarget?.name ?? ""}」移出当前歌单吗？</>}
      />

      {/* ---------- 批量导入本地音乐 ---------- */}
      <ImportLocalModal
        open={importOpen}
        collectionId={idNum}
        onClose={() => setImportOpen(false)}
        onImported={load}
      />
    </div>
  );
}

/* ---------------- 管理视图：可删除单曲 ---------------- */

function ManageList({
  songs,
  removing,
  onRemove,
  onPlay,
}: {
  songs: Song[];
  removing: string | null;
  onRemove: (s: Song) => void;
  onPlay: (s: Song) => void;
}) {
  if (!songs.length) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.04]">
          <ListChecks className="h-7 w-7 text-zinc-500" aria-hidden="true" />
        </span>
        <p className="text-sm text-zinc-500">空歌单，先去添加一些歌曲吧</p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-1.5" aria-label="管理歌曲列表">
      {songs.map((s, i) => {
        const key = `${s.source}:${s.id}`;
        return (
          <motion.li
            key={`${key}-${i}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.03, 0.5), duration: 0.28 }}
            className="flex min-h-[64px] items-center gap-3 rounded-2xl bg-white/[0.03] px-3 py-2 transition-colors hover:bg-white/[0.05]"
          >
            <button
              onClick={() => onPlay(s)}
              aria-label={`播放 ${s.name}`}
              className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-zinc-800"
            >
              {s.cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={coverProxyUrl(s.cover, s.source)} alt="" className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <Music4 className="h-5 w-5 text-zinc-500" aria-hidden="true" />
              )}
              <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity hover:opacity-100">
                <Play className="h-4 w-4 text-white" fill="currentColor" aria-hidden="true" />
              </span>
            </button>
            <button onClick={() => onPlay(s)} className="flex min-w-0 flex-1 flex-col items-start text-left">
              <span className="w-full truncate text-[14px] font-semibold text-zinc-100" title={`${s.name} - ${s.artist || "未知歌手"}`}>{s.name}</span>
              <span className="flex w-full items-center gap-1.5 text-[11.5px] text-zinc-500">
                <span className={`shrink-0 rounded border px-1 py-px text-[9px] ${sourceMeta(s.source).badge}`}>{sourceMeta(s.source).label}</span>
                <span className="min-w-0 flex-1 truncate">{s.artist || "未知歌手"}</span>
                <span className="shrink-0 tabular-nums">{s.duration ? fmtTimeClient(s.duration) : ""}</span>
              </span>
            </button>
            <button
              onClick={() => onRemove(s)}
              disabled={removing === key}
              aria-label={`移出 ${s.name}`}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors hover:text-red-300 active:scale-90 disabled:opacity-40"
            >
              {removing === key ? <Loader2 className="h-[17px] w-[17px] animate-spin" /> : <Trash2 className="h-[17px] w-[17px]" />}
            </button>
          </motion.li>
        );
      })}
    </ul>
  );
}

/* ---------------- 批量导入本地音乐模态 ---------------- */

function ImportLocalModal({
  open,
  collectionId,
  onClose,
  onImported,
}: {
  open: boolean;
  collectionId: number;
  onClose: () => void;
  onImported: () => void;
}) {
  const [tracks, setTracks] = useState<LocalTrack[] | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTracks(null);
    setSelected(new Set());
    setError("");
    // 传 collection_id：后端标记「已在该歌单」状态
    apiLocalMusic({ limit: 500, collection_id: collectionId })
      .then((r) => setTracks(r.tracks ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : "加载本地音乐失败"));
  }, [open, collectionId]);

  const toggle = (t: LocalTrack) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(t.id)) n.delete(t.id);
      else n.add(t.id);
      return n;
    });
  };

  const confirmAdd = async () => {
    const chosen = (tracks ?? []).filter((t) => selected.has(t.id));
    if (!chosen.length) return;
    setBusy(true);
    try {
      // 批量端点（单事务 + 返回 added/duplicate/failed），取代逐条 POST
      const r = await apiAddLocalMusicBatch(collectionId, chosen.map((t) => t.id));
      const err = (r as { error?: string }).error;
      if (err) throw new Error(err);
      if (r.added > 0) {
        toast.success(`已添加 ${r.added} 首${r.duplicate > 0 ? `（${r.duplicate} 首已存在）` : ""}${r.failed > 0 ? `，${r.failed} 首失败` : ""}`);
        onImported();
        onClose();
      } else if (r.duplicate > 0) {
        toast.info(`所选 ${r.duplicate} 首均已在该歌单中`);
        onImported();
        onClose();
      } else {
        toast.error("添加失败，请重试");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "添加失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="导入本地音乐" maxWidth={520}>
      {error ? (
        <p className="py-6 text-center text-sm text-zinc-400">{error}</p>
      ) : tracks === null ? (
        <div className="flex flex-col gap-2 py-2" role="status" aria-label="加载中">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[56px] animate-pulse rounded-xl bg-white/[0.035]" style={{ animationDelay: `${i * 60}ms` }} />
          ))}
        </div>
      ) : tracks.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.04]">
            <HardDrive className="h-6 w-6 text-zinc-500" aria-hidden="true" />
          </span>
          <p className="text-sm text-zinc-400">本地音乐库是空的</p>
          <Link
            href="/local"
            className="mt-1 flex h-11 items-center rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 text-sm font-semibold text-white hover:brightness-110 active:scale-95"
          >
            去本地上传
          </Link>
        </div>
      ) : (
        <>
          <p className="mb-3 text-xs text-zinc-500">共 {tracks.length} 首本地音乐，勾选后添加到该歌单</p>
          <ul className="max-h-[46vh] overflow-y-auto">
            {tracks.map((t) => {
              const checked = selected.has(t.id);
              const added = t.already_added;
              return (
                <li key={t.id}>
                  <button
                    onClick={() => !added && toggle(t)}
                    disabled={added}
                    aria-pressed={checked}
                    className={`flex min-h-[56px] w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors ${
                      added ? "opacity-45" : "hover:bg-white/[0.05] active:scale-[0.99]"
                    }`}
                  >
                    <span
                      className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border transition-colors ${
                        checked ? "border-transparent bg-gradient-to-br from-violet-500 to-fuchsia-500" : "border-white/[0.18] bg-white/[0.02]"
                      }`}
                      aria-hidden="true"
                    >
                      {checked && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="w-full truncate text-[13.5px] font-semibold text-zinc-100" title={`${t.name} - ${t.artist || "未知歌手"}`}>{t.name}</span>
                      <span className="flex w-full items-center gap-1.5 text-[11px] text-zinc-500">
                        <span className="min-w-0 flex-1 truncate">{t.artist || "未知歌手"}</span>
                        <span className="shrink-0">{t.size_text || ""}</span>
                        <span className="shrink-0 tabular-nums">{t.duration ? fmtTimeClient(t.duration) : ""}</span>
                      </span>
                    </span>
                    {added && <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-px text-[10px] text-zinc-400">已在该歌单</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-zinc-500">
              已选 <span className="tabular-nums text-fuchsia-300">{selected.size}</span> 首
            </p>
            <div className="flex gap-2.5">
              <button
                onClick={onClose}
                className="h-11 rounded-xl border border-white/[0.1] bg-white/[0.03] px-4 text-sm font-medium text-zinc-300 hover:bg-white/[0.06] active:scale-[0.98]"
              >
                取消
              </button>
              <button
                onClick={confirmAdd}
                disabled={busy || selected.size === 0}
                className="flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/25 transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
                添加到歌单
              </button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

/* ---------------- 骨架 ---------------- */

function CollectionFallback() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 lg:px-8 lg:py-10" aria-busy="true">
      <div className="mb-4 h-11 w-20 animate-pulse rounded-xl bg-white/[0.04]" />
      <div className="glass flex flex-col gap-5 rounded-3xl border border-white/[0.1] p-4 sm:flex-row lg:p-6">
        <div className="h-40 w-40 shrink-0 animate-pulse rounded-2xl bg-white/[0.05]" />
        <div className="flex flex-1 flex-col gap-3 py-2">
          <div className="h-4 w-32 animate-pulse rounded bg-white/[0.05]" />
          <div className="h-7 w-1/2 animate-pulse rounded bg-white/[0.05]" />
          <div className="h-3.5 w-2/5 animate-pulse rounded bg-white/[0.04]" />
          <div className="mt-2 flex gap-2.5">
            <div className="h-11 w-28 animate-pulse rounded-xl bg-white/[0.05]" />
            <div className="h-11 w-32 animate-pulse rounded-xl bg-white/[0.04]" />
          </div>
        </div>
      </div>
      <div className="mt-6 flex flex-col gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-[60px] animate-pulse rounded-xl bg-white/[0.035]" style={{ animationDelay: `${i * 60}ms` }} />
        ))}
      </div>
    </div>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || "—";
  return d.toLocaleDateString("zh-CN");
}
