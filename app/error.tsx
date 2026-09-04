"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

/**
 * 路由级错误边界（Next.js App Router error.tsx 约定，审核 4.9 / A-22）：
 * 子树渲染/生命周期异常不再白屏整页，展示错误卡 + 重试/返回首页；
 * 异常统一进入 console.error 捕获入口，不静默吞掉。
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 异常上报入口（审核 4.9：前端运行时错误统一捕获）
    console.error("[app-error]", error.digest ? `digest=${error.digest} ` : "", error.message || error);
  }, [error]);

  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 px-4 py-16 text-center" role="alert">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10">
        <AlertTriangle className="h-6 w-6 text-red-300/80" aria-hidden="true" />
      </span>
      <h2 className="text-lg font-bold text-zinc-100">页面出了点问题</h2>
      <p className="max-w-sm text-sm leading-relaxed text-zinc-500">
        {error.message || "渲染时发生未知错误"}，可以重试或返回首页。
      </p>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
        <button
          onClick={reset}
          className="flex h-11 items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] px-5 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.08] active:scale-95"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> 重试
        </button>
        <a
          href="/"
          className="flex h-11 items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] px-5 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/[0.08] active:scale-95"
        >
          <Home className="h-4 w-4" aria-hidden="true" /> 返回首页
        </a>
      </div>
    </div>
  );
}
