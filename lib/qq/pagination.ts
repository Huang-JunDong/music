/**
 * 分页与换一批策略框架 — 完整移植自 .ref/QQMusicApi qqmusic_api/core/pagination.py。
 *
 * 5 种策略：PageStrategy（页码）/ OffsetStrategy（偏移窗口）/ CursorStrategy（游标回写）/
 * BatchRefreshStrategy（换一批）/ MultiFieldContinuationStrategy（多字段 continuation）。
 * AsyncPager 为有状态分页器；paginatedCgi() 构造可翻页请求（对齐 PaginatedCgiRequest）；
 * MODULE_PAGERS 收录参考仓库全部 31 个带 pager_strategy 的接口预设（extractor 基于上游原始字段）。
 */
import type { QQClient } from "./client";
import type { CgiInvokeOptions } from "./types";

export type PaginationParams = Record<string, any>;
export type NextParamsBuilder<T> = (params: PaginationParams, response: T) => PaginationParams | null;

export interface PagerStrategy<T = any> {
  /** 判断是否还能继续迭代 */
  hasNext(params: PaginationParams, response: T): boolean;
  /** 计算并返回下一次请求使用的全新参数字典 */
  nextParams(params: PaginationParams, response: T): PaginationParams;
}

const deepCopy = (params: PaginationParams): PaginationParams => structuredClone(params);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/* ---------------- PageStrategy 页码策略 ---------------- */

export interface PageStrategyOptions<T> {
  hasMoreExtractor?: (response: T) => boolean | null | undefined;
  totalExtractor?: (response: T) => number | null | undefined;
  countExtractor?: (response: T) => number | null | undefined;
  pageSize?: number;
  startPage?: number;
}

export class PageStrategy<T = any> implements PagerStrategy<T> {
  constructor(
    public readonly pageKey: string,
    private readonly opts: PageStrategyOptions<T> = {},
  ) {}

  hasNext(params: PaginationParams, response: T): boolean {
    const explicit = this.opts.hasMoreExtractor?.(response);
    if (explicit !== undefined && explicit !== null) return explicit;

    if (this.opts.totalExtractor && this.opts.pageSize != null) {
      const total = this.opts.totalExtractor(response);
      if (total !== null && total !== undefined) {
        const currentPage = params[this.pageKey] ?? this.opts.startPage ?? 1;
        if (!isInt(currentPage)) throw new TypeError("分页请求缺少有效的页码参数, 无法判断是否存在下一页");
        const consumedPages = currentPage - (this.opts.startPage ?? 1) + 1;
        return consumedPages * this.opts.pageSize < total;
      }
    }

    if (this.opts.countExtractor) {
      const count = this.opts.countExtractor(response);
      if (count !== null && count !== undefined) {
        if (this.opts.pageSize != null) return count >= this.opts.pageSize && count > 0;
        return count > 0;
      }
    }
    return false;
  }

  nextParams(params: PaginationParams, _response?: T): PaginationParams {
    const newParams = deepCopy(params);
    const currentPage = newParams[this.pageKey] ?? this.opts.startPage ?? 1;
    if (!isInt(currentPage)) throw new TypeError("分页请求缺少有效的页码参数, 无法计算下一页");
    newParams[this.pageKey] = currentPage + 1;
    return newParams;
  }
}

/* ---------------- OffsetStrategy 偏移量策略 ---------------- */

export interface OffsetStrategyOptions<T> {
  pageSizeKey?: string;
  pageSize?: number;
  startOffset?: number;
  hasMoreExtractor?: (response: T) => boolean | null | undefined;
  totalExtractor?: (response: T) => number | null | undefined;
  countExtractor?: (response: T) => number | null | undefined;
}

export class OffsetStrategy<T = any> implements PagerStrategy<T> {
  constructor(
    public readonly offsetKey: string,
    private readonly opts: OffsetStrategyOptions<T> = {},
  ) {
    if (opts.pageSizeKey == null && opts.pageSize == null) {
      throw new Error("OffsetStrategy 需要 page_size_key 或 page_size");
    }
  }

