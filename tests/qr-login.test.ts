/**
 * lib/qr-login.ts（审核整改 P3-04 下沉）单测：凭证组装优先级 + 轮询分发。
 */
import { describe, expect, it } from "vitest";
import { qrLoginCookieString, normalizeSourceCookieString, resolveQRLogin } from "@/lib/qr-login";
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

describe("normalizeSourceCookieString（凭证串防超限规范化）", () => {
  /** 真实场景复刻：上游 803 Set-Cookie 数组 join（含 Max-Age/Expires/Path 属性段，实测 3939 字符），
      encodeURIComponent 后 name+value 超 4096 → 浏览器静默丢弃 Set-Cookie（扫码成功但显示未登录） */
  it("剥离 Set-Cookie 属性段，保留全部有效键值对且编码后不超浏览器 4096 上限", () => {
    const musicU = "0".repeat(168);
    const musicA = "A".repeat(250);
    const raw = [
      `MUSIC_U=${musicU}; Max-Age=31536000; Expires=Sun, 12 Sep 2027 00:00:00 GMT; Path=/`,
      `__csrf=${"c".repeat(32)}; Max-Age=1296010; Expires=Mon, 28 Sep 2026 00:00:00 GMT; Path=/`,
      `MUSIC_A=${musicA}; Max-Age=31536000; Expires=Sun, 12 Sep 2027 00:00:00 GMT; Path=/`,
      `NMTID=${"n".repeat(32)}; Max-Age=31536000; Expires=Sun, 12 Sep 2027 00:00:00 GMT; Path=/`,
      `_ntes_nuid=${"u".repeat(32)}; Max-Age=31536000; Expires=Sun, 12 Sep 2027 00:00:00 GMT; Path=/`,
      `_ntes_nnid=${"d".repeat(16)},1789216000000,${"e".repeat(16)}; Max-Age=31536000; Expires=Sun, 12 Sep 2027 00:00:00 GMT; Path=/`,
      `WNMCID=xidian.1789216000.01.0; Max-Age=1800; Expires=Fri, 12 Sep 2026 01:00:00 GMT; Path=/`,
      `WEVNSM=1.0.0; Max-Age=3600; Expires=Fri, 12 Sep 2026 00:30:00 GMT; Path=/`,
    ].join(";");

    const normalized = normalizeSourceCookieString(raw);
    expect(normalized).toContain(`MUSIC_U=${musicU}`);
    expect(normalized).toContain(`MUSIC_A=${musicA}`);
    expect(normalized).toContain(`__csrf=`);
    expect(normalized).toContain(`WEVNSM=1.0.0`);
    /* 属性段被剥离，不再出现 */
    expect(normalized).not.toContain("Max-Age=");
    expect(normalized).not.toContain("Expires=");
    expect(normalized).not.toContain("Path=/");
    /* 最终浏览器 Set-Cookie：名 + 编码值 + 固定属性 须在 4096 内 */
    const cookieName = "music_dl_src_netease";
    const finalLen = cookieName.length + encodeURIComponent(normalized).length + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=7776000".length;
    expect(finalLen).toBeLessThan(4096);
  });

  it("纯 token 形态凭证（非 k=v）原样保留", () => {
    expect(normalizeSourceCookieString("refreshed-by-upstream")).toBe("refreshed-by-upstream");
  });

  it("同名去重：空值删除指令不覆盖有效值", () => {
    expect(normalizeSourceCookieString("MUSIC_U=abc; MUSIC_U=")).toBe("MUSIC_U=abc");
  });

  it("极端超预算时按序丢弃放不下的项（首项登录态键天然优先保留）", () => {
    const raw = `MUSIC_U=${"x".repeat(3000)}; filler=${"y".repeat(2000)}`;
    const normalized = normalizeSourceCookieString(raw);
    expect(normalized).toContain("MUSIC_U=");
    expect(normalized).not.toContain("filler=");
  });
});

describe("resolveQRLogin", () => {
  it("不支持的源抛 unsupported（provider 缺 checkQRLogin 能力）", async () => {
    await expect(resolveQRLogin("no_such_source", "k")).rejects.toThrow("unsupported qr login source");
  });
});
