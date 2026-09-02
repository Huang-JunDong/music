/**
 * Next.js instrumentation — 服务端启动钩子（对齐 Go StartWithOptions 启动行为）：
 * - 未初始化管理员时生成 setup token 打印 stdout
 * - 启动时后台全量扫描下载目录，同步本地音乐 SQLite 索引（对齐 Go syncLocalMusicIndexAsync）
 * - MUSIC_DL_DISABLE_AUTH=1 时跳过鉴权初始化（桌面模式等价）
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

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
}
