"use client";

/**
 * 云盘音乐 /cloud（P1 B3，网易专属单源）— 云盘歌曲列表 + 空间用量。
 * 未登录引导 /accounts；列表数据不缓存（个人数据）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CloudUpload, RefreshCw, AlertTriangle, ChevronDown, QrCode, HardDrive } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { CloudSongList } from "@/components/cloud-song-list";
import { apiCloudSongs } from "@/lib/client/api";
import type { CloudSong } from "@/lib/types";

export default function CloudPage() {
  const [songs, setSongs] = useState<CloudSong[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [needLogin, setNeedLogin] = useState(false);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [size, setSize] = useState<{ used?: number; max?: number }>({});

  /* 审核整改 C-08：load 键控（最后写入胜出——加载更多在途时点刷新，旧 append 响应不污染新列表） */
  const seqRef = useRef(0);

  const load = useCallback(async (p: number, append: boolean) => {
    const seq = ++seqRef.current;
    setLoading(true);
    setError("");
    try {
      const r = await apiCloudSongs(p, 50);
      if (seq !== seqRef.current) return;
      if (r.need_login || (r.error && /登录/.test(r.error))) {
        setNeedLogin(true);
        return;
      }
      if (r.error) {
        setError(r.error);
        return;
      }
      setNeedLogin(false);
      setSongs((prev) => (append ? [...prev, ...(r.songs ?? [])] : r.songs ?? []));
      setHasMore(!!r.has_more);
      if (r.size !== undefined || r.max_size !== undefined) setSize({ used: r.size, max: r.max_size });
    } catch (e) {
      if (seq === seqRef.current) setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setSongs([]);
    setPage(1);
    void load(1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey]);

  const onDeleted = (cloudId: string) => {
    setSongs((prev) => prev.filter((s) => s.cloud_id !== cloudId));
  };

  const percent = size.used !== undefined && size.max ? Math.min(100, (size.used / size.max) * 100) : 0;

  return (
    <div className="mx-auto w-full max-w-[1000px] px-4 py-6 lg:px-8 lg:py-10">
      <PageHeader
        icon={CloudUpload}
        title="云盘音乐"
        subtitle="网易云盘歌曲：匹配纠错 · 云盘歌词 · 高危删除（二次确认 + 频控）"
        actions={
          <button
            onClick={() => setRetryKey((k) => k + 1)}
            aria-label="刷新"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/[.1] text-zinc-400 transition-colors hover:border-violet-400/40 hover:text-zinc-100"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        }
      />

      {needLogin ? (
        <div className="glass flex flex-col items-center gap-4 rounded-3xl border border-white/[.07] p-10 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.04]">
            <QrCode className="h-7 w-7 text-zinc-500" aria-hidden="true" />
          </span>
          <p className="text-sm text-zinc-400">云盘为个人数据，需要登录网易云账号</p>
          <Link href="/accounts" className="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 text-[13px] font-semibold text-white">
            <QrCode className="h-4 w-4" aria-hidden="true" /> 去扫码登录
          </Link>
        </div>
      ) : (
        <>
          {/* 空间用量 */}
          {(size.used !== undefined || size.max) && (
            <section className="glass mb-4 rounded-3xl border border-white/[.07] p-5" aria-label="云盘空间">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-[13.5px] font-semibold text-zinc-200">
                  <HardDrive className="h-4 w-4 text-fuchsia-300" aria-hidden="true" /> 云盘空间
                </h2>
                <span className="text-[12px] text-zinc-500">
                  {size.used !== undefined ? `${(size.used / 1024 / 1024 / 1024).toFixed(1)} GB` : "—"}
                  {size.max ? ` / ${(size.max / 1024 / 1024 / 1024).toFixed(0)} GB` : ""}
                </span>
              </div>
              <div
                className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/[0.06]"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(percent)}
              >
                <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-500 transition-[width] duration-700" style={{ width: `${percent}%` }} />
              </div>
            </section>
          )}

          {error && !loading && !songs.length ? (
            <div className="glass flex items-center gap-3 rounded-3xl border border-red-400/20 p-5 text-sm text-red-200" role="alert">
              <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">{error}</span>
              <button onClick={() => setRetryKey((k) => k + 1)} className="min-h-[40px] rounded-xl border border-white/[.1] px-3 text-[12.5px] text-zinc-300">
                重试
              </button>
            </div>
          ) : loading && !songs.length ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="shimmer h-16 rounded-2xl" />
              ))}
            </div>
          ) : !songs.length ? (
            <div className="glass flex flex-col items-center gap-3 rounded-3xl border border-white/[.07] py-16">
              <CloudUpload className="h-8 w-8 text-zinc-600" aria-hidden="true" />
              <p className="text-sm text-zinc-500">云盘还是空的（上传请在官方客户端操作）</p>
            </div>
          ) : (
            <CloudSongList songs={songs} onDeleted={onDeleted} />
          )}

          {hasMore && !loading && (
            <button
              onClick={() => {
                const next = page + 1;
                setPage(next);
                void load(next, true);
              }}
              className="mt-4 flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-2xl border border-white/[.08] text-[13px] text-zinc-400 transition-colors hover:border-violet-400/40 hover:text-zinc-100"
            >
              <ChevronDown className="h-4 w-4" aria-hidden="true" /> 加载更多
            </button>
          )}
        </>
      )}
    </div>
  );
}
