/**
 * 登录流程会话封装 — 完整移植 .ref/QQMusicApi qqmusic_api/modules/login_utils.py。
 *  - PhoneLoginSession：会话化发送验证码 + 验证码鉴权换凭证
 *  - PollInterval：轮询间隔控制（默认 1.5s / 已扫码 0.75s / WX-SCAN 0.5s / 网络退避上限 3s）
 *  - QRCodeLoginSession：二维码缓存复用、waitQrcodeLogin 一站式登录、
 *    iterEvents 完整事件流状态机（web/mobile 双模式自动切换、指数退避、事件去重、deadline）
 */
import type { Credential } from "../types";
import type { QQClient } from "../client";
import { LoginError, NetworkError } from "../errors";
import { checkQrcode, checkingMobileQrcode, getQrcode, phoneAuthorize, sendAuthcode, type QR, type QRCodeEvent, type QRLoginResult, type QRLoginType, type PhoneAuthCodeResult } from "./login";

/** deadline 超时信号（对齐 anyio TimeoutError 的流内超时语义） */
class TimeoutError extends Error {
  constructor() {
    super("deadline exceeded");
    this.name = "TimeoutError";
  }
}

/** 手机验证码登录会话（对齐 PhoneLoginSession） */
export class PhoneLoginSession {
  lastResult: PhoneAuthCodeResult | null = null;

  constructor(
    private readonly client: QQClient,
    public readonly phone: number | string,
    public readonly countryCode: number = 86,
  ) {}

  /** 发送当前会话手机号对应的验证码（缓存 last_result） */
  async sendAuthcode(): Promise<PhoneAuthCodeResult> {
    const result = await sendAuthcode(this.client, this.phone, this.countryCode);
    this.lastResult = result;
    return result;
  }

  /** 使用验证码完成当前会话的登录鉴权 */
  authorize(authCode: string): Promise<Credential> {
    return phoneAuthorize(this.client, this.phone, authCode);
  }
}

/** 二维码登录轮询间隔控制策略（单位： 秒，对齐 PollInterval） */
export interface PollInterval {
  default: number;
  scanned?: number | null;
  error?: number | null;
}

export function pollInterval(defaultSec: number, scanned?: number, error?: number): PollInterval {
  return { default: defaultSec, scanned: scanned ?? null, error: error ?? null };
}

const scannedInterval = (interval: PollInterval): number => interval.scanned ?? interval.default / 2;
const errorInterval = (interval: PollInterval): number => interval.error ?? interval.default * 2;

export interface QRCodeLoginSessionOptions {
  client: QQClient;
  /** 二维码登录类型 */
  loginType: QRLoginType;
  /** 轮询间隔（秒数或精细配置，默认 1.5） */
  interval?: number | PollInterval;
  /** 整个登录流程的最大超时时间（秒，默认 180，必须 > 0） */
  timeoutSeconds?: number;
  /** 是否产出重复的状态变更事件（默认 false） */
  emitRepeat?: boolean;
}

/** 二维码登录会话（对齐 QRCodeLoginSession） */
export class QRCodeLoginSession {
  private readonly client: QQClient;
  readonly loginType: QRLoginType;
  readonly interval: PollInterval;
  readonly timeoutSeconds: number;
  readonly emitRepeat: boolean;
  private cachedQrcode: QR | null = null;

  constructor(options: QRCodeLoginSessionOptions) {
    this.client = options.client;
    this.loginType = options.loginType;
    this.interval =
      typeof options.interval === "number" || options.interval === undefined
        ? pollInterval(options.interval ?? 1.5)
        : options.interval;
    this.timeoutSeconds = options.timeoutSeconds ?? 180;
    this.emitRepeat = options.emitRepeat ?? false;
    if (this.timeoutSeconds <= 0) throw new Error("timeout_seconds 必须大于 0");
  }

  /** 获取并缓存当前会话的二维码（复用直至会话销毁，对齐 frozen 缓存） */
  async getQrcode(): Promise<QR> {
    if (this.cachedQrcode === null) {
      this.cachedQrcode = await getQrcode(this.client, this.loginType);
    }
    return this.cachedQrcode;
  }