  private resolvePageSize(params: PaginationParams): number {
    if (this.opts.pageSize != null) return this.opts.pageSize;
    const size = params[this.opts.pageSizeKey!];
    if (!isInt(size)) throw new TypeError("分页请求缺少有效的 page_size 参数, 无法计算下一页偏移量");
    return size;
  }

  private resolveStep(params: PaginationParams, response: T): number {
    const count = this.opts.countExtractor?.(response);
    if (count !== null && count !== undefined) return count;
    return this.resolvePageSize(params);
  }

  hasNext(params: PaginationParams, response: T): boolean {
    const explicit = this.opts.hasMoreExtractor?.(response);
    if (explicit !== undefined && explicit !== null) return explicit;

    if (this.opts.totalExtractor) {
      const total = this.opts.totalExtractor(response);
      if (total !== null && total !== undefined) {
        const currentOffset = params[this.offsetKey] ?? this.opts.startOffset ?? 0;
        if (currentOffset == null) throw new Error("分页请求缺少有效的 offset 参数, 无法计算下一页");
        const step = this.resolveStep(params, response);
        if (step <= 0) return false;
        return currentOffset + step < total;
      }
    }

    if (this.opts.countExtractor) {
      const count = this.opts.countExtractor(response);
      if (count !== null && count !== undefined) {
        const pageSize = this.resolvePageSize(params);
        return count >= pageSize && count > 0;
      }
    }
    return false;
  }

  nextParams(params: PaginationParams, response: T): PaginationParams {
    const newParams = deepCopy(params);
    const currentOffset = newParams[this.offsetKey] ?? this.opts.startOffset ?? 0;
    if (currentOffset == null) throw new Error("分页请求缺少有效的 offset 参数, 无法计算下一页");
    const step = this.resolveStep(params, response);
    if (step <= 0) throw new Error("分页响应未提供有效的当前页数量, 无法计算下一页偏移量");
    newParams[this.offsetKey] = currentOffset + step;
    return newParams;
  }
}

/* ---------------- CursorStrategy 游标策略 ---------------- */

export interface CursorStrategyOptions<T> {
  cursorExtractor: (response: T) => unknown;
  hasMoreExtractor?: (response: T) => boolean | null | undefined;
  countExtractor?: (response: T) => number | null | undefined;
  pageSize?: number;
}

export class CursorStrategy<T = any> implements PagerStrategy<T> {
  constructor(
    public readonly cursorKey: string,
    private readonly opts: CursorStrategyOptions<T>,
  ) {}

  protected extractCursor(response: T): unknown {
    const cursor = this.opts.cursorExtractor(response);
    if (cursor === null || cursor === undefined) {
      throw new Error(`分页响应未提供下一页参数: ${this.cursorKey}`);
    }
    return cursor;
  }

  protected isTerminated(response: T): boolean {
    const explicit = this.opts.hasMoreExtractor?.(response);
    if (explicit !== undefined && explicit !== null) return !explicit;

    const count = this.opts.countExtractor?.(response);
    if (count !== null && count !== undefined) {
      if (this.opts.pageSize != null && count < this.opts.pageSize) return true;
      if (count === 0) return true;
    }
    return false;
  }

  hasNext(params: PaginationParams, response: T): boolean {
    if (this.isTerminated(response)) return false;
    try {
      return params[this.cursorKey] !== this.extractCursor(response);
    } catch {
      return false;
    }
  }

  nextParams(params: PaginationParams, response: T): PaginationParams {
    const newParams = deepCopy(params);
    newParams[this.cursorKey] = this.extractCursor(response);
    return newParams;
  }
}

/* ---------------- BatchRefreshStrategy 换一批策略 ---------------- */

export class BatchRefreshStrategy<T = any> extends CursorStrategy<T> {
  private readonly allowRepeat: boolean;

