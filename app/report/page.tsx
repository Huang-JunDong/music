"use client";

/**
 * 听歌报告 /report（P1 A3）— 分段渐进加载，单 section 失败不影响其余。
 * 网易：年度总结/听歌画像/播放排行(周/全部)/历史每日推荐；
 * QQ：音乐基因画像（其余 section 单源隐藏）。
 */
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { ChartPie, Play, RotateCcw, CalendarDays, Sparkles, QrCode, RefreshCw, Music2 } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { apiReportSections, apiListenStats, apiPlayRecord, apiHistoryDailyRecommends } from "@/lib/client/api";
import { usePlayer } from "@/lib/client/store";
import { coverProxyUrl } from "@/lib/play-url";
import { formatDuration, type ReportSection, type ListenStats, type PlayRecordItem, type HistoryDailyRecommend, type Song } from "@/lib/types";

export default function ReportPage() {
  return (
    <Suspense fallback={<div className="mx-auto w-full max-w-[1000px] px-4 py-10 lg:px-8"><div className="shimmer h-40 rounded-3xl" aria-busy="true" /></div>}>
      <ReportInner />
    </Suspense>
  );
}

function ReportInner() {
  const params = useSearchParams();
  const router = useRouter();
  const source = params.get("source") === "qq" ? "qq" : "netease";
  const [retryKey, setRetryKey] = useState(0);
  /* 审核整改 C-09：selector 订阅（原整库订阅在 currentTime 高频更新时整页重渲染） */
  const play = usePlayer((s) => s.play);

  const [sections, setSections] = useState<ReportSection[] | null>(null);
  const [sectionsError, setSectionsError] = useState<string | null>(null);
  const [stats, setStats] = useState<ListenStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [record, setRecord] = useState<PlayRecordItem[] | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [recordType, setRecordType] = useState<0 | 1>(1);
  const [days, setDays] = useState<HistoryDailyRecommend[] | null>(null);
  const [daysError, setDaysError] = useState<string | null>(null);
  /* 审核整改 C-08：日期详情键控（最后写入胜出，旧响应不覆盖新选中日期） */
  const pickSeq = useRef(0);
  const [dayDetail, setDayDetail] = useState<(HistoryDailyRecommend & { error?: string }) | null>(null);
  const [needLogin, setNeedLogin] = useState(false);

  const isNcm = source === "netease";

  /* 分段渐进加载：stats 先行（快），annual 慢接口后置 */
  /* 审核整改 B-02：各段落失败落 error 态（原 .catch(()=>undefined) 静默 → 永久骨架屏），
     刷新按钮对全部段落生效（stats effect 接入 retryKey） */
  useEffect(() => {
    let alive = true;
    setNeedLogin(false);
    setStats(null);
    setStatsError(null);
    apiListenStats(source)
      .then((r) => {
        if (!alive) return;
        /* need_login（服务端语义化标记）或错误文案含"登录"→ 登录引导 */
        if (r.need_login || (r.error && /登录/.test(r.error))) setNeedLogin(true);
        else if (r.error) setStatsError(r.error);
        else if (r.stats) setStats(r.stats);
        else setStatsError("听歌画像加载失败");
      })
      .catch(() => {
        if (alive) setStatsError("听歌画像加载失败，请稍后重试");
      });
    return () => {
      alive = false;
    };
  }, [source, retryKey]);

  useEffect(() => {
    if (!isNcm || needLogin) return;
    let alive = true;
    setSections(null);
    setSectionsError(null);
    apiReportSections("netease")
      .then((r) => {
        if (!alive) return;
        if (r.need_login) setNeedLogin(true);
        else if (r.error) setSectionsError(r.error);
        else setSections(r.sections ?? []);
      })
      .catch(() => {
        if (alive) setSectionsError("年度报告加载失败，请稍后重试");
      });
    return () => {
      alive = false;
    };
  }, [isNcm, needLogin, retryKey]);

  useEffect(() => {
    if (!isNcm || needLogin) return;
    let alive = true;
    setRecord(null);
    setRecordError(null);
    apiPlayRecord("netease", recordType)
      .then((r) => {
        if (!alive) return;
        if (r.need_login) setNeedLogin(true);
        else if (r.error) setRecordError(r.error);
        else setRecord(r.items ?? []);
      })
      .catch(() => {
        if (alive) setRecordError("播放排行加载失败，请稍后重试");
      });
    return () => {
      alive = false;
    };
  }, [isNcm, recordType, needLogin, retryKey]);

  useEffect(() => {
    if (!isNcm || needLogin) return;
    let alive = true;
    setDays(null);
    setDaysError(null);
    apiHistoryDailyRecommends("netease")
      .then((r) => {
        if (!alive) return;
        if (r.need_login) setNeedLogin(true);
        else if (r.error) setDaysError(r.error);
        else setDays(r.days ?? []);
      })
      .catch(() => {
        if (alive) setDaysError("每日推荐回忆加载失败，请稍后重试");
      });
    return () => {
      alive = false;
    };
  }, [isNcm, needLogin, retryKey]);

  const playSong = (song: Song, list?: Song[]) => {
    play(song, list);
    toast.success(`开始播放：${song.name}`);
  };

  const retry = () => setRetryKey((k) => k + 1);

  if (needLogin) {
    return (
      <div className="mx-auto w-full max-w-[1000px] px-4 py-6 lg:px-8 lg:py-10">
        <PageHeader icon={ChartPie} title="听歌报告" subtitle="登录后查看你的年度总结、听歌画像与播放排行" />
        <div className="glass flex flex-col items-center gap-4 rounded-3xl border border-white/[.07] p-10 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.04]">
            <QrCode className="h-7 w-7 text-zinc-500" aria-hidden="true" />
          </span>
          <p className="text-sm text-zinc-400">听歌报告属于个人数据，需要登录音源账号</p>
          <Link
            href="/accounts"
            className="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 text-[13px] font-semibold text-white"
          >
            <QrCode className="h-4 w-4" aria-hidden="true" /> 去扫码登录
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1000px] px-4 py-6 lg:px-8 lg:py-10">
      <PageHeader
        icon={ChartPie}
        title="听歌报告"
        subtitle={isNcm ? "年度总结 · 听歌画像 · 播放排行 · 每日推荐回忆" : "QQ音乐 · 音乐基因画像"}
        actions={
          <>
            <div className="flex rounded-xl border border-white/[.08] bg-white/[0.02] p-1" role="tablist" aria-label="音源切换">
              {[
                { key: "netease", label: "网易云" },
                { key: "qq", label: "QQ音乐" },
              ].map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={source === t.key}
                  onClick={() => router.replace(`/report?source=${t.key}`)}
                  className={`min-h-[40px] rounded-lg px-3.5 text-[12.5px] font-medium transition-colors ${
                    source === t.key ? "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white" : "text-zinc-400 hover:text-zinc-100"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {isNcm && (
              <button
                onClick={() => setRetryKey((k) => k + 1)}
                aria-label="刷新报告"
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/[.1] text-zinc-400 transition-colors hover:border-violet-400/40 hover:text-zinc-100"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            )}
          </>
        }
      />

      <div className="flex flex-col gap-4">
        {/* 听歌画像 / 音乐基因 */}
        <StatsCard stats={stats} error={statsError} source={source} onRetry={retry} />

        {/* 年度报告（网易专属） */}
        {isNcm && <AnnualCard sections={sections} error={sectionsError} onRetry={retry} />}

        {/* 播放排行（网易专属） */}
        {isNcm && (
          <RecordCard items={record} error={recordError} type={recordType} onTypeChange={setRecordType} onPlay={playSong} onRetry={retry} />
        )}

        {/* 历史每日推荐（网易专属） */}
        {isNcm && (
          <HistoryCard
            days={days}
            error={daysError}
            detail={dayDetail}
            onPick={(d) => {
              setDayDetail({ date: d.date, songs: [] });
              const seq = ++pickSeq.current;
              apiHistoryDailyRecommends("netease", d.date)
                .then((r) => {
                  if (seq !== pickSeq.current) return;
                  const first = r.days?.[0];
                  if (first && first.date === d.date) setDayDetail(first);
                  else setDayDetail({ date: d.date, songs: [], error: "该日推荐加载失败" });
                })
                .catch(() => {
                  if (seq === pickSeq.current) setDayDetail({ date: d.date, songs: [], error: "该日推荐加载失败" });
                });
            }}
            onPlay={playSong}
            onRetry={retry}
          />
        )}
      </div>
    </div>
  );
}

function StatsCard({ stats, error, source, onRetry }: { stats: ListenStats | null; error: string | null; source: string; onRetry: () => void }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="glass relative overflow-hidden rounded-3xl border border-white/[.07] p-5"
      aria-label={source === "qq" ? "音乐基因" : "听歌画像"}
    >
      <div aria-hidden="true" className="pointer-events-none absolute -right-14 -top-16 h-48 w-48 rounded-full bg-cyan-400/10 blur-3xl" />
      <h3 className="relative flex items-center gap-2 text-[14px] font-bold text-zinc-100">
        <Sparkles className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {source === "qq" ? "音乐基因画像" : "听歌数据总览"}
      </h3>
      {error && !stats ? (
        /* 审核整改 B-02：error 态可重试（原失败后永久骨架屏） */
        <div className="relative mt-4 flex flex-col items-center gap-3 py-6 text-center">
          <p className="text-[13px] text-zinc-400">{error}</p>
          <button onClick={onRetry} className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-white/[.1] px-4 text-[13px] text-zinc-300 transition-colors hover:border-cyan-300/40 hover:text-zinc-100">
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> 重试
          </button>
        </div>
      ) : !stats ? (
        <div className="relative mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="shimmer h-[72px] rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="relative mt-4">
          {(stats.total_listen_count !== undefined || stats.total_listen_days !== undefined || stats.today_listen_count !== undefined || stats.recent_listen_count !== undefined || stats.total_listen_duration !== undefined) && (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {stats.total_listen_count !== undefined && (
                <StatChip label="累计听歌" value={`${stats.total_listen_count.toLocaleString("zh-CN")} 次`} />
              )}
              {stats.total_listen_days !== undefined && <StatChip label="累计天数" value={`${stats.total_listen_days.toLocaleString("zh-CN")} 天`} />}
              {stats.total_listen_duration !== undefined && (
                <StatChip
                  label="累计收听"
                  value={
                    stats.total_listen_duration >= 3600
                      ? `${(stats.total_listen_duration / 3600).toFixed(1)} 小时`
                      : `${Math.max(1, Math.round(stats.total_listen_duration / 60))} 分钟`
                  }
                />
              )}
              {stats.today_listen_count !== undefined && <StatChip label="今日收听" value={`${stats.today_listen_count} 次`} />}
              {stats.recent_listen_count !== undefined && <StatChip label="最近收听" value={`${stats.recent_listen_count.toLocaleString("zh-CN")} 条`} />}
            </div>
          )}
          {stats.gene_tags?.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {stats.gene_tags.map((t, i) => (
                <span key={`${t.name}-${i}`} className="rounded-xl border border-white/[.07] bg-white/[0.03] px-3 py-1.5 text-[12px] text-zinc-300">
                  <b className="text-zinc-100">{t.name}</b>
                  <span className="ml-1.5 text-zinc-500">{t.value}</span>
                </span>
              ))}
            </div>
          ) : null}
          {stats.today_songs?.length ? (
            <div className="mt-4">
              <p className="mb-2 text-[12px] font-semibold text-zinc-400">今日最常听</p>
              <ul className="flex flex-col gap-1.5">
                {stats.today_songs.slice(0, 5).map(({ song, count }, i) => (
                  <li key={`${song.id}-${i}`} className="flex items-center gap-2.5 rounded-xl bg-white/[0.02] px-3 py-2">
                    <span className="w-5 text-center text-[12px] font-bold text-zinc-600">{i + 1}</span>
                    {song.cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={coverProxyUrl(song.cover, song.source)} alt="" loading="lazy" className="h-9 w-9 rounded-lg object-cover" />
                    ) : (
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.05]">
                        <Music2 className="h-4 w-4 text-zinc-500" aria-hidden="true" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-[13px] text-zinc-200">{song.name}</b>
                      <span className="block truncate text-[11px] text-zinc-500">{song.artist}</span>
                    </span>
                    <span className="shrink-0 text-[11.5px] text-zinc-500">{count} 次</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {!stats.gene_tags?.length &&
            stats.total_listen_count === undefined &&
            stats.today_listen_count === undefined &&
            stats.recent_listen_count === undefined &&
            stats.total_listen_duration === undefined && (
              <p className="py-4 text-center text-[13px] text-zinc-500">暂无画像数据（可能需要更多听歌记录）</p>
            )}
        </div>
      )}
    </motion.section>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/[.06] bg-white/[0.03] p-3">
      <p className="text-[11px] text-zinc-500">{label}</p>
      <p className="mt-1 text-[15px] font-extrabold text-zinc-100">{value}</p>
    </div>
  );
}

function AnnualCard({ sections, error, onRetry }: { sections: ReportSection[] | null; error: string | null; onRetry: () => void }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.06 }}
      className="glass rounded-3xl border border-white/[.07] p-5"
      aria-label="年度报告"
    >
      <h3 className="flex items-center gap-2 text-[14px] font-bold text-zinc-100">
        <ChartPie className="h-4 w-4 text-fuchsia-300" aria-hidden="true" /> 年度报告
      </h3>
      {error && !sections ? (
        /* 审核整改 B-02：error 态可重试 */
        <div className="mt-4 flex flex-col items-center gap-3 py-6 text-center">
          <p className="text-[13px] text-zinc-400">{error}</p>
          <button onClick={onRetry} className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-white/[.1] px-4 text-[13px] text-zinc-300 transition-colors hover:border-fuchsia-300/40 hover:text-zinc-100">
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> 重试
          </button>
        </div>
      ) : !sections ? (
        <div className="mt-4 flex flex-col gap-2" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="shimmer h-16 rounded-2xl" />
          ))}
        </div>
      ) : !sections.length ? (
        <p className="py-4 text-center text-[13px] text-zinc-500">年度报告暂未生成（活动型接口存在时效，年底开放）</p>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          {sections.map((sec) => (
            <div key={sec.key}>
              <p className="mb-2 text-[12px] font-semibold tracking-wide text-zinc-400">{sec.title}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {sec.cards.map((c, i) => (
                  <div key={`${sec.key}-${i}`} className="rounded-xl border border-white/[.06] bg-gradient-to-br from-white/[0.04] to-transparent p-3">
                    <p className="truncate text-[11.5px] text-zinc-500" title={c.label}>{c.label}</p>
                    <p className="mt-1 truncate text-[13.5px] font-bold text-zinc-100" title={c.value}>{c.value}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.section>
  );
}

function RecordCard({
  items,
  error,
  type,
  onTypeChange,
  onPlay,
  onRetry,
}: {
  items: PlayRecordItem[] | null;
  error: string | null;
  type: 0 | 1;
  onTypeChange: (t: 0 | 1) => void;
  onPlay: (song: Song, list?: Song[]) => void;
  onRetry: () => void;
}) {
  const songs = items?.map((i) => i.song) ?? [];
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="glass rounded-3xl border border-white/[.07] p-5"
      aria-label="播放排行"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-[14px] font-bold text-zinc-100">
          <RotateCcw className="h-4 w-4 text-violet-300" aria-hidden="true" /> 播放排行
        </h3>
        {/* 审核整改 C-11：tablist 补 aria-label、触控目标提升 */}
        <div className="flex rounded-xl border border-white/[.08] bg-white/[0.02] p-1" role="tablist" aria-label="时间范围">
          {[
            { key: 1 as const, label: "最近一周" },
            { key: 0 as const, label: "全部时间" },
          ].map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={type === t.key}
              onClick={() => onTypeChange(t.key)}
              className={`min-h-[40px] rounded-lg px-3.5 text-[12px] font-medium transition-colors ${
                type === t.key ? "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white" : "text-zinc-400 hover:text-zinc-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {error && !items ? (
        /* 审核整改 B-02：error 态可重试 */
        <div className="mt-4 flex flex-col items-center gap-3 py-6 text-center">
          <p className="text-[13px] text-zinc-400">{error}</p>
          <button onClick={onRetry} className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-white/[.1] px-4 text-[13px] text-zinc-300 transition-colors hover:border-violet-400/40 hover:text-zinc-100">
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> 重试
          </button>
        </div>
      ) : !items ? (
        <div className="mt-4 flex flex-col gap-2" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="shimmer h-14 rounded-2xl" />
          ))}
        </div>
      ) : !items.length ? (
        <p className="py-4 text-center text-[13px] text-zinc-500">暂无播放记录</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-1.5">
          {items.slice(0, 100).map((item, i) => (
            <li key={`${item.song.id}-${i}`}>
              <button
                onClick={() => onPlay(item.song, songs)}
                className="flex w-full items-center gap-2.5 rounded-xl bg-white/[0.02] px-3 py-2 text-left transition-colors hover:bg-white/[0.05]"
                aria-label={`播放 ${item.song.name}`}
              >
                <span className={`w-6 text-center text-[12px] font-bold ${i < 3 ? "text-fuchsia-300" : "text-zinc-600"}`}>{i + 1}</span>
                {item.song.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={coverProxyUrl(item.song.cover, item.song.source)} alt="" loading="lazy" className="h-10 w-10 rounded-lg object-cover" />
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/[0.05]">
                    <Music2 className="h-4 w-4 text-zinc-500" aria-hidden="true" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-[13px] text-zinc-200">{item.song.name}</b>
                  <span className="block truncate text-[11px] text-zinc-500">
                    {item.song.artist} · {formatDuration(item.song.duration)}
                  </span>
                </span>
                <span className="shrink-0 text-[11.5px] text-zinc-500">{item.play_count} 次</span>
                <Play className="h-4 w-4 shrink-0 text-zinc-600" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </motion.section>
  );
}

function HistoryCard({
  days,
  error,
  detail,
  onPick,
  onPlay,
  onRetry,
}: {
  days: HistoryDailyRecommend[] | null;
  error: string | null;
  detail: (HistoryDailyRecommend & { error?: string }) | null;
  onPick: (d: HistoryDailyRecommend) => void;
  onPlay: (song: Song, list?: Song[]) => void;
  onRetry: () => void;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.14 }}
      className="glass rounded-3xl border border-white/[.07] p-5"
      aria-label="历史每日推荐"
    >
      <h3 className="flex items-center gap-2 text-[14px] font-bold text-zinc-100">
        <CalendarDays className="h-4 w-4 text-amber-300" aria-hidden="true" /> 每日推荐回忆
      </h3>
      {!days ? (
        error ? (
          /* 审核整改 B-02：error 态可重试 */
          <div className="mt-4 flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-[13px] text-zinc-400">{error}</p>
            <button onClick={onRetry} className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-white/[.1] px-4 text-[13px] text-zinc-300 transition-colors hover:border-amber-300/40 hover:text-zinc-100">
              <RotateCcw className="h-4 w-4" aria-hidden="true" /> 重试
            </button>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2" aria-busy="true">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="shimmer h-9 w-24 rounded-full" />
            ))}
          </div>
        )
      ) : !days.length ? (
        <p className="py-4 text-center text-[13px] text-zinc-500">暂无历史每日推荐记录（需连续使用每日推荐）</p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            {days.slice(0, 30).map((d) => (
              <button
                key={d.date}
                onClick={() => onPick(d)}
                className={`min-h-[40px] rounded-full border px-3.5 text-[12px] font-medium transition-colors ${
                  detail?.date === d.date
                    ? "border-amber-300/40 bg-amber-400/15 text-amber-200"
                    : "border-white/[.08] bg-white/[0.02] text-zinc-400 hover:border-amber-300/30 hover:text-amber-100"
                }`}
              >
                {d.date}
              </button>
            ))}
          </div>
          {detail && (
            <div className="mt-4 rounded-2xl border border-white/[.06] bg-white/[0.02] p-3.5">
              <p className="mb-2 text-[12px] font-semibold text-zinc-400">{detail.date} 的每日推荐</p>
              {detail.songs.length ? (
                <ul className="flex flex-col gap-1">
                  {detail.songs.slice(0, 30).map((song, i) => (
                    <li key={`${song.id}-${i}`}>
                      <button
                        onClick={() => onPlay(song, detail.songs)}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.05]"
                        aria-label={`播放 ${song.name}`}
                      >
                        <span className="w-5 text-center text-[11px] text-zinc-600">{i + 1}</span>
                        <b className="min-w-0 flex-1 truncate text-[12.5px] text-zinc-200">{song.name}</b>
                        <span className="min-w-0 shrink-0 truncate text-[11px] text-zinc-500">{song.artist}</span>
                        <Play className="h-3.5 w-3.5 shrink-0 text-zinc-600" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : detail.error ? (
                /* 三审 R3：detail.error 渲染闭环（B-02 整改补全：失败态可重试，原永远显示"加载中…"） */
                <p className="flex items-center justify-center gap-2 py-3 text-center text-[12px] text-zinc-500">
                  {detail.error}
                  <button
                    onClick={() => onPick({ date: detail.date, songs: [] })}
                    className="text-amber-200 underline-offset-2 transition-colors hover:text-amber-100 hover:underline"
                  >
                    重试
                  </button>
                </p>
              ) : (
                <p className="py-3 text-center text-[12px] text-zinc-500">加载中…</p>
              )}
            </div>
          )}
        </>
      )}
    </motion.section>
  );
}
