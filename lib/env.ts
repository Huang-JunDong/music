/**
 * 环境变量集中读取（审核 5.9 / A-27）：
 * 全部业务配置统一经此模块类型化访问，禁止业务代码散落 `process.env.X` 直读。
 * 采用函数形式保持与原直读一致的动态语义（进程生命周期内可变，请求间不可变语义不变）。
 *
 * 登记清单（2026-09-04）：MUSIC_DL_DISABLE_AUTH / MUSIC_DL_FFMPEG / MUSIC_DL_FAVORITES_DB /
 * NCM_DEBUG / ENABLE_GENERAL_UNBLOCK / PROXY_URL / ENABLE_PROXY / NETEASE_COOKIE /
 * ENABLE_RANDOM_CN_IP / SODA_QR_CAPTURE_FILE / SODA_QR_USE_CAPTURE_PARAMS / SODA_QR_USE_CAPTURE_SIGNATURE。
 * 例外：lib/netease/modules/ 下自动生成文件维持上游语义不改写（见 docs/netease-api-inventory.md 类型边界声明）。
 */

function trim(raw: string | undefined): string {
  return (raw ?? "").trim();
}

/** MUSIC_DL_DISABLE_AUTH=1 — 桌面模式等价（全部放行；生产环境禁用，见审核 2.1） */
export function disableAuth(): boolean {
  return trim(process.env.MUSIC_DL_DISABLE_AUTH) === "1";
}

/** MUSIC_DL_FFMPEG — 显式 ffmpeg 路径（PATH/ffmpeg-static 之后的兜底优先级见各调用方） */
export function ffmpegPath(): string {
  return trim(process.env.MUSIC_DL_FFMPEG);
}

/** MUSIC_DL_FAVORITES_DB — legacy favorites.db 迁移源路径 */
export function favoritesDbPath(): string {
  return trim(process.env.MUSIC_DL_FAVORITES_DB);
}

/** NCM_DEBUG=true — 网易模块调试日志（默认关闭，见审核 5.9 开关清理） */
export function ncmDebug(): boolean {
  return process.env.NCM_DEBUG === "true";
}

/** ENABLE_GENERAL_UNBLOCK=true — 歌曲 URL 通用解锁（默认关闭） */
export function enableGeneralUnblock(): boolean {
  return process.env.ENABLE_GENERAL_UNBLOCK === "true";
}

/** PROXY_URL — kuwo 音源前置代理前缀 */
export function proxyUrl(): string {
  return process.env.PROXY_URL ?? "";
}

/** ENABLE_PROXY — 启用 kuwo 代理前缀（默认 false） */
export function enableProxy(): boolean {
  return (process.env.ENABLE_PROXY || "false") === "true";
}

/** NETEASE_COOKIE — 显式注入的网易 cookie 串 */
export function neteaseCookie(): string | undefined {
  return process.env.NETEASE_COOKIE;
}

/** ENABLE_RANDOM_CN_IP=true — 默认启用随机中国 IP */
export function enableRandomCNIP(): boolean {
  return process.env.ENABLE_RANDOM_CN_IP === "true";
}

/** SODA_QR_CAPTURE_FILE — 汽水扫码参数捕获文件路径 */
export function sodaQrCaptureFile(): string {
  return trim(process.env.SODA_QR_CAPTURE_FILE);
}

/** SODA_QR_USE_CAPTURE_PARAMS=1 — 使用捕获的请求参数 */
export function sodaQrUseCaptureParams(): boolean {
  return process.env.SODA_QR_USE_CAPTURE_PARAMS === "1";
}

/** SODA_QR_USE_CAPTURE_SIGNATURE=1 — 使用捕获的 msToken/a_bogus 签名 */
export function sodaQrUseCaptureSignature(): boolean {
  return process.env.SODA_QR_USE_CAPTURE_SIGNATURE === "1";
}

/**
 * MUSIC_DL_PROXY_INSECURE=1 — 书面风险接受的代码化（审核整改 A-05）：
 * 仅当显式设置时才对 HTTPS 代理隧道关闭目标证书校验（默认严格校验 rejectUnauthorized: true）。
 * 风险：开启后经自签证书代理的出站请求可被中间人截获。生产环境保持关闭。
 */
export function proxyInsecure(): boolean {
  return process.env.MUSIC_DL_PROXY_INSECURE === "1";
}
