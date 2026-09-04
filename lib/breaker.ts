/**
 * 上游熔断器（审核整改 A-27）：按源（或任意维度键）统计连续失败，
 * 连续失败达阈值后短路一段时间，期间直接跳过该源（快速失败），窗口过后放行重试。
 * 进程内状态，适用单实例（多实例局限已登记审核文档）。
 */

interface BreakerState {
  consecutiveFailures: number;
  openUntil: number;
}

const BREAKER_FAILURE_THRESHOLD = 5;
const BREAKER_OPEN_MS = 30_000;

const breakers = new Map<string, BreakerState>();

function stateOf(key: string): BreakerState {
  let state = breakers.get(key);
  if (!state) {
    state = { consecutiveFailures: 0, openUntil: 0 };
    breakers.set(key, state);
  }
  return state;
}

/** 该键当前是否被熔断（短路中） */
export function breakerAllows(key: string): boolean {
  const state = breakers.get(key);
  if (!state) return true;
  return Date.now() >= state.openUntil;
}

/** 记录一次成功：清零连续失败计数（半开探测成功即闭合） */
export function breakerRecordSuccess(key: string): void {
  const state = stateOf(key);
  state.consecutiveFailures = 0;
  state.openUntil = 0;
}

/** 记录一次失败：连续失败达阈值则开启短路窗口 */
export function breakerRecordFailure(key: string): void {
  const state = stateOf(key);
  state.consecutiveFailures += 1;
  if (state.consecutiveFailures >= BREAKER_FAILURE_THRESHOLD) {
    state.openUntil = Date.now() + BREAKER_OPEN_MS;
  }
}
