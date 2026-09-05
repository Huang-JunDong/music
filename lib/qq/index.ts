/**
 * lib/qq — QQ 音乐 API（TypeScript 移植自 .ref/QQMusicApi）
 *
 * 分层结构（对齐参考仓库）：
 *  - utils / errors      工具与错误（对应 qqmusic_api/utils/common.py、algorithms/sign.py、core/exceptions.py）
 *  - credential          凭证（对应 models/request.py Credential，持久化挂接本项目 cookies 表）
 *  - device / qimei      Android 设备指纹与 QIMEI（对应 utils/device.py、utils/qimei.py）
 *  - versioning          三平台 comm / UA / g_tk（对应 core/versioning.py）
 *  - client              CGI 客户端（对应 core/client.py + api_context.py + request.py；含 gather 批量合并）
 *  - pagination          分页策略框架（对应 core/pagination.py：5 策略 + AsyncPager + 27 接口预设）
 *  - rate-limit          客户端级限流与连接重试（对应 niquests TokenBucket/RetryConfiguration）
 *  - cover               封面 URL 体系（对应 models/base.py cover_url：六档尺寸 + 回退链）
 *  - mqtt                MQTT 5.0 over WS（对应 utils/mqtt.py，手机扫码通道）
 *  - modules/*           14 个业务模块（对应 qqmusic_api/modules/*）
 *  - modules/login-session  登录会话封装（对应 login_utils.py：QRCodeLoginSession/PhoneLoginSession）
 *  - modules/helper-utils   COS 直传会话（对应 helper_utils.py：UploadFileSession）
 *  - registry            HTTP 路由表（对应 web/src/routes，60 端点 + 全量补齐）
 */
export * from "./types";
export * from "./utils";
export * from "./errors";
export * from "./credential";
export * from "./device";
export * from "./versioning";
export * from "./client";
export * from "./registry";
export * from "./pagination";
export * from "./cover";
export * from "./rate-limit";
export { MqttClient, MqttRedirectError, MqttSubackError, PropertyId } from "./mqtt";
export type { MqttMessage, MqttUserProperties, MqttConnectOptions } from "./mqtt";
export { QRCodeLoginSession, PhoneLoginSession, waitQrcodeLogin, pollInterval } from "./modules/login-session";
export type { PollInterval, QRCodeLoginSessionOptions } from "./modules/login-session";
export { UploadFileSession } from "./modules/helper-utils";
export type { UploadFileSessionOptions, UploadObjectInfo } from "./modules/helper-utils";