  /** 等待二维码登录完成并返回凭证；REFUSE/TIMEOUT 抛 LoginError */
  async waitQrcodeLogin(): Promise<Credential> {
    for await (const result of this.iterEvents()) {
      if (result.event === "DONE") {
        if (!result.credential) throw new LoginError("登录结果缺少凭证", -1);
        return result.credential;
      }
      if (result.event === "REFUSE") throw new LoginError("用户拒绝了登录请求", -1);
      if (result.event === "TIMEOUT") throw new LoginError("登录二维码已超时", -1);
    }
    throw new LoginError("登录流程异常结束", -1);
  }

  /** 统一产出二维码登录事件流（web 轮询状态机 / mobile MQTT 推送自动切换 + 事件去重） */
  async *iterEvents(): AsyncGenerator<QRLoginResult, void, undefined> {
    const qrcode = await this.getQrcode();
    const deadline = Date.now() + this.timeoutSeconds * 1000;

    const rawStream =
      qrcode.qrType === "mobile" ? this.iterMobileStream(deadline) : this.iterWebStream(qrcode, deadline);

    // 事件去重（emitRepeat=false 时跳过连续同状态事件）
    let lastEvent: QRCodeEvent | null = null;
    for await (const item of rawStream) {
      if (!this.emitRepeat && item.event === lastEvent) continue;
      lastEvent = item.event;
      yield item;
    }
  }

  /** web（qq/wx）轮询状态机：间隔控制 / WX-SCAN 0.5s / 网络错误指数退避 */
  private async *iterWebStream(qrcode: QR, deadline: number): AsyncGenerator<QRLoginResult, void, undefined> {
    const minSafeIntervalSec = 1.0;
    let errorRetries = 0;
    for (;;) {
      const loopStart = Date.now();
      const timeoutLeft = deadline - loopStart;
      if (timeoutLeft <= 0) {
        yield { event: "TIMEOUT", done: false };
        return;
      }

      let item: QRLoginResult;
      try {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          item = await Promise.race([
            checkQrcode(this.client, qrcode),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new TimeoutError()), timeoutLeft);
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
        errorRetries = 0;
      } catch (err) {
        if (err instanceof TimeoutError) {
          yield { event: "TIMEOUT", done: false };
          return;
        }
        // 仅网络类错误退避重试（对齐 Python 只捕 RequestException）；业务错误直接上抛
        if (!(err instanceof NetworkError)) throw err;
        const backoff = Math.min(errorInterval(this.interval), Math.pow(2, errorRetries) * this.interval.default);
        if (!(await sleepBeforeDeadlineInternal(deadline, backoff))) {
          yield { event: "TIMEOUT", done: false };
          return;
        }
        errorRetries += 1;
        continue;
      }

      yield item;
      if (item.event === "DONE" || item.event === "REFUSE" || item.event === "TIMEOUT") return;

      let sleepSec = this.interval.default;
      if (item.event === "CONF") {
        sleepSec = scannedInterval(this.interval);
      } else if (qrcode.qrType === "wx" && item.event === "SCAN") {
        sleepSec = 0.5;
      }

      const elapsed = (Date.now() - loopStart) / 1000;
      if (!(await sleepBeforeDeadlineInternal(deadline, Math.max(sleepSec, minSafeIntervalSec - elapsed)))) {
        yield { event: "TIMEOUT", done: false };
        return;
      }
    }
  }

  /** mobile（MQTT 推送）流 */
  private async *iterMobileStream(deadline: number): AsyncGenerator<QRLoginResult, void, undefined> {
    if (deadline <= Date.now()) {
      yield { event: "TIMEOUT", done: false };
      return;
    }
    for await (const item of checkingMobileQrcode(this.client, await this.getQrcode(), deadline)) {
      yield item;
      if (item.event === "DONE" || item.event === "REFUSE" || item.event === "TIMEOUT") return;
    }
  }
}

async function sleepBeforeDeadlineInternal(deadline: number, delaySec: number): Promise<boolean> {
  const leftMs = deadline - Date.now();
  if (leftMs <= 0) return false;
  await new Promise((resolve) => setTimeout(resolve, Math.min(delaySec * 1000, leftMs)));
  return Date.now() < deadline;
}

/** 便捷工厂：一站式等待二维码登录完成 */
export async function waitQrcodeLogin(
  client: QQClient,
  loginType: QRLoginType,
  options?: Omit<QRCodeLoginSessionOptions, "client" | "loginType">,
): Promise<Credential> {
  const session = new QRCodeLoginSession({ client, loginType, ...options });
  return session.waitQrcodeLogin();
}
