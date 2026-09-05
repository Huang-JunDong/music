/**
 * 迁移补齐功能的回归测试 — 分页策略 / 封面 URL / 异常层级 / gather 拆包 / credential 边界 / 歌词解密兜底。
 */
import { describe, expect, it, vi, afterEach } from "vitest";

import {
  PageStrategy,
  OffsetStrategy,
  CursorStrategy,
  BatchRefreshStrategy,
  MultiFieldContinuationStrategy,
  AsyncPager,
  paginatedCgi,
  MODULE_PAGERS,
  MODULE_ITEM_EXTRACTORS,
} from "../lib/qq/pagination";
import { albumCoverUrl, singerCoverUrl, songCoverUrl, buildPhotoNewCoverUrl } from "../lib/qq/cover";
import {
  GlobalApiError,
  LoginAuthExpiredError,
  LoginDeviceLimitError,
  LoginAccountRestrictedError,
  LoginRateLimitError,
  LoginError,
  CgiApiError,
  CredentialRefreshError,
  RateLimitedError,
} from "../lib/qq/errors";
import { parseCgiResponse, QQClient, type GatherRequest } from "../lib/qq/client";
import { isCredentialExpired, emptyCredential } from "../lib/qq/credential";
import { getLyric, getMultiStyleTransLyric } from "../lib/qq/modules/lyric";
import { qq } from "../lib/providers/qq";
import type { Song } from "../lib/types";

/* getStreamUrl 音质测试：隔离全局凭证（真实库中存在已登录凭证时 provider 会触发 VIP 网络探测） */
vi.mock("../lib/qq/credential", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lib/qq/credential")>();
  return { ...mod, loadCredential: () => null };
});

describe("封面 URL 体系", () => {
  it("六档尺寸 + T001/T002", () => {
    expect(albumCoverUrl({ mid: "abc" }, 150)).toBe(
      "https://y.gtimg.cn/music/photo_new/T002R150x150M000abc.jpg",
    );
    expect(albumCoverUrl({ mid: "abc" }, 1500)).toBe(
      "https://y.gtimg.cn/music/photo_new/T002R1500x1500M000abc.jpg",
    );
    expect(singerCoverUrl({ mid: "xyz" }, 800)).toBe(
      "https://y.gtimg.cn/music/photo_new/T001R800x800M000xyz.jpg",
    );
  });

  it("mid 缺失回退 pmid；空白返回空串", () => {
    expect(albumCoverUrl({ pmid: "p1" })).toContain("T002R300x300M000p1.jpg");
    expect(albumCoverUrl({ logo: "p1" }, 300)).toContain("p1");
    expect(singerCoverUrl({ singerPmid: "p2" })).toContain("T001R300x300M000p2.jpg");
    expect(albumCoverUrl({ mid: "  " })).toBe("");
    expect(buildPhotoNewCoverUrl("T001", "", 300)).toBe("");
  });

  it("非法尺寸抛错；Song 级回退链：专辑 → 歌手 → 空串", () => {
    expect(() => buildPhotoNewCoverUrl("T001", "abc", 200 as never)).toThrow("not supported size");
    expect(songCoverUrl({ album: { mid: "alb" }, singer: [{ mid: "s1" }] })).toContain("T002");
    expect(songCoverUrl({ album: {}, singer: [{ pmid: "s1" }] })).toContain("T001");
    expect(songCoverUrl({ album: {}, singer: [] })).toBe("");
  });
});

describe("异常类型层级", () => {
  it("7 个新子类的继承关系与语义", () => {
    expect(new LoginAuthExpiredError(1000, {})).toBeInstanceOf(LoginError);
    expect(new LoginDeviceLimitError(20279)).toBeInstanceOf(LoginError);
    expect(new LoginAccountRestrictedError(20277)).toBeInstanceOf(LoginError);
    expect(new LoginAccountRestrictedError("账号已被封禁", 20450).message).toBe("账号已被封禁");
    expect(new LoginRateLimitError(104604)).toBeInstanceOf(LoginError);
    expect(new GlobalApiError(1001, {})).toBeInstanceOf(CgiApiError);
    expect(new CredentialRefreshError("x", 1)).toBeInstanceOf(CgiApiError);
  });

  it("RateLimitedError 携带 feedbackUrl", () => {
    const err = new RateLimitedError(2001, { feedbackURL: "https://example.com/verify" });
    expect(err.feedbackUrl).toBe("https://example.com/verify");
    expect(new RateLimitedError(2001).feedbackUrl).toBeNull();
  });
});

