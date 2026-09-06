"use client";

/**
 * 设置：音源登录状态（扫码） / 手动 Cookie / 播放与下载设置 / 下载记录
 * QR 轮询 3s，组件卸载或弹窗关闭即清理定时器
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  QrCode,
  ChevronDown,
  Loader2,
  Trash2,
  Save,
  Cookie,
  SlidersHorizontal,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  CloudUpload,
  ServerCog,
  KeyRound,
  Eye,
  EyeOff,
  LogOut,
} from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/modal";
import {
  apiGetCookies,
  apiSaveCookies,
  apiCreateQRLogin,
  apiCheckQRLogin,
  apiSettings,
  apiSaveSettings,
  apiSystemStatus,
  apiPasswordChange,
  type SystemStatus,
} from "@/lib/client/api";
import { refreshPlayerSettings } from "@/lib/client/store";
import { sourceMeta } from "@/lib/play-url";
import type { QRLoginSession } from "@/lib/types";
import { PageHeader } from "@/components/page-header";

/** 扫码登录源（汽水扫码未调通，已隐藏入口） */
const LOGIN_SOURCES = ["netease", "qq", "qq_wx", "kugou", "bilibili"];
/** 手动 Cookie 源：在扫码源基础上补 soda（汽水需手动配置 Cookie 才能使用个人歌单/下载） */
const COOKIE_SOURCES = [...LOGIN_SOURCES, "soda"];

type QRState = { source: string; session: QRLoginSession; status: "waiting" | "scanned" | "expired" };

export default function SettingsPage() {
  const [cookieTick, setCookieTick] = useState(0);
  const refreshCookies = useCallback(() => setCookieTick((t) => t + 1), []);

  return (
    <div className="mx-auto w-full max-w-[880px] px-4 py-6 lg:px-8 lg:py-10">
      <PageHeader icon={SlidersHorizontal} title="设置" subtitle="音源登录、播放与下载偏好、本地数据管理" />

      <div className="flex flex-col gap-5">
        <SystemStatusCard />
        <LoginSection tick={cookieTick} onCookieChanged={refreshCookies} />
        <CookieSection tick={cookieTick} onSaved={refreshCookies} />
        <PlaybackSection />
        <PasswordSection />
      </div>
    </div>
  );
}

/* ================= 账号安全：修改密码（审核补充：登录体系完善） ================= */

function PasswordSection() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const save = async () => {
    if (newPassword.length < 6) {
      toast.error("新密码至少 6 位");
      return;
    }
    if (newPassword !== confirm) {
      toast.error("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    try {
      await apiPasswordChange({ old_password: oldPassword, new_password: newPassword, confirm_password: confirm });
      toast.success("密码已修改（当前会话已续期）");
      setOldPassword("");
      setNewPassword("");
      setConfirm("");
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "修改失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="glass rounded-3xl border border-white/[0.07] p-5"
      aria-label="账号安全"
    >
      <h2 className="flex items-center gap-2 text-[15px] font-bold text-zinc-100">
        <KeyRound className="h-4 w-4 text-fuchsia-300" aria-hidden="true" /> 账号安全
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
        修改管理员登录密码；忘记密码可在登录页通过服务端日志重置令牌找回
      </p>

      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="mt-3 flex h-11 items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] px-4 text-[13px] font-medium text-zinc-200 transition-colors hover:bg-white/[0.08] active:scale-95"
        >
          <KeyRound className="h-4 w-4" aria-hidden="true" /> 修改密码
        </button>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <PwField label="旧密码" value={oldPassword} onChange={setOldPassword} autoComplete="current-password" />
          <PwField label="新密码（至少 6 位）" value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
          <PwField label="确认新密码" value={confirm} onChange={setConfirm} autoComplete="new-password" />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setOpen(false)}
              className="h-11 rounded-xl border border-white/[0.1] px-4 text-[13px] text-zinc-400 transition-colors hover:text-zinc-200"
            >
              取消
            </button>
            <button
              onClick={save}
              disabled={busy || !oldPassword || !newPassword}
              className="flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 text-[13px] font-semibold text-white shadow-lg shadow-fuchsia-500/25 transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              确认修改
            </button>
          </div>
        </div>
      )}
    </motion.section>
  );
}

