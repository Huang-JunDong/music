/**
 * MQTT 5.0 over WebSocket 客户端 — 完整移植 .ref/QQMusicApi qqmusic_api/utils/mqtt.py。
 * 能力：CONNECT（AUTH_METHOD + USER_PROPERTY）/ CONNACK（ServerKeepAlive 采纳、0x9C/0x9D 重定向）/
 * SUBSCRIBE（等待 SUBACK 并校验失败码）/ PUBLISH 接收（USER_PROPERTY → properties + QoS1 PUBACK）/
 * PINGREQ keepalive / DISCONNECT / 意外断线检测与错误上抛 / 20s 连接超时 / 消息队列（8192 背压上限）。
 * 传输层使用 undici WebSocket（wss）。
 */
import { WebSocket } from "undici";
import { NetworkError } from "./errors";

export const PropertyId = {
  SERVER_KEEP_ALIVE: 0x13,
  SERVER_REFERENCE: 0x1c,
  REASON_STRING: 0x1f,
  AUTH_METHOD: 0x15,
  USER_PROPERTY: 0x26,
} as const;

export type MqttUserProperties = [string, string][];

/** 重定向常量（对齐 _MQTT_RECONNECT_MIN/MAX_DELAY 等） */
export const MQTT_RECONNECT_MIN_DELAY = 1;
export const MQTT_RECONNECT_MAX_DELAY = 120;
export const MQTT_PUBLISH_QUEUE_SIZE = 8192;
export const MQTT_CONNECT_TIMEOUT = 20.0;

/** 服务端要求客户端切换到新的 MQTT 节点（对齐 MqttRedirectError） */
export class MqttRedirectError extends Error {
  constructor(
    public readonly newAddress: string,
    public readonly reasonCode: number = 0x9d,
  ) {
    super(`Server moved to ${newAddress}`);
    this.name = "MqttRedirectError";
  }
}

/** SUBACK 返回失败码（对齐 _MqttSubackError extends ConnectionError） */
export class MqttSubackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MqttSubackError";
  }
}

export interface MqttMessage {
  topic: string;
  payload: Buffer;
  qos: number;
  properties: Record<string, string>;
  json<T = any>(): T | null;
}

/* ---------------- 包编码 ---------------- */

function encodeLength(len: number): Buffer {
  const out: number[] = [];
  do {
    let byte = len % 128;
    len = Math.floor(len / 128);
    if (len > 0) byte |= 0x80;
    out.push(byte);
  } while (len > 0);
  return Buffer.from(out);
}

function encodeString(s: string): Buffer {
  const buf = Buffer.from(s, "utf-8");
  const head = Buffer.alloc(2);
  head.writeUInt16BE(buf.length);
  return Buffer.concat([head, buf]);
}

function encodeProperties(props: { authMethod?: string; userProperties?: MqttUserProperties }): Buffer {
  const parts: Buffer[] = [];
  if (props.authMethod !== undefined) {
    parts.push(Buffer.from([PropertyId.AUTH_METHOD]), encodeString(props.authMethod));
  }
  for (const [k, v] of props.userProperties ?? []) {
    parts.push(Buffer.from([PropertyId.USER_PROPERTY]), encodeString(k), encodeString(v));
  }
  const body = Buffer.concat(parts);
  return Buffer.concat([encodeLength(body.length), body]);
}

/* ---------------- 包解码 ---------------- */

function readVarInt(buf: Buffer, offset: number): { value: number; offset: number } {
  let multiplier = 1;
  let value = 0;
  let byte = 0;
  do {
    byte = buf[offset++];
    value += (byte & 0x7f) * multiplier;
    multiplier *= 128;
  } while (byte & 0x80);
  return { value, offset };
}

function readString(buf: Buffer, offset: number): { value: string; offset: number } {
  const len = buf.readUInt16BE(offset);
  offset += 2;
  return { value: buf.subarray(offset, offset + len).toString("utf-8"), offset: offset + len };
}

