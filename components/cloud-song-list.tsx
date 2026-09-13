"use client";

/**
 * 云盘歌曲列表（P1 B3）— 空间用量头部 + 匹配纠错弹窗 + 删除二次确认 + 歌词查看。
 */
import { memo, useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Play, Search, Trash2, FileText, X, AlertTriangle, Music2, HardDrive, Info } from "lucide-react";
import { toast } from "sonner";
import { apiCloudMatch, apiCloudDelete, apiCloudLyric, apiCloudSongDetail } from "@/lib/client/api";
import { usePlayer } from "@/lib/client/store";
import { coverProxyUrl } from "@/lib/play-url";
import { formatDuration, formatSize, type CloudSong, type Song } from "@/lib/types";

export function CloudSongList({
  songs,
  onDeleted,
}: {
  songs: CloudSong[];
  onDeleted: (cloudId: string) => void;
}) {
  const [matchTarget, setMatchTarget] = useState<CloudSong | null>(null);
  const [matchQuery, setMatchQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<CloudSong | null>(null);
  const [lyricTarget, setLyricTarget] = useState<{ song: CloudSong; lyric: string } | null>(null);
  /* P1 B3：云盘单条详情（user_cloud_detail byids） */
  const [detailTarget, setDetailTarget] = useState<CloudSong | null>(null);
  const [busy, setBusy] = useState(false);
  /* 审核整改 C-09：selector 订阅 play（原整库订阅在 currentTime 高频更新时 50 行全量重渲染） */
  const play = usePlayer((s) => s.play);

  const showDetail = useCallback((item: CloudSong) => {
    const cloudId = item.cloud_id;
    if (!cloudId) return;
    setDetailTarget(item);
    void (async () => {
      setBusy(true);
      try {
        const r = await apiCloudSongDetail(cloudId);
        if (!r.error && r.song) {
          /* 三审 R3：函数式更新校验仍是同一条详情（原关闭 Modal 后响应返回会重新弹窗） */
          setDetailTarget((prev) => (prev?.cloud_id === cloudId ? r.song! : prev));
        }
      } catch {
        /* 保留列表数据兜底展示 */
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  const doDelete = async () => {
    if (!deleteTarget?.cloud_id) return;
    setBusy(true);
    try {
      await apiCloudDelete(deleteTarget.cloud_id);
      toast.success(`已删除：${deleteTarget.song.name}`);
      onDeleted(deleteTarget.cloud_id);
      setDeleteTarget(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  const doMatch = async (targetSongId: string) => {
    if (!matchTarget?.cloud_id) return;
    setBusy(true);
    try {
      await apiCloudMatch(matchTarget.cloud_id, targetSongId);
      toast.success("匹配成功，歌曲信息已关联正版曲库");
      setMatchTarget(null);
      setMatchQuery("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "匹配失败");
    } finally {
      setBusy(false);
    }
  };

  const showLyric = useCallback((item: CloudSong) => {
    const cloudId = item.cloud_id;
    if (!cloudId) return;
    void (async () => {
      setBusy(true);
      try {
        const r = await apiCloudLyric(cloudId);
        setLyricTarget({ song: item, lyric: r.lyric ?? "暂无歌词" });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "歌词获取失败");
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  const playSong = useCallback(
    (item: CloudSong) => {
      const list: Song[] = songs.map((s) => s.song);
      play(item.song, list);
      toast.success(`开始播放：${item.song.name}`);
    },
    [songs, play],
  );

  /* 审核整改 C-09：回调稳定引用（供 memo 行组件 props 浅比较） */
  const openMatch = useCallback((item: CloudSong) => {
    setMatchTarget(item);
    setMatchQuery(`${item.song.name} ${item.song.artist}`.trim());
  }, []);
  const openDelete = useCallback((item: CloudSong) => setDeleteTarget(item), []);

  return (
    <>
      <ul className="flex flex-col gap-1.5">
        {songs.map((item, i) => (
          /* 审核整改 C-09：key 去数组索引（cloud_id 稳定唯一；原索引 key 配合删除导致全量重挂载与动画重播） */
          <CloudSongRow
            key={item.cloud_id || `${item.song.id}-${item.filename ?? i}`}
            item={item}
            index={i}
            onPlay={playSong}
            onDetail={showDetail}
            onMatch={openMatch}
            onLyric={showLyric}
            onDelete={openDelete}
          />
        ))}
      </ul>

      {/* 匹配纠错弹窗 */}
      <Modal open={!!matchTarget} onClose={() => !busy && setMatchTarget(null)} title="匹配纠错">
        {matchTarget && (
          <div>
            <p className="text-[13px] leading-relaxed text-zinc-400">
              为「{matchTarget.song.name}」填入要关联的正版歌曲 id（网易云歌曲数字 id），匹配后可获得标准歌词、封面与排序信息。
            </p>
            <div className="mt-3 flex items-center gap-2">
              <input
                value={matchQuery}
                onChange={(e) => setMatchQuery(e.target.value)}
                placeholder="歌曲名 歌手（提示）"
                className="input-shell min-h-[44px] flex-1 rounded-xl px-3 text-[13px]"
                disabled
              />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[12px] text-zinc-500">正版歌曲 id：</span>
              <MatchInput onConfirm={doMatch} busy={busy} />
            </div>
          </div>
        )}
      </Modal>

      {/* 删除确认弹窗 */}
      <Modal open={!!deleteTarget} onClose={() => !busy && setDeleteTarget(null)} title="删除云盘歌曲">
        {deleteTarget && (
          <div>
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-300" aria-hidden="true" />
              <p className="text-[13px] leading-relaxed text-zinc-300">
                确定删除「{deleteTarget.song.name || deleteTarget.filename}」吗？
                <br />
                <span className="text-zinc-500">删除后云端文件将不可恢复（高危操作）。</span>
              </p>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} disabled={busy} className="min-h-[44px] rounded-xl border border-white/[.1] px-4 text-[13px] text-zinc-300 hover:border-violet-400/40">
                取消
              </button>
              <button onClick={doDelete} disabled={busy} className="min-h-[44px] rounded-xl bg-gradient-to-r from-red-500 to-orange-500 px-4 text-[13px] font-semibold text-white disabled:opacity-60">
                {busy ? "删除中…" : "确认删除"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* 歌词弹窗 */}
      <Modal open={!!lyricTarget} onClose={() => setLyricTarget(null)} title="云盘歌词">
        {lyricTarget && (
          <div>
            <p className="mb-2 text-[13px] font-semibold text-zinc-200">{lyricTarget.song.song.name}</p>
            <pre className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-2xl bg-white/[0.03] p-3 text-[12px] leading-relaxed text-zinc-400">
              {lyricTarget.lyric}
            </pre>
          </div>
        )}
      </Modal>

      {/* P1 B3：云盘详情弹窗（user_cloud_detail） */}
      <Modal open={!!detailTarget} onClose={() => setDetailTarget(null)} title="云盘详情">
        {detailTarget && (
          <div aria-busy={busy}>
            <p className="text-[13.5px] font-semibold text-zinc-100">{detailTarget.song.name || detailTarget.filename}</p>
            <dl className="mt-3 grid grid-cols-[80px_1fr] gap-y-2 text-[12.5px]">
              <dt className="text-zinc-500">歌手</dt>
              <dd className="truncate text-zinc-300">{detailTarget.song.artist || "—"}</dd>
              <dt className="text-zinc-500">云盘文件</dt>
              <dd className="truncate text-zinc-300" title={detailTarget.filename}>{detailTarget.filename || "—"}</dd>
              <dt className="text-zinc-500">文件大小</dt>
              <dd className="text-zinc-300">{detailTarget.file_size ? formatSize(detailTarget.file_size) : "—"}</dd>
              <dt className="text-zinc-500">添加时间</dt>
              <dd className="text-zinc-300">{detailTarget.add_time ? detailTarget.add_time.slice(0, 10) : "—"}</dd>
              <dt className="text-zinc-500">匹配状态</dt>
              <dd className="text-zinc-300">{detailTarget.match_state ?? (detailTarget.song.artist ? "已匹配" : "未匹配")}</dd>
            </dl>
          </div>
        )}
      </Modal>
    </>
  );
}

/* 审核整改 C-09：列表行 memo 化（50 行 × 5 交互元素；原父组件任一 state 变化全量重渲染） */
const CloudSongRow = memo(function CloudSongRow({
  item,
  index,
  onPlay,
  onDetail,
  onMatch,
  onLyric,
  onDelete,
}: {
  item: CloudSong;
  index: number;
  onPlay: (item: CloudSong) => void;
  onDetail: (item: CloudSong) => void;
  onMatch: (item: CloudSong) => void;
  onLyric: (item: CloudSong) => void;
  onDelete: (item: CloudSong) => void;
}) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.02, 0.3) }}
      className="flex items-center gap-2.5 rounded-2xl bg-white/[0.02] px-3 py-2 transition-colors hover:bg-white/[0.04]"
    >
      <button onClick={() => onPlay(item)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left" aria-label={`播放 ${item.song.name}`}>
        {item.song.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coverProxyUrl(item.song.cover, "netease")} alt="" loading="lazy" className="h-11 w-11 shrink-0 rounded-xl object-cover" />
        ) : (
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.05]">
            <HardDrive className="h-4 w-4 text-zinc-500" aria-hidden="true" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[13px] text-zinc-200">{item.song.name || item.filename}</b>
          <span className="block truncate text-[11px] text-zinc-500">
            {[item.song.artist, item.file_size ? formatSize(item.file_size) : "", item.match_state].filter(Boolean).join(" · ") || "云盘歌曲"}
          </span>
        </span>
        <span className="hidden shrink-0 text-[11px] text-zinc-600 sm:block">{formatDuration(item.song.duration)}</span>
        <Play className="h-4 w-4 shrink-0 text-zinc-600" aria-hidden="true" />
      </button>
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={() => onDetail(item)}
          aria-label={`查看详情 ${item.song.name}`}
          title="云盘详情"
          className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-cyan-300"
        >
          <Info className="h-4 w-4" />
        </button>
        <button
          onClick={() => onMatch(item)}
          aria-label={`匹配纠错 ${item.song.name}`}
          title="匹配纠错"
          className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-fuchsia-300"
        >
          <Search className="h-4 w-4" />
        </button>
        <button
          onClick={() => onLyric(item)}
          aria-label={`查看歌词 ${item.song.name}`}
          title="云盘歌词"
          className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-cyan-300"
        >
          <FileText className="h-4 w-4" />
        </button>
        <button
          onClick={() => onDelete(item)}
          aria-label={`删除 ${item.song.name}`}
          title="删除（高危）"
          className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-300"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </motion.li>
  );
});

function MatchInput({ onConfirm, busy }: { onConfirm: (songId: string) => void; busy: boolean }) {
  const [value, setValue] = useState("");
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
        placeholder="如 2034742057"
        inputMode="numeric"
        className="input-shell min-h-[44px] flex-1 rounded-xl px-3 text-[13px]"
      />
      <button
        onClick={() => value && onConfirm(value)}
        disabled={busy || !value}
        className="min-h-[44px] rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 text-[13px] font-semibold text-white disabled:opacity-60"
      >
        {busy ? "匹配中…" : "匹配"}
      </button>
    </div>
  );
}

function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  /* 审核整改 C-10：弹层打开期间锁定背景滚动（对齐 app-shell MobileDrawer 范式） */
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12, transition: { duration: 0.15 } }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-white/[.1] bg-zinc-950/95 p-5 shadow-2xl"
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-[14px] font-bold text-zinc-100">
                <Music2 className="h-4 w-4 text-fuchsia-300" aria-hidden="true" /> {title}
              </h3>
              <button onClick={onClose} aria-label="关闭" className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200">
                <X className="h-5 w-5" />
              </button>
            </div>
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
