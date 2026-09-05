"use client";

/**
 * QQ 音乐 API 控制台 — 浏览 / 检索 / 在线调试全部接口（14 模块 105+ 端点）
 * 数据源 GET /api/qq（分组清单）；请求走 /api/qq<route>
 * 设计：Swiss 极简 + 高密度仪表盘（QQ 品牌绿 accent，等宽代码区，暗色 tokens 与项目一致）
 * 交互特性：自动解析路由中的 {path_param} 生成必填行；GET/POST/DELETE 方法按接口定义锁定
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Music2,
  Lock,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { apiConsoleFetch } from "@/lib/client/api";

interface ApiEntry {
  id: string;
  name: string;
  route: string;
  method: string;
  summary: string;
  auth: string;
}
interface Inventory {
  count: number;
  categories: Record<string, ApiEntry[]>;
}

interface ParamRow {
  id: number;
  key: string;
  value: string;
  /** path 占位参数（来自路由 {xxx}）不可编辑 key */
  isPath?: boolean;
  required?: boolean;
}

interface ResponseState {
  status: number;
  durationMs: number;
  body: string;
}

let paramRowId = 0;

const METHOD_TONE: Record<string, string> = {
  GET: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  POST: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  DELETE: "bg-red-500/15 text-red-300 border-red-500/30",
};

