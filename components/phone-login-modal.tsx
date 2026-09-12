"use client";

/**
 * 手机号登录弹窗：验证码（网易/QQ）/ 密码（网易）双模式
 * 60s 验证码倒计时；成功后回调刷新账号状态
 */
import { useEffect, useRef, useState } from "react";
import { Smartphone, Loader2, KeyRound, MessageSquareCode } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/modal";
import { apiPhoneLoginSendCode, apiPhoneLogin } from "@/lib/client/api";
import { sourceMeta } from "@/lib/play-url";

export function PhoneLoginModal({
  source,
  onClose,
  onSuccess,
}: {
  source: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const supportPassword = source === "netease";
  const [mode, setMode] = useState<"code" | "password">("code");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startCountdown = () => {
    setCountdown(60);
    timerRef.current = setInterval(() => {
      setCountdown((v) => {
        if (v <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return v - 1;
      });
    }, 1000);
  };

  const onSendCode = async () => {
    if (sending || countdown > 0) return;
    const p = phone.replace(/\s|-/g, "");
    if (!/^\d{5,15}$/.test(p)) {
      toast.error("请先输入正确的手机号");
      return;
    }
    setSending(true);
    try {
      await apiPhoneLoginSendCode(source, p);
      toast.success("验证码已发送");
      startCountdown();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "发送失败");
    } finally {
      setSending(false);
    }
  };

  const onSubmit = async () => {
    if (submitting) return;
    const p = phone.replace(/\s|-/g, "");
    if (!/^\d{5,15}$/.test(p)) {
      toast.error("手机号格式不正确");
      return;
    }
    if (mode === "code" && !code.trim()) {
      toast.error("请输入验证码");
      return;
    }
    if (mode === "password" && !password) {
      toast.error("请输入密码");
      return;
    }
    setSubmitting(true);
    try {
      await apiPhoneLogin(source, p, mode, mode === "code" ? code.trim() : password);
      toast.success(`${sourceMeta(source).label}登录成功`);
      onSuccess();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open onClose={onClose} maxWidth={400} title={`手机号登录${sourceMeta(source).label}`}>
      <div className="mb-3 flex gap-1.5" role="tablist" aria-label="登录方式">
        {[
          { key: "code" as const, label: "验证码登录", icon: MessageSquareCode },
          ...(supportPassword ? [{ key: "password" as const, label: "密码登录", icon: KeyRound }] : []),
        ].map((m) => {
          const Icon = m.icon;
          const active = mode === m.key;
          return (
            <button
              key={m.key}
              role="tab"
              aria-selected={active}
              onClick={() => setMode(m.key)}
              className={`flex min-h-[36px] flex-1 items-center justify-center gap-1.5 rounded-xl border text-[12.5px] font-medium transition-all active:scale-95 ${
                active
                  ? "border-violet-400/40 bg-violet-500/20 text-violet-100 ring-1 ring-violet-400/30"
                  : "border-white/[0.1] bg-white/[0.02] text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {m.label}
            </button>
          );
        })}
      </div>

      <div className="space-y-2.5">
        <label className="sr-only" htmlFor="phone-login-phone">
          手机号
        </label>
        <div className="input-shell flex items-center gap-2 rounded-xl px-3">
          <Smartphone className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" />
          <input
            id="phone-login-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value.slice(0, 18))}
            inputMode="tel"
            autoComplete="tel"
            placeholder="手机号"
            className="min-h-[46px] w-full bg-transparent text-[13.5px] text-zinc-100 focus:outline-none"
          />
        </div>

        {mode === "code" ? (
          <div>
            <label className="sr-only" htmlFor="phone-login-code">
              验证码
            </label>
            <div className="flex gap-2">
              <div className="input-shell flex min-w-0 flex-1 items-center rounded-xl px-3">
                <input
                  id="phone-login-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="验证码"
                  className="min-h-[46px] w-full bg-transparent text-[13.5px] tracking-widest text-zinc-100 focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => void onSendCode()}
                disabled={sending || countdown > 0}
                className="flex h-[46px] shrink-0 items-center rounded-xl border border-violet-400/30 bg-violet-500/15 px-3.5 text-[12.5px] font-medium text-violet-200 transition-colors hover:bg-violet-500/25 active:scale-95 disabled:opacity-50"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                {countdown > 0 ? `${countdown}s` : "发送验证码"}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <label className="sr-only" htmlFor="phone-login-password">
              密码
            </label>
            <div className="input-shell flex items-center rounded-xl px-3">
              <input
                id="phone-login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="账号密码"
                className="min-h-[46px] w-full bg-transparent text-[13.5px] text-zinc-100 focus:outline-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void onSubmit();
                }}
              />
            </div>
          </div>
        )}

        <button
          onClick={() => void onSubmit()}
          disabled={submitting}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/25 transition-all hover:brightness-110 active:scale-95 disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {submitting ? "登录中…" : "登录"}
        </button>
        <p className="text-center text-[11px] leading-relaxed text-zinc-600">
          凭证仅保存在你的浏览器；扫码登录同样可用
        </p>
      </div>
    </Modal>
  );
}