describe("分页策略", () => {
  it("PageStrategy：hasMore 显式 / total 推断 / 页码递增", () => {
    const strategy = new PageStrategy<any>("page", {
      pageSize: 10,
      totalExtractor: (r) => r.total,
    });
    expect(strategy.hasNext({ page: 1 }, { total: 25 })).toBe(true);
    expect(strategy.hasNext({ page: 2 }, { total: 20 })).toBe(false);
    expect(strategy.nextParams({ page: 1, q: "x" }, {})).toEqual({ page: 2, q: "x" });
    // 显式 hasMore 优先
    const explicit = new PageStrategy<any>("page", { hasMoreExtractor: () => false, totalExtractor: () => 999, pageSize: 1 });
    expect(explicit.hasNext({ page: 1 }, {})).toBe(false);
  });

  it("OffsetStrategy：total 推断 / count 推断 / step 采用实际返回数", () => {
    const strategy = new OffsetStrategy<any>("begin", {
      pageSizeKey: "num",
      totalExtractor: (r) => r.totalNum,
      countExtractor: (r) => (r.list ?? []).length,
    });
    expect(strategy.hasNext({ begin: 0, num: 10 }, { totalNum: 25, list: new Array(10) })).toBe(true);
    expect(strategy.hasNext({ begin: 20, num: 10 }, { totalNum: 25, list: new Array(5) })).toBe(false);
    // 无 total 时按 count >= pageSize 判断
    const countOnly = new OffsetStrategy<any>("begin", { pageSize: 10, countExtractor: (r) => r.n });
    expect(countOnly.hasNext({}, { n: 10 })).toBe(true);
    expect(countOnly.hasNext({}, { n: 9 })).toBe(false);
    expect(strategy.nextParams({ begin: 0, num: 10 }, { list: new Array(7) })).toEqual({ begin: 7, num: 10 });
    expect(() => new OffsetStrategy<any>("begin", {})).toThrow("OffsetStrategy 需要");
  });

  it("CursorStrategy：终止条件 / 游标回写 / 游标缺失停止", () => {
    const strategy = new CursorStrategy<any>("LastPos", {
      hasMoreExtractor: (r) => (r.HasMore === 1 ? true : false),
      cursorExtractor: (r) => r.NextPos ?? null,
    });
    expect(strategy.hasNext({ LastPos: "a" }, { HasMore: 0, NextPos: "b" })).toBe(false);
    expect(strategy.hasNext({ LastPos: "a" }, { HasMore: 1, NextPos: "b" })).toBe(true);
    expect(strategy.hasNext({ LastPos: "a" }, { HasMore: 1, NextPos: "a" })).toBe(false);
    expect(strategy.nextParams({ LastPos: "a" }, { NextPos: "c" })).toEqual({ LastPos: "c" });
    expect(strategy.hasNext({}, { HasMore: 1 })).toBe(false); // 无游标 → 终止
  });

  it("BatchRefreshStrategy：游标不变停止 / allowRepeat 持续刷新", () => {
    const opts = {
      hasMoreExtractor: () => true as const,
      cursorExtractor: (r: any) => r.next ?? null,
    };
    const noRepeat = new BatchRefreshStrategy<any>("last", opts);
    expect(noRepeat.hasNext({ last: 1 }, { next: 1 })).toBe(false);
    expect(noRepeat.hasNext({ last: 1 }, { next: 2 })).toBe(true);
    const allowRepeat = new BatchRefreshStrategy<any>("last", { ...opts, allowRepeat: true });
    expect(allowRepeat.hasNext({ last: 1 }, { next: 1 })).toBe(true);
  });

  it("MultiFieldContinuationStrategy：buildNext 返回 null 停止", () => {
    const strategy = new MultiFieldContinuationStrategy<any>(
      (params, r) => (r.hasMore ? { ...params, page: params.page + 1 } : null),
      { hasMoreExtractor: (r) => (r.hasMore ? null : false) },
    );
    expect(strategy.hasNext({ page: 1 }, { hasMore: true })).toBe(true);
    expect(strategy.hasNext({ page: 1 }, { hasMore: false })).toBe(false);
    expect(strategy.nextParams({ page: 1 }, { hasMore: true })).toEqual({ page: 2 });
    expect(() => strategy.nextParams({}, { hasMore: false })).toThrow("continuation");
  });

  it("AsyncPager + paginatedCgi 自动翻页（fake client）", async () => {
    const pages = [{ items: [1, 2], next: true }, { items: [3], next: false }];
    let call = 0;
    const fakeClient = {
      invoke: vi.fn(async () => pages[Math.min(call++, pages.length - 1)]),
    } as unknown as QQClient;
    const strategy = new MultiFieldContinuationStrategy<any>((params, r) => (r.next ? { ...params, page: params.page + 1 } : null));
    const request = paginatedCgi(fakeClient, { module: "m", method: "n", param: { page: 1 } }, strategy);
    const collected = await request.collect();
    expect(collected).toEqual(pages);

    // 条目级跨页展开
    call = 0;
    const items = await request.withExtractor((r) => r.items).collectItems();
    expect(items).toEqual([1, 2, 3]);

    // limit 页数限制
    call = 0;
    const limited = await request.collect(1);
    expect(limited).toEqual([pages[0]]);
  });

  it("MODULE_PAGERS 覆盖全部 31 个接口预设", () => {
    const expected = [
      "album.get_song", "album.get_new_album",
      "comment.get_hot_comments", "comment.get_new_comments", "comment.get_recommend_comments", "comment.get_moment_comments",
      "pm.get_sessions", "pm.get_messages",
      "recommend.get_home_feed", "recommend.get_radar_recommend", "recommend.get_recommend_songlist",
      "search.general_search", "search.search_by_type",
      "singer.get_singer_list_index", "singer.get_tab_detail", "singer.get_songs_list", "singer.get_album_list", "singer.get_mv_list",
      "mv.get_mv_list",
      "song.get_related_songlist", "song.get_related_mv",
      "songlist.get_detail", "top.get_detail",
      "user.get_follow_singers", "user.get_fans", "user.get_follow_user", "user.get_friend",
      "user.get_fav_song", "user.get_fav_songlist", "user.get_fav_album", "user.get_dislike_list",
    ];
    for (const id of expected) {
      expect(MODULE_PAGERS[id], `缺少策略预设: ${id}`).toBeDefined();
      expect(typeof MODULE_PAGERS[id]().hasNext).toBe("function");
    }
    expect(Object.keys(MODULE_ITEM_EXTRACTORS).length).toBeGreaterThanOrEqual(26);
  });

  it("search.search_by_type：nextpage != -1 继续（-1 终止）", () => {
    const strategy = MODULE_PAGERS["search.search_by_type"]();
    expect(strategy.hasNext({ page_num: 1 }, { meta: { nextpage: 2, sum: 100 } })).toBe(true);
    expect(strategy.hasNext({ page_num: 9 }, { meta: { nextpage: -1 } })).toBe(false);
  });

  it("pm.get_sessions：has_more=0 显式终止（无无限翻页）", () => {
    const strategy = MODULE_PAGERS["pm.get_sessions"]();
    const response = { has_more: 0, sessions: [{ session_id: "s", sort_time: 1 }] };
    expect(strategy.hasNext({}, response)).toBe(false);
    expect(MODULE_PAGERS["pm.get_messages"]().hasNext({}, { has_more: 0, messages: [{ id: "m" }] })).toBe(false);
  });

  it("评论 continuation 预设：PageNum+1 与 LastCommentSeqNo 回写", () => {
    const strategy = MODULE_PAGERS["comment.get_hot_comments"]();
    const response = { CommentList: { HasMore: 1, Comments: [{ SeqNo: "s1" }, { SeqNo: "s2" }] } };
    expect(strategy.hasNext({ PageNum: 0 }, response)).toBe(true);
    expect(strategy.nextParams({ PageNum: 0, LastCommentSeqNo: "" }, response)).toEqual({
      PageNum: 1,
      LastCommentSeqNo: "s2",
    });
    expect(strategy.hasNext({ PageNum: 0 }, { CommentList: { HasMore: 0, Comments: [] } })).toBe(false);
  });

  it("user.get_dislike_list 预设：三类 lastid 回写", () => {
    const strategy = MODULE_PAGERS["user.get_dislike_list"]();
    const response = { Singers: [{ ID: "a" }], Songs: [{ ID: "b" }], Styles: [] };
    expect(strategy.nextParams({ Cmd: 3, Page: 1 }, response)).toEqual({
      Cmd: 3,
      Page: 2,
      SingersLastid: "a",
      SongLastid: "b",
    });
    expect(strategy.hasNext({}, { Singers: [], Songs: [], Styles: [] })).toBe(false);
  });
});