  constructor(
    refreshKey: string,
    opts: CursorStrategyOptions<T> & { allowRepeat?: boolean } = {} as CursorStrategyOptions<T>,
  ) {
    super(refreshKey, opts);
    this.allowRepeat = opts.allowRepeat ?? false;
  }

  hasNext(params: PaginationParams, response: T): boolean {
    if (this.isTerminated(response)) return false;
    if (this.allowRepeat) {
      try {
        this.extractCursor(response);
        return true;
      } catch {
        return false;
      }
    }
    return super.hasNext(params, response);
  }
}

/* ---------------- MultiFieldContinuationStrategy 多字段延续策略 ---------------- */

export class MultiFieldContinuationStrategy<T = any> implements PagerStrategy<T> {
  constructor(
    private readonly buildNext: NextParamsBuilder<T>,
    private readonly opts: {
      hasMoreExtractor?: (response: T) => boolean | null | undefined;
      countExtractor?: (response: T) => number | null | undefined;
      pageSize?: number;
      contextName?: string;
    } = {},
  ) {}

  private buildCandidate(params: PaginationParams, response: T): PaginationParams | null {
    return this.buildNext(deepCopy(params), response);
  }

  hasNext(params: PaginationParams, response: T): boolean {
    const explicit = this.opts.hasMoreExtractor?.(response);
    if (explicit !== undefined && explicit !== null && !explicit) return false;

    const count = this.opts.countExtractor?.(response);
    if (count !== null && count !== undefined) {
      if ((this.opts.pageSize != null && count < this.opts.pageSize) || count === 0) return false;
    }
    return this.buildCandidate(params, response) !== null;
  }

  nextParams(params: PaginationParams, response: T): PaginationParams {
    const next = this.buildCandidate(params, response);
    if (next === null) {
      throw new Error(`[${this.opts.contextName ?? "continuation"}] 分页响应未提供继续翻页所需的 continuation 数据`);
    }
    return next;
  }
}

/* ---------------- 可翻页请求与 AsyncPager ---------------- */

export interface PaginatedRequest<T = any> {
  readonly strategy: PagerStrategy<T>;
  readonly params: PaginationParams;
  execute(params: PaginationParams): Promise<T>;
  nextRequest(previousResponse: T): PaginatedRequest<T> | null;
  withExtractor<I>(itemsExtractor: (response: T) => Iterable<I> | null | undefined): ItemPaginatedRequest<T, I>;
  pager(limit?: number): AsyncPager<T>;
  collect(limit?: number): Promise<T[]>;
  paginate(limit?: number): AsyncGenerator<T, void, undefined>;
}

export interface ItemPaginatedRequest<T = any, I = any> extends PaginatedRequest<T> {
  readonly itemsExtractor: (response: T) => Iterable<I> | null | undefined;
  iterItems(limit?: number): AsyncGenerator<I, void, undefined>;
  collectItems(limit?: number): Promise<I[]>;
}

/** 有状态异步分页器（对齐 AsyncPager：first/next/hasMore + async iterator） */
export class AsyncPager<T = any> {
  private currentRequest: PaginatedRequest<T> | null;
  private yieldedCount = 0;
  private hasMore = true;
  private firstResponse: T | null = null;
  private lastResponse: T | null = null;

  constructor(
    initialRequest: PaginatedRequest<T>,
    private readonly limit?: number,
  ) {
    this.currentRequest = initialRequest;
  }

  hasMorePages(): boolean {
    if (this.limit != null && this.yieldedCount >= this.limit) return false;
    if (this.yieldedCount === 0) return true;
    return this.hasMore && this.currentRequest !== null;
  }

  async first(): Promise<T> {
    if (this.firstResponse !== null) return this.firstResponse;
    if (!this.hasMorePages()) throw new StopAsyncIterationError();
    const res = await this.currentRequest!.execute(this.currentRequest!.params);
    this.firstResponse = res;
    if (this.yieldedCount === 0) {
      this.yieldedCount = 1;
      this.lastResponse = res;
      this.currentRequest = this.currentRequest!.nextRequest(res);
      if (this.currentRequest === null) this.hasMore = false;
    }
    return res;
  }

