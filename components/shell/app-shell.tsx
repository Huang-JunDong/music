"use client";

/**
 * 应用外壳：PC 侧边栏 / 移动顶部栏（音乐符号唤出左侧抽屉菜单） + 全局播放条 + 鉴权分流
 * 设计原则：触控目标 ≥44px、8px 间距节奏、暗色对比 ≥4.5:1、layoutId 滑动指示器
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion, MotionConfig } from "motion/react";
import {
  Search, Compass, ListMusic, HardDrive, Settings, Music4, History, Clapperboard, LogIn, LogOut, X, Terminal, Music2, QrCode, Trophy, MonitorPlay, Radio, Disc3, CalendarCheck, Rewind, Users,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { usePlayer, bindAudioEvents, bindSpaceToggle } from "@/lib/client/store";
import { PlayerBar } from "@/components/player/player-bar";
import { FloatingToolbar } from "@/components/floating-toolbar";
import { apiAuthStatus, apiLogout } from "@/lib/client/api";
import { toast } from "sonner";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  match: (p: string) => boolean;
  /** 分组标题：菜单 >7 项时按职能分组，降低扫描成本（组名渲染为小节标题） */
  group?: string;
}

const NAV: NavItem[] = [
  /* /playlist 主入口是歌单广场的三处网格（推荐/分类/收藏）→ 归「歌单广场」；
     /album 主入口是首页专辑结果与歌曲行专辑链接 → 归「搜索」 */
  { href: "/", label: "搜索", icon: Search, match: (p: string) => p === "/" || p.startsWith("/album") },
  { href: "/explore", label: "歌单广场", icon: Compass, match: (p: string) => p.startsWith("/explore") || p.startsWith("/playlist") },
  { href: "/albums", label: "新碟架", icon: Disc3, match: (p: string) => p.startsWith("/albums") },
  { href: "/charts", label: "排行榜", icon: Trophy, match: (p: string) => p.startsWith("/charts") },
  { href: "/artists", label: "歌手库", icon: Users, match: (p: string) => p.startsWith("/artists") },
  { href: "/mv", label: "MV", icon: MonitorPlay, match: (p: string) => p.startsWith("/mv") },
  { href: "/fm", label: "私人FM", icon: Radio, match: (p: string) => p.startsWith("/fm") },
  { href: "/collections", label: "我的歌单", icon: ListMusic, match: (p: string) => p.startsWith("/collections") || p.startsWith("/collection") },
  { href: "/local", label: "本地音乐", icon: HardDrive, match: (p: string) => p.startsWith("/local") },
  { href: "/downloads", label: "下载记录", icon: History, match: (p: string) => p.startsWith("/downloads") },
  { href: "/checkin", label: "签到中心", icon: CalendarCheck, match: (p: string) => p.startsWith("/checkin") },
  { href: "/history", label: "播放历史", icon: Rewind, match: (p: string) => p.startsWith("/history") },
  { href: "/render", label: "视频渲染", icon: Clapperboard, match: (p: string) => p.startsWith("/render") },
  { href: "/accounts", label: "我的音源账号", icon: QrCode, match: (p: string) => p.startsWith("/accounts"), group: "音源与 API" },
  { href: "/netease", label: "网易 API", icon: Terminal, match: (p: string) => p.startsWith("/netease"), group: "音源与 API" },
  { href: "/qq", label: "QQ API", icon: Music2, match: (p: string) => p.startsWith("/qq"), group: "音源与 API" },
  { href: "/settings", label: "设置", icon: Settings, match: (p: string) => p.startsWith("/settings") },
];