describe("parseCgiResponse", () => {
  it("外层 code != 0 抛 GlobalApiError", () => {
    try {
      parseCgiResponse({ code: 1001, req_0: { code: 0, data: {} } }, {});
      throw new Error("should not reach");
    } catch (err) {
      expect(err).toBeInstanceOf(GlobalApiError);
      expect((err as GlobalApiError).code).toBe(1001);
    }
  });

  it("expectedCount 缺失 req_N 时抛 ApiDataError", () => {
    expect(() => parseCgiResponse({ req_0: { code: 0, data: 1 } }, {}, 2)).toThrow(/缺少预期的子响应.*req_1/);
  });

  it("逐请求 allowErrorCodes 独立生效", () => {
    const [a, b] = parseCgiResponse(
      { req_0: { code: 20277, data: "x" }, req_1: { code: 0, data: "y" } },
      [{ allowErrorCodes: [20277], parseOnAllow: false }, {}],
      2,
    );
    expect(a).toEqual({ code: 20277, data: "x" });
    expect(b).toBe("y");
  });
});

describe("gather 批量合并", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch as typeof fetch;
  });

  it("同组 CGI 合并为 req_0..req_N 单次调用，结果按输入顺序返回", async () => {
    let capturedBody: any;
    globalThis.fetch = (async (_url: any, init: any) => {
      capturedBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify({ req_0: { code: 0, data: { v: 1 } }, req_1: { code: 0, data: { v: 2 } }, req_2: { code: 0, data: { v: 3 } } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const client = new QQClient({ platform: "web" });
    const requests: GatherRequest[] = [
      { kind: "cgi", module: "m1", method: "a", param: { x: 1 } },
      { kind: "cgi", module: "m1", method: "b", param: { x: 2 } },
      { kind: "cgi", module: "m1", method: "c", param: { x: 3 } },
    ];
    const results = await client.gather<{ v: number }>(requests);
    expect(results).toEqual([{ v: 1 }, { v: 2 }, { v: 3 }]);
    expect(Object.keys(capturedBody).filter((k) => k.startsWith("req_"))).toEqual(["req_0", "req_1", "req_2"]);
    expect(capturedBody.req_1).toEqual({ module: "m1", method: "b", param: { x: 2 } });
  });

  it("requireLogin 缺凭证：returnExceptions 收集异常而不抛出", async () => {
    /* 显式空凭证：不依赖全局库状态（credential:null 会落构造函数 ?? 兜底读 SQLite，
       全局凭证有效时本用例会翻转为 CgiApiError 并发起真实网络请求） */
    const client = new QQClient({ platform: "web", credential: emptyCredential() });
    const results = await client.gather(
      [{ kind: "cgi", module: "m", method: "x", param: {}, options: { requireLogin: true } }],
      { returnExceptions: true },
    );
    expect((results[0] as Error).name).toBe("CredentialInvalidError");
  });
});

describe("credential is_expired 边界", () => {
  it("时间字段缺失视为已过期（对齐 Python now >= 0 恒真语义）", () => {
    expect(isCredentialExpired(emptyCredential())).toBe(true);
    const future = { ...emptyCredential(), musickeyCreateTime: Math.floor(Date.now() / 1000), keyExpiresIn: 3600 };
    expect(isCredentialExpired(future)).toBe(false);
    const past = { ...emptyCredential(), musickeyCreateTime: 1, keyExpiresIn: 1 };
    expect(isCredentialExpired(past)).toBe(true);
  });
});

describe("歌词自动解密", () => {
  it("解密失败保留原值（对齐 suppress 语义）；raw=true 跳过解密", async () => {
    const fakeClient = {
      invoke: vi.fn(async () => ({ lyric: "plain-not-hex", trans: "", roma: "" })),
    } as unknown as QQClient;
    const decrypted = (await getLyric(fakeClient, 123, { qrc: true })) as any;
    expect(decrypted.lyric).toBe("plain-not-hex");

    const raw = (await getLyric(fakeClient, 123, { raw: true })) as any;
    expect(raw.lyric).toBe("plain-not-hex");
  });

  it("多风格翻译 lyrics[*].lyric 尝试解密", async () => {
    const fakeClient = {
      invoke: vi.fn(async () => ({ lyrics: [{ styleName: "s", lyric: "xx" }, { styleName: "t" }] })),
    } as unknown as QQClient;
    const result = (await getMultiStyleTransLyric(fakeClient, 1)) as any;
    expect(result.lyrics[0].lyric).toBe("xx"); // 非 hex 密文保留原值
    expect(result.lyrics[1].styleName).toBe("t");
  });
});

describe("raw() 同名多域 Set-Cookie 解析（扫码登录 check_sig p_skey 回归）", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch as typeof fetch;
  });

  /** 用多条 set-cookie 头构造响应并跑 raw() */
  async function rawWith(setCookieLines: string[]): Promise<Record<string, string>> {
    globalThis.fetch = (async () =>
      new Response("", {
        status: 302,
        headers: setCookieLines.map((v) => ["set-cookie", v]) as [string, string][],
      })) as typeof fetch;
    const client = new QQClient({ platform: "web" });
    const res = await client.raw({ method: "GET", url: "https://example.com/" });
    return res.cookies;
  }

  it("有效值在前、空值删除指令在后（QQ check_sig 实测顺序）：保留有效值", async () => {
    const cookies = await rawWith([
      "p_uin=o123;Path=/;Domain=graph.qq.com",
      "p_skey=VALID;Path=/;Domain=graph.qq.com;Secure",
      "p_uin=;Expires=Thu, 01 Jan 1970 00:00:00 GMT;Path=/;Domain=qq.com",
      "p_skey=;Expires=Thu, 01 Jan 1970 00:00:00 GMT;Path=/;Domain=qq.com",
    ]);
    expect(cookies.p_skey).toBe("VALID");
    expect(cookies.p_uin).toBe("o123");
  });

  it("删除指令在前、有效值在后（QQ check_sig 的 pt2gguin 顺序）：保留有效值", async () => {
    const cookies = await rawWith([
      "pt2gguin=;Expires=Thu, 01 Jan 1970 00:00:00 GMT;Path=/;Domain=qq.com",
      "pt2gguin=o123;Expires=Tue, 19 Jan 2038 03:14:07 GMT;Path=/;Domain=ptlogin2.qq.com;Secure",
    ]);
    expect(cookies.pt2gguin).toBe("o123");
  });

  it("仅有删除指令时保留空值（清除语义不变）；不同名互不影响", async () => {
    const cookies = await rawWith(["a=1;Path=/", "b=;Expires=Thu, 01 Jan 1970 00:00:00 GMT;Path=/"]);
    expect(cookies.a).toBe("1");
    expect(cookies.b).toBe("");
  });
});

