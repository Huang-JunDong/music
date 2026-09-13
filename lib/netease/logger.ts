/** 极简 logger — 对齐 api-enhanced util/logger.js 的接口面（info/warn/error/debug） */
import { ncmDebug } from "../env";

const tag = "[ncm]";
export const logger = {
  info(...args: unknown[]) {
    // eslint-disable-next-line no-console -- logger 模块即 console 封装面（审核整改 C-15：收敛文件级豁免为逐行）
    console.log(tag, ...args);
  },
  warn(...args: unknown[]) {
    // eslint-disable-next-line no-console -- 同上
    console.warn(tag, ...args);
  },
  error(...args: unknown[]) {
    // eslint-disable-next-line no-console -- 同上
    console.error(tag, ...args);
  },
  debug(...args: unknown[]) {
    // eslint-disable-next-line no-console -- 同上
    if (ncmDebug()) console.debug(tag, ...args);
  },
};