/** 密码输入（带显隐切换，对齐登录页交互）：显示状态内聚在字段内，三个字段互不影响 */
function PwField({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-zinc-400">{label}</span>
      <span className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          className="h-11 w-full rounded-xl input-shell px-3.5 pr-12 text-sm text-zinc-200"
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? "隐藏密码" : "显示密码"}
          aria-pressed={show}
          className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:text-zinc-200"
        >
          {show ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </span>
    </label>
  );
}

/* ================= 0) 环境状态（ffmpeg / 下载目录 / 版本） ================= */

const FFMPEG_SOURCE_LABEL: Record<SystemStatus["ffmpeg_source"], string> = {
  path: "系统 PATH",
  builtin: "内置二进制",
  env: "环境变量指定",
  unavailable: "不可用",
};

function SystemStatusCard() {
  const [status, setStatus] = useState<SystemStatus | null>(null);

  useEffect(() => {
    let alive = true;
    apiSystemStatus()
      .then((s) => alive && setStatus(s))
      .catch(() => alive && setStatus(null));
    return () => {
      alive = false;
    };
  }, []);

  if (status === null) return null;

  const ffmpegOk = status.ffmpeg_available;
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="glass rounded-3xl border border-white/[0.1] p-5"
      aria-label="环境状态"
    >
      <h2 className="flex items-center gap-2 text-[15px] font-bold text-zinc-100">
        <ServerCog className="h-4 w-4 text-emerald-300" aria-hidden="true" /> 环境状态
      </h2>
      <div className="mt-3 flex flex-col gap-2 text-[13px]">
        <div className="flex items-center justify-between gap-3">
          <span className="text-zinc-500">ffmpeg（元数据嵌入 / 视频合成）</span>
          <span className={`flex items-center gap-1.5 ${ffmpegOk ? "text-emerald-300" : "text-amber-300"}`}>
            {ffmpegOk ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4" aria-hidden="true" />}
            {FFMPEG_SOURCE_LABEL[status.ffmpeg_source] ?? status.ffmpeg_source}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-zinc-500">服务器下载目录</span>
          <span className="max-w-[55%] truncate font-mono text-[12px] text-zinc-300" title={status.download_dir}>
            {status.download_dir}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-zinc-500">版本 / 平台</span>
          <span className="text-zinc-300">
            v{status.app_version} · {status.platform}
          </span>
        </div>
      </div>
    </motion.section>
  );
}

/* ================= a) 音源登录状态 + 扫码 ================= */

