import { NextRequest, NextResponse } from "next/server";
import { clearDownloadRecords, getDownloadRecordPage } from "@/lib/download-record";
import { requireAuth } from "@/lib/auth";
import { checkWriteGuard } from "@/lib/write-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/downloads/records?page=&page_size=&status=
 * status 可选过滤（success / skipped / failed，白名单校验）
 * 字段名对齐 Go DownloadRecord（无 json tag → 大写驼峰）：
 * ID / Name / Artist / Source / Status / Error / CreatedAt
 */
function goStyleRecord(row: {
  id: number;
  name: string;
  artist: string;
  source: string;
  status: string;
  error: string;
  created_at: string;
}) {
  return {
    ID: row.id,
    Name: row.name,
    Artist: row.artist,
    Source: row.source,
    Status: row.status,
    Error: row.error,
    CreatedAt: row.created_at,
  };
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  let page = parseInt((params.get("page") ?? "1").trim(), 10) || 1;
  let pageSize = parseInt((params.get("page_size") ?? "20").trim(), 10) || 20;
  if (page < 1) page = 1;
  if (pageSize < 1) pageSize = 20;
  if (pageSize > 100) pageSize = 100;

  /* 状态过滤（白名单；空/非法值视为不过滤） */
  const VALID_STATUS = ["success", "skipped", "failed"];
  const rawStatus = (params.get("status") ?? "").trim();
  const status = VALID_STATUS.includes(rawStatus) ? rawStatus : undefined;

  const { records, total } = getDownloadRecordPage(page, pageSize, status);
  let totalPages = 1;
  if (total > 0) totalPages = Math.ceil(total / pageSize);
  if (page > totalPages) {
    page = totalPages;
    const retry = getDownloadRecordPage(page, pageSize, status);
    return NextResponse.json({
      records: retry.records.map(goStyleRecord),
      page,
      page_size: pageSize,
      total: retry.total,
      total_pages: totalPages,
    });
  }

  return NextResponse.json({
    records: records.map(goStyleRecord),
    page,
    page_size: pageSize,
    total,
    total_pages: totalPages,
  });
}

/**
 * DELETE /api/downloads/records — 清空记录（保留去重表）
 * 权限收紧：/downloads 页匿名可访问，若 DELETE 继续免登录，任何访客都能清空全局
 * 不可撤销数据（CSRF 守卫只防跨站，不防本站未授权用户）——改为管理员才能清空；
 * MUSIC_DL_DISABLE_AUTH=1 桌面模式 requireAuth 全放行，单机行为不变。
 */
export async function DELETE(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return NextResponse.json(denied.body, { status: denied.status });
  const guarded = checkWriteGuard(req);
  if (guarded) return guarded;
  clearDownloadRecords();
  return NextResponse.json({ status: "ok" });
}