  async next(): Promise<T> {
    if (!this.hasMorePages() || this.currentRequest === null) throw new StopAsyncIterationError();
    const req = this.currentRequest;
    const response = await req.execute(req.params);
    if (this.firstResponse === null) this.firstResponse = response;
    this.lastResponse = response;
    this.yieldedCount += 1;
    this.currentRequest = req.nextRequest(response);
    if (this.currentRequest === null) this.hasMore = false;
    return response;
  }

  [Symbol.asyncIterator](): AsyncGenerator<T, void, undefined> {
    return (async function* (pager: AsyncPager<T>) {
      try {
        yield await pager.first();
      } catch (err) {
        if (err instanceof StopAsyncIterationError) return;
        throw err;
      }
      while (pager.hasMorePages()) {
        try {
          yield await pager.next();
        } catch (err) {
          if (err instanceof StopAsyncIterationError) return;
          throw err;
        }
      }
    })(this);
  }
}

/** 迭代终止信号（对齐 StopAsyncIteration） */
export class StopAsyncIterationError extends Error {
  constructor() {
    super("stop async iteration");
    this.name = "StopAsyncIteration";
  }
}

class PaginatedCgiRequestImpl<T> implements PaginatedRequest<T> {
  constructor(
    private readonly client: QQClient,
    private readonly spec: { module: string; method: string; param: PaginationParams; options?: CgiInvokeOptions },
    public readonly strategy: PagerStrategy<T>,
  ) {}

  get params(): PaginationParams {
    return this.spec.param;
  }

  execute(params: PaginationParams): Promise<T> {
    return this.client.invoke<T>(this.spec.module, this.spec.method, params, this.spec.options);
  }

  nextRequest(previousResponse: T): PaginatedRequest<T> | null {
    if (this.strategy.hasNext(this.spec.param, previousResponse)) {
      const nextParam = this.strategy.nextParams(this.spec.param, previousResponse);
      return new PaginatedCgiRequestImpl<T>(this.client, { ...this.spec, param: nextParam }, this.strategy);
    }
    return null;
  }

  withExtractor<I>(itemsExtractor: (response: T) => Iterable<I> | null | undefined): ItemPaginatedRequest<T, I> {
    return new ItemPaginatedCgiRequestImpl<T, I>(this, itemsExtractor);
  }

  pager(limit?: number): AsyncPager<T> {
    return new AsyncPager<T>(this, limit);
  }

  async collect(limit?: number): Promise<T[]> {
    const pages: T[] = [];
    for await (const page of this.paginate(limit)) pages.push(page);
    return pages;
  }

  async *paginate(limit?: number): AsyncGenerator<T, void, undefined> {
    yield* this.pager(limit)[Symbol.asyncIterator]();
  }
}

class ItemPaginatedCgiRequestImpl<T, I> implements ItemPaginatedRequest<T, I> {
  constructor(
    private readonly base: PaginatedRequest<T>,
    readonly itemsExtractor: (response: T) => Iterable<I> | null | undefined,
  ) {}

  get strategy(): PagerStrategy<T> {
    return this.base.strategy;
  }

  get params(): PaginationParams {
    return this.base.params;
  }

  execute(params: PaginationParams): Promise<T> {
    return this.base.execute(params);
  }

  nextRequest(previousResponse: T): PaginatedRequest<T> | null {
    return this.base.nextRequest(previousResponse);
  }

  withExtractor<J>(itemsExtractor: (response: T) => Iterable<J> | null | undefined): ItemPaginatedRequest<T, J> {
    return new ItemPaginatedCgiRequestImpl<T, J>(this.base, itemsExtractor);
  }

  pager(limit?: number): AsyncPager<T> {
    return this.base.pager(limit);
  }

