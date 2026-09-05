/**
 * lib/qr-login.ts（审核整改 P3-04 下沉）单测：凭证组装优先级 + 轮询分发。
 */
import { describe, expect, it } from "vitest";
import { qrLoginCookieString, resolveQRLogin } from "@/lib/qr-login";
import type { QRLoginResult } from "@/lib/types";

const result = (partial: Partial<QRLoginResult>): QRLoginResult =>
  ({ source: "netease", key: "k", ...partial }) as QRLoginResult;

describe("qrLoginCookieString", () => {
  it("优先 cookie 字段（整体串直出）", () => {
    expect(qrLoginCookieString(result({ status: "success", cookie: " MUSIC_U=abc; os=pc " }))).toBe("MUSIC_U=abc; os=pc");
  });

  it("无 cookie 字段时按 key 排序拼接 cookies map，空值剔除", () => {
    expect(
      qrLoginCookieString(
        result({
          status: "success",
          cookies: { os: "pc", MUSIC_U: "abc", EMPTY: "  ", " ": "x" },
        }),
      ),
    ).toBe("MUSIC_U=abc; os=pc");
  });

  it("两者皆空返回空串", () => {
    expect(qrLoginCookieString(result({ status: "waiting" }))).toBe("");
  });
});

describe("resolveQRLogin", () => {
  it("不支持的源抛 unsupported（provider 缺 checkQRLogin 能力）", async () => {
    await expect(resolveQRLogin("no_such_source", "k")).rejects.toThrow("unsupported qr login source");
  });
});
