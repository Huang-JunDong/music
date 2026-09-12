"use client";

/**
 * 源站歌单操作弹窗（双模式）：
 * - songs=null：新建歌单（源选择 + 名称）
 * - songs=[...]：批量加入源站歌单（选择目标歌单 或 新建并加入）
 * 依赖对应源登录态；仅同源歌曲可加入（服务端校验）
 */
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Check, ListPlus, Loader2, Music4, Pencil, Plus, Users2, X } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/modal";
import { apiUserPlaylists, apiCreatePlaylist, apiManagePlaylistSongs, apiUpdateSourcePlaylist } from "@/lib/client/api";
import { coverProxyUrl, sourceMeta } from "@/lib/play-url";
import type { Playlist, Song } from "@/lib/types";

/* 歌单列表模块级缓存（源维度） */
const userPlaylistsCache = new Map<string, Playlist[]>();

export function SourcePlaylistSheet({ songs, onClose }: { songs: Song[] | null; onClose: () => void }) {
  /* 源选择：默认取歌曲中首个支持源 */
  const supported = useMemo(() => {
    if (!songs) return ["netease", "qq"] as ("netease" | "qq")[];
    const set = new Set(songs.map((s) => s.source).filter((s) => s === "netease" || s === "qq"));
    return [...set] as ("netease" | "qq")[];
  }, [songs]);

  const [source, setSource] = useState<"netease" | "qq">(supported[0] ?? "netease");
  const [playlists, setPlaylists] = useState<Playlist[] | null>(userPlaylistsCache.get(supported[0] ?? "netease") ?? null);
  const [loadingLists, setLoadingLists] = useState(false);
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"pick" | "create">("pick");

  /* 同源可加入的歌曲数 */
  const sameSourceSongs = useMemo(
    () => (songs ? songs.filter((s) => s.source === source) : []),
    [songs, source],
  );

  /* 拉取该源用户歌单（仅加入模式需要） */
  useEffect(() => {
    if (!songs || mode !== "pick") return;
    const cached = userPlaylistsCache.get(source);
    if (cached) {
      setPlaylists(cached);
      return;
    }
    let alive = true;
    setLoadingLists(true);
    apiUserPlaylists([source])
      .then((r) => {
        if (!alive) return;
        const list = r.tabs?.[0]?.playlists ?? [];
        userPlaylistsCache.set(source, list);
        setPlaylists(list);
      })
      .catch(() => {
        if (alive) setPlaylists([]);
      })
      .finally(() => {
        if (alive) setLoadingLists(false);
      });
    return () => {
      alive = false;
    };
  }, [source, mode, songs]);

  const onCreate = async () => {
    const n = name.trim();
    if (!n || creating) return;
    setCreating(true);
    try {
      const r = await apiCreatePlaylist(source, n);
      toast.success(`已创建「${n}」`);
      userPlaylistsCache.delete(source);
      if (!songs) {
        onClose();
        return;
      }
      if (sameSourceSongs.length && r.playlist_id) {
        /* 创建与加歌两步独立反馈：加歌失败不影响"已创建"事实（审核整改 P3-4） */
        try {
          await apiManagePlaylistSongs("add_songs", source, r.playlist_id, sameSourceSongs);
          toast.success(`已将 ${sameSourceSongs.length} 首加入「${n}」`);
        } catch (e) {
          toast.error(e instanceof Error ? `歌单已创建，加入失败：${e.message}` : "歌单已创建，但加入失败");
        }
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建失败（可能需要登录对应源账号）");
    } finally {
      setCreating(false);
    }
  };

  const onAddTo = async (p: Playlist) => {
    if (!sameSourceSongs.length || adding) return;
    setAdding(p.id);
    try {
      const r = await apiManagePlaylistSongs("add_songs", source, p.id, sameSourceSongs);
      toast.success(`已将 ${r.count ?? sameSourceSongs.length} 首加入「${p.name}」`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "添加失败（可能需要登录对应源账号）");
    } finally {
      setAdding(null);
    }
  };

  /* 源站歌单重命名（仅网易支持：playlist_update） */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renaming, setRenaming] = useState(false);

  const onRename = async (p: Playlist) => {
    const n = renameDraft.trim();
    if (!n || renaming) return;
    if (n === p.name) {
      setRenamingId(null);
      return;
    }
    setRenaming(true);
    try {
      await apiUpdateSourcePlaylist(source, p.id, n);
      toast.success("歌单已重命名");
      const next = (playlists ?? []).map((x) => (x.id === p.id ? { ...x, name: n } : x));
      setPlaylists(next);
      userPlaylistsCache.set(source, next);
      setRenamingId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "重命名失败（可能需要登录对应源账号）");
    } finally {
      setRenaming(false);
    }
  };

  return (
    <Modal open onClose={onClose} maxWidth={480} title={songs ? "加入源站歌单" : "新建源站歌单"}>
      {/* 源选择 */}
      {supported.length > 1 ? (
        <div className="mb-3 flex gap-1.5" role="tablist" aria-label="目标源">
          {supported.map((s) => {
            const meta = sourceMeta(s);
            const active = s === source;
            return (
              <button
                key={s}
                role="tab"
                aria-selected={active}
                onClick={() => setSource(s)}
                className={`flex min-h-[36px] flex-1 items-center justify-center gap-1.5 rounded-xl border text-[12.5px] font-medium transition-all active:scale-95 ${
                  active
                    ? "border-violet-400/40 bg-violet-500/20 text-violet-100 ring-1 ring-violet-400/30"
                    : "border-white/[0.1] bg-white/[0.02] text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
                {meta.label}
                {songs && <span className="tabular-nums opacity-70">{songs.filter((x) => x.source === s).length} 首</span>}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="mb-3 text-[12px] text-zinc-500">
          {sourceMeta(source).label}
          {songs ? ` · ${sameSourceSongs.length} 首可加入` : " · 登录后可创建"}
        </p>
      )}

      {/* 模式切换（仅加入模式） */}
      {songs && (
        <div className="mb-3 flex gap-1.5">
          {[
            { key: "pick" as const, label: "选择歌单", icon: ListPlus },
            { key: "create" as const, label: "新建并加入", icon: Plus },
          ].map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.key}
                onClick={() => setMode(m.key)}
                aria-pressed={mode === m.key}
                className={`flex min-h-[32px] items-center gap-1 rounded-full border px-3 text-[11.5px] font-medium transition-all active:scale-95 ${
                  mode === m.key
                    ? "border-fuchsia-400/40 bg-fuchsia-500/15 text-fuchsia-100"
                    : "border-white/[0.1] bg-white/[0.02] text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Icon className="h-3 w-3" aria-hidden="true" />
                {m.label}
              </button>
            );
          })}
        </div>
      )}

      {/* 选择歌单列表 */}
      {songs && mode === "pick" ? (
        loadingLists || playlists === null ? (
          <div className="space-y-2 py-2" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="shimmer h-14 rounded-xl" />
            ))}
          </div>
        ) : !playlists.length ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Users2 className="h-8 w-8 text-zinc-600" aria-hidden="true" />
            <p className="text-[13px] text-zinc-500">该源没有可用的歌单（未登录）</p>
            <button onClick={() => setMode("create")} className="text-[12.5px] text-violet-300 hover:text-violet-200">
              新建一个 →
            </button>
          </div>
        ) : (
          <ul className="max-h-[46vh] space-y-1.5 overflow-y-auto pr-1">
            {playlists.map((p, i) => (
              <motion.li
                key={`${p.source}-${p.id}`}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.03, 0.3), duration: 0.2 }}
              >
                {renamingId === p.id ? (
                  /* 重命名编辑态：输入 + 确认/取消 */
                  <div className="glass flex w-full items-center gap-1.5 rounded-xl border border-violet-400/30 p-2">
                    <label className="sr-only" htmlFor={`rename-${p.id}`}>
                      歌单新名称
                    </label>
                    <input
                      id={`rename-${p.id}`}
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value.slice(0, 40))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void onRename(p);
                        } else if (e.key === "Escape") {
                          setRenamingId(null);
                        }
                      }}
                      maxLength={40}
                      className="input-shell min-h-[38px] min-w-0 flex-1 rounded-lg px-2.5 text-[13px] text-zinc-100"
                    />
                    <button
                      onClick={() => void onRename(p)}
                      disabled={renaming || !renameDraft.trim()}
                      aria-label="确认重命名"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/20 text-violet-200 transition-colors hover:bg-violet-500/30 disabled:opacity-40"
                    >
                      {renaming ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
                    </button>
                    <button
                      onClick={() => setRenamingId(null)}
                      aria-label="取消重命名"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-zinc-400 transition-colors hover:bg-white/[0.08]"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => void onAddTo(p)}
                      disabled={!sameSourceSongs.length || adding !== null}
                      aria-label={`加入歌单 ${p.name}`}
                      className="glass group flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-white/[0.07] p-2 text-left transition-all hover:border-violet-400/30 active:scale-[0.99] disabled:opacity-50"
                    >
                      <span className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-zinc-800">
                        {p.cover ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={coverProxyUrl(p.cover, p.source)} alt="" loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                          <span className="flex h-full items-center justify-center">
                            <Music4 className="h-4 w-4 text-zinc-600" aria-hidden="true" />
                          </span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="tip block truncate text-[13px] font-semibold text-zinc-200">
                          {p.name}
                          <span className="tip-bubble">
                            <span className="tip-name">{p.name}</span>
                            <span className="tip-sub">{p.track_count} 首</span>
                          </span>
                        </span>
                        <span className="mt-0.5 block text-[11px] tabular-nums text-zinc-500">{p.track_count} 首</span>
                      </span>
                      {adding === p.id ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-300" aria-hidden="true" />
                      ) : (
                        <ListPlus className="h-4 w-4 shrink-0 text-zinc-500 transition-colors group-hover:text-violet-300" aria-hidden="true" />
                      )}
                    </button>
                    {/* 重命名（仅网易源：playlist_update；QQ 无对应接口） */}
                    {source === "netease" ? (
                      <button
                        onClick={() => {
                          setRenamingId(p.id);
                          setRenameDraft(p.name);
                        }}
                        aria-label={`重命名歌单 ${p.name}`}
                        title="重命名"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-zinc-600 transition-colors hover:bg-white/[0.05] hover:text-zinc-300"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                )}
              </motion.li>
            ))}
          </ul>
        )
      ) : (
        /* 新建表单 */
        <div className="py-1">
          <label className="sr-only" htmlFor="new-playlist-name">
            歌单名称
          </label>
          <input
            id="new-playlist-name"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 40))}
            placeholder={`在${sourceMeta(source).label}创建的新歌单名`}
            className="input-shell min-h-[46px] w-full rounded-xl px-3.5 text-[13.5px] text-zinc-100"
          />
          {songs && sameSourceSongs.length > 0 && (
            <p className="mt-2 text-[11.5px] text-zinc-500">
              创建后将自动加入 {sameSourceSongs.length} 首{source === "netease" ? "网易云" : "QQ音乐"}歌曲
            </p>
          )}
          <button
            onClick={() => void onCreate()}
            disabled={!name.trim() || creating}
            className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/25 transition-all hover:brightness-110 active:scale-95 disabled:opacity-40"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
            {creating ? "创建中…" : "创建歌单"}
          </button>
        </div>
      )}
    </Modal>
  );
}
