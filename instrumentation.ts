/**
 * Next.js instrumentation — 服务端启动钩子（对齐 Go StartWithOptions 启动行为）。
 *
 * 注意：本文件会被同时编译到 Node.js 与 Edge 两个 Runtime。
 * NEXT_RUNTIME 在构建期由 webpack 静态替换，因此下方分支在 Edge 构建中
 * 会被常量折叠消除，Node 专用模块（node:* / process.on 等）不会进入 Edge 产物。
 * 所有 Node 专用逻辑必须放在 instrumentation-node.ts，不要回填到本文件。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNodejs } = await import("./instrumentation-node");
    await registerNodejs();
  }
}