  async collect(limit?: number): Promise<T[]> {
    return this.base.collect(limit);
  }

  async *paginate(limit?: number): AsyncGenerator<T, void, undefined> {
    yield* this.base.paginate(limit);
  }

  /** 跨页展开提取数据项（对齐 ItemPaginatedMixin.iter_items） */
  async *iterItems(limit?: number): AsyncGenerator<I, void, undefined> {
    if (limit != null && limit <= 0) return;
    let totalYielded = 0;
    for await (const response of this.base.paginate()) {
      const items = this.itemsExtractor(response);
      if (items === null || items === undefined) continue;
      for (const item of items) {
        if (limit != null && totalYielded >= limit) return;
        yield item;
        totalYielded += 1;
      }
    }
  }

  async collectItems(limit?: number): Promise<I[]> {
    const items: I[] = [];
    for await (const item of this.iterItems(limit)) items.push(item);
    return items;
  }
}

/** 构造可翻页的 CGI 请求（对齐 PaginatedCgiRequest） */
export function paginatedCgi<T = any>(
  client: QQClient,
  spec: { module: string; method: string; param: PaginationParams; options?: CgiInvokeOptions },
  strategy: PagerStrategy<T>,
): PaginatedRequest<T> {
  return new PaginatedCgiRequestImpl<T>(client, spec, strategy);
}

/* ---------------- 27 个接口的策略预设（对齐参考仓库各模块 pager_strategy） ----------------
 * extractor 基于上游原始响应字段（invoke 返回的 data，未经 response-map 重命名）。
 * 用法：const pager = paginatedCgi(client, {module, method, param, options}, MODULE_PAGERS["album.get_song"]());
 */

type StrategyFactory = () => PagerStrategy<any>;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const len = (v: unknown): number | null => (Array.isArray(v) ? v.length : null);
const truthy = (v: unknown): boolean | null => (v === null || v === undefined ? null : Boolean(v));
const pick = (obj: any, ...keys: string[]): unknown => {
  if (!obj || typeof obj !== "object") return undefined;
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
};

