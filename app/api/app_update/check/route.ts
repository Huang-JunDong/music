import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_GITHUB_PROXY_URL, DEFAULT_UPDATE_REPO_URL, getWebSettings } from "@/lib/store";
import { formatSizeMB } from "@/lib/web-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_REQUEST_TIMEOUT = 5_000;
const APP_VERSION = "1.1.0";

interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
  content_type: string;
}

interface GitHubRelease {
  tag_name: string;
  name: string;
  html_url: string;
  body: string;
  assets: GitHubAsset[];
}

interface UpdateAsset {
  name: string;
  url: string;
  proxied_url: string;
  size: number;
  size_text: string;
  content_type: string;
  preferred: boolean;
}

function proxiedGitHubURL(rawURL: string, proxyURL: string, enabled: boolean): string {
  rawURL = (rawURL ?? "").trim();
  proxyURL = (proxyURL ?? "").trim();
  if (!enabled || !rawURL || !proxyURL) return rawURL;
  return `${proxyURL.replace(/\/+$/, "")}/${rawURL}`;
}

function githubRepoFromURL(raw: string): { owner: string; repo: string } {
  let text = (raw ?? "").trim();
  if (!text) text = DEFAULT_UPDATE_REPO_URL;
  if (!text.includes("://")) text = `https://github.com/${text.replace(/^github\.com\//, "")}`;
  const parsed = new URL(text);
  const host = parsed.host.toLowerCase().replace(/^www\./, "");
  if (host !== "github.com") {
    throw new Error(`only github.com repository links are supported: ${text}`);
  }
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error(`invalid GitHub repository link: ${text}`);
  const owner = parts[0].trim();
  const repo = parts[1].trim().replace(/\.git$/, "");
  if (!owner || !repo) throw new Error(`invalid GitHub repository link: ${text}`);
  return { owner, repo };
}

async function requestGitHubRelease(apiURL: string): Promise<GitHubRelease> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GITHUB_REQUEST_TIMEOUT);
  try {
    const resp = await fetch(apiURL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `go-music-dl/${APP_VERSION}`,
      },
      signal: controller.signal,
      cache: "no-store",
    });
    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`GitHub returned ${resp.status} ${resp.statusText}`);
    }
    const release = (await resp.json()) as GitHubRelease;
    if (!(release.tag_name ?? "").trim() && !(release.name ?? "").trim()) {
      throw new Error("GitHub release response missing version");
    }
    return release;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLatestGitHubRelease(
  owner: string,
  repo: string,
  proxyEnabled: boolean,
  proxyURL: string,
): Promise<GitHubRelease> {
  const apiURL = `${GITHUB_API_BASE}/repos/${owner}/${repo}/releases/latest`;
  const proxied = proxiedGitHubURL(apiURL, proxyURL, proxyEnabled);
  if (proxyEnabled && proxyURL.trim() && proxied && proxied !== apiURL) {
    // 代理与直连并发竞速，先成功者胜
    return Promise.any([requestGitHubRelease(proxied), requestGitHubRelease(apiURL)]).catch(
      (err: AggregateError) => {
        throw new Error(err.errors?.[0]?.message ?? "GitHub release request failed");
      },
    );
  }
  return requestGitHubRelease(apiURL);
}

