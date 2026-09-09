"use client";

/**
 * 登录 / 管理员初始化（对齐 Go auth.html：setup token + 登录）
 * 已登录或鉴权关闭时自动跳回首页。
 */
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { motion } from "motion/react";
import { Music4, Loader2, LogIn, ShieldCheck, KeyRound, UserRound, LockKeyhole, Eye, EyeOff, LifeBuoy } from "lucide-react";
import { toast } from "sonner";
import { apiAuthStatus, apiLogin, apiSetup, apiPasswordForgot, apiPasswordReset } from "@/lib/client/api";

function LoginPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

  const [mode, setMode] = useState<"loading" | "login" | "setup" | "forgot">("loading");
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [token, setToken] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  /** 忘记密码：第一步申请令牌，第二步凭令牌重置 */
  const [forgotStep, setForgotStep] = useState<1 | 2>(1);
  const [newPassword, setNewPassword] = useState("");
  const [newConfirm, setNewConfirm] = useState("");

  useEffect(() => {
    apiAuthStatus()
      .then((st) => {
        if (st.auth_disabled) {
          router.replace(next);
          return;
        }
        if (st.logged_in) {
          router.replace(next);
          return;
        }
        setMode(st.setup_required ? "setup" : "login");
      })
      .catch(() => setMode("login"));
  }, [router, next]);

  const doLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      toast.error("请输入用户名和密码");
      return;
    }
    setBusy(true);
    try {
      await apiLogin(username.trim(), password);
      toast.success("登录成功");
      // 通知应用外壳（侧边栏/抽屉登录卡片）立即刷新登录态，无需手动刷新页面
      window.dispatchEvent(new Event("musicdl:auth-changed"));
      router.replace(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "登录失败");
    } finally {
      setBusy(false);
    }
  };

  const doSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) {
      toast.error("请输入服务端启动日志中的 setup token");
      return;
    }
    if (!username.trim()) {
      toast.error("请设置用户名");
      return;
    }
    if (password.length < 6) {
      toast.error("密码至少 6 位");
      return;
    }
    if (password !== confirm) {
      toast.error("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    try {
      await apiSetup({ setup_token: token.trim(), username: username.trim(), password, confirm_password: confirm });
      toast.success("初始化成功，请登录");
      setMode("login");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "初始化失败");
    } finally {
      setBusy(false);
    }
  };

  /* 忘记密码：第一步申请（令牌打印服务端 stdout），第二步凭令牌重置 */
  const doForgotRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      toast.error("请输入管理员用户名");
      return;
    }
    setBusy(true);
    try {
      const r = await apiPasswordForgot(username.trim());
      toast.success(r.hint ?? "重置令牌已打印在服务端日志中");
      setForgotStep(2);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "申请失败");
    } finally {
      setBusy(false);
    }
  };

  const doForgotReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) {
      toast.error("请输入服务端日志中的重置令牌");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("新密码至少 6 位");
      return;
    }
    if (newPassword !== newConfirm) {
      toast.error("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    try {
      await apiPasswordReset({
        username: username.trim(),
        reset_token: token.trim(),
        new_password: newPassword,
        confirm_password: newConfirm,
      });
      toast.success("密码已重置，请使用新密码登录");
      setMode("login");
      setPassword("");
      setToken("");
      setNewPassword("");
      setNewConfirm("");
      setForgotStep(1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "重置失败");
    } finally {
      setBusy(false);
    }
  };

  if (mode === "loading") {
    return (
      <div className="flex min-h-[70dvh] items-center justify-center" role="status" aria-label="检查登录状态">
        <Loader2 className="h-6 w-6 animate-spin text-fuchsia-300" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[76dvh] w-full max-w-[420px] flex-col justify-center px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="mb-6 flex flex-col items-center gap-3 text-center"
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-cyan-400 shadow-xl shadow-fuchsia-500/25">
          <Music4 className="h-6 w-6 text-white" aria-hidden="true" />
        </span>
        <h1 className="text-2xl font-extrabold tracking-tight text-zinc-50">
          {mode === "setup" ? "初始化管理员" : mode === "forgot" ? "找回密码" : "欢迎回来"}
        </h1>
        <p className="max-w-[300px] text-[13px] leading-relaxed text-zinc-500">
          {mode === "setup"
            ? "首次使用需初始化管理员账号；setup token 已打印在服务端启动日志（stdout）中"
            : mode === "forgot"
              ? "重置令牌将打印在服务端运行日志（stdout）中，15 分钟内有效"
              : "登录后可管理 Cookie、下载目录与 WebDAV 等配置"}
        </p>
      </motion.div>

      {mode === "forgot" ? (
        /* ---------- 忘记密码（审核补充：找回密码流程） ---------- */
        <motion.form
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.08 }}
          onSubmit={forgotStep === 1 ? doForgotRequest : doForgotReset}
          className="glass flex flex-col gap-3 rounded-3xl border border-white/[0.1] p-5 shadow-2xl shadow-black/40"
          aria-label={forgotStep === 1 ? "申请密码重置" : "重置密码"}
        >
          <label className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-400">
              <UserRound className="h-3.5 w-3.5" aria-hidden="true" /> 用户名
            </span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="管理员用户名"
              autoComplete="username"
              required
              disabled={forgotStep === 2}
              className="min-h-[46px] rounded-xl input-shell px-3 text-sm text-zinc-100 disabled:opacity-60"
            />
          </label>

          {forgotStep === 2 && (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-400">
                  <LifeBuoy className="h-3.5 w-3.5" aria-hidden="true" /> 重置令牌
                </span>
                <input
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="粘贴服务端控制台打印的重置令牌"
                  autoComplete="off"
                  required
                  className="min-h-[46px] rounded-xl input-shell px-3 font-mono text-[13px] text-zinc-100"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-400">
                  <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" /> 新密码 <span className="text-zinc-500">（至少 6 位）</span>
                </span>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="设置新密码"
                  autoComplete="new-password"
                  required
                  minLength={6}
                  className="min-h-[46px] rounded-xl input-shell px-3 text-sm text-zinc-100"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-400">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> 确认新密码
                </span>
                <input
                  type="password"
                  value={newConfirm}
                  onChange={(e) => setNewConfirm(e.target.value)}
                  placeholder="再输入一次新密码"
                  autoComplete="new-password"
                  required
                  className="min-h-[46px] rounded-xl input-shell px-3 text-sm text-zinc-100"
                />
              </label>
            </>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-1 flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/25 transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            {forgotStep === 1 ? "申请重置令牌" : "重置密码"}
          </button>

          <button
            type="button"
            onClick={() => {
              setMode("login");
              setForgotStep(1);
            }}
            className="min-h-[40px] text-xs text-zinc-500 transition-colors hover:text-zinc-300"
          >
            返回登录
          </button>
        </motion.form>
      ) : (
      <motion.form
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.08 }}
        onSubmit={mode === "setup" ? doSetup : doLogin}
        className="glass flex flex-col gap-3 rounded-3xl border border-white/[0.1] p-5 shadow-2xl shadow-black/40"
        aria-label={mode === "setup" ? "初始化管理员" : "登录"}
      >
        {mode === "setup" && (
          <label className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-400">
              <KeyRound className="h-3.5 w-3.5" aria-hidden="true" /> Setup Token
            </span>
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="粘贴服务端控制台打印的 token"
              autoComplete="off"
              required
              className="min-h-[46px] rounded-xl input-shell px-3 font-mono text-[13px] text-zinc-100"
            />
          </label>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-400">
            <UserRound className="h-3.5 w-3.5" aria-hidden="true" /> 用户名
          </span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="管理员用户名"
            autoComplete="username"
            required
            className="min-h-[46px] rounded-xl input-shell px-3 text-sm text-zinc-100"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-400">
            <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" /> 密码
            {mode === "setup" && <span className="text-zinc-500">（至少 6 位）</span>}
          </span>
          <span className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "setup" ? "设置密码" : "密码"}
              autoComplete={mode === "setup" ? "new-password" : "current-password"}
              required
              minLength={mode === "setup" ? 6 : undefined}
              className="min-h-[46px] w-full rounded-xl input-shell px-3 pr-12 text-sm text-zinc-100"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "隐藏密码" : "显示密码"}
              aria-pressed={showPassword}
              className="absolute right-1 top-1/2 flex h-[38px] w-[38px] -translate-y-1/2 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:text-zinc-200"
            >
              {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
            </button>
          </span>
        </label>

        {mode === "setup" && (
          <label className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-400">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> 确认密码
            </span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="再输入一次密码"
              autoComplete="new-password"
              required
              className="min-h-[46px] rounded-xl input-shell px-3 text-sm text-zinc-100"
            />
          </label>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-1 flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/25 transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "setup" ? <ShieldCheck className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
          {mode === "setup" ? "初始化并登录" : "登录"}
        </button>

        {mode === "login" && (
          <button
            type="button"
            onClick={() => {
              setForgotStep(1);
              setToken("");
              setNewPassword("");
              setNewConfirm("");
              setMode("forgot");
            }}
            className="min-h-[40px] text-xs text-zinc-500 transition-colors hover:text-zinc-300"
          >
            忘记密码？
          </button>
        )}
      </motion.form>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[70dvh] items-center justify-center" role="status" aria-label="加载中">
          <Loader2 className="h-6 w-6 animate-spin text-fuchsia-300" />
        </div>
      }
    >
      <LoginPageInner />
    </Suspense>
  );
}