export const MODULE_PAGERS: Record<string, StrategyFactory> = {
  /* album */
  "album.get_song": () =>
    new OffsetStrategy<any>("begin", {
      pageSizeKey: "num",
      totalExtractor: (r) => num(r.totalNum),
      countExtractor: (r) => len(r.songList),
    }),
  "album.get_new_album": () =>
    new OffsetStrategy<any>("start", {
      pageSizeKey: "num",
      totalExtractor: (r) => num(r.total),
      countExtractor: (r) => len(r.albums),
    }),

  /* comment（CommentList 系列上游嵌套在 CommentList 键内） */
  ...Object.fromEntries(
    (["comment.get_hot_comments", "comment.get_new_comments", "comment.get_recommend_comments"] as const).map((id) => [
      id,
      (): PagerStrategy<any> =>
        new MultiFieldContinuationStrategy<any>(
          (params, r) => {
            const list = r?.CommentList;
            if (!list || !list.HasMore) return null;
            const comments = list.Comments ?? [];
            const cursor = comments.length > 0 ? comments[comments.length - 1].SeqNo : undefined;
            if (cursor === undefined) return null;
            return { ...params, PageNum: (params.PageNum ?? 0) + 1, LastCommentSeqNo: cursor };
          },
          { contextName: "comment_list" },
        ),
    ]),
  ),
  "comment.get_moment_comments": () =>
    new CursorStrategy<any>("LastPos", {
      hasMoreExtractor: (r) => r?.HasMore === 1, // 对齐 Python has_more == 1（恒 bool）
      cursorExtractor: (r) => r?.NextPos ?? null,
    }),

  /* private_message（上游 has_more/sessions/messages 均为 snake_case 原生字段） */
  "pm.get_sessions": () =>
    new MultiFieldContinuationStrategy<any>(
      (params, r) => {
        const sessions = r?.sessions;
        if (!Array.isArray(sessions) || sessions.length === 0) return null;
        const last = sessions[sessions.length - 1];
        return { ...params, last_id: last.session_id, last_time: last.sort_time };
      },
      { hasMoreExtractor: (r) => r?.has_more === 1, contextName: "private_message_session_list" },
    ),
  "pm.get_messages": () =>
    new MultiFieldContinuationStrategy<any>(
      (params, r) => {
        const messages = r?.messages;
        if (!Array.isArray(messages) || messages.length === 0) return null;
        return { ...params, last_id: messages[messages.length - 1].id };
      },
      { hasMoreExtractor: (r) => r?.has_more === 1, contextName: "private_message_list" },
    ),

  /* recommend */
  "recommend.get_home_feed": () =>
    new MultiFieldContinuationStrategy<any>(
      (params, r) => {
        const shelves = r?.v_shelf;
        const shelfCount = Array.isArray(shelves) ? shelves.length : 0;
        if (shelfCount === 0) return null;
        const seen = new Set<string>((params.v_cache ?? []).map(String));
        for (const shelf of shelves) {
          const shelfId = String(shelf?.id ?? "");
          if (!seen.has(shelfId)) seen.add(shelfId);
        }
        return {
          ...params,
          direction: 1,
          page: (params.page ?? 1) + 1,
          s_num: (params.s_num ?? 0) + shelfCount,
          v_cache: [...seen],
        };
      },
      { contextName: "recommend_home_feed" },
    ),
  "recommend.get_radar_recommend": () =>
    new PageStrategy<any>("Page", {
      hasMoreExtractor: (r) => truthy(r?.HasMore),
    }),
  "recommend.get_recommend_songlist": () =>
    new CursorStrategy<any>("From", {
      hasMoreExtractor: (r) => truthy(r?.HasMore),
      cursorExtractor: (r) => r?.FromLimit ?? null,
    }),

  /* search */
  "search.general_search": () =>
    new MultiFieldContinuationStrategy<any>(
      (params, r) => ({
        ...params,
        searchid: r?.meta?.sid,
        page_id: r?.meta?.nextpage,
        page_start: r?.meta?.nextpage_start,
      }),
      { hasMoreExtractor: (r) => (r?.meta?.nextpage !== -1 ? null : false), contextName: "general_search" },
    ),
  "search.search_by_type": () =>
    new PageStrategy<any>("page_num", {
      hasMoreExtractor: (r) => r?.meta?.nextpage !== -1,
      totalExtractor: (r) => num(r?.meta?.sum),
    }),

  /* singer */
  "singer.get_singer_list_index": () =>
    new MultiFieldContinuationStrategy<any>(
      (params, r) => {
        const singerlist = r?.singerlist;
        const count = Array.isArray(singerlist) ? singerlist.length : 0;
        const total = num(r?.total) ?? 0;
        if (!count || params.sin + count >= total) return null;
        return { ...params, sin: params.sin + count, cur_page: params.cur_page + 1 };
      },
      { contextName: "singer_list_index" },
    ),
  "singer.get_tab_detail": () =>
    new PageStrategy<any>("PageNum", {
      hasMoreExtractor: (r) => truthy(r?.HasMore),
    }),
  "singer.get_songs_list": () =>
    new OffsetStrategy<any>("begin", {
      pageSizeKey: "number",
      totalExtractor: (r) => num(r.totalNum),
      countExtractor: (r) => len(r.songList),
    }),
  "singer.get_album_list": () =>
    new OffsetStrategy<any>("begin", {
      pageSizeKey: "number",
      totalExtractor: (r) => num(r.total),
      countExtractor: (r) => len(r.albumList),
    }),
  "singer.get_mv_list": () =>
    new OffsetStrategy<any>("start", {
      pageSizeKey: "count",
      totalExtractor: (r) => num(r.total),
      countExtractor: (r) => len(r.list),
    }),

  /* mv 分类列表（对齐 mv.py GetAllocMvInfo 的 OffsetStrategy） */
  "mv.get_mv_list": () =>
    new OffsetStrategy<any>("start", {
      pageSizeKey: "size",
      totalExtractor: (r) => num(r.total),
      countExtractor: (r) => len(r.list),
    }),

  /* song（换一批） */
  "song.get_related_songlist": () =>
    new BatchRefreshStrategy<any>("vecPlaylist", {
      hasMoreExtractor: (r) => truthy(r?.hasMore),
      cursorExtractor: (r) => {
        const groups = r?.vecPlaylistNew;
        if (!Array.isArray(groups)) return null;
        const ids: number[] = [];
        for (const group of groups) {
          for (const playlist of group?.playlists ?? []) {
            // SongList.id alias choices("id","tid","dissid")，按序取第一个存在键
            const id = num(pick(playlist, "id", "tid", "dissid"));
            if (id !== null) ids.push(id);
          }
        }
        return ids.length > 0 ? ids : null;
      },
    }),
  "song.get_related_mv": () =>
    new BatchRefreshStrategy<any>("lastmvid", {
      hasMoreExtractor: (r) => truthy(r?.hasmore),
      cursorExtractor: (r) => {
        const list = r?.list;
        if (!Array.isArray(list) || list.length === 0) return null;
        // MV.id alias choices("id","sid","mvid","singerId")，按序取第一个存在键
        return num(pick(list[list.length - 1], "id", "sid", "mvid", "singerId")) ?? String(list[list.length - 1].id ?? "");
      },
    }),

  /* songlist / top */
  "songlist.get_detail": () =>
    new OffsetStrategy<any>("song_begin", {
      pageSizeKey: "song_num",
      hasMoreExtractor: (r) => truthy(r?.hasmore),
      totalExtractor: (r) => num(r.total_song_num),
      countExtractor: (r) => len(r.songlist),
    }),
  "top.get_detail": () =>
    new OffsetStrategy<any>("offset", {
      pageSizeKey: "num",
      // TopDetailResponse.info alias "data"、TopSummary.total_num alias "totalNum" → 上游 data.totalNum
      totalExtractor: (r) => num(r?.data?.totalNum),
      countExtractor: (r) => len(r.songInfoList),
    }),

  /* user */
  "user.get_follow_singers": userRelationPager(),
  "user.get_fans": userRelationPager(),
  "user.get_follow_user": userRelationPager(),
  "user.get_friend": () =>
    new PageStrategy<any>("Page", {
      hasMoreExtractor: (r) => truthy(r?.HasMore),
    }),
  "user.get_fav_song": () =>
    new OffsetStrategy<any>("song_begin", {
      pageSizeKey: "song_num",
      hasMoreExtractor: (r) => truthy(r?.hasmore),
      totalExtractor: (r) => num(r.total_song_num),
      countExtractor: (r) => len(r.songlist),
    }),
  "user.get_fav_songlist": () =>
    new OffsetStrategy<any>("offset", {
      pageSizeKey: "size",
      hasMoreExtractor: (r) => truthy(r?.hasmore),
      totalExtractor: (r) => num(r.total),
      countExtractor: (r) => len(r.v_list),
    }),
  "user.get_fav_album": () =>
    new OffsetStrategy<any>("offset", {
      pageSizeKey: "size",
      hasMoreExtractor: (r) => truthy(r?.hasmore),
      totalExtractor: (r) => num(r.total),
      countExtractor: (r) => len(r.v_list),
    }),
  "user.get_dislike_list": () =>
    new MultiFieldContinuationStrategy<any>((params, r) => {
      const singers = r?.Singers ?? [];
      const songs = r?.Songs ?? [];
      const styles = r?.Styles ?? [];
      if (!(singers.length || songs.length || styles.length)) return null;
      const next: PaginationParams = { ...params, Page: (params.Page ?? 1) + 1 };
      if (songs.length) next.SongLastid = songs[songs.length - 1].ID;
      if (singers.length) next.SingersLastid = singers[singers.length - 1].ID;
      if (styles.length) next.StyleLastid = styles[styles.length - 1].ID;
      return next;
    }),
};

