"use client";

/**
 * 我的音源账号 — 每个访客扫码登录"自己的"网易云/QQ/微信通道/酷狗账号：
 * 状态展示（已登录/未登录）、扫码登录（Modal 二维码 + 3s 轮询）、一键退出。
 * 凭证仅存当前浏览器（HttpOnly music_dl_src_*），与服务器全局配置互不影响；
 * 登录/退出后通过 onChanged 通知宿主页面刷新数据。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { QrCode, LogOut, Loader2, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/modal";
import { QrImage } from "@/components/qr-image";
import { PhoneLoginModal } from "@/components/phone-login-modal";
import {
  apiCreateQRLogin,
  apiCheckQRLogin,
  apiQRLoginStatus,
  apiQRLogout,
} from "@/lib/client/api";
import { sourceMeta } from "@/lib/play-url";
import type { QRLoginSession } from "@/lib/types";

/** 可扫码登录"自己账号"的源（与设置页 LOGIN_SOURCES 对齐；qq_wx=微信通道） */
const MINE_LOGIN_SOURCES = ["netease", "qq", "qq_wx", "kugou", "bilibili"];
/** 支持手机号登录的源（验证码双源 / 密码仅网易） */
const PHONE_LOGIN_SOURCES = new Set(["netease", "qq"]);

type MineQRState = { source: string; session: QRLoginSession; status: "waiting" | "scanned" | "expired" };

