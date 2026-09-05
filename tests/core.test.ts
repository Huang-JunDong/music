/**
 * 核心算法回归测试 — 覆盖第四轮 B15 修复项
 * SongKey / 文件名模板 / 签名探测 / Content-Type 表 / normalizeWebSettings / 相似度
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { songKey } from "../lib/download-record";
import { buildDownloadFilename, detectExtByContentType, audioMimeByExt } from "../lib/web-core";
import { detectExtBySignature, parseContentRangeTotal } from "../lib/range-fetch";
import { detectAudioExtBySignature, sanitizeDownloadRelativePath } from "../lib/download-flow";
import { normalizeWebSettings, defaultWebSettings } from "../lib/store";
import { CalcSongSimilarity, IsDurationClose } from "../lib/similarity";
import { responseCookies } from "../lib/http";
import { cookieToJson } from "../lib/netease/utils";

describe("songKey（Go SongKey：artist - name，保留大小写）", () => {
  it("基本拼接与空值回退 Unknown", () => {
    expect(songKey("歌名", "歌手")).toBe("歌手 - 歌名");
    expect(songKey("", "")).toBe("Unknown - Unknown");
    expect(songKey("x", "")).toBe("Unknown - x");
  });
  it("保留大小写（与旧版小写行为区分）", () => {
    expect(songKey("Song", "Artist")).toBe("Artist - Song");
  });
  it("控制字符剥离 + trim", () => {
    expect(songKey("a\u0000b", " c ")).toBe("c - ab");
  });
});

describe("buildDownloadFilename", () => {
  it("无 {ext} 模板时末尾追加扩展名（Go 默认模板）", () => {
    const out = buildDownloadFilename({ id: "1", name: "N", artist: "A", album: "", source: "netease" }, "flac", "{artist} - {name}");
    expect(out).toBe("A - N.flac");
  });
  it("含 {ext} 模板原位替换", () => {
    const out = buildDownloadFilename({ id: "1", name: "N", artist: "A", album: "AL", source: "qq" }, "mp3", "{source}/{album}/{name}.{ext}");
    expect(out).toBe("qq/AL/N.mp3");
  });
  it("目录穿越清洗：不产生独立 .. 路径段", () => {
    const out = buildDownloadFilename({ id: "1", name: "../etc/passwd", artist: "A", album: "", source: "s" }, "mp3", "{artist} - {name}.{ext}");
    // 对齐 Go：sanitize 把 / 替换掉，整体不构成多段路径，更无独立 ".." 段（段内残留子串无路径语义）
    expect(out.split(/[\\/]/).some((seg) => seg === ".." || seg === ".")).toBe(false);
    expect(out.startsWith("..")).toBe(false);
  });
  it("空模板回退 Go 默认 {artist} - {name}", () => {
    const out = buildDownloadFilename({ id: "1", name: "N", artist: "A", album: "", source: "s" }, "mp3", "  ");
    expect(out).toBe("A - N.mp3");
  });
});

describe("detectExtBySignature（Go 分支顺序与门槛）", () => {
  it("4 字节 probe：裸 mp3 frame sync 命中（≥2 字节）", () => {
    expect(detectExtBySignature(new Uint8Array([0xff, 0xfb, 0x90, 0x00]))).toBe("mp3");
  });
  it("ID3 3 字节命中", () => {
    expect(detectExtBySignature(new Uint8Array([0x49, 0x44, 0x33]))).toBe("mp3");
  });
  it("fLaC 4 字节命中", () => {
    expect(detectExtBySignature(new Uint8Array([0x66, 0x4c, 0x61, 0x43]))).toBe("flac");
  });
  it("wma 需完整 16 字节 GUID", () => {
    const wma = new Uint8Array([0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0x00, 0xaa, 0x00, 0x62, 0xce, 0x6c]);
    expect(detectExtBySignature(wma)).toBe("wma");
    expect(detectExtBySignature(wma.subarray(0, 4))).toBe("");
  });
  it("ftyp 需 ≥12 字节（4 字节 probe 不误判 m4a）", () => {
    expect(detectExtBySignature(new Uint8Array([0x00, 0x00, 0x00, 0x20]))).toBe("");
  });
  it("download-flow 版（Buffer）同步行为", () => {
    expect(detectAudioExtBySignature(Buffer.from([0xff, 0xf3, 0x40]))).toBe("mp3");
  });
});

describe("detectExtByContentType（Go 表）", () => {
  it.each([
    ["audio/flac", "flac"],
    ["audio/x-flac", "flac"],
    ["audio/x-ms-wma", "wma"],
    ["video/x-ms-asf", "wma"],
    ["application/vnd.ms-asf", "wma"],
    ["audio/mpeg", "mp3"],
    ["audio/x-mp3", "mp3"],
    ["audio/aac", "m4a"],
    ["audio/aacp", "m4a"],
    ["audio/mp4", "m4a"],
    ["application/ogg", "ogg"],
    ["audio/wav", ""],
  ])("%s → %s", (ct, ext) => {
    expect(detectExtByContentType(ct)).toBe(ext);
  });
  it("剥 ; 参数后缀", () => {
    expect(detectExtByContentType("audio/mpeg; charset=binary")).toBe("mp3");
  });
});

describe("audioMimeByExt", () => {
  it.each([
    ["wma", "audio/x-ms-wma"],
    ["flac", "audio/flac"],
    ["m4a", "audio/mp4"],
    ["mp3", "audio/mpeg"],
    ["", "audio/mpeg"],
  ])("%s → %s", (ext, mime) => {
    expect(audioMimeByExt(ext)).toBe(mime);
  });
});

describe("parseContentRangeTotal", () => {
  it("bytes 0-3/12345 → 12345", () => {
    expect(parseContentRangeTotal("bytes 0-3/12345")).toBe(12345);
  });
  it("非法/缺失 → 0", () => {
    expect(parseContentRangeTotal(null)).toBe(0);
    expect(parseContentRangeTotal("bytes 0-3/*")).toBe(0);
  });
});

describe("sanitizeDownloadRelativePath", () => {
  it("反斜杠归一 + 危险段剔除", () => {
    expect(sanitizeDownloadRelativePath("..\\..\\a/b.mp3")).toBe(path.join("a", "b.mp3"));
  });
  it("全危险段回退 download", () => {
    expect(sanitizeDownloadRelativePath("../..")).toBe("download");
  });
});

describe("normalizeWebSettings（Go normalizeWebSettings）", () => {
  it("空值回填：dir/template/webdavDir(music-dl)/repo/proxy", () => {
    const s = normalizeWebSettings({
      embedDownload: false,
      downloadToLocal: false,
      downloadDir: "",
      downloadFilenameTemplate: "",
      webdavEnabled: false,
      webdavUrl: "",
      webdavUsername: "",
      webdavPassword: "",
      webdavDir: "",
      disableFloatingLyrics: false,
      webPageSize: 0,
      cliPageSize: 0,
      downloadConcurrency: 0,
      autoCheckUpdate: false,
      autoSwitchInvalidSources: false,
      autoCacheOnPlay: false,
      updateRepoUrl: "",
      githubProxyEnabled: false,
      githubProxyUrl: "",
      vgChangeCover: false,
      vgChangeAudio: false,
      vgChangeLyric: false,
      vgExportVideo: false,
    });
    expect(s.webdavDir).toBe("music-dl");
    expect(s.downloadFilenameTemplate).toBe("{artist} - {name}");
    expect(s.webPageSize).toBe(200);
    expect(s.cliPageSize).toBe(20);
    expect(s.githubProxyUrl).toBe("https://edgeone.gh-proxy.com");
  });
  it("concurrency：≤0 先回填默认 3（Go 顺序），>5 夹紧 5", () => {
    const base = defaultWebSettings();
    expect(normalizeWebSettings({ ...base, downloadConcurrency: 999 }).downloadConcurrency).toBe(5);
    expect(normalizeWebSettings({ ...base, downloadConcurrency: -3 }).downloadConcurrency).toBe(3);
    expect(normalizeWebSettings({ ...base, downloadConcurrency: 4 }).downloadConcurrency).toBe(4);
  });
  it("webdavDir 去首尾斜杠", () => {
    expect(normalizeWebSettings({ ...defaultWebSettings(), webdavDir: "/a/b/" }).webdavDir).toBe("a/b");
  });
});

describe("相似度（Go CalcSongSimilarity/IsDurationClose 常量）", () => {
  it("完全一致 → 高分", () => {
    expect(CalcSongSimilarity("歌", "人", "歌", "人")).toBeGreaterThan(0.9);
  });
  it("完全不同 → 低分", () => {
    expect(CalcSongSimilarity("aaa", "bbb", "ccc", "ddd")).toBeLessThan(0.3);
  });
  it("IsDurationClose：±10s 或 ±15% 宽限（Go 语义）", () => {
    expect(IsDurationClose(200, 205)).toBe(true);
    expect(IsDurationClose(200, 220)).toBe(true); // diff=20 ≤ max(10, 200*0.15=30)
    expect(IsDurationClose(200, 250)).toBe(false); // diff=50 > 30
    expect(IsDurationClose(0, 999)).toBe(true);
  });
});

describe("同名多域 Set-Cookie 解析（扫码登录关键 cookie 回归）", () => {
  /** 用多条 set-cookie 头构造 Response */
  function respWith(lines: string[]): Response {
    return new Response("", {
      status: 302,
      headers: lines.map((v) => ["set-cookie", v]) as [string, string][],
    });
  }

  it("responseCookies：有效值在前、空值删除指令在后 → 保留有效值", () => {
    const cookies = responseCookies(
      respWith([
        "p_uin=o123;Path=/;Domain=graph.qq.com",
        "p_skey=VALID;Path=/;Domain=graph.qq.com;Secure",
        "p_uin=;Expires=Thu, 01 Jan 1970 00:00:00 GMT;Path=/;Domain=qq.com",
        "p_skey=;Expires=Thu, 01 Jan 1970 00:00:00 GMT;Path=/;Domain=qq.com",
      ]),
    );
    expect(cookies.p_skey).toBe("VALID");
    expect(cookies.p_uin).toBe("o123");
  });

  it("responseCookies：删除指令在前、有效值在后 → 保留有效值；仅删除时保留空值", () => {
    const cookies = responseCookies(
      respWith([
        "pt2gguin=;Expires=Thu, 01 Jan 1970 00:00:00 GMT;Path=/;Domain=qq.com",
        "pt2gguin=o123;Path=/;Domain=ptlogin2.qq.com",
        "b=;Expires=Thu, 01 Jan 1970 00:00:00 GMT;Path=/",
      ]),
    );
    expect(cookies.pt2gguin).toBe("o123");
    expect(cookies.b).toBe("");
  });

  it("cookieToJson：数组 join 串中同名空值不覆盖有效值", () => {
    expect(cookieToJson("MUSIC_U=token-abc; Path=/; _ntes_nuid=; MUSIC_U=")).toMatchObject({
      MUSIC_U: "token-abc",
      _ntes_nuid: "",
    });
  });
});