function BrandMark() {
  return (
    <Link href="/" className="group flex items-center gap-3 px-2 py-1" aria-label="Music 首页">
      <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-cyan-400 shadow-lg shadow-fuchsia-500/25 transition-transform duration-300 group-hover:scale-105">
        <Music4 className="h-5 w-5 text-white" strokeWidth={2.2} aria-hidden="true" />
        <span className="absolute inset-0 rounded-xl ring-1 ring-white/20" />
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-[15px] font-bold tracking-wide text-zinc-50">Music</span>
        <span className="text-[11px] text-zinc-500">全网音乐聚合</span>
      </span>
    </Link>
  );
}

/** 导航项列表：PC 侧边栏与移动抽屉共用；pillLayoutId 必须按容器区分，
 *  避免 framer-motion 共享布局把两处激活指示器串成同一元素（指示器错位/消失） */
function NavItems({ pillLayoutId }: { pillLayoutId: string }) {
  const pathname = usePathname() ?? "/";
  return (
    <nav className="flex flex-col gap-1" aria-label="主导航">
      {NAV.map((item, i) => {
        const active = item.match(pathname);
        const Icon = item.icon;
        const showGroup = !!item.group && NAV[i - 1]?.group !== item.group;
        return (
          <Fragment key={item.href}>
            {showGroup && (
              <div className="mt-3 px-3 pb-1 text-[11px] font-semibold tracking-[0.14em] text-zinc-500">
                {item.group}
              </div>
            )}
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors duration-200 ${
                active ? "text-white" : "text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.04]"
              }`}
            >
              {active && (
                <motion.span
                  layoutId={pillLayoutId}
                  className="absolute inset-0 rounded-xl bg-gradient-to-r from-violet-500/20 to-fuchsia-500/15 ring-1 ring-violet-400/25"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          </Fragment>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const hasCurrent = usePlayer((s) => s.index >= 0);
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const menuBtnRef = useRef<HTMLButtonElement | null>(null);
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

  /* 鉴权状态 + 401 全局分流；监听登录页成功事件实时刷新侧边栏登录态 */
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
    window.addEventListener("musicdl:auth-changed", refresh);
    return () => {
      window.removeEventListener("musicdl:auth-required", onAuthRequired);
      window.removeEventListener("musicdl:auth-changed", refresh);
    };
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
    <MotionConfig reducedMotion="user">
      <div className="relative z-10 flex min-h-dvh">
      {/* ---------- PC 侧边栏 ---------- */}
      <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col gap-6 border-r border-white/[0.07] bg-zinc-950/60 px-4 py-6 backdrop-blur-xl lg:flex">
        <BrandMark />
        <NavItems pillLayoutId="nav-pill-pc" />
        <AuthCard auth={auth} doLogout={doLogout} />
      </aside>

      {/* ---------- 主内容 ---------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 移动顶部品牌栏：音乐符号按钮唤出左侧抽屉菜单 */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-white/[0.07] bg-zinc-950/80 px-4 py-2.5 backdrop-blur-xl lg:hidden">
          <div className="flex min-w-0 items-center gap-3">
            <button
              ref={menuBtnRef}
              onClick={() => setDrawerOpen(true)}
              aria-label="打开导航菜单"
              aria-haspopup="dialog"
              aria-expanded={drawerOpen}
              className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-cyan-400 shadow-lg shadow-fuchsia-500/25 transition-transform duration-300 active:scale-95"
            >
              <Music4 className="h-5 w-5 text-white" strokeWidth={2.2} aria-hidden="true" />
              <span className="absolute inset-0 rounded-xl ring-1 ring-white/20" />
            </button>
            <Link href="/" className="flex min-w-0 flex-col leading-tight" aria-label="Music 首页">
              <span className="text-[15px] font-bold tracking-wide text-zinc-50">Music</span>
              <span className="truncate text-[11px] text-zinc-500">全网音乐聚合</span>
            </Link>
          </div>
          {!auth.disabled && !auth.loggedIn && (
            <Link
              href="/login"
              className="flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-3 text-[12.5px] font-semibold text-white"
            >
              <LogIn className="h-3.5 w-3.5" aria-hidden="true" /> 登录
            </Link>
          )}
        </header>

        <main className={`min-w-0 flex-1 ${hasCurrent ? "pb-[88px] lg:pb-[104px]" : "pb-8"} lg:pl-2`}>
          {children}
        </main>

        {/* 全局播放条 */}
        <PlayerBar />
      </div>

      {/* 悬浮快捷工具栏（回顶部/回底部） */}
      <FloatingToolbar />

      {/* ---------- 移动左侧抽屉菜单 ---------- */}
      <MobileDrawer open={drawerOpen} onClose={closeDrawer} auth={auth} doLogout={doLogout} returnFocusRef={menuBtnRef} />
      </div>
    </MotionConfig>
  );
}

/** 登录/退出卡片：PC 侧边栏与移动抽屉共用 */
function AuthCard({
  auth,
  doLogout,
}: {
  auth: { loggedIn: boolean; disabled: boolean; username: string };
  doLogout: () => void;
}) {
  if (auth.disabled) return null;
  return (
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
  );
}

/**
 * 移动左侧抽屉菜单：点击顶部音乐符号唤出，承载全部导航 + 登录态。
 * 无障碍（WAI-ARIA dialog 模式）：
 * - 打开时焦点移入面板、关闭时焦点返还触发按钮，Tab 循环圈定在面板内
 * - Esc / 遮罩点击 / Android 返回手势均可关闭；返回手势经 pushState 接管，先关抽屉再退出页面
 */
function MobileDrawer({
  open,
  onClose,
  auth,
  doLogout,
  returnFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  auth: { loggedIn: boolean; disabled: boolean; username: string };
  doLogout: () => void;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const pathname = usePathname() ?? "/";
  const reduced = useReducedMotion();
  const panelRef = useRef<HTMLElement | null>(null);

  /* 路由变化时自动收起抽屉 */
  useEffect(() => {
    onClose();
  }, [pathname, onClose]);

  /* 打开时：锁滚动 + Esc 关闭 + 返回手势关闭 + 焦点移入面板；关闭时回退历史条目并返还焦点 */
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    /* Android 返回手势/浏览器返回先关抽屉，而不是直接离开页面 */
    history.pushState({ __musicDrawer: true }, "");
    const onPop = () => onClose();
    window.addEventListener("popstate", onPop);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        /* 经 history.back() 触发 popstate 统一关闭，避免残留孤儿历史条目 */
        if (history.state?.__musicDrawer) history.back();
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);

    /* 焦点移入面板（programmatic focus 不触发 :focus-visible，不会闪焦点环） */
    panelRef.current?.focus();

    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      /* 主动关闭（非返回键触发）时消耗掉 drawer 历史条目；返回键/路由跳转已回退则跳过 */
      if (history.state?.__musicDrawer) history.back();
      returnFocusRef.current?.focus();
    };
  }, [open, onClose, returnFocusRef]);

  /* Tab 圈定：焦点循环限制在面板内可聚焦元素 */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !panelRef.current) return;
    const focusables = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")
    ).filter((el) => el.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panelRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.aside
            ref={panelRef}
            initial={reduced ? false : { x: -300 }}
            animate={{ x: 0 }}
            exit={reduced ? undefined : { x: -300, transition: { duration: 0.18, ease: "easeOut" } }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
            onKeyDown={onKeyDown}
            className="fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[85vw] flex-col gap-6 overflow-y-auto border-r border-white/[0.07] bg-zinc-950/95 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] pt-[calc(env(safe-area-inset-top,0px)+1.5rem)] backdrop-blur-xl focus:outline-none lg:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="导航菜单"
            tabIndex={-1}
          >
            <div className="flex items-center justify-between gap-2">
              <BrandMark />
              <button
                onClick={onClose}
                aria-label="关闭菜单"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavItems pillLayoutId="nav-pill-drawer" />
            <AuthCard auth={auth} doLogout={doLogout} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

