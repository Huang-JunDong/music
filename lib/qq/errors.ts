/**
 * QQ 音乐 API 错误类型 — 完整对齐 .ref/QQMusicApi qqmusic_api/core/exceptions.py。
 * 类型层级：CgiApiError（对应 CgiApiException）派生 CredentialExpired / CredentialRefresh /
 * RateLimited / Login 系列 / SignatureRequired / GlobalApiError。
 */

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

export class HTTPError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(`HTTP ${statusCode}: ${message}`);
    this.name = "HTTPError";
  }
}

export class ApiDataError extends Error {
  constructor(
    message: string,
    public data?: unknown,
  ) {
    super(`API Data Error: ${message}`);
    this.name = "ApiDataError";
  }
}

/** CGI 业务错误（req_N.code != 0 且不在允许列表），对应 CgiApiException */
export class CgiApiError extends Error {
  constructor(
    message: string,
    public code: number,
    public data?: unknown,
  ) {
    super(message);
    this.name = "CgiApiError";
  }
}

/** 全局网关拦截错误（外层信封 code != 0） */
export class GlobalApiError extends CgiApiError {
  constructor(code: number, data?: unknown) {
    super(`请求被网关拒绝 (code=${code})`, code, data);
    this.name = "GlobalApiError";
  }
}

export class SignatureRequiredError extends CgiApiError {
  constructor(code = 2000, data?: unknown) {
    super("请求需要签名", code, data);
    this.name = "SignatureRequiredError";
  }
}

/** 触发风控或请求频率限制（code=2001），携带 feedbackURL */
export class RateLimitedError extends CgiApiError {
  constructor(
    code: number,
    data?: unknown,
  ) {
    super("触发风控, 需登录或者安全验证", code, data);
    this.name = "RateLimitedError";
    this.feedbackUrl =
      data && typeof data === "object" ? (data as Record<string, unknown>).feedbackURL as string ?? null : null;
  }

  /** 风控反馈跳转地址（上游 data.feedbackURL） */
  feedbackUrl: string | null;
}

/** 凭证过期/失效（code = 1000 / 104400 / 104401） */
export class CredentialExpiredError extends CgiApiError {
  constructor(code: number, data?: unknown) {
    super("登录凭证已过期, 请重新登录", code, data);
    this.name = "CredentialExpiredError";
  }
}

/** 凭证刷新失败 */
export class CredentialRefreshError extends CgiApiError {
  constructor(
    message = "登录凭证刷新失败",
    code = -1,
    data?: unknown,
  ) {
    super(message, code, data);
    this.name = "CredentialRefreshError";
  }
}

/** 登录业务异常（LoginServer 校验失败） */
export class LoginError extends CgiApiError {
  constructor(
    message = "登录失败",
    code = -1,
    data?: unknown,
  ) {
    super(message, code, data);
    this.name = "LoginError";
  }
}

/** 登录鉴权参数无效或已过期（code=1000/104401/104400） */
export class LoginAuthExpiredError extends LoginError {
  constructor(code: number, data?: unknown) {
    super("登录鉴权参数无效或已过期", code, data);
    this.name = "LoginAuthExpiredError";
  }
}

/** 登录设备数量超限（code=20279） */
export class LoginDeviceLimitError extends LoginError {
  constructor(code: number, data?: unknown) {
    super("登录设备超限", code, data);
    this.name = "LoginDeviceLimitError";
  }
}

/** 账号受限或已被封禁（code=20277/20278/20450）；支持 (code) 或 (message, code) 双态构造 */
export class LoginAccountRestrictedError extends LoginError {
  constructor(message: string | number = "账号受限", code = -1, data?: unknown) {
    if (typeof message === "number") {
      super("账号受限", message, data);
    } else {
      super(message, code, data);
    }
    this.name = "LoginAccountRestrictedError";
  }
}

/** 登录操作过于频繁（code=104604） */
export class LoginRateLimitError extends LoginError {
  constructor(code: number, data?: unknown) {
    super("操作过于频繁", code, data);
    this.name = "LoginRateLimitError";
  }
}
