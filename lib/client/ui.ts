"use client";

/** 前端共享 UI 工具 */
export { coverUrl, sourceMeta, qualityTag, downloadUrl, switchSourceUrl, isLocalSource } from "../play-url";
export type { SourceMeta } from "../play-url";

export function fmtTimeClient(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function fmtSizeClient(bytes: number): string {
  if (!bytes || bytes <= 0) return "";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 首页已勾选音源（对齐 Go goToRecommend ∩ 已选源：推荐/我的收藏页按交集过滤） */
const SELECTED_SOURCES_KEY = "musicdl:selected-sources";

export function setSelectedSources(sources: string[]): void {
  try {
    sessionStorage.setItem(SELECTED_SOURCES_KEY, JSON.stringify(sources));
  } catch {
    /* ignore */
  }
}

export function getSelectedSources(): string[] {
  try {
    const raw = sessionStorage.getItem(SELECTED_SOURCES_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((s) => typeof s === "string" && s) : [];
  } catch {
    return [];
  }
}