export function MySourceAccounts({ onChanged }: { onChanged?: () => void }) {
  const [statuses, setStatuses] = useState<Record<string, boolean> | null>(null);
  const [qr, setQr] = useState<MineQRState | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [phoneSource, setPhoneSource] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState<string | null>(null);
  const notifiedScanRef = useRef(false);

  const loadStatuses = useCallback(() => {
    Promise.all(
      MINE_LOGIN_SOURCES.map((s) => apiQRLoginStatus(s).catch(() => ({ source: s, logged_in: false }))),
    ).then((list) => {
      const map: Record<string, boolean> = {};
      for (const st of list) map[st.source] = !!st.logged_in;
      setStatuses(map);
    });
  }, []);

  useEffect(() => {
    loadStatuses();
  }, [loadStatuses]);

  /* QR 轮询：waiting/scanned 每 3s 查一次；关闭弹窗自动清理（凭证由服务端写入本浏览器） */
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
          toast.success(`${sourceMeta(qr.source).label} 登录成功`);
          setQr(null);
          loadStatuses();
          onChanged?.();
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
  }, [qr, loadStatuses, onChanged]);

  const openQR = async (source: string) => {
    setQrLoading(true);
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

  const logout = async (source: string) => {
    setLoggingOut(source);
    try {
      await apiQRLogout(source);
      toast.success(`已退出${sourceMeta(source).label}账号`);
      loadStatuses();
      onChanged?.();
    } catch {
      toast.error("退出失败");
    } finally {
      setLoggingOut(null);
    }
  };

  const qrUrl = qr ? qr.session.url : "";
  const qrImageUrl = qr ? qr.session.image_url : undefined;
  const loggedInCount = statuses ? MINE_LOGIN_SOURCES.filter((s) => statuses[s]).length : 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="glass rounded-3xl border border-white/[.1] p-5"
      aria-label="我的音源账号"
    >
      <h2 className="flex items-center gap-2 text-[15px] font-bold text-zinc-100">
        <QrCode className="h-4 w-4 text-fuchsia-300" aria-hidden="true" /> 我的音源账号
        {statuses !== null && (
          <span
            role="status"
            className={`ml-auto rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
              loggedInCount > 0
                ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300/90"
                : "border-white/10 bg-white/[.04] text-zinc-400"
            }`}
          >
            {loggedInCount}/{MINE_LOGIN_SOURCES.length} 已登录
          </span>
        )}
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
        扫码登录自己的网易云 / QQ 账号，同步个人收藏歌单与会员内容；凭证仅保存在你的浏览器，与服务器配置互不影响
      </p>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {MINE_LOGIN_SOURCES.map((s) => {
          const loggedIn = !!statuses?.[s];
          return (
            <div
              key={s}
              className="flex min-h-[60px] items-center gap-3 rounded-2xl border border-white/[.07] bg-white/[.02] px-3.5 py-2"
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${loggedIn ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" : "bg-zinc-600"}`}
                aria-hidden="true"
              />
              <span className="shrink-0 text-[13px] font-medium text-zinc-200">{sourceMeta(s).label}</span>
              <span
                role="status"
                aria-live="polite"
                className={`shrink-0 text-[11px] ${loggedIn ? "text-emerald-300/80" : "text-zinc-400"}`}
              >
                {statuses === null ? "检测中…" : loggedIn ? "已登录" : "未登录"}
              </span>
              {loggedIn ? (
                <button
                  onClick={() => void logout(s)}
                  disabled={loggingOut === s}
                  className="ml-auto flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-white/[.1] bg-white/[.04] px-3.5 text-[12px] font-medium text-zinc-300 transition-colors hover:border-red-400/30 hover:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 active:scale-95 disabled:opacity-50"
                >
                  {loggingOut === s ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <LogOut className="h-3.5 w-3.5" aria-hidden="true" />} 退出
                </button>
              ) : (
                <span className="ml-auto flex shrink-0 items-center gap-1.5">
                  {PHONE_LOGIN_SOURCES.has(s) && (
                    <button
                      onClick={() => setPhoneSource(s)}
                      aria-label={`手机号登录${sourceMeta(s).label}`}
                      className="flex h-11 items-center gap-1.5 rounded-xl border border-white/[.1] bg-white/[.04] px-3 text-[12px] font-medium text-zinc-300 transition-colors hover:border-violet-400/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 active:scale-95"
                    >
                      <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
                      手机登录
                    </button>
                  )}
                  <button
                    onClick={() => void openQR(s)}
                    disabled={qrLoading}
                    className="flex h-11 items-center gap-1.5 rounded-xl border border-white/[.1] bg-white/[.04] px-3.5 text-[12px] font-medium text-zinc-300 transition-colors hover:border-violet-400/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 active:scale-95 disabled:opacity-50"
                  >
                    {qrLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <QrCode className="h-3.5 w-3.5" aria-hidden="true" />}
                    扫码登录
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>

      {phoneSource && (
        <PhoneLoginModal
          source={phoneSource}
          onClose={() => setPhoneSource(null)}
          onSuccess={() => {
            loadStatuses();
            onChanged?.();
          }}
        />
      )}

      <Modal open={!!qr} onClose={() => setQr(null)} title={`扫码登录${qr ? sourceMeta(qr.source).label : ""}`}>
        {qr && (
          <div className="flex flex-col items-center gap-3 py-2">
            <div className="relative rounded-2xl border border-white/[.08] bg-white p-3">
              <QrImage
                url={qrUrl}
                imageUrl={qrImageUrl}
                size={220}
                className={qr.status === "expired" ? "opacity-25 grayscale" : qr.status === "scanned" ? "opacity-60" : ""}
              />
              {qr.status === "expired" && (
                <button
                  onClick={() => void openQR(qr.source)}
                  className="absolute inset-0 flex h-full w-full items-center justify-center rounded-2xl text-[13px] font-medium text-zinc-700 transition-colors hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
                >
                  二维码已过期，点击刷新
                </button>
              )}
            </div>
            <p className="text-center text-xs leading-relaxed text-zinc-500">
              {qr.status === "scanned" ? "已扫描，请在手机上确认登录" : `打开${sourceMeta(qr.source).label}App扫码登录你的账号`}
            </p>
          </div>
        )}
      </Modal>
    </motion.section>
  );
}
