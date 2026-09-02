"use client";

/**
 * 下载记录页（对齐 Go 下载记录面板：分页 / 清空 / 状态过滤）
 * 字段为 Go DownloadRecord 大写驼峰（ID/Name/Artist/Source/Status/Error/CreatedAt）
 */
import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { ChevronLeft, ChevronRight, Trash2, Loader2, History, CheckCircle2, SkipForward, XCircle, RefreshCcw, ListFilter } from "lucide-react";
import { toast } from "sonner";
import { apiDownloadRecords, apiClearDownloadRecords, type DownloadRecord } from "@/lib/client/api";
import { sourceMeta } from "@/lib/play-url";
import { ConfirmDialog } from "@/components/modal";
import { PageHeader } from "@/components/page-header";

const STATUS_UI: Record<string, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  success: { label: "成功", cls: "text-emerald-300", icon: CheckCircle2 },
  skipped: { label: "跳过", cls: "text-amber-300", icon: SkipForward },
  failed: { label: "失败", cls: "text-red-300", icon: XCircle },
};

type StatusFilter = "" | "success" | "skipped" | "failed";

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "", label: "全部" },
  { key: "success", label: "成功" },
  { key: "skipped", label: "跳过" },
  { key: "failed", label: "失败" },
];

export default function DownloadsPage() {
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [status, setStatus] = useState<StatusFilter>("");
  const [data, setData] = useState<{ records: DownloadRecord[]; total: number; total_pages: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(
    (p: number, s: StatusFilter) => {
      setLoading(true);
      apiDownloadRecords(p, pageSize, s)
        .then((r) => {
          setData(r);
          setPage(r.page);
        })
        .catch((e) => toast.error(e instanceof Error ? e.message : "加载失败"))
        .finally(() => setLoading(false));
    },
    [pageSize],
  );

  useEffect(() => {
    load(1, status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const changeFilter = (s: StatusFilter) => {
    if (s === status) return;
    setStatus(s);
  };

  const onClear = async () => {
    setClearing(true);
    try {
      await apiClearDownloadRecords();
      toast.success("已清空下载记录");
      setConfirmClear(false);
      load(1, status);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "清空失败");
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1000px] px-4 py-6 lg:px-8 lg:py-10">
      {/* ---------- 页头（统一 PageHeader） ---------- */}
      <PageHeader
        icon={History}
        title="下载记录"
        subtitle={data ? `共 ${data.total} 条` : "加载中…"}
        actions={
          <button
            onClick={() => setConfirmClear(true)}
            disabled={clearing || !data?.total}
            className="glass flex min-h-[42px] items-center gap-1.5 rounded-xl border border-white/[0.1] px-3.5 text-[13px] text-zinc-300 transition-colors hover:border-red-400/40 hover:text-red-300 disabled:opacity-40"
          >
            {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
            清空
          </button>
        }
      />

      {/* ---------- 状态过滤（对齐 Go 下载记录面板） ---------- */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5" role="group" aria-label="状态过滤">
        <ListFilter className="mr-0.5 h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
        {STATUS_FILTERS.map((f) => {
          const active = status === f.key;
          const ui = f.key ? STATUS_UI[f.key] : null;
          return (
            <button
              key={f.key || "all"}
              onClick={() => changeFilter(f.key)}
              aria-pressed={active}
              className={`flex min-h-[38px] items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium transition-all active:scale-95 ${
                active
                  ? "border-violet-400/40 bg-violet-500/20 text-violet-100 ring-1 ring-violet-400/30"
                  : "border-white/[0.1] bg-white/[0.02] text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {ui && !active && <ui.icon className={`h-3 w-3 ${ui.cls} opacity-80`} aria-hidden="true" />}
              {f.label}
            </button>
          );
        })}
      </div>

      {/* 清空二次确认 */}
      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={onClear}
        busy={clearing}
        title="清空下载记录"
        confirmText="清空"
        description={
          <>
            确定清空全部 {data?.total ?? 0} 条下载记录吗？
            <br />
            <span className="text-zinc-500">仅清除记录，去重索引保留，已下载歌曲仍会跳过。</span>
          </>
        }
      />

      {loading ? (
        <div className="flex flex-col gap-2" role="status" aria-label="加载中">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="shimmer h-[58px] rounded-xl" />
          ))}
        </div>
      ) : !data || data.records.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.04]">
            <History className="h-7 w-7 text-zinc-500" aria-hidden="true" />
          </span>
          <p className="text-sm text-zinc-500">{status ? "该状态下暂无记录" : "暂无下载记录"}</p>
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-1.5">
            {data.records.map((r, i) => {
              const st = STATUS_UI[r.Status] ?? { label: r.Status, cls: "text-zinc-400", icon: History };
              const StIcon = st.icon;
              const meta = sourceMeta(r.Source);
              return (
                <motion.li
                  key={r.ID}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.02, 0.4), duration: 0.25 }}
                  className="flex min-h-[58px] items-center gap-3 rounded-2xl bg-white/[0.03] px-3.5"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.04]">
                    <StIcon className={`h-[18px] w-[18px] ${st.cls}`} aria-hidden="true" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13.5px] font-semibold text-zinc-100">{r.Name || "未知歌曲"}</span>
                    <span className="flex items-center gap-1.5 truncate text-[11.5px] text-zinc-500">
                      <span className="truncate">{r.Artist || "未知歌手"}</span>
                      {r.Source && <span className={`shrink-0 rounded border px-1 text-[9px] ${meta.badge}`}>{meta.label}</span>}
                      <span className="shrink-0 tabular-nums">{r.CreatedAt?.replace("T", " ").slice(0, 19)}</span>
                    </span>
                    {r.Error && <span className="truncate text-[11px] text-red-300/80">{r.Error}</span>}
                  </div>
                  <span className={`shrink-0 text-[11px] font-medium ${st.cls}`}>{st.label}</span>
                </motion.li>
              );
            })}
          </ul>

          {/* 分页 */}
          <div className="mt-4 flex items-center justify-center gap-3">
            <button
              onClick={() => load(page - 1, status)}
              disabled={page <= 1}
              aria-label="上一页"
              className="glass flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.1] text-zinc-300 disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-[13px] tabular-nums text-zinc-400">
              {page} / {data.total_pages || 1}
            </span>
            <button
              onClick={() => load(page + 1, status)}
              disabled={page >= data.total_pages}
              aria-label="下一页"
              className="glass flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.1] text-zinc-300 disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              onClick={() => load(page, status)}
              aria-label="刷新"
              className="glass flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.1] text-zinc-300"
            >
              <RefreshCcw className="h-4 w-4" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
