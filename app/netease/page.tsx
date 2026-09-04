"use client";

/**
 * 网易云 API 控制台 — 浏览 / 检索 / 在线调试全部 439 个接口
 * 数据源 GET /api/netease（分组清单）；请求走 /api/netease<route>
 * 设计：Swiss 极简 + 高密度仪表盘（对齐项目暗色 tokens，等宽代码区）
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  Terminal,
  Search,
  Play,
  Copy,
  Check,
  Plus,
  Trash2,
  Loader2,
  Package,
  Layers,
  ChevronRight,
  CircleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";

interface ApiEntry {
  name: string;
  route: string;
}
interface Inventory {
  count: number;
  categories: Record<string, ApiEntry[]>;
}

interface ParamRow {
  id: number;
  key: string;
  value: string;
}

interface ResponseState {
  status: number;
  durationMs: number;
  body: string;
}

let paramRowId = 0;

export default function NeteaseConsolePage() {
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<string>("__all__");
  const [selected, setSelected] = useState<ApiEntry | null>(null);
  const [method, setMethod] = useState<"GET" | "POST">("GET");
  const [params, setParams] = useState<ParamRow[]>([]);
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<ResponseState | null>(null);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    fetch("/api/netease", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) {
          // 401 = 会话过期（对齐全局约定：提示登录而非静默失败/白屏崩溃）
          throw new Error(r.status === 401 ? "未登录或会话已过期，请重新登录（HTTP 401）" : `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((data: Inventory) => {
        // 结构防御：异常响应体（如 { error }）不得进入 inventory state
        if (!data || typeof data.categories !== "object" || data.categories === null) {
          throw new Error("接口清单响应结构异常（缺少 categories）");
        }
        setInventory(data);
      })
      .catch((e) => setLoadError(String(e?.message ?? e)));
  }, []);

  const filtered = useMemo(() => {
    if (!inventory) return {};
    const q = query.trim().toLowerCase();
    const out: Record<string, ApiEntry[]> = {};
    for (const [cat, list] of Object.entries(inventory.categories ?? {})) {
      if (activeCat !== "__all__" && activeCat !== cat) continue;
      const hits = q
        ? list.filter((e) => e.name.toLowerCase().includes(q) || e.route.toLowerCase().includes(q))
        : list;
      if (hits.length) out[cat] = hits;
    }
    return out;
  }, [inventory, query, activeCat]);

  const totalCount = useMemo(
    () => Object.values(filtered).reduce((n, list) => n + list.length, 0),
    [filtered],
  );

  const selectApi = useCallback((entry: ApiEntry) => {
    setSelected(entry);
    setResponse(null);
    setParams([]);
    setMethod("GET");
  }, []);

  const send = useCallback(async () => {
    if (!selected) return;
    const usp = new URLSearchParams();
    for (const p of params) {
      const k = p.key.trim();
      if (k) usp.append(k, p.value);
    }
    const qs = usp.toString();
    const url = `/api/netease${selected.route}${qs ? `?${qs}` : ""}`;
    setSending(true);
    const started = performance.now();
    try {
      const resp = await fetch(url, { method });
      const durationMs = Math.round(performance.now() - started);
      let text = await resp.text();
      try {
        text = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* 非 JSON 原样 */
      }
      if (text.length > 400_000) text = text.slice(0, 400_000) + "\n…（已截断）";
      setResponse({ status: resp.status, durationMs, body: text });
    } catch (e: any) {
      setResponse({ status: 0, durationMs: Math.round(performance.now() - started), body: String(e?.message ?? e) });
    } finally {
      setSending(false);
    }
  }, [selected, params, method]);

  const copyText = useCallback(async (text: string, tag: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      toast.error("复制失败");
    }
  }, []);

  const statusTone = (s: number) =>
    s >= 200 && s < 300
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
      : s >= 300 && s < 400
        ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
        : s === 0
          ? "bg-zinc-500/15 text-zinc-400 border-zinc-500/30"
          : "bg-red-500/15 text-red-300 border-red-500/30";

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-6 lg:px-8 lg:py-10">
      <PageHeader
        icon={Terminal}
        title="网易云 API 控制台"
        subtitle={
          <>
            迁移自{" "}
            <a
              href="https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced"
              target="_blank"
              rel="noreferrer"
              className="text-zinc-400 underline decoration-zinc-600 underline-offset-2 hover:text-zinc-200"
            >
              api-enhanced
            </a>{" "}
            · 路由规则 1:1 · 未显式传 cookie 时自动注入已登录账号
          </>
        }
        actions={
          <div className="flex items-center gap-2 text-[12px]">
            <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-zinc-300">
              <Package className="h-3.5 w-3.5 text-fuchsia-300" aria-hidden="true" />
              {inventory?.count ?? "…"} 个接口
            </span>
            <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-zinc-300">
              <Layers className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" />
              {inventory ? Object.keys(inventory.categories ?? {}).length : "…"} 个分类
            </span>
          </div>
        }
      />

      {loadError && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-300">
          <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          接口清单加载失败：{loadError}
        </div>
      )}

      {/* 搜索栏（FAQ Landing 模式：搜索优先） */}
      <div className="relative mb-4">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
          aria-hidden="true"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索接口名或路由，如 login、song/url、cloudsearch…"
          className="input-shell w-full rounded-xl py-2.5 pl-10 pr-16 text-[13px] text-zinc-100"
          aria-label="搜索接口"
        />
        <span className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[11px] text-zinc-500">
          {totalCount}
        </span>
      </div>

      {/* 移动端分类筛选（lg 以下展示横向 chips；PC 端用左侧分类栏） */}
      {inventory && (
        <div
          className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:hidden"
          role="tablist"
          aria-label="接口分类"
        >
          <CategoryChip
            label="全部"
            count={inventory.count}
            active={activeCat === "__all__"}
            onClick={() => setActiveCat("__all__")}
          />
          {Object.entries(inventory.categories ?? {}).map(([cat, list]) => (
            <CategoryChip
              key={cat}
              label={cat}
              count={list.length}
              active={activeCat === cat}
              onClick={() => setActiveCat(cat)}
            />
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[190px_1fr_minmax(0,440px)]">
        {/* ── 分类侧栏 ── */}
        <nav
          className="glass hidden max-h-[calc(100dvh-220px)] flex-col gap-0.5 overflow-y-auto rounded-2xl border border-white/[0.07] p-2 lg:sticky lg:top-4 lg:flex"
          aria-label="接口分类"
        >
          <CategoryButton
            label="全部"
            count={inventory?.count ?? 0}
            active={activeCat === "__all__"}
            onClick={() => setActiveCat("__all__")}
          />
          {inventory &&
            Object.entries(inventory.categories ?? {}).map(([cat, list]) => (
              <CategoryButton
                key={cat}
                label={cat}
                count={list.length}
                active={activeCat === cat}
                onClick={() => setActiveCat(cat)}
              />
            ))}
        </nav>

        {/* ── 接口列表 ── */}
        <div
          className="glass max-h-[calc(100dvh-220px)] min-h-[320px] overflow-y-auto rounded-2xl border border-white/[0.07] p-2"
          role="list"
        >
          {!inventory && !loadError && <ListSkeleton />}
          {inventory && totalCount === 0 && (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-zinc-500">
              <Search className="h-6 w-6" aria-hidden="true" />
              <p className="text-[13px]">没有匹配「{query}」的接口</p>
            </div>
          )}
          {Object.entries(filtered).map(([cat, list]) => (
            <div key={cat} className="mb-1">
              <p className="sticky top-0 z-[1] bg-surface-console/95 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 backdrop-blur-sm">
                {cat} · {list.length}
              </p>
              {list.map((entry) => {
                const active = selected?.name === entry.name;
                return (
                  <button
                    key={entry.name}
                    role="listitem"
                    onClick={() => selectApi(entry)}
                    className={`group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors duration-200 ${
                      active
                        ? "bg-violet-500/15 text-zinc-100"
                        : "text-zinc-300 hover:bg-white/[0.05]"
                    }`}
                  >
                    <ChevronRight
                      className={`h-3 w-3 shrink-0 transition-colors duration-200 ${
                        active ? "text-fuchsia-300" : "text-zinc-600 group-hover:text-zinc-400"
                      }`}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px] leading-5">
                      {entry.route}
                    </span>
                    {active && (
                      <motion.span
                        layoutId="api-active-dot"
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-fuchsia-400"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* ── 调试面板 ── */}
        <section className="glass flex max-h-[calc(100dvh-220px)] min-h-[320px] flex-col overflow-hidden rounded-2xl border border-white/[0.07]">
          {!selected ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-zinc-500">
              <Terminal className="h-8 w-8" aria-hidden="true" />
              <p className="text-[13px]">从左侧选择一个接口开始调试</p>
              <p className="font-mono text-[11px] text-zinc-600">GET /api/netease&lt;route&gt;</p>
            </div>
          ) : (
            <>
              {/* 选中接口 + 方法 + 发送 */}
              <div className="border-b border-white/[0.07] p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="truncate font-mono text-[12px] text-zinc-400">{selected.name}</p>
                  <button
                    onClick={() => copyText(selected.route, "route")}
                    className="flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-zinc-400 transition-colors duration-200 hover:text-zinc-200"
                  >
                    {copied === "route" ? (
                      <Check className="h-3 w-3 text-emerald-400" aria-hidden="true" />
                    ) : (
                      <Copy className="h-3 w-3" aria-hidden="true" />
                    )}
                    路由
                  </button>
                </div>
                <div className="flex items-stretch gap-2">
                  <div className="flex overflow-hidden rounded-lg border border-white/10" role="group" aria-label="请求方法">
                    {(["GET", "POST"] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setMethod(m)}
                        className={`px-3 py-1.5 font-mono text-[11px] font-semibold transition-colors duration-200 ${
                          method === m
                            ? m === "GET"
                              ? "bg-emerald-500/20 text-emerald-300"
                              : "bg-amber-500/20 text-amber-300"
                            : "bg-white/[0.03] text-zinc-500 hover:text-zinc-300"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  <code className="input-shell min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg px-3 py-1.5 font-mono text-[12px] leading-5 text-cyan-300">
                    /api/netease{selected.route}
                  </code>
                  <button
                    onClick={send}
                    disabled={sending}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-lg shadow-fuchsia-500/20 transition-all duration-200 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {sending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Play className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    发送
                  </button>
                </div>
              </div>

              {/* 参数编辑 */}
              <div className="border-b border-white/[0.07] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    查询参数
                  </p>
                  <button
                    onClick={() => setParams((p) => [...p, { id: ++paramRowId, key: "", value: "" }])}
                    className="flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-zinc-400 transition-colors duration-200 hover:text-zinc-200"
                  >
                    <Plus className="h-3 w-3" aria-hidden="true" />
                    添加
                  </button>
                </div>
                {params.length === 0 ? (
                  <p className="py-1 text-[12px] text-zinc-600">
                    无参数。示例：id、limit、offset、keywords、level…
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {params.map((p) => (
                      <div key={p.id} className="flex items-center gap-1.5">
                        <input
                          value={p.key}
                          onChange={(e) =>
                            setParams((rows) =>
                              rows.map((r) => (r.id === p.id ? { ...r, key: e.target.value } : r)),
                            )
                          }
                          placeholder="key"
                          aria-label="参数名"
                          className="input-shell min-w-0 w-[38%] rounded-md px-2 py-1 font-mono text-[12px] text-zinc-200"
                        />
                        <input
                          value={p.value}
                          onChange={(e) =>
                            setParams((rows) =>
                              rows.map((r) => (r.id === p.id ? { ...r, value: e.target.value } : r)),
                            )
                          }
                          placeholder="value"
                          aria-label="参数值"
                          className="input-shell min-w-0 flex-1 rounded-md px-2 py-1 font-mono text-[12px] text-zinc-200"
                        />
                        <button
                          onClick={() => setParams((rows) => rows.filter((r) => r.id !== p.id))}
                          className="shrink-0 rounded-md p-1 text-zinc-600 transition-colors duration-200 hover:text-red-400"
                          aria-label="删除参数"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 响应 */}
              <div className="flex min-h-0 flex-1 flex-col p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    响应
                  </p>
                  {response && (
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold ${statusTone(response.status)}`}
                      >
                        {response.status === 0 ? "ERR" : response.status}
                      </span>
                      <span className="font-mono text-[11px] text-zinc-500">
                        {response.durationMs}ms
                      </span>
                      <button
                        onClick={() => copyText(response.body, "resp")}
                        className="flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-zinc-400 transition-colors duration-200 hover:text-zinc-200"
                      >
                        {copied === "resp" ? (
                          <Check className="h-3 w-3 text-emerald-400" aria-hidden="true" />
                        ) : (
                          <Copy className="h-3 w-3" aria-hidden="true" />
                        )}
                        复制
                      </button>
                    </div>
                  )}
                </div>
                <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-white/[0.07] bg-black/30">
                  {response ? (
                    <pre className="p-3 font-mono text-[11.5px] leading-relaxed text-zinc-300">
                      {response.body}
                    </pre>
                  ) : (
                    <div className="flex h-full min-h-[120px] items-center justify-center text-[12px] text-zinc-600">
                      {sending ? "请求中…" : "点击「发送」查看响应"}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/* ---------- 分类按钮 ---------- */
function CategoryButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[12px] transition-colors duration-200 ${
        active ? "bg-violet-500/15 font-semibold text-zinc-100" : "text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200"
      }`}
    >
      <span className="truncate">{label}</span>
      <span className="shrink-0 font-mono text-[10.5px] text-zinc-600">{count}</span>
    </button>
  );
}

/* ---------- 移动端分类 chip ---------- */
function CategoryChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[12px] transition-colors duration-200 ${
        active
          ? "border-violet-500/40 bg-violet-500/15 font-semibold text-zinc-100"
          : "border-white/10 bg-white/[0.04] text-zinc-400 hover:text-zinc-200"
      }`}
    >
      <span>{label}</span>
      <span className="font-mono text-[10.5px] text-zinc-600">{count}</span>
    </button>
  );
}

/* ---------- 列表骨架 ---------- */
function ListSkeleton() {
  return (
    <div className="flex flex-col gap-1.5 p-2" aria-hidden="true">
      {Array.from({ length: 14 }).map((_, i) => (
        <div key={i} className="shimmer h-7 rounded-lg" style={{ opacity: 1 - i * 0.05 }} />
      ))}
    </div>
  );
}
