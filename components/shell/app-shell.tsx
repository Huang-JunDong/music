"use client";

/**
 * 应用外壳：PC 侧边栏 / 移动底部 Tab + 全局播放条 + 鉴权分流
 * 设计原则：触控目标 ≥44px、8px 间距节奏、暗色对比 ≥4.5:1、layoutId 滑动指示器
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
  Search, Compass, ListMusic, HardDrive, Settings, Music4, History, Clapperboard, LogIn, LogOut, Menu, X, Terminal,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { usePlayer, bindAudioEvents, bindSpaceToggle } from "@/lib/client/store";
import { PlayerBar } from "@/components/player/player-bar";
import { FloatingToolbar } from "@/components/floating-toolbar";
import { apiAuthStatus, apiLogout } from "@/lib/client/api";
import { toast } from "sonner";

const NAV = [
  { href: "/", label: "搜索", icon: Search, match: (p: string) => p === "/" || p.startsWith("/playlist") || p.startsWith("/album") },
  { href: "/explore", label: "歌单广场", icon: Compass, match: (p: string) => p.startsWith("/explore") },
  { href: "/collections", label: "我的歌单", icon: ListMusic, match: (p: string) => p.startsWith("/collections") || p.startsWith("/collection") },
  { href: "/local", label: "本地音乐", icon: HardDrive, match: (p: string) => p.startsWith("/local") },
  { href: "/downloads", label: "下载记录", icon: History, match: (p: string) => p.startsWith("/downloads") },
  { href: "/render", label: "视频渲染", icon: Clapperboard, match: (p: string) => p.startsWith("/render") },
  { href: "/netease", label: "API 控制台", icon: Terminal, match: (p: string) => p.startsWith("/netease") },
  { href: "/settings", label: "设置", icon: Settings, match: (p: string) => p.startsWith("/settings") },
];

/** 移动底部 Tab 仅渲染前 4 项 + 「更多」面板承载其余（≤5 项导航准则，触控目标更宽裕） */
const PRIMARY_NAV = NAV.slice(0, 4);
const SECONDARY_NAV = NAV.slice(4);

function BrandMark() {
  return (
    <Link href="/" className="group flex items-center gap-3 px-2 py-1" aria-label="Music DL 首页">
      <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-cyan-400 shadow-lg shadow-fuchsia-500/25 transition-transform duration-300 group-hover:scale-105">
        <Music4 className="h-5 w-5 text-white" strokeWidth={2.2} aria-hidden="true" />
        <span className="absolute inset-0 rounded-xl ring-1 ring-white/20" />
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-[15px] font-bold tracking-wide text-zinc-50">Music DL</span>
        <span className="text-[11px] text-zinc-500">全网音乐聚合</span>
      </span>
    </Link>
  );
}