/** 解析 MQTT 5 属性区（依据规范属性宽度表逐项推进；未知属性终止解析） */
function readProperties(buf: Buffer, offset: number): { props: Map<number, unknown>; offset: number } {
  const { value: propLen, offset: afterLen } = readVarInt(buf, offset);
  const end = afterLen + propLen;
  const props = new Map<number, unknown>();
  let pos = afterLen;
  while (pos < end) {
    const id = buf[pos++];
    let handled = true;
    switch (id) {
      case 0x01: // Payload Format Indicator (u8)
      case 0x17: // Request Problem Information
      case 0x19: // Request Response Information
      case 0x23: // Maximum QoS
      case 0x24: // Retain Available
      case 0x28: // Wildcard Subscription Available
      case 0x29: // Subscription Identifier Available
      case 0x2a: // Shared Subscription Available
        props.set(id, buf[pos++]);
        break;
      case 0x13: // Server Keep Alive (u16)
      case 0x21: // Receive Maximum
      case 0x22: // Topic Alias Maximum
        props.set(id, buf.readUInt16BE(pos));
        pos += 2;
        break;
      case 0x02: // Message Expiry Interval (u32)
      case 0x11: // Session Expiry Interval
      case 0x18: // Will Delay Interval
      case 0x27: // Maximum Packet Size
        props.set(id, buf.readUInt32BE(pos));
        pos += 4;
        break;
      case 0x0b: {
        // Subscription Identifier (varint)
        const v = readVarInt(buf, pos);
        props.set(id, v.value);
        pos = v.offset;
        break;
      }
      case 0x03: // Content Type (str)
      case 0x08: // Response Topic
      case 0x12: // Assigned Client Identifier
      case 0x1a: // Response Information
      case 0x1c: // Server Reference
      case 0x1f: // Reason String
      case 0x15: {
        // Authentication Method
        const s = readString(buf, pos);
        props.set(id, s.value);
        pos = s.offset;
        break;
      }
      case 0x09: // Correlation Data (bin)
      case 0x16: {
        // Authentication Data (bin)
        const len = buf.readUInt16BE(pos);
        pos += 2 + len;
        break;
      }
      case PropertyId.USER_PROPERTY: {
        const k = readString(buf, pos);
        const v = readString(buf, k.offset);
        const list = (props.get(id) as MqttUserProperties | undefined) ?? [];
        list.push([k.value, v.value]);
        props.set(id, list);
        pos = v.offset;
        break;
      }
      default:
        handled = false;
        break;
    }
    if (!handled) break;
  }
  return { props, offset: end };
}

interface MqttPacket {
  type: number;
  flags: number;
  body: Buffer;
}

function parsePacketFrom(buf: Buffer): { packet: MqttPacket; rest: Buffer } | null {
  if (buf.length < 2) return null;
  const { value: remLen, offset } = readVarInt(buf, 1);
  if (buf.length < offset + remLen) return null;
  return {
    packet: {
      type: buf[0] >> 4,
      flags: buf[0] & 0x0f,
      body: buf.subarray(offset, offset + remLen),
    },
    rest: buf.subarray(offset + remLen),
  };
}

/** 对齐 _build_redirect_path：末段含 ":" 则替换，否则追加 */
function buildRedirectPath(path: string, serverReference: string): string {
  const parts = path.replace(/\/+$/, "").split("/");
  if (parts.length && parts[parts.length - 1].includes(":")) {
    parts[parts.length - 1] = serverReference;
    return parts.join("/");
  }
  return `${path.replace(/\/+$/, "")}/${serverReference}`;
}

export interface MqttConnectOptions {
  clientId: string;
  host: string;
  port: number;
  path: string;
  keepAlive?: number;
  maxRedirects?: number;
  connectProperties?: { authMethod?: string; userProperties?: MqttUserProperties };
  headers?: Record<string, string>;
}

interface PendingSuback {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

interface WaitingConsumer {
  resolve: (msg: MqttMessage) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

export class MqttClient {
  private ws: WebSocket | null = null;
  private closed = false;
  private buffer: Buffer = Buffer.alloc(0);
  private packetId = 0;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private keepAlive: number;
  private frameHandler: ((msg: MqttMessage) => void) | null = null;
  private closeHandler: ((err: Error) => void) | null = null;
  private readonly pendingSubacks = new Map<number, PendingSuback>();
  private readonly messageQueue: MqttMessage[] = [];
  private readonly waitingConsumers: WaitingConsumer[] = [];
  private messageError: Error | null = null;
  private currentPath: string;

