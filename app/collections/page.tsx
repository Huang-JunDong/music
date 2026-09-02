"use client";

/**
 * 我的本地歌单：自建 + 导入（include_imported=1）
 * 新建 / 编辑 / 删除（自建）；导入歌单显示来源徽章并可跳原链
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { Plus, ListMusic, Pencil, Trash2, MoreVertical, ExternalLink, Loader2, Music4 } from "lucide-react";
import { toast } from "sonner";
import { Modal, ConfirmDialog } from "@/components/modal";
import { PageHeader } from "@/components/page-header";
import {
  apiCollections,
  apiCreateCollection,
  apiUpdateCollection,
  apiDeleteCollection,
  type LocalCollection,
} from "@/lib/client/api";
import { coverProxyUrl, sourceMeta } from "@/lib/play-url";

export default function CollectionsPage() {
  const [list, setList] = useState<LocalCollection[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<LocalCollection | null>(null);
  const [deleting, setDeleting] = useState<LocalCollection | null>(null);
  const [menuFor, setMenuFor] = useState<LocalCollection | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiCollections(true)
      .then((r) => {
        setList(r);
        setError("");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      const r = await apiDeleteCollection(deleting.id);
      const err = (r as { error?: string }).error;
      if (err) throw new Error(err);
      toast.success(`已删除「${deleting.name}」`);
      setDeleting(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  const manualCount = list?.filter((c) => c.kind === "manual").length ?? 0;
  const importedCount = list?.filter((c) => c.kind === "imported").length ?? 0;

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 lg:px-8 lg:py-10">
      {/* ---------- 页头（统一 PageHeader） ---------- */}
      <PageHeader
        icon={ListMusic}
        title="我的歌单"
        subtitle={list === null ? "加载中…" : `${manualCount} 个自建 · ${importedCount} 个导入`}
        actions={
          <button
            onClick={() => setCreating(true)}
            className="flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/25 transition-all hover:brightness-110 active:scale-95"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> 新建歌单
          </button>
        }
      />

      {/* ---------- 内容 ---------- */}
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
      ) : list === null ? (
        <CollectionsSkeleton />
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.04]">
            <ListMusic className="h-7 w-7 text-zinc-500" aria-hidden="true" />
          </span>
          <p className="text-sm text-zinc-400">还没有歌单</p>
          <p className="max-w-sm text-xs leading-relaxed text-zinc-500">
            在搜索或歌单广场里发现喜欢的歌单后，用「导入到我的歌单」收藏；也可以直接新建一个
          </p>
          <div className="mt-1 flex flex-wrap justify-center gap-2.5">
            <button
              onClick={() => setCreating(true)}
              className="flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/25 hover:brightness-110 active:scale-95"
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> 新建歌单
            </button>
            <Link
              href="/explore"
              className="flex h-11 items-center rounded-xl border border-white/[0.12] bg-white/[0.03] px-5 text-sm font-medium text-zinc-300 hover:bg-white/[0.07] active:scale-95"
            >
              去歌单广场
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {list.map((c, i) => {
            const meta = sourceMeta(c.source);
            return (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.035, 0.45), duration: 0.3 }}
                className="group"
              >
                <Link href={`/collection?id=${c.id}`} className="block" aria-label={`打开歌单 ${c.name}`}>
                  <div className="relative aspect-square overflow-hidden rounded-2xl bg-zinc-800/80 ring-1 ring-white/[0.06] transition-all duration-300 group-hover:ring-violet-400/40 group-hover:shadow-xl group-hover:shadow-fuchsia-500/10">
                    {c.cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={coverProxyUrl(c.cover, c.source)}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-gradient-to-br from-violet-500/15 via-fuchsia-500/10 to-cyan-400/10">
                        <ListMusic className="h-10 w-10 text-zinc-500" aria-hidden="true" />
                      </div>
                    )}
                    {c.kind === "imported" ? (
                      <span className={`absolute left-2 top-2 rounded border px-1.5 py-px text-[10px] backdrop-blur ${meta.badge}`}>
                        {meta.label}
                      </span>
                    ) : (
                      <span className="absolute left-2 top-2 rounded border border-white/[0.12] bg-black/45 px-1.5 py-px text-[10px] text-zinc-300 backdrop-blur">
                        自建
                      </span>
                    )}
                    {/* 操作入口：PC hover 显示，移动端常显 */}
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setMenuFor(c);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setMenuFor(c);
                        }
                      }}
                      aria-label={`歌单操作：${c.name}`}
                      className="absolute right-1 top-1 flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-zinc-300 transition-opacity hover:bg-black/40 active:scale-90 lg:opacity-0 lg:group-hover:opacity-100"
                    >
                      <MoreVertical className="h-[18px] w-[18px] drop-shadow" aria-hidden="true" />
                    </span>
                  </div>
                  <p className="mt-2 truncate text-[13px] font-semibold text-zinc-200 transition-colors group-hover:text-fuchsia-200">{c.name}</p>
                  <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                    {c.track_count > 0 ? `${c.track_count} 首` : "空歌单"}
                    {c.kind === "imported" && c.creator ? ` · ${c.creator}` : ""}
                  </p>
                </Link>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* ---------- 新建 / 编辑 ---------- */}
      <CollectionFormModal
        open={creating || !!editing}
        initial={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={load}
      />

      {/* ---------- 操作菜单 ---------- */}
      <Modal open={!!menuFor} onClose={() => setMenuFor(null)} title={menuFor?.name ?? ""} maxWidth={400}>
        {menuFor && (
          <div className="flex flex-col gap-1">
            {menuFor.kind === "manual" && (
              <button
                onClick={() => {
                  setEditing(menuFor);
                  setMenuFor(null);
                }}
                className="flex min-h-[48px] items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.05] active:scale-[0.98]"
              >
                <Pencil className="h-4 w-4 text-zinc-400" aria-hidden="true" /> 编辑信息
              </button>
            )}
            {menuFor.kind === "imported" && menuFor.link && (
              <a
                href={menuFor.link}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-[48px] items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.05] active:scale-[0.98]"
              >
                <ExternalLink className="h-4 w-4 text-zinc-400" aria-hidden="true" /> 在{sourceMeta(menuFor.source).label}打开原歌单
              </a>
            )}
            {menuFor.kind === "manual" && (
              <button
                onClick={() => {
                  setDeleting(menuFor);
                  setMenuFor(null);
                }}
                className="flex min-h-[48px] items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-red-300 transition-colors hover:bg-red-500/10 active:scale-[0.98]"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" /> 删除歌单
              </button>
            )}
          </div>
        )}
      </Modal>

      {/* ---------- 删除确认 ---------- */}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={onDelete}
        busy={busy}
        title="删除歌单"
        confirmText="删除"
        description={
          <>
            确定删除「{deleting?.name ?? ""}」吗？
            <br />
            歌单中的 {deleting?.track_count ?? 0} 首歌曲将被移出，此操作不可撤销。
          </>
        }
      />
    </div>
  );
}