export default function QQConsolePage() {
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<string>("__all__");
  const [selectedId, setSelectedId] = useState("");
  const [params, setParams] = useState<ParamRow[]>([]);
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<ResponseState | null>(null);
  const [copied, setCopied] = useState("");

  /** URL 即状态（审核整改 P3-06）：q / cat / api 进 query，可分享、刷新/回退还原 */
  const urlRestoredRef = useRef(false);
  useEffect(() => {
    if (!urlRestoredRef.current) {
      urlRestoredRef.current = true;
      const usp = new URLSearchParams(window.location.search);
      const q = usp.get("q");
      const cat = usp.get("cat");
      const api = usp.get("api");
      if (q) setQuery(q);
      if (cat) setActiveCat(cat);
      if (api) setSelectedId(api);
      return; // 首帧仅恢复；状态更新后由下一次执行写回
    }
    const out = new URLSearchParams();
    if (query.trim()) out.set("q", query.trim());
    if (activeCat !== "__all__") out.set("cat", activeCat);
    if (selectedId) out.set("api", selectedId);
    const qs = out.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [query, activeCat, selectedId]);

  const loadInventory = useCallback(() => {
    setLoadError("");
    apiConsoleFetch("/api/qq", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) {
          throw new Error(r.status === 401 ? "未登录或会话已过期，请重新登录（HTTP 401）" : `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((data: Inventory) => {
        if (!data || typeof data.categories !== "object" || data.categories === null) {
          throw new Error("接口清单响应结构异常（缺少 categories）");
        }
        setInventory(data);
      })
      .catch((e) => setLoadError(String(e?.message ?? e)));
  }, []);

  useEffect(() => {
    loadInventory();
  }, [loadInventory]);

  /** 选中接口（点击列表或 URL 恢复 api 参数）从清单派生 */
  const selected = useMemo(() => {
    if (!inventory || !selectedId) return null;
    for (const list of Object.values(inventory.categories ?? {})) {
      const hit = list.find((e) => e.id === selectedId);
      if (hit) return hit;
    }
    return null;
  }, [inventory, selectedId]);

  /** 选中接口变化 → 生成路径参数行并清空上次响应 */
  useEffect(() => {
    if (!selected) {
      setParams([]);
      setResponse(null);
      return;
    }
    const placeholders = [...selected.route.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    setParams(placeholders.map((key) => ({ id: ++paramRowId, key, value: "", isPath: true, required: true })));
    setResponse(null);
  }, [selected]);

  const filtered = useMemo(() => {
    if (!inventory) return {};
    const q = query.trim().toLowerCase();
    const out: Record<string, ApiEntry[]> = {};
    for (const [cat, list] of Object.entries(inventory.categories ?? {})) {
      if (activeCat !== "__all__" && activeCat !== cat) continue;
      const hits = q
        ? list.filter(
            (e) =>
              e.name.toLowerCase().includes(q) ||
              e.route.toLowerCase().includes(q) ||
              e.summary.toLowerCase().includes(q),
          )
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
    setSelectedId(entry.id);
  }, []);

  /** 发送：替换路径占位符 → 拼 query → 按 CHANGE/body 规则发 JSON */
  const send = useCallback(async () => {
    if (!selected) return;
    const usp = new URLSearchParams();
    let route = selected.route;
    for (const p of params) {
      const k = p.key.trim();
      if (!k) continue;
      if (p.isPath) {
        route = route.replace(`{${k}}`, encodeURIComponent(p.value.trim()));
      } else {
        usp.append(k, p.value);
      }
    }
    if (/\{\w+\}/.test(route)) {
      toast.error("请先填写路径参数（路由中的 {…} 占位）");
      return;
    }
    const qs = usp.toString();
    const url = `/api/qq${route}${qs ? `?${qs}` : ""}`;
    setSending(true);
    const started = performance.now();
    try {
      // 统一层（审核整改 P3-07/P1-01）：非 GET 自动携带 X-Requested-With（writeGuard CSRF 防护）
      // 非 GET：query 同步进 body，便于对象/数组型参数（file_info / query_info / files…）
      const resp = await apiConsoleFetch(url, {
        method: selected.method,
        ...(selected.method === "GET" ? {} : { body: Object.fromEntries(usp.entries()) }),
      });
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
  }, [selected, params]);

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
        icon={Music2}
        title="QQ 音乐 API 控制台"
        subtitle="14 模块全量接口 · 登录态自动注入（扫码/验证码成功即写入）"
        actions={
          <div className="flex items-center gap-2 text-[12px]">
            <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-zinc-300">
              <Package className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
              {inventory?.count ?? "…"} 个接口
            </span>
            <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-zinc-300">
              <Layers className="h-3.5 w-3.5 text-teal-300" aria-hidden="true" />
              {inventory ? Object.keys(inventory.categories ?? {}).length : "…"} 个模块
            </span>
          </div>
        }
      />

      {loadError && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-300">
          <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">接口清单加载失败：{loadError}</span>
          <button
            onClick={loadInventory}
            className="shrink-0 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[12px] font-medium text-red-200 transition-colors duration-200 hover:bg-red-500/20"
          >
            重试
          </button>
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
          placeholder="搜索接口名、路由或描述，如 qrcode、song/url、私信…"
          className="input-shell w-full rounded-xl py-2.5 pl-10 pr-16 text-[13px] text-zinc-100"
          aria-label="搜索接口"
        />
        <span className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[11px] text-zinc-500">
          {totalCount}
        </span>
      </div>

      {/* 移动端分类筛选（lg 以下横向 chips） */}
      {inventory && (
        <div
          className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:hidden"
          role="tablist"
          aria-label="接口模块"
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

      <div className="grid gap-4 lg:grid-cols-[200px_1fr_minmax(0,460px)]">
        {/* ── 模块侧栏 ── */}
        <nav
          className="glass hidden max-h-[calc(100dvh-220px)] flex-col gap-0.5 overflow-y-auto rounded-2xl border border-white/[0.07] p-2 lg:sticky lg:top-4 lg:flex"
          aria-label="接口模块"
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
                const active = selected?.id === entry.id;
                return (
                  <button
                    key={entry.id}
                    role="listitem"
                    onClick={() => selectApi(entry)}
                    title={entry.summary}
                    className={`group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors duration-200 ${
                      active ? "bg-emerald-500/15 text-zinc-100" : "text-zinc-300 hover:bg-white/[0.05]"
                    }`}
                  >
                    <ChevronRight
                      className={`h-3 w-3 shrink-0 transition-colors duration-200 ${
                        active ? "text-emerald-300" : "text-zinc-600 group-hover:text-zinc-400"
                      }`}
                      aria-hidden="true"
                    />
                    <span
                      className={`shrink-0 rounded border px-1 py-px font-mono text-[9.5px] font-semibold leading-none ${
                        METHOD_TONE[entry.method] ?? METHOD_TONE.GET
                      }`}
                    >
                      {entry.method}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px] leading-5">{entry.route}</span>
                    {entry.auth === "required" && (
                      <Lock className="h-3 w-3 shrink-0 text-amber-400/70" aria-label="需要登录" aria-hidden="false" />
                    )}
                    {active && (
                      <motion.span
                        layoutId="qq-api-active-dot"
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400"
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
              <p className="font-mono text-[11px] text-zinc-600">GET /api/qq&lt;route&gt;</p>
              <p className="text-[11px] text-zinc-600">带 &#123;param&#125; 的路由会自动生成必填参数行</p>
            </div>
          ) : (
            <>
              {/* 选中接口 + 方法 + 发送 */}
              <div className="border-b border-white/[0.07] p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="truncate text-[12px] text-zinc-400" title={selected.summary}>
                    {selected.summary}
                  </p>
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
                  <span
                    className={`flex shrink-0 items-center rounded-lg border px-3 font-mono text-[11px] font-semibold ${
                      METHOD_TONE[selected.method] ?? METHOD_TONE.GET
                    }`}
                  >
                    {selected.method}
                  </span>
                  <code className="input-shell min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg px-3 py-1.5 font-mono text-[12px] leading-5 text-emerald-300">
                    /api/qq{selected.route}
                  </code>
                  <button
                    onClick={send}
                    disabled={sending}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-lg shadow-emerald-500/20 transition-all duration-200 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
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

              {/* 参数编辑：路径参数（必填，key 锁定）+ 自定义 query */}
              <div className="border-b border-white/[0.07] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    参数{params.some((p) => p.isPath) && <span className="ml-1 normal-case text-amber-400/80">路径参数必填</span>}
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
                    无参数。示例：keyword、num、page、song_ids…
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {params.map((p) => (
                      <div key={p.id} className="flex items-center gap-1.5">
                        <div className="flex min-w-0 w-[42%] items-center gap-1">
                          <span
                            className={`shrink-0 rounded px-1 py-px font-mono text-[9.5px] leading-none ${
                              p.isPath
                                ? "bg-amber-500/15 text-amber-300"
                                : "bg-white/[0.05] text-zinc-500"
                            }`}
                          >
                            {p.isPath ? "path" : "query"}
                          </span>
                          <input
                            value={p.key}
                            readOnly={p.isPath}
                            onChange={(e) =>
                              setParams((rows) =>
                                rows.map((r) => (r.id === p.id ? { ...r, key: e.target.value } : r)),
                              )
                            }
                            placeholder="key"
                            aria-label={p.isPath ? `路径参数 ${p.key}` : "参数名"}
                            className={`input-shell min-w-0 flex-1 rounded-md px-2 py-1 font-mono text-[12px] ${
                              p.isPath ? "text-amber-200/90" : "text-zinc-200"
                            }`}
                          />
                        </div>
                        <input
                          value={p.value}
                          onChange={(e) =>
                            setParams((rows) =>
                              rows.map((r) => (r.id === p.id ? { ...r, value: e.target.value } : r)),
                            )
                          }
                          placeholder={p.isPath ? `替换 {${p.key}}` : "value"}
                          aria-label={`${p.key} 参数值`}
                          className="input-shell min-w-0 flex-1 rounded-md px-2 py-1 font-mono text-[12px] text-zinc-200"
                        />
                        {!p.isPath && (
                          <button
                            onClick={() => setParams((rows) => rows.filter((r) => r.id !== p.id))}
                            className="shrink-0 rounded-md p-1 text-zinc-600 transition-colors duration-200 hover:text-red-400"
                            aria-label="删除参数"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 响应 */}
              <div className="flex min-h-0 flex-1 flex-col p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">响应</p>
                  {response && (
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold ${statusTone(response.status)}`}
                      >
                        {response.status === 0 ? "ERR" : response.status}
                      </span>
                      <span className="font-mono text-[11px] text-zinc-500">{response.durationMs}ms</span>
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
                    <pre className="p-3 font-mono text-[11.5px] leading-relaxed text-zinc-300">{response.body}</pre>
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

/* ---------- 模块按钮 ---------- */
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
        active ? "bg-emerald-500/15 font-semibold text-zinc-100" : "text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200"
      }`}
    >
      <span className="min-w-0 flex-1 truncate text-left" title={label}>{label}</span>
      <span className="shrink-0 font-mono text-[10.5px] text-zinc-600">{count}</span>
    </button>
  );
}

/* ---------- 移动端模块 chip ---------- */
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
          ? "border-emerald-500/40 bg-emerald-500/15 font-semibold text-zinc-100"
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