function NavItems({ vertical }: { vertical: boolean }) {
  const pathname = usePathname() ?? "/";
  const items = vertical ? NAV : PRIMARY_NAV;
  return (
    <nav className={vertical ? "flex flex-col gap-1" : "flex h-full items-stretch"} aria-label={vertical ? "主导航" : "底部导航"}>
      {items.map((item) => {
        const active = item.match(pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={
              vertical
                ? `relative flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors duration-200 ${
                    active ? "text-white" : "text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.04]"
                  }`
                : `relative flex min-w-[48px] flex-1 flex-col items-center justify-center gap-1 text-[9.5px] font-medium transition-colors duration-200 ${
                    active ? "text-fuchsia-300" : "text-zinc-500 hover:text-zinc-200"
                  }`
            }
          >
            {active && (
              <motion.span
                layoutId={vertical ? "nav-pill" : "tab-indicator"}
                className={
                  vertical
                    ? "absolute inset-0 rounded-xl bg-gradient-to-r from-violet-500/20 to-fuchsia-500/15 ring-1 ring-violet-400/25"
                    : "absolute top-0 h-[2.5px] w-7 rounded-full bg-gradient-to-r from-violet-400 to-fuchsia-400"
                }
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <Icon className={vertical ? "h-[18px] w-[18px]" : "h-[21px] w-[21px]"} strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
            <span className={vertical ? "" : "sr-only sm:not-sr-only"}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const hasCurrent = usePlayer((s) => s.index >= 0);
  const router = useRouter();
  const [auth, setAuth] = useState<{ loggedIn: boolean; disabled: boolean; username: string }>({
    loggedIn: false,
    disabled: true,
    username: "",
  });

  useEffect(() => {
    bindAudioEvents();
    bindSpaceToggle();
  }, []);

  /* ?open_config=1 → 自动打开设置页（对齐 Go 打开配置抽屉） */
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("open_config") === "1") {
      const url = new URL(window.location.href);
      url.searchParams.delete("open_config");
      window.history.replaceState(null, "", url.toString());
      router.push("/settings");
    }
  }, [router]);

  /* 鉴权状态 + 401 全局分流 */
  useEffect(() => {
    const refresh = () => {
      apiAuthStatus()
        .then((st) => setAuth({ loggedIn: st.logged_in, disabled: !!st.auth_disabled, username: st.username ?? "" }))
        .catch(() => setAuth((a) => a));
    };
    refresh();
    const onAuthRequired = () => {
      setAuth((a) => ({ ...a, loggedIn: false }));
      router.push("/login");
    };
    window.addEventListener("musicdl:auth-required", onAuthRequired);
    return () => window.removeEventListener("musicdl:auth-required", onAuthRequired);
  }, [router]);

  const doLogout = useCallback(async () => {
    try {
      await apiLogout();
      toast.success("已退出登录");
      setAuth((a) => ({ ...a, loggedIn: false, username: "" }));
    } catch {
      toast.error("退出失败");
    }
  }, []);

  return (
    <div className="relative z-10 flex min-h-dvh">
      {/* ---------- PC 侧边栏 ---------- */}
      <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col gap-6 border-r border-white/[0.07] bg-zinc-950/60 px-4 py-6 backdrop-blur-xl lg:flex">
        <BrandMark />
        <NavItems vertical />
        {!auth.disabled && (
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3">
            {auth.loggedIn ? (
              <>
                <p className="mb-2 truncate text-[12px] text-zinc-400">
                  已登录：<span className="font-semibold text-zinc-200">{auth.username}</span>
                </p>
                <button
                  onClick={doLogout}
                  className="flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-xl border border-white/[0.1] text-[12.5px] text-zinc-400 transition-colors hover:border-red-400/40 hover:text-red-300"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" /> 退出登录
                </button>
              </>
            ) : (
              <Link
                href="/login"
                className="flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-[12.5px] font-semibold text-white"
              >
                <LogIn className="h-3.5 w-3.5" aria-hidden="true" /> 登录
              </Link>
            )}
          </div>
        )}
      </aside>

      {/* ---------- 主内容 ---------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 移动顶部品牌栏 */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-white/[0.07] bg-zinc-950/80 px-4 py-2.5 backdrop-blur-xl lg:hidden">
          <BrandMark />
          {!auth.disabled && !auth.loggedIn && (
            <Link
              href="/login"
              className="flex min-h-[40px] items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-3 text-[12.5px] font-semibold text-white"
            >
              <LogIn className="h-3.5 w-3.5" aria-hidden="true" /> 登录
            </Link>
          )}
        </header>

        <main className={`min-w-0 flex-1 ${hasCurrent ? "pb-[156px] lg:pb-[104px]" : "pb-[76px] lg:pb-8"} lg:pl-2`}>
          {children}
        </main>

        {/* 全局播放条 */}
        <PlayerBar />
      </div>

      {/* 悬浮快捷工具栏（回顶部/回底部） */}
      <FloatingToolbar />

      {/* ---------- 移动底部 Tab ---------- */}
      <MobileTabBar />
    </div>
  );
}

function MobileTabBar() {
  const pathname = usePathname() ?? "/";
  const reduced = useReducedMotion();
  const [moreOpen, setMoreOpen] = useState(false);
  const anyActive = NAV.some((n) => n.match(pathname));
  const secondaryActive = SECONDARY_NAV.some((n) => n.match(pathname));

  /* 路由变化时自动收起「更多」面板 */
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  /* Esc 关闭 + 打开时锁定背景滚动 */
  useEffect(() => {
    if (!moreOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [moreOpen]);

  return (
    <>
      <AnimatePresence>
        {anyActive && (
          <motion.nav
            initial={reduced ? false : { y: 90 }}
            animate={{ y: 0 }}
            exit={{ y: 90 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="glass safe-bottom fixed inset-x-0 bottom-0 z-40 flex h-[62px] items-stretch border-t border-white/[0.1] lg:hidden"
            aria-label="底部导航"
          >
            <NavItems vertical={false} />
            {/* 「更多」入口：承载下载记录 / 视频渲染 / 设置 */}
            <button
              onClick={() => setMoreOpen(true)}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              aria-current={secondaryActive ? "page" : undefined}
              className={`relative flex min-w-[48px] flex-1 flex-col items-center justify-center gap-1 text-[9.5px] font-medium transition-colors duration-200 ${
                secondaryActive ? "text-fuchsia-300" : "text-zinc-500 hover:text-zinc-200"
              }`}
            >
              {secondaryActive && (
                <motion.span
                  layoutId="tab-indicator"
                  className="absolute top-0 h-[2.5px] w-7 rounded-full bg-gradient-to-r from-violet-400 to-fuchsia-400"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              <Menu className="h-[21px] w-[21px]" strokeWidth={secondaryActive ? 2.2 : 1.8} aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">更多</span>
            </button>
          </motion.nav>
        )}
      </AnimatePresence>

      {/* 「更多」底部面板 */}
      <AnimatePresence>
        {moreOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
              onClick={() => setMoreOpen(false)}
              aria-hidden="true"
            />
            <motion.div
              initial={reduced ? false : { y: 240 }}
              animate={{ y: 0 }}
              exit={{ y: 240 }}
              transition={{ type: "spring", stiffness: 380, damping: 36 }}
              className="glass safe-bottom fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border-t border-white/[0.1] p-4 pb-5"
              role="menu"
              aria-label="更多页面"
            >
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[13px] font-bold text-zinc-100">更多</p>
                <button
                  onClick={() => setMoreOpen(false)}
                  aria-label="关闭"
                  className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="flex flex-col gap-1">
                {SECONDARY_NAV.map((item) => {
                  const Icon = item.icon;
                  const active = item.match(pathname);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      role="menuitem"
                      className={`flex min-h-[52px] items-center gap-3 rounded-2xl px-4 text-sm font-medium transition-colors ${
                        active ? "bg-gradient-to-r from-violet-500/20 to-fuchsia-500/10 text-white ring-1 ring-violet-400/25" : "text-zinc-300 hover:bg-white/[0.05]"
                      }`}
                    >
                      <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