function LoginSection({ tick, onCookieChanged }: { tick: number; onCookieChanged: () => void }) {
  const [cookies, setCookies] = useState<Record<string, string> | null>(null);
  const [qr, setQr] = useState<QRState | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [loggingOut, setLoggingOut] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);
  const notifiedScanRef = useRef(false);

  const load = useCallback(() => {
    apiGetCookies()
      .then(setCookies)
      .catch(() => setCookies({}));
  }, []);

  useEffect(() => {
    load();
  }, [load, tick]);

  /* QR 轮询：waiting/scanned 每 3s 查一次；卸载 / 关闭自动清理 */
  useEffect(() => {
    if (!qr || qr.status === "expired") return;
    let alive = true;
    const timer = setInterval(async () => {
      try {
        const r = await apiCheckQRLogin(qr.source, qr.session.key);
        if (!alive) return;
        if (r.status === "scanned") {
          if (!notifiedScanRef.current) {
            notifiedScanRef.current = true;
            toast.info("已扫描，请在手机上确认登录");
          }
          setQr((s) => (s && s.status === "waiting" ? { ...s, status: "scanned" } : s));
        } else if (r.status === "success") {
          /* P2-02：凭证不经前端——服务端已写库（管理员/桌面模式）并经 HttpOnly Set-Cookie 下发浏览器 */
          toast.success(`${sourceMeta(qr.source).label} 登录成功`);
          setQr(null);
          onCookieChanged();
        } else if (r.status === "expired" || r.status === "failed") {
          setQr((s) => (s ? { ...s, status: "expired" } : s));
        }
      } catch {
        /* 网络抖动：继续轮询 */
      }
    }, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [qr, onCookieChanged]);

  const openQR = async (source: string) => {
    setQrLoading(true);
    setImgError(false);
    notifiedScanRef.current = false;
    try {
      const session = await apiCreateQRLogin(source);
      if (!session?.key || (!session.url && !session.image_url)) throw new Error("未获取到二维码");
      setQr({ source, session, status: "waiting" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `${sourceMeta(source).label} 暂不支持扫码登录`);
    } finally {
      setQrLoading(false);
    }
  };

  /** 退出登录：空串触发服务端删键语义（setAllCookies 空值 → DELETE），清除该源已保存的服务器 Cookie */
  const logout = async (source: string, cookieKey: string) => {
    setLoggingOut(source);
    try {
      const r = await apiSaveCookies({ [cookieKey]: "" });
      const err = (r as { error?: string }).error;
      if (err) throw new Error(err);
      toast.success(
        cookieKey === "qq"
          ? "已退出登录（QQ 与微信通道共用凭证，已一并清除）"
          : `${sourceMeta(source).label} 已退出登录`,
      );
      onCookieChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "退出失败");
    } finally {
      setLoggingOut(null);
    }
  };

  const qrImg = qr ? qr.session.image_url || qr.session.url : "";

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="glass rounded-3xl border border-white/[0.1] p-5"
      aria-label="音源登录"
    >
      <h2 className="flex items-center gap-2 text-[15px] font-bold text-zinc-100">
        <QrCode className="h-4 w-4 text-fuchsia-300" aria-hidden="true" /> 音源登录
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">扫码登录后可同步各源的个人收藏歌单（歌单广场 · 我的收藏）</p>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {LOGIN_SOURCES.map((s) => {
          const meta = sourceMeta(s);
          const cookieKey = s === "qq_wx" ? "qq" : s;
          const configured = Boolean(cookies && cookies[cookieKey] && cookies[cookieKey].trim());
          return (
            <div key={s} className="flex min-h-[60px] flex-wrap items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-3.5 py-2">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${configured ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" : "bg-zinc-600"}`}
                aria-hidden="true"
              />
              <span className="shrink-0 text-[13px] font-medium text-zinc-200">{meta.label}</span>
              <span className={`shrink-0 text-[11px] ${configured ? "text-emerald-300/80" : "text-zinc-500"}`}>
                {cookies === null ? "检测中…" : configured ? "已登录" : "未登录"}
              </span>
              {configured ? (
                <button
                  onClick={() => void logout(s, cookieKey)}
                  disabled={loggingOut === s}
                  className="ml-auto flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-red-500/20 bg-red-500/[0.07] px-3.5 text-[12px] font-medium text-red-300 transition-colors hover:bg-red-500/15 active:scale-95 disabled:opacity-50"
                >
                  {loggingOut === s ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <LogOut className="h-3.5 w-3.5" aria-hidden="true" />} 退出
                </button>
              ) : (
                <button
                  onClick={() => void openQR(s)}
                  disabled={qrLoading}
                  className="ml-auto flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-white/[0.1] bg-white/[0.04] px-3.5 text-[12px] font-medium text-zinc-300 transition-colors hover:border-violet-400/30 hover:text-white active:scale-95 disabled:opacity-50"
                >
                  <QrCode className="h-3.5 w-3.5" aria-hidden="true" /> 扫码登录
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* QR 模态 */}
      <Modal open={!!qr} onClose={() => setQr(null)} title={qr ? `${sourceMeta(qr.source).label} 扫码登录` : "扫码登录"} maxWidth={380}>
        {qr && (
          <div className="flex flex-col items-center gap-4 py-1">
            <div className="relative flex h-60 w-60 items-center justify-center overflow-hidden rounded-2xl bg-white p-3">
              {!imgError ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrImg}
                  alt="登录二维码"
                  className="h-full w-full object-contain"
                  onError={() => setImgError(true)}
                />
              ) : (
                <p className="p-3 text-center text-[11px] leading-relaxed break-all text-zinc-500">
                  二维码图片加载失败。请复制链接到对应 App 打开：
                  <br />
                  {qrImg}
                </p>
              )}
              {qr.status === "expired" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-950/85 backdrop-blur-sm">
                  <p className="text-[13px] font-medium text-zinc-200">二维码已过期</p>
                  <button
                    onClick={() => void openQR(qr.source)}
                    className="flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/25 hover:brightness-110 active:scale-95"
                  >
                    <RefreshCw className="h-4 w-4" aria-hidden="true" /> 刷新二维码
                  </button>
                </div>
              )}
            </div>

            <p className="flex items-center gap-2 text-[13px] text-zinc-400">
              {qr.status === "scanned" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-fuchsia-300" aria-hidden="true" />
                  已扫描，请在手机上点击确认
                </>
              ) : (
                <>请使用{sourceMeta(qr.source).label} App 扫码登录</>
              )}
            </p>
            <p className="text-[11px] leading-relaxed text-zinc-500">登录成功后 Cookie 会自动保存，关闭弹窗即可</p>
          </div>
        )}
      </Modal>
    </motion.section>
  );
}