  constructor(private readonly options: MqttConnectOptions) {
    this.keepAlive = options.keepAlive ?? 45;
    this.currentPath = options.path;
  }

  private nextPacketId(): number {
    this.packetId = (this.packetId % 65535) + 1;
    return this.packetId;
  }

  /** 建立 MQTT 连接（处理 0x9C/0x9D ServerReference 重定向，最多 maxRedirects 次；采纳 ServerKeepAlive） */
  async connect(): Promise<void> {
    let redirects = 0;
    const maxRedirects = this.options.maxRedirects ?? 3;
    for (;;) {
      const url = `wss://${this.options.host}:${this.options.port}${this.currentPath}`;
      let connack: { reasonCode: number; props: Map<number, unknown> };
      try {
        connack = await this.connectOnce(url, MQTT_CONNECT_TIMEOUT * 1000);
      } catch (err) {
        if (err instanceof MqttRedirectError) throw err;
        throw new NetworkError(`MQTT connection failed: ${(err as Error)?.message ?? err}`);
      }
      if (connack.reasonCode === 0x00) {
        const serverKeepAlive = connack.props.get(PropertyId.SERVER_KEEP_ALIVE);
        if (typeof serverKeepAlive === "number") {
          // 采纳服务端下发的 keepalive 并重启心跳
          this.keepAlive = serverKeepAlive;
          this.startPing();
        }
        return;
      }
      const serverRef = connack.props.get(PropertyId.SERVER_REFERENCE);
      if ((connack.reasonCode === 0x9c || connack.reasonCode === 0x9d) && typeof serverRef === "string" && serverRef) {
        this.teardownSocket();
        if (redirects >= maxRedirects) {
          throw new MqttRedirectError(serverRef, connack.reasonCode);
        }
        redirects += 1;
        this.currentPath = buildRedirectPath(this.currentPath, serverRef);
        continue;
      }
      this.teardownSocket();
      const reason = (connack.props.get(PropertyId.REASON_STRING) as string | undefined) ?? "";
      throw new NetworkError(`MQTT Connect Failed. Reason Code: 0x${connack.reasonCode.toString(16)}${reason ? ` ${reason}` : ""}`);
    }
  }

  private connectOnce(url: string, timeoutMs: number): Promise<{ reasonCode: number; props: Map<number, unknown> }> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(url, {
        headers: this.options.headers,
        protocols: ["mqtt"],
      });
      this.ws = ws;

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.teardownSocket();
        reject(err);
      };