/* ---------------- 新建 / 编辑表单模态 ---------------- */

function CollectionFormModal({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: LocalCollection | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setDesc(initial?.description ?? "");
    }
  }, [open, initial]);

  const submit = async () => {
    const n = name.trim();
    if (!n) {
      toast.error("请输入歌单名称");
      return;
    }
    setBusy(true);
    try {
      if (initial) {
        const r = await apiUpdateCollection(initial.id, { name: n, description: desc.trim() });
        const err = (r as { error?: string }).error;
        if (err) throw new Error(err);
        toast.success("歌单已更新");
      } else {
        const r = await apiCreateCollection({ name: n, description: desc.trim() });
        const err = (r as { error?: string }).error;
        if (err) throw new Error(err);
        toast.success(`已创建「${n}」`);
      }
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? "编辑歌单" : "新建歌单"} maxWidth={440}>
      <label htmlFor="collection-name" className="block text-xs font-medium text-zinc-400">
        名称
      </label>
      <input
        id="collection-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={60}
        placeholder="给歌单起个名字"
        className="mt-1.5 h-11 w-full rounded-xl input-shell px-3.5 text-sm text-zinc-100"
      />
      <label htmlFor="collection-desc" className="mt-4 block text-xs font-medium text-zinc-400">
        简介（可选）
      </label>
      <textarea
        id="collection-desc"
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        rows={3}
        maxLength={300}
        placeholder="简单描述这个歌单"
        className="mt-1.5 w-full resize-none rounded-xl input-shell px-3.5 py-2.5 text-sm leading-relaxed text-zinc-100"
      />
      <div className="mt-5 flex justify-end gap-2.5">
        <button
          onClick={onClose}
          className="h-11 rounded-xl border border-white/[0.1] bg-white/[0.03] px-5 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/[0.06] active:scale-[0.98]"
        >
          取消
        </button>
        <button
          onClick={submit}
          disabled={busy}
          className="flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/25 transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
          {initial ? "保存" : "创建"}
        </button>
      </div>
    </Modal>
  );
}

/* ---------------- 骨架 ---------------- */

function CollectionsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" role="status" aria-label="加载中">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="animate-pulse" style={{ animationDelay: `${i * 50}ms` }}>
          <div className="aspect-square rounded-2xl bg-white/[0.035]" />
          <div className="mt-2 h-3.5 w-3/4 rounded bg-white/[0.035]" />
          <div className="mt-1.5 h-3 w-1/2 rounded bg-white/[0.02]" />
        </div>
      ))}
    </div>
  );
}