describe("getStreamUrl 音质偏好（QQ 阶梯截断）", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch as typeof fetch;
  });

  /** mock musicu.fcg：捕获请求的 filename 档位，逐档返回 purl（unavailable 前缀档位返回空 purl 模拟不可用） */
  function mockVkey(unavailablePrefixes: string[] = []) {
    let capturedFilenames: string[] = [];
    globalThis.fetch = (async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      capturedFilenames = (body.req_0?.param?.filename ?? []) as string[];
      return new Response(
        JSON.stringify({
          req_0: {
            code: 0,
            data: {
              midurlinfo: capturedFilenames.map((f) => ({
                filename: f,
                purl: unavailablePrefixes.some((p) => f.startsWith(p)) ? "" : `purl-${f.slice(0, 4)}`,
              })),
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
    return () => capturedFilenames;
  }

  it("默认（best/不传）：非 VIP 请求 320+128 两档，取 320 优先", async () => {
    const cap = mockVkey();
    const url = await qq.getStreamUrl({ ...baseSong() });
    expect(cap().map((f) => f.slice(0, 4))).toEqual(["M800", "M500"]);
    expect(url).toContain("purl-M800");
  });

  it("standard：仅请求 128k 档", async () => {
    const cap = mockVkey();
    const url = await qq.getStreamUrl({ ...baseSong() }, "standard");
    expect(cap().map((f) => f.slice(0, 4))).toEqual(["M500"]);
    expect(url).toContain("purl-M500");
  });

  it("high：请求 320+128 档（不可用自动降级到 128）", async () => {
    /* mock：M800 无 purl（该档不可用）→ 应回落到 M500 */
    const cap = mockVkey(["M800"]);
    const url = await qq.getStreamUrl({ ...baseSong() }, "high");
    expect(cap().map((f) => f.slice(0, 4))).toEqual(["M800", "M500"]);
    expect(url).toContain("purl-M500");
  });

  function baseSong() {
    return {
      source: "qq",
      id: "004YZbkL2MNHoY",
      name: "t",
      artist: "a",
      album: "",
      duration: 1,
      size: 0,
      bitrate: 0,
      cover: "",
      link: "",
    } as Song;
  }
});