function normalizeVersion(raw: string): string {
  let text = (raw ?? "").trim();
  text = text.replace(/^refs\/tags\//, "");
  text = text.replace(/^[vV]/, "");
  let out = "";
  for (const ch of text) {
    if ((ch >= "0" && ch <= "9") || ch === "." || ch === "-" || ch === "_") out += ch;
    else break;
  }
  return out.replace(/^[._-]+|[._-]+$/g, "");
}

function versionNumberParts(version: string): number[] {
  const normalized = normalizeVersion(version);
  if (!normalized) return [0];
  const fields = normalized.split(/[._-]/).filter(Boolean);
  const parts = fields.map((f) => {
    const n = parseInt(f, 10);
    return Number.isNaN(n) ? 0 : n;
  });
  return parts.length ? parts : [0];
}

function compareVersions(a: string, b: string): number {
  const ap = versionNumberParts(a);
  const bp = versionNumberParts(b);
  const maxLen = Math.max(ap.length, bp.length);
  for (let i = 0; i < maxLen; i++) {
    const av = ap[i] ?? 0;
    const bv = bp[i] ?? 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

const ARCHIVE_EXTS = new Set([
  ".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar",
  ".dmg", ".pkg", ".msi", ".deb", ".rpm", ".apk",
]);

function isUpdateArchiveExt(ext: string): boolean {
  return ARCHIVE_EXTS.has(ext.toLowerCase());
}

function osKeys(): string[] {
  // Go runtime.GOOS：windows / darwin(mac) / linux；Node win32/darwin/linux
  const platform = process.platform;
  const goOS = platform === "win32" ? "windows" : platform;
  return platform === "darwin" ? ["darwin", "mac"] : [goOS, platform];
}

function archKeys(): string[] {
  // Go amd64 → x64（Node 的 process.arch 在 x86_64 上为 "x64"）
  return process.arch === "x64" ? ["x64", "amd64"] : [process.arch];
}

function updateAssetPreferenceScore(name: string): number {
  name = name.toLowerCase();
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot) : "";
  let score = 0;

  const osList = osKeys();
  if (osList.some((k) => name.includes(k))) score += 40;
  const archList = archKeys();
  if (archList.some((k) => name.includes(k))) score += 20;

  const isWindows = process.platform === "win32";
  if (isWindows && ext === ".exe") score += 30;
  if (!isWindows && !isUpdateArchiveExt(ext)) score += 15;
  if (isUpdateArchiveExt(ext)) score -= 10;
  return score;
}

function preferredUpdateAssetIndex(assets: GitHubAsset[]): number {
  if (!assets.length) return -1;
  let bestIndex = 0;
  let bestScore = updateAssetPreferenceScore(assets[0].name);
  for (let i = 1; i < assets.length; i++) {
    const score = updateAssetPreferenceScore(assets[i].name);
    if (score > bestScore) {
      bestIndex = i;
      bestScore = score;
    }
  }
  if (bestScore > 0) return bestIndex;

  const osList = osKeys();
  const archList = archKeys();
  for (let i = 0; i < assets.length; i++) {
    const name = assets[i].name.toLowerCase();
    if (osList.some((k) => name.includes(k)) && archList.some((k) => name.includes(k))) return i;
  }
  for (let i = 0; i < assets.length; i++) {
    const name = assets[i].name.toLowerCase();
    if (osList.some((k) => name.includes(k))) return i;
  }
  return 0;
}

/** GET /api/app_update/check?repo=&proxy=&use_proxy= — GitHub latest release 检查 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const settings = getWebSettings();
  const repoURL = (params.get("repo") ?? "").trim() || settings.updateRepoUrl;
  const proxyURL = (params.get("proxy") ?? "").trim() || settings.githubProxyUrl || DEFAULT_GITHUB_PROXY_URL;
  let proxyEnabled = settings.githubProxyEnabled;
  const rawUseProxy = (params.get("use_proxy") ?? "").trim();
  if (rawUseProxy) proxyEnabled = rawUseProxy === "1" || rawUseProxy.toLowerCase() === "true";

  let owner: string;
  let repo: string;
  try {
    ({ owner, repo } = githubRepoFromURL(repoURL));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  let release: GitHubRelease;
  try {
    release = await fetchLatestGitHubRelease(owner, repo, proxyEnabled, proxyURL);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  let latest = normalizeVersion(release.tag_name ?? "");
  if (!latest) latest = normalizeVersion(release.name ?? "");
  const current = normalizeVersion(APP_VERSION);
  const updateAvailable = compareVersions(latest, current) > 0;

  const preferredIndex = preferredUpdateAssetIndex(release.assets ?? []);
  const assets: UpdateAsset[] = (release.assets ?? []).map((asset, index) => ({
    name: asset.name,
    url: (asset.browser_download_url ?? "").trim(),
    proxied_url: proxiedGitHubURL((asset.browser_download_url ?? "").trim(), proxyURL, proxyEnabled),
    size: asset.size,
    size_text: formatSizeMB(asset.size),
    content_type: asset.content_type,
    preferred: index === preferredIndex,
  }));

  let downloadURL = (release.html_url ?? "").trim();
  const preferred = assets[preferredIndex];
  if (preferred?.url) downloadURL = preferred.url;

  return NextResponse.json({
    current_version: current,
    latest_version: latest,
    update_available: updateAvailable,
    release_name: (release.name ?? "").trim(),
    release_url: (release.html_url ?? "").trim(),
    download_url: downloadURL,
    proxied_url: proxiedGitHubURL(downloadURL, proxyURL, proxyEnabled),
    repo_url: `https://github.com/${owner}/${repo}`,
    proxy_enabled: proxyEnabled,
    proxy_url: proxyURL,
    assets,
    body: (release.body ?? "").trim(),
    checked_at: new Date().toISOString(),
  });
}
