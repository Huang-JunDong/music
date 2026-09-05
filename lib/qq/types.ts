/** QQ 音乐 API 公共类型 */
import type { Platform } from "./versioning";

export type { Platform };

/** CGI 调用可选项 */
export interface CgiInvokeOptions {
  /** 自定义 comm（与默认 comm 合并） */
  comm?: Record<string, string | number | boolean> | null;
  /** 直接使用 comm 作为公共参数（不合并默认值） */
  overrideComm?: boolean;
  /** 保留 param 中的布尔值（不做 bool→int 转换） */
  preserveBool?: boolean;
  /** 允许的错误码（不抛异常）；"all" 表示全部放行 */
  allowErrorCodes?: number[] | "all";
  /** 允许的错误码命中时是否仍解析 data 返回 */
  parseOnAllow?: boolean;
  /** 本次请求使用的凭证（优先于客户端全局凭证） */
  credential?: Credential | null;
  /** 请求平台（优先于客户端默认平台） */
  platform?: Platform | null;
  /** 是否走签名网关 musics.fcg */
  sign?: boolean;
  /** 是否要求已登录（无有效凭证时抛 CredentialInvalidError） */
  requireLogin?: boolean;
}

/** 登录凭证 — 对齐 qqmusic_api.models.request.Credential（snake_case 序列化） */
export interface Credential {
  openid: string;
  refresh_token: string;
  access_token: string;
  expired_at: number;
  musicid: number;
  musickey: string;
  unionid: string;
  str_musicid: string;
  refresh_key: string;
  musickeyCreateTime: number;
  keyExpiresIn: number;
  first_login: number;
  bindAccountType: number;
  needRefreshKeyIn: number;
  encryptUin: string;
  loginType: number;
}
