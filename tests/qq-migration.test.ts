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
    const client = new QQClient({ platform: "web", credential: null });
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
