/**
 * 网易云 API 模块类型定义 — 对齐 api-enhanced interface.d.ts / util/request.js
 */

/** 模块查询参数（HTTP query/body 合并结果，宽松类型） */
export type NcmQuery = Record<string, any>;

/** createOption 生成的请求选项（对齐 util/option.js） */
export interface NcmRequestOption {
  crypto: string;
  cookie: NcmQuery | string | undefined;
  ua: string;
  proxy?: string;
  realIP?: string;
  randomCNIP: boolean;
  e_r: any;
  domain: string;
  checkToken: any;
  headers: Record<string, string>;
  timeout: number;
  ip?: string;
}

/** 模块返回结构（对齐 request.js answer；部分模块不返回 cookie/redirectUrl） */
export interface NcmResponse {
  status: number;
  body: any;
  cookie?: string[];
  redirectUrl?: string;
  [key: string]: any;
}

/** body 泛型化的响应（避免 any 淹没泛型） */
export interface NcmResponseOf<T> {
  status: number;
  body: T;
  cookie?: string[];
  redirectUrl?: string;
  [key: string]: any;
}

/** 传给模块的 request 函数签名 */
export type NcmRequestFn = (
  uri: string,
  data: any,
  options: NcmRequestOption,
) => Promise<NcmResponse>;

/** 接口模块签名 */
export type NcmModule = (
  query: NcmQuery,
  request: NcmRequestFn,
) => Promise<NcmResponse>;

/** 上传文件描述（FormData 解析后注入 query.imgFile / query.songFile） */
export interface NcmUploadFile {
  name: string;
  data: Buffer;
  mimetype?: string;
  md5?: string;
  size?: number;
  tempFilePath?: string;
  [key: string]: any;
}
