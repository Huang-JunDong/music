/** 极简 logger — 对齐 api-enhanced util/logger.js 的接口面（info/warn/error/debug） */
/* eslint-disable no-console */
const tag = "[ncm]";
export const logger = {
  info(...args: unknown[]) {
    console.log(tag, ...args);
  },
  warn(...args: unknown[]) {
    console.warn(tag, ...args);
  },
  error(...args: unknown[]) {
    console.error(tag, ...args);
  },
  debug(...args: unknown[]) {
    if (process.env.NCM_DEBUG === "true") console.debug(tag, ...args);
  },
};