/* ================= b) 手动 Cookie ================= */

function CookieSection({ tick, onSaved }: { tick: number; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  /** 已保存到服务器的 Cookie（source → 值）：仅展开时加载，供各行展示"清除"入口 */
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [clearing, setClearing] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    apiGetCookies()
      .then((c) => alive && setSaved(c ?? {}))
      .catch(() => alive && setSaved({}));
    return () => {
      alive = false;
    };
  }, [open, tick]);

  /** 清除已保存 Cookie：空串触发服务端删键（setAllCookies 空值 → DELETE）；qq/qq_wx 同键一并清除 */
  const clear = async (s: string) => {
    const key = s === "qq_wx" ? "qq" : s;
    setClearing(s);
    try {
      const r = await apiSaveCookies({ [key]: "" });
      const err = (r as { error?: string }).error;
      if (err) throw new Error(err);
      toast.success(
        key === "qq"
          ? "已清除（QQ 与微信通道共用存储，一并清除）"
          : `${sourceMeta(s).label} Cookie 已清除`,
      );
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "清除失败");
    } finally {
      setClearing(null);
    }
  };

  const save = async () => {
    const body: Record<string, string> = {};
    for (const s of COOKIE_SOURCES) {
      const v = (values[s] ?? "").trim();
      if (!v) continue;
      // 微信通道 Cookie 与 QQ 同库存储（读取侧统一走 qq 键，对齐扫码侧归并逻辑）
      body[s === "qq_wx" ? "qq" : s] = v;
    }
    if (!Object.keys(body).length) {
      toast.info("没有填写任何 Cookie");
      return;
    }
    // qq 与 qq_wx 同库同键（qq）：两框都填时后者覆盖前者——显式提示避免静默丢一个
    if ((values.qq ?? "").trim() && (values.qq_wx ?? "").trim()) {
      toast.info("QQ 与 QQ（微信通道）同时填写：两者存同一键，仅微信通道的值会生效");
    }
    setBusy(true);
    try {
      const r = await apiSaveCookies(body);
      const err = (r as { error?: string }).error;
      if (err) throw new Error(err);
      toast.success("Cookie 已保存");
      setValues({});
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.05 }}
      className="glass rounded-3xl border border-white/[0.1] p-5"
      aria-label="手动 Cookie"
    >
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 text-left">
        <Cookie className="h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
        <h2 className="flex-1 text-[15px] font-bold text-zinc-100">手动 Cookie</h2>
        <span className="mr-1 text-[11px] text-zinc-500">进阶</span>
        <ChevronDown className={`h-4 w-4 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {open && (
        <div className="mt-4">
          <p className="text-xs leading-relaxed text-zinc-500">
            从浏览器或抓包工具复制各源 Cookie 粘贴到这里（扫码登录失败时的备选方案）；留空的源不会被修改，已保存的源可点"清除"删除。
          </p>
          <div className="mt-4">
            {COOKIE_SOURCES.map((s) => {
              const key = s === "qq_wx" ? "qq" : s;
              const hasSaved = Boolean(saved[key] && saved[key].trim());
              return (
                <div key={s} className="mb-3 last:mb-0">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <label htmlFor={`cookie-${s}`} className="block text-xs font-medium text-zinc-400">
                      {sourceMeta(s).label} Cookie
                      {hasSaved && <span className="ml-1.5 text-emerald-300/70">已保存</span>}
                    </label>
                    {hasSaved && (
                      <button
                        onClick={() => void clear(s)}
                        disabled={clearing === s}
                        className="flex h-9 shrink-0 items-center gap-1 rounded-xl border border-red-500/20 bg-red-500/[0.07] px-2.5 text-[11px] font-medium text-red-300 transition-colors hover:bg-red-500/15 active:scale-95 disabled:opacity-50"
                      >
                        {clearing === s ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Trash2 className="h-3 w-3" aria-hidden="true" />} 清除
                      </button>
                    )}
                  </div>
                  <textarea
                    id={`cookie-${s}`}
                    value={values[s] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [s]: e.target.value }))}
                    rows={2}
                    spellCheck={false}
                    placeholder={`粘贴 ${sourceMeta(s).label} 的 Cookie 字符串（留空则不修改）`}
                    className="w-full resize-y rounded-xl input-shell px-3.5 py-2.5 font-mono text-[12px] leading-relaxed text-zinc-200"
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex justify-end">
            <button
              onClick={save}
              disabled={busy}
              className="flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/25 transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              保存 Cookie
            </button>
          </div>
        </div>
      )}
    </motion.section>
  );
}

/* ================= c) 播放与下载设置 ================= */

interface PlaybackForm {
  autoCacheOnPlay: boolean;
  autoSwitchInvalidSources: boolean;
  downloadFilenameTemplate: string;
  webPageSize: string;
  embedDownload: boolean;
  downloadToLocal: boolean;
  downloadDir: string;
  downloadConcurrency: string;
  webdavEnabled: boolean;
  webdavUrl: string;
  webdavUsername: string;
  webdavPassword: string;
  webdavDir: string;
}
const truthy = (v: unknown) => v === true || v === "true" || v === "1";

function PlaybackSection() {
  const [form, setForm] = useState<PlaybackForm | null>(null);
  const [error, setError] = useState("");
  const [partial, setPartial] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    apiSettings()
      .then((st) => {
        if (!alive) return;
        if (st && typeof st === "object" && typeof (st as { error?: string }).error === "string") {
          setError((st as { error: string }).error);
          return;
        }
        setForm({
          autoCacheOnPlay: truthy(st.autoCacheOnPlay),
          autoSwitchInvalidSources: truthy(st.autoSwitchInvalidSources),
          downloadFilenameTemplate: typeof st.downloadFilenameTemplate === "string" ? st.downloadFilenameTemplate : "",
          webPageSize: st.webPageSize != null ? String(st.webPageSize) : "",
          embedDownload: truthy(st.embedDownload),
          downloadToLocal: truthy(st.downloadToLocal),
          downloadDir: typeof st.downloadDir === "string" ? st.downloadDir : "",
          downloadConcurrency: st.downloadConcurrency != null ? String(st.downloadConcurrency) : "",
          webdavEnabled: truthy(st.webdavEnabled),
          webdavUrl: typeof st.webdavUrl === "string" ? st.webdavUrl : "",
          webdavUsername: typeof st.webdavUsername === "string" ? st.webdavUsername : "",
          webdavPassword: "",
          webdavDir: typeof st.webdavDir === "string" ? st.webdavDir : "",
        });
        // 会话过期时服务端只返回播放器子集（partial）——显式提示，防止把缺失字段当成"设置丢失"
        if (truthy((st as { partial?: unknown }).partial)) {
          setPartial(true);
        }
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "读取设置失败");
      });
    return () => {
      alive = false;
    };
  }, []);

  const buildBody = (f: PlaybackForm): Record<string, unknown> => {
    const body: Record<string, unknown> = {
      autoCacheOnPlay: f.autoCacheOnPlay,
      autoSwitchInvalidSources: f.autoSwitchInvalidSources,
      downloadFilenameTemplate: f.downloadFilenameTemplate.trim(),
      webPageSize: Math.max(10, Math.min(200, Number(f.webPageSize) || 30)),
      embedDownload: f.embedDownload,
      downloadToLocal: f.downloadToLocal,
      downloadDir: f.downloadDir.trim(),
      downloadConcurrency: Math.max(1, Math.min(5, Number(f.downloadConcurrency) || 3)),
      webdavEnabled: f.webdavEnabled,
      webdavUrl: f.webdavUrl.trim(),
      webdavUsername: f.webdavUsername.trim(),
      webdavDir: f.webdavDir.trim(),
    };
    if (f.webdavPassword) body.webdavPassword = f.webdavPassword;
    return body;
  };

  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      const r = await apiSaveSettings(buildBody(form));
      if (r && typeof r === "object" && typeof (r as { error?: string }).error === "string") {
        throw new Error((r as { error: string }).error);
      }
      // 播放相关设置（自动换源开关等）立即生效，无需刷新页面
      refreshPlayerSettings();
      toast.success("设置已保存");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  /**
   * 开关即点即存（后台静默保存）：勾选状态立即落库，离开页面不再丢失；
   * 成功不打扰（开关本身就是视觉反馈），失败才提示可改用底部按钮重试。
   */
  const toggleAndSave =
    (key: "autoCacheOnPlay" | "autoSwitchInvalidSources" | "embedDownload" | "downloadToLocal" | "webdavEnabled") =>
    (v: boolean) => {
      if (!form) return;
      const next = { ...form, [key]: v };
      setForm(next);
      apiSaveSettings(buildBody(next))
        .then(() => refreshPlayerSettings())
        .catch((e) => {
          toast.error(e instanceof Error ? `自动保存失败：${e.message}` : "自动保存失败");
        });
    };

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.1 }}
      className="glass rounded-3xl border border-white/[0.1] p-5"
      aria-label="播放与下载设置"
    >
      <h2 className="flex items-center gap-2 text-[15px] font-bold text-zinc-100">
        <SlidersHorizontal className="h-4 w-4 text-cyan-300" aria-hidden="true" /> 播放与下载
      </h2>

      {error ? (
        <p className="mt-3 flex items-center gap-2 text-[13px] text-red-300/90">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> {error}
        </p>
      ) : form === null ? (
        <div className="mt-4 flex flex-col gap-2" role="status" aria-label="加载中">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[52px] animate-pulse rounded-2xl bg-white/[0.035]" />
          ))}
        </div>
      ) : (
        <>
          {partial && (
            <p className="mt-3 flex items-center gap-2 rounded-2xl border border-amber-400/20 bg-amber-400/[0.07] px-4 py-2.5 text-[13px] text-amber-300/90">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              登录状态已过期：当前仅显示播放相关设置，服务器下载 / WebDAV 等以重新登录后为准
            </p>
          )}
          <div className="mt-4 flex flex-col gap-2">
            <Toggle
              checked={form.autoCacheOnPlay}
              onChange={toggleAndSave("autoCacheOnPlay")}
              label="播放时自动缓存到本地"
              hint="试听的同时把音频下载到本地音乐目录"
            />
            <Toggle
              checked={form.autoSwitchInvalidSources}
              onChange={toggleAndSave("autoSwitchInvalidSources")}
              label="音源失效时自动换源"
              hint="播放失败时自动尝试其他音源的同一首歌"
            />
            <Toggle
              checked={form.embedDownload}
              onChange={toggleAndSave("embedDownload")}
              label="下载时嵌入元数据"
              hint="把歌名 / 歌手 / 专辑 / 封面 / 歌词写入音频文件（自动使用系统或内置 ffmpeg）"
            />
            <Toggle
              checked={form.downloadToLocal}
              onChange={toggleAndSave("downloadToLocal")}
              label="下载时同时保存到服务器"
              hint="浏览器下载的同时，把文件落盘到服务器下载目录（去重）"
            />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_150px]">
            <div>
              <label htmlFor="setting-filename" className="mb-1.5 block text-xs font-medium text-zinc-400">
                下载文件名模板
              </label>
              <input
                id="setting-filename"
                value={form.downloadFilenameTemplate}
                onChange={(e) => setForm({ ...form, downloadFilenameTemplate: e.target.value })}
                placeholder="{name} - {artist}.{ext}"
                spellCheck={false}
                className="h-11 w-full rounded-xl input-shell px-3.5 font-mono text-[12.5px] text-zinc-200"
              />
              <p className="mt-1.5 text-[11px] text-zinc-500">可用变量：{"{name} {artist} {album} {source} {id} {ext}"}</p>
            </div>
            <div>
              <label htmlFor="setting-pagesize" className="mb-1.5 block text-xs font-medium text-zinc-400">
                每页条数
              </label>
              <input
                id="setting-pagesize"
                type="number"
                min={10}
                max={200}
                value={form.webPageSize}
                onChange={(e) => setForm({ ...form, webPageSize: e.target.value })}
                placeholder="30"
                className="h-11 w-full rounded-xl input-shell px-3.5 text-sm tabular-nums text-zinc-200"
              />
              <p className="mt-1.5 text-[11px] text-zinc-500">10 – 200</p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_150px]">
            <div>
              <label htmlFor="setting-dl-dir" className="mb-1.5 block text-xs font-medium text-zinc-400">
                服务器下载目录
              </label>
              <input
                id="setting-dl-dir"
                value={form.downloadDir}
                onChange={(e) => setForm({ ...form, downloadDir: e.target.value })}
                placeholder="data/downloads"
                spellCheck={false}
                className="h-11 w-full rounded-xl input-shell px-3.5 font-mono text-[12.5px] text-zinc-200"
              />
              <p className="mt-1.5 text-[11px] text-zinc-500">留空使用默认 data/downloads</p>
            </div>
            <div>
              <label htmlFor="setting-dl-conc" className="mb-1.5 block text-xs font-medium text-zinc-400">
                下载并发数
              </label>
              <input
                id="setting-dl-conc"
                type="number"
                min={1}
                max={5}
                value={form.downloadConcurrency}
                onChange={(e) => setForm({ ...form, downloadConcurrency: e.target.value })}
                placeholder="3"
                className="h-11 w-full rounded-xl input-shell px-3.5 text-sm tabular-nums text-zinc-200"
              />
              <p className="mt-1.5 text-[11px] text-zinc-500">1 – 5（对齐服务端上限）</p>
            </div>
          </div>

          {/* ---------- WebDAV 同步 ---------- */}
          <div className="mt-5 border-t border-white/[0.07] pt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-[13.5px] font-bold text-zinc-200">
                  <CloudUpload className="h-4 w-4 text-violet-300" aria-hidden="true" /> WebDAV 同步
                </h3>
                <p className="mt-0.5 text-[11.5px] text-zinc-500">下载完成后自动把文件上传到 WebDAV 网盘</p>
              </div>
              <Toggle
                checked={form.webdavEnabled}
                onChange={toggleAndSave("webdavEnabled")}
                label="启用 WebDAV"
              />
            </div>
            {form.webdavEnabled && (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor="setting-webdav-url" className="mb-1.5 block text-xs font-medium text-zinc-400">
                    服务地址
                  </label>
                  <input
                    id="setting-webdav-url"
                    value={form.webdavUrl}
                    onChange={(e) => setForm({ ...form, webdavUrl: e.target.value })}
                    placeholder="https://dav.example.com/dav"
                    spellCheck={false}
                    className="h-11 w-full rounded-xl input-shell px-3.5 text-sm text-zinc-200"
                  />
                </div>
                <div>
                  <label htmlFor="setting-webdav-user" className="mb-1.5 block text-xs font-medium text-zinc-400">
                    用户名
                  </label>
                  <input
                    id="setting-webdav-user"
                    value={form.webdavUsername}
                    onChange={(e) => setForm({ ...form, webdavUsername: e.target.value })}
                    autoComplete="off"
                    className="h-11 w-full rounded-xl input-shell px-3.5 text-sm text-zinc-200"
                  />
                </div>
                <div>
                  <label htmlFor="setting-webdav-pass" className="mb-1.5 block text-xs font-medium text-zinc-400">
                    密码（留空不修改）
                  </label>
                  <input
                    id="setting-webdav-pass"
                    type="password"
                    value={form.webdavPassword}
                    onChange={(e) => setForm({ ...form, webdavPassword: e.target.value })}
                    autoComplete="new-password"
                    className="h-11 w-full rounded-xl input-shell px-3.5 text-sm text-zinc-200"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="setting-webdav-dir" className="mb-1.5 block text-xs font-medium text-zinc-400">
                    远端子目录
                  </label>
                  <input
                    id="setting-webdav-dir"
                    value={form.webdavDir}
                    onChange={(e) => setForm({ ...form, webdavDir: e.target.value })}
                    placeholder="music-dl"
                    spellCheck={false}
                    className="h-11 w-full rounded-xl input-shell px-3.5 text-sm text-zinc-200"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 flex justify-end">
            <button
              onClick={save}
              disabled={busy}
              className="flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-6 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/25 transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              保存设置
            </button>
          </div>
        </>
      )}
    </motion.section>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-[56px] w-full items-center justify-between gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 py-2.5 text-left transition-colors hover:bg-white/[0.035] active:scale-[0.99]"
    >
      <span className="flex min-w-0 flex-col">
        <span className="text-[13px] font-medium text-zinc-200">{label}</span>
        {hint && <span className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">{hint}</span>}
      </span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${checked ? "bg-gradient-to-r from-violet-500 to-fuchsia-500" : "bg-zinc-700"}`}>
        <motion.span
          layout
          transition={{ type: "spring", stiffness: 500, damping: 32 }}
          className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow ${checked ? "left-[23px]" : "left-[3px]"}`}
        />
      </span>
    </button>
  );
}
