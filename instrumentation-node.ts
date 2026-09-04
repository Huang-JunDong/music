/**
 * Node.js Runtime 专用的 instrumentation 实现。
 * 仅由 instrumentation.ts 在 NEXT_RUNTIME === "nodejs" 时动态加载，
 * 严禁被 Edge 可达的代码路径静态引入（本文件使用 process.on/exit 与 node:* 模块）。
 *
 * - 未初始化管理员时生成 setup token 打印 stdout
 * - 启动时后台全量扫描下载目录，同步本地音乐 SQLite 索引（对齐 Go syncLocalMusicIndexAsync）
 * - 启动清扫上次运行遗留的 videogen 临时目录（审核 A-19）
 * - SIGTERM/SIGINT 优雅退出：清理临时会话后退出，不被悬挂句柄阻塞（审核 5.10 / A-19）
 * - MUSIC_DL_DISABLE_AUTH=1 时跳过鉴权初始化（桌面模式等价）
 */

/** 优雅退出（审核 5.10 / A-19）：信号到达后清理 videogen 会话/临时目录再退出 */
function installGracefulShutdown(): void {
  let exiting = false;
  const shutdown = () => {
    if (exiting) return;
    exiting = true;
    void (async () => {
      try {
        const { shutdownVideogen } = await import("@/lib/videogen");
        shutdownVideogen();
      } catch {
        /* 清理失败不阻塞退出 */
      }
      process.exit(0);
    })();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

export async function registerNodejs(): Promise<void> {
  if ((process.env.MUSIC_DL_DISABLE_AUTH ?? "").trim() !== "1") {
    try {
      const { ensureSetupToken, hasAdmin } = await import("@/lib/auth");
      if (!hasAdmin()) {
        ensureSetupToken();
      }
    } catch {
      /* 数据库尚不可用时不阻断启动 */
    }
  }

  try {
    const { refreshLocalMusicScanAsync } = await import("@/lib/local-music");
    refreshLocalMusicScanAsync();
  } catch {
    /* 下载目录尚不可用时不阻断启动 */
  }

  // 审核整改 A-19：清扫上次异常退出遗留的 vg_render_* 临时目录（含上传音频）
  try {
    const { sweepAbandonedVideogenTempDirs } = await import("@/lib/videogen");
    sweepAbandonedVideogenTempDirs();
  } catch {
    /* 临时目录不可访问时不阻断启动 */
  }

  installGracefulShutdown();
}