      const timer = setTimeout(() => {
        fail(new Error("MQTT connect timed out"));
      }, timeoutMs);

      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        const propBlock = encodeProperties({
          authMethod: this.options.connectProperties?.authMethod,
          userProperties: this.options.connectProperties?.userProperties,
        });
        const keepAliveBuf = Buffer.alloc(2);
        keepAliveBuf.writeUInt16BE(this.keepAlive);
        const variableHeader = Buffer.concat([
          encodeString("MQTT"),
          Buffer.from([5, 0x02]), // protocol level 5 + Clean Start
          keepAliveBuf,
          propBlock,
        ]);
        const payload = encodeString(this.options.clientId);
        const body = Buffer.concat([variableHeader, payload]);
        ws.send(new Uint8Array(Buffer.concat([Buffer.from([0x10]), encodeLength(body.length), body])));
      };
      ws.onerror = () => fail(new Error("MQTT TCP connect failed before CONNACK"));
      ws.onclose = () => fail(new Error("WebSocket closed before CONNACK"));
      ws.onmessage = (ev) => {
        this.buffer = Buffer.concat([this.buffer, Buffer.from(ev.data as ArrayBuffer)]);
        const parsed = parsePacketFrom(this.buffer);
        if (parsed && parsed.packet.type === 2) {
          settled = true;
          clearTimeout(timer);
          this.buffer = parsed.rest;
          const reasonCode = parsed.packet.body.length > 1 ? parsed.packet.body[1] : 0;
          const { props } = readProperties(parsed.packet.body, 2);
          this.startPing();
          // CONNACK 后切换到会话期帧处理（PUBLISH/SUBACK/PINGRESP...）
          ws.onmessage = (e) => this.onFrame(Buffer.from(e.data as ArrayBuffer));
          // 连接建立后的断线检测：意外断线 → 终止会话并上抛（对齐 _on_disconnect/_fail_message_stream）
          ws.onclose = () => this.handleUnexpectedDisconnect(new Error("MQTT disconnected during session"));
          ws.onerror = () => this.handleUnexpectedDisconnect(new Error("MQTT socket error during session"));
          resolve({ reasonCode, props });
        }
      };
    });
  }

  /** 意外断线：失败所有等待中的订阅/消息消费者，通知 closeHandler（对齐 _handle_unexpected_disconnect） */
  private handleUnexpectedDisconnect(err: Error): void {
    if (this.closed) return;
    this.stopPing();
    this.messageError = err;
    for (const suback of this.pendingSubacks.values()) {
      if (suback.timer) clearTimeout(suback.timer);
      suback.reject(err);
    }
    this.pendingSubacks.clear();
    for (const consumer of this.waitingConsumers) {
      if (consumer.timer) clearTimeout(consumer.timer);
      consumer.reject(new NetworkError(err.message));
    }
    this.waitingConsumers.length = 0;
    this.frameHandler = null;
    this.closeHandler?.(new NetworkError(err.message));
  }

  private teardownSocket(): void {
    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.onmessage = null;
        this.ws.close();
      } catch {
        /* ignore */
      }
    }
    this.ws = null;
  }

  private startPing(): void {
    this.stopPing();
    this.keepAliveTimer = setInterval(() => {
      this.sendRaw(Buffer.from([0xc0, 0x00])); // PINGREQ
    }, Math.max(5, Math.floor(this.keepAlive * 0.8)) * 1000);
  }

  private stopPing(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  private sendRaw(frame: Buffer): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(new Uint8Array(frame));
    }
  }

  private onFrame(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);
    for (;;) {
      const parsed = parsePacketFrom(this.buffer);
      if (!parsed) return;
      this.buffer = parsed.rest;
      const { packet } = parsed;
      if (packet.type === 3) {
        // PUBLISH
        const topic = readString(packet.body, 0);
        let pos = topic.offset;
        const qos = (packet.flags >> 1) & 0x03;
        let packetIdBuf: Buffer | null = null;
        if (qos > 0) {
          packetIdBuf = packet.body.subarray(pos, pos + 2);
          pos += 2;
        }
        const { props, offset: payloadStart } = readProperties(packet.body, pos);
        const payload = packet.body.subarray(payloadStart);
        const userProps = (props.get(PropertyId.USER_PROPERTY) as MqttUserProperties | undefined) ?? [];
        const message: MqttMessage = {
          topic: topic.value,
          payload,
          qos,
          properties: Object.fromEntries(userProps.map(([k, v]) => [k, v])),
          json<T = any>(): T | null {
            try {
              return JSON.parse(payload.toString("utf-8")) as T;
            } catch {
              return null;
            }
          },
        };
        if (qos === 1 && packetIdBuf && packetIdBuf.length === 2) {
          this.sendRaw(Buffer.concat([Buffer.from([0x40, 0x02]), packetIdBuf])); // PUBACK
        }
        this.enqueueMessage(message);
      } else if (packet.type === 9) {
        // SUBACK：body = [packetId(2)] [props] [reasonCodes...]
        const packetId = packet.body.length >= 2 ? packet.body.readUInt16BE(0) : 0;
        const { offset: afterProps } = readProperties(packet.body, 2);
        const reasonCodes = [...packet.body.subarray(afterProps)];
        const pending = this.pendingSubacks.get(packetId);
        if (pending) {
          this.pendingSubacks.delete(packetId);
          if (pending.timer) clearTimeout(pending.timer);
          if (reasonCodes.some((code) => code >= 0x80)) {
            pending.reject(
              new MqttSubackError(
                `SUBACK rejected. Reason codes: ${reasonCodes.map((c) => `0x${c.toString(16)}`).join(",")}`,
              ),
            );
          } else {
            pending.resolve();
          }
        }
      }
      // 其余包类型（PINGRESP/PUBACK...）无需处理
    }
  }

  /** 入队消息（8192 上限防 OOM，溢出丢弃），并唤醒等待中的消费者 */
  private enqueueMessage(message: MqttMessage): void {
    const consumer = this.waitingConsumers.shift();
    if (consumer) {
      if (consumer.timer) clearTimeout(consumer.timer);
      consumer.resolve(message);
      return;
    }
    this.frameHandler?.(message);
    if (this.messageQueue.length < MQTT_PUBLISH_QUEUE_SIZE) {
      this.messageQueue.push(message);
    }
    // 队列满：丢弃（对齐 send_nowait WouldBlock 分支）
  }

  /**
   * 订阅主题（携带 USER_PROPERTY），等待 SUBACK 并校验失败码。
   * 超时上限 max(keepAlive, 5)s（对齐 _wait_threading_event）。
   */
  async subscribe(topic: string, properties?: { userProperties?: MqttUserProperties }): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("MQTT is not connected");
    }
    const packetId = this.nextPacketId();
    const packetIdBuf = Buffer.alloc(2);
    packetIdBuf.writeUInt16BE(packetId);
    const propBlock = encodeProperties({ userProperties: properties?.userProperties });
    const topicBlock = Buffer.concat([encodeString(topic), Buffer.from([0x00])]); // QoS 0
    const body = Buffer.concat([packetIdBuf, propBlock, topicBlock]);

    await new Promise<void>((resolve, reject) => {
      const timeoutMs = Math.max(this.keepAlive, 5.0) * 1000;
      const timer = setTimeout(() => {
        this.pendingSubacks.delete(packetId);
        reject(new Error(`Subscribe to ${topic} timed out`));
      }, timeoutMs);
      this.pendingSubacks.set(packetId, { resolve, reject, timer });
      this.sendRaw(Buffer.concat([Buffer.from([0x82]), encodeLength(body.length), body]));
    });
  }

  /** 注册消息回调（队列消费模式之外的通知通道） */
  onMessage(handler: (msg: MqttMessage) => void): void {
    this.frameHandler = handler;
  }

  /** 注册意外断线回调 */
  onClose(handler: (err: Error) => void): void {
    this.closeHandler = handler;
  }

  /** 等待下一条消息（超时 ms；断线时抛 NetworkError，对齐 messages() 流的 ConnectionError 上抛） */
  waitForMessage(timeoutMs?: number): Promise<MqttMessage> {
    if (this.messageError) throw new NetworkError(this.messageError.message);
    const queued = this.messageQueue.shift();
    if (queued) return Promise.resolve(queued);
    if (this.closed) throw new NetworkError("WebSocket closed");
    return new Promise<MqttMessage>((resolve, reject) => {
      const consumer: WaitingConsumer = { resolve, reject, timer: null };
      if (timeoutMs !== undefined) {
        consumer.timer = setTimeout(() => {
          const idx = this.waitingConsumers.indexOf(consumer);
          if (idx >= 0) this.waitingConsumers.splice(idx, 1);
          reject(new Error("waitForMessage timed out"));
        }, timeoutMs);
      }
      this.waitingConsumers.push(consumer);
    });
  }

  /** 当前会话是否已因意外断线而失败 */
  get error(): Error | null {
    return this.messageError;
  }

  /** 断开连接并释放所有资源 */
  disconnect(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopPing();
    try {
      this.sendRaw(Buffer.from([0xe0, 0x00])); // DISCONNECT
    } catch {
      /* ignore */
    }
    for (const suback of this.pendingSubacks.values()) {
      if (suback.timer) clearTimeout(suback.timer);
      suback.reject(new Error("WebSocket closed"));
    }
    this.pendingSubacks.clear();
    for (const consumer of this.waitingConsumers) {
      if (consumer.timer) clearTimeout(consumer.timer);
      consumer.reject(new Error("WebSocket closed"));
    }
    this.waitingConsumers.length = 0;
    this.teardownSocket();
  }
}
