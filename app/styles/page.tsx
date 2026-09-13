"use client";

/**
 * 曲风探索 /styles（P1 B2，网易专属单源）— 曲风标签云（两级）+ 我的偏好标记。
 * 点击曲风 → /styles/[id] 四 Tab 详情（歌曲/专辑/歌手/歌单）。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { AudioWaveform, RefreshCw, AlertTriangle, Star } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { apiStyles } from "@/lib/client/api";
import type { StyleTag } from "@/lib/types";

export default function StylesPage() {
  const [topTags, setTopTags] = useState<StyleTag[]>([]);
  const [allTags, setAllTags] = useState<StyleTag[]>([]);
  const [preferences, setPreferences] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    apiStyles()
      .then((r) => {
        if (!alive) return;
        if (r.error) throw new Error(r.error);
        setTopTags(r.top_tags ?? []);
        setAllTags(r.tags ?? []);
        setPreferences(r.preferences ?? []);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [retryKey]);

  /* 二级曲风按父级分组 */
  const groups = topTags.map((top) => ({
    top,
    children: allTags.filter((t) => t.parent_id === top.id),
  }));

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 lg:px-8 lg:py-10">
      <PageHeader
        icon={AudioWaveform}
        title="曲风探索"
        subtitle="网易曲风体系：标签直达歌曲 / 专辑 / 歌手 / 歌单，标出你的偏好曲风"
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

      {error ? (
        <div className="glass flex items-center gap-3 rounded-3xl border border-red-400/20 p-5 text-sm text-red-200" role="alert">
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{error}</span>
          <button onClick={() => setRetryKey((k) => k + 1)} className="min-h-[40px] rounded-xl border border-white/[.1] px-3 text-[12.5px] text-zinc-300">
            重试
          </button>
        </div>
      ) : loading ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="shimmer h-24 rounded-3xl" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.length === 0 && (
            <div className="glass flex flex-col items-center gap-3 rounded-3xl border border-white/[.07] py-16">
              <AudioWaveform className="h-8 w-8 text-zinc-600" aria-hidden="true" />
              <p className="text-sm text-zinc-500">曲风数据暂不可用</p>
            </div>
          )}
          {groups.map(({ top, children }, gi) => (
            <motion.section
              key={top.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: Math.min(gi * 0.06, 0.4) }}
              className="glass rounded-3xl border border-white/[.07] p-5"
              aria-label={`曲风分组 ${top.name}`}
            >
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-[15px] font-bold text-zinc-100">
                  <AudioWaveform className="h-4 w-4 text-fuchsia-300" aria-hidden="true" />
                  {top.name}
                  {preferences.includes(top.id) && <Star className="h-3.5 w-3.5 fill-amber-300 text-amber-300" aria-label="我的偏好曲风" />}
                </h2>
                <Link
                  href={`/styles/${top.id}`}
                  className="flex min-h-[36px] items-center rounded-xl border border-white/[.1] px-3 text-[12px] text-zinc-400 transition-colors hover:border-violet-400/40 hover:text-zinc-100"
                >
                  查看 →
                </Link>
              </div>
              {children.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {children.map((child) => (
                    <Link
                      key={child.id}
                      href={`/styles/${child.id}`}
                      className={`flex min-h-[36px] items-center gap-1.5 rounded-full border px-3.5 text-[12.5px] transition-colors ${
                        preferences.includes(child.id)
                          ? "border-amber-300/40 bg-amber-400/10 text-amber-200"
                          : "border-white/[.08] bg-white/[0.02] text-zinc-300 hover:border-violet-400/40 hover:text-zinc-100"
                      }`}
                    >
                      {child.name}
                      {preferences.includes(child.id) && <Star className="h-3 w-3 fill-amber-300 text-amber-300" aria-hidden="true" />}
                    </Link>
                  ))}
                </div>
              )}
            </motion.section>
          ))}
        </div>
      )}
    </div>
  );
}