function userRelationPager(): StrategyFactory {
  return () =>
    new OffsetStrategy<any>("From", {
      pageSizeKey: "Size",
      hasMoreExtractor: (r) => truthy(r?.HasMore),
      totalExtractor: (r) => num(r?.Total),
      countExtractor: (r) => len(r?.List),
    });
}

/** 27 接口的默认条目提取器（对齐各模块 with_extractor） */
export const MODULE_ITEM_EXTRACTORS: Record<string, (response: any) => any[]> = {
  "album.get_song": (r) => (r?.songList ?? []).map((item: any) => item?.songInfo),
  "album.get_new_album": (r) => r?.albums ?? [],
  "comment.get_hot_comments": (r) => r?.CommentList?.Comments ?? [],
  "comment.get_new_comments": (r) => r?.CommentList?.Comments ?? [],
  "comment.get_recommend_comments": (r) => r?.CommentList?.Comments ?? [],
  "comment.get_moment_comments": (r) => r?.CmList ?? [],
  "pm.get_sessions": (r) => r?.sessions ?? [],
  "pm.get_messages": (r) => r?.messages ?? [],
  "recommend.get_home_feed": (r) => r?.v_shelf ?? [],
  "recommend.get_radar_recommend": (r) => (r?.VecSongs ?? []).map((v: any) => v.Track),
  "recommend.get_recommend_songlist": (r) => (r?.List ?? []).map((v: any) => v?.Playlist?.basic),
  "search.search_by_type": (r) =>
    r?.body?.item_song || r?.body?.singer || r?.body?.item_album || r?.body?.item_songlist ||
    r?.body?.item_mv || r?.body?.item_user || r?.body?.item_audio || [],
  "singer.get_singer_list_index": (r) => r?.singerlist ?? [],
  "singer.get_songs_list": (r) => (r?.songList ?? []).map((item: any) => item?.songInfo),
  "singer.get_album_list": (r) => r?.albumList ?? [],
  "singer.get_mv_list": (r) => r?.list ?? [],
  "mv.get_mv_list": (r) => r?.list ?? [],
  "song.get_related_songlist": (r) => (r?.vecPlaylistNew ?? []).flatMap((g: any) => g?.playlists ?? []),
  "song.get_related_mv": (r) => r?.list ?? [],
  "songlist.get_detail": (r) => r?.songlist ?? [],
  "top.get_detail": (r) => r?.songInfoList ?? [],
  "user.get_follow_singers": (r) => r?.List ?? [],
  "user.get_fans": (r) => r?.List ?? [],
  "user.get_follow_user": (r) => r?.List ?? [],
  "user.get_friend": (r) => r?.Friends ?? [],
  "user.get_fav_song": (r) => r?.songlist ?? [],
  "user.get_fav_songlist": (r) => r?.v_list ?? [],
  "user.get_fav_album": (r) => r?.v_list ?? [],
};

/**
 * 一键跨页收集条目：按路由 id 的预设策略自动翻页并展开数据项。
 * fetchPage 接收完整分页参数（含翻页键），首次调用应传初始 param。
 */
export async function autoCollectItems<I = any>(
  routeId: string,
  client: QQClient,
  spec: { module: string; method: string; param: PaginationParams; options?: CgiInvokeOptions },
  limit?: number,
): Promise<I[]> {
  const strategy = MODULE_PAGERS[routeId]?.();
  if (!strategy) throw new Error(`接口 ${routeId} 未配置分页策略预设`);
  const extractor = MODULE_ITEM_EXTRACTORS[routeId];
  const request = paginatedCgi(client, spec, strategy);
  if (!extractor) {
    const pages = await request.collect(limit);
    return pages as unknown as I[];
  }
  return request.withExtractor<I>(extractor as (response: any) => I[]).collectItems(limit);
}
