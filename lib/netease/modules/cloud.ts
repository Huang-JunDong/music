import type { NcmQuery, NcmRequestFn } from '../types';
/* cloud.ts — 功能家族合并文件（16 个接口，由 439 个独立模块合并生成） */
/* ---------- cloud  (/cloud) ---------- */
/** 云盘上传 — 对齐 api-enhanced module/cloud.js（music-metadata 读元数据 + songUpload 插件） */

import type { NcmModule, NcmResponse } from "../types";
import { createOption } from "../option";
import { logger } from "../logger";
import songUpload from "../plugins/song-upload";
import { getFileSize, getFileMd5, getFileExtension, sanitizeFilename, cleanupTempFile, isTempFile, readFileChunk } from "../file-helper";
import axios, { default as axiosLike } from "../axios-compat";
import uploadImage from "../plugins/upload";

const cloud__handler: NcmModule = async (query: NcmQuery, request: NcmRequestFn) => {
  const mm = await import("music-metadata");

  if (!query.songFile) {
    throw { status: 500, body: { msg: "请上传音乐文件", code: 500 } } as NcmResponse;
  }
  query.songFile.name = Buffer.from(query.songFile.name, "latin1").toString("utf-8");
  const ext = getFileExtension(query.songFile.name);
  const filename = sanitizeFilename(query.songFile.name);
  const bitrate = 999000;

  const useTemp = isTempFile(query.songFile);
  let fileSize = await getFileSize(query.songFile);
  let fileMd5 = await getFileMd5(query.songFile);

  query.songFile.md5 = fileMd5;
  query.songFile.size = fileSize;

  try {
    const res = await request(
      "/api/cloud/upload/check",
      {
        bitrate: String(bitrate),
        ext: "",
        length: fileSize,
        md5: fileMd5,
        songId: "0",
        version: 1,
      },
      createOption(query),
    );

    let artist = "";
    let album = "";
    let songName = "";

    try {
      const metadata = useTemp
        ? await mm.parseFile(query.songFile.tempFilePath)
        : await mm.parseBuffer(query.songFile.data, query.songFile.mimetype);
      const info = metadata.common;
      if (info.title) songName = info.title;
      if (info.album) album = info.album;
      if (info.artist) artist = info.artist;
    } catch (error) {
      logger.info("元数据解析错误:", (error as Error).message);
    }

    const tokenRes = await request(
      "/api/nos/token/alloc",
      {
        bucket: "",
        ext,
        filename,
        local: false,
        nos_product: 3,
        type: "audio",
        md5: fileMd5,
      },
      createOption(query),
    );

    if (!tokenRes.body.result || !tokenRes.body.result.resourceId) {
      logger.error("Token分配失败:", tokenRes.body);
      throw {
        status: 500,
        body: { code: 500, msg: "获取上传token失败", detail: tokenRes.body },
      } as NcmResponse;
    }

    if (res.body.needUpload) {
      logger.info("需要上传，开始上传流程...");
      try {
        const uploadInfo = await songUpload(query, request);
        logger.info("上传完成:", uploadInfo?.body?.result?.resourceId);
      } catch (uploadError) {
        throw uploadError;
      }
    } else {
      logger.info("文件已存在，跳过上传");
    }

    const res2 = await request(
      "/api/upload/cloud/info/v2",
      {
        md5: fileMd5,
        songid: res.body.songId,
        filename: query.songFile.name,
        song: songName || filename,
        album: album || "未知专辑",
        artist: artist || "未知艺术家",
        bitrate: String(bitrate),
        resourceId: tokenRes.body.result.resourceId,
      },
      createOption(query),
    );

    if (res2.body.code !== 200) {
      logger.error("云盘信息上传失败:", res2.body);
      throw {
        status: res2.status || 500,
        body: { code: res2.body.code || 500, msg: res2.body.msg || "上传云盘信息失败", detail: res2.body },
      } as NcmResponse;
    }

    const res3 = await request("/api/cloud/pub/v2", { songid: res2.body.songId }, createOption(query));

    return {
      status: 200,
      body: { ...res.body, ...res3.body },
      cookie: res.cookie,
    };
  } finally {
    if (useTemp) {
      await cleanupTempFile(query.songFile.tempFilePath);
    }
  }
};

export const cloud = cloud__handler;

/* ---------- cloud_import  (/cloud/import) ---------- */

/* 自动转换自 api-enhanced module/cloud_import.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 云盘导入歌曲

export const cloud_import = async (query: NcmQuery, request: NcmRequestFn) => {
  query.id = query.id || -2
  query.artist = query.artist || '未知'
  query.album = query.album || '未知'
  const checkData = {
    uploadType: 0,
    songs: JSON.stringify([
      {
        md5: query.md5,
        songId: query.id,
        bitrate: query.bitrate,
        fileSize: query.fileSize,
      },
    ]),
  }
  const res = await request(
    `/api/cloud/upload/check/v2`,
    checkData,
    createOption(query),
  )
  //res.body.data[0].upload 0:文件可导入,1:文件已在云盘,2:不能导入
  //只能用song决定云盘文件名，且上传后的文件名后缀固定为mp3
  const importData = {
    uploadType: 0,
    songs: JSON.stringify([
      {
        songId: res.body.data[0].songId,
        bitrate: query.bitrate,
        song: query.song,
        artist: query.artist,
        album: query.album,
        fileName: query.song + '.' + query.fileType,
      },
    ]),
  }
  return request(`/api/cloud/user/song/import`, importData, createOption(query))
}

/* ---------- cloud_lyric_get  (/cloud/lyric/get) ---------- */

/* 自动转换自 api-enhanced module/cloud_lyric_get.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 获取云盘歌词

export const cloud_lyric_get = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    userId: query.uid,
    songId: query.sid,
    lv: -1,
    kv: -1,
  }
  return request(`/api/cloud/lyric/get`, data, createOption(query, 'eapi'))
}

/* ---------- cloud_match  (/cloud/match) ---------- */

/* 自动转换自 api-enhanced module/cloud_match.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const cloud_match = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    userId: query.uid,
    songId: query.sid,
    adjustSongId: query.asid,
  }
  return request(
    `/api/cloud/user/song/match`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- cloud_upload_complete  (/cloud/upload/complete) ---------- */

/* 自动转换自 api-enhanced module/cloud_upload_complete.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const cloud_upload_complete = async (query: NcmQuery, request: NcmRequestFn) => {
  const {
    songId,
    resourceId,
    md5,
    filename,
    song,
    artist,
    album,
    bitrate = 999000,
  } = query

  if (!songId || !resourceId || !md5 || !filename) {
    return Promise.reject({
      status: 400,
      body: {
        code: 400,
        msg: '缺少必要参数: songId, resourceId, md5, filename',
      },
    })
  }

  const songName = song || filename.replace(/\.[^.]+$/, '')

  const res2 = await request(
    `/api/upload/cloud/info/v2`,
    {
      md5: md5,
      songid: songId,
      filename: filename,
      song: songName,
      album: album || '未知专辑',
      artist: artist || '未知艺术家',
      bitrate: String(bitrate),
      resourceId: resourceId,
    },
    createOption(query),
  )

  if (res2.body.code !== 200) {
    return Promise.reject({
      status: res2.status || 500,
      body: {
        code: res2.body.code || 500,
        msg: res2.body.msg || '上传云盘信息失败',
        detail: res2.body,
      },
    })
  }

  const res3 = await request(
    `/api/cloud/pub/v2`,
    {
      songid: res2.body.songId,
    },
    createOption(query),
  )

  return {
    status: 200,
    body: {
      code: 200,
      data: {
        songId: res2.body.songId,
        ...res3.body,
      },
    },
    cookie: res2.cookie,
  }
}

/* ---------- cloud_upload_token  (/cloud/upload/token) ---------- */

/* 自动转换自 api-enhanced module/cloud_upload_token.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const cloud_upload_token = async (query: NcmQuery, request: NcmRequestFn) => {
  const { md5, fileSize, filename, bitrate = 999000 } = query

  if (!md5 || !fileSize || !filename) {
    return Promise.reject({
      status: 400,
      body: {
        code: 400,
        msg: '缺少必要参数: md5, fileSize, filename',
      },
    })
  }

  const ext = filename.includes('.') ? filename.split('.').pop() : 'mp3'

  const checkRes = await request(
    `/api/cloud/upload/check`,
    {
      bitrate: String(bitrate),
      ext: '',
      length: fileSize,
      md5: md5,
      songId: '0',
      version: 1,
    },
    createOption(query),
  )

  const bucket = 'jd-musicrep-privatecloud-audio-public'
  const tokenRes = await request(
    `/api/nos/token/alloc`,
    {
      bucket: bucket,
      ext: ext,
      filename: filename
        .replace(/\.[^.]+$/, '')
        .replace(/\s/g, '')
        .replace(/\./g, '_'),
      local: false,
      nos_product: 3,
      type: 'audio',
      md5: md5,
    },
    createOption(query, 'weapi'),
  )

  if (!tokenRes.body.result || !tokenRes.body.result.objectKey) {
    return Promise.reject({
      status: 500,
      body: {
        code: 500,
        msg: '获取上传token失败',
        detail: tokenRes.body,
      },
    })
  }

  let lbs
  try {
    lbs = (
      await axios.request({
        method: 'get',
        url: `https://wanproxy.127.net/lbs?version=1.0&bucketname=${bucket}`,
        timeout: 10000,
      })
    ).data
  } catch (error: any) {
    return Promise.reject({
      status: 500,
      body: {
        code: 500,
        msg: '获取上传服务器地址失败',
        detail: error.message,
      },
    })
  }

  if (!lbs || !lbs.upload || !lbs.upload[0]) {
    return Promise.reject({
      status: 500,
      body: {
        code: 500,
        msg: '获取上传服务器地址无效',
        detail: lbs,
      },
    })
  }

  return {
    status: 200,
    body: {
      code: 200,
      data: {
        needUpload: checkRes.body.needUpload,
        songId: checkRes.body.songId,
        uploadToken: tokenRes.body.result.token,
        objectKey: tokenRes.body.result.objectKey,
        resourceId: tokenRes.body.result.resourceId,
        uploadUrl: `${lbs.upload[0]}/${bucket}/${tokenRes.body.result.objectKey.replace(/\//g, '%2F')}?offset=0&complete=true&version=1.0`,
        bucket: bucket,
        md5: md5,
        fileSize: fileSize,
        filename: filename,
      },
    },
    cookie: checkRes.cookie,
  }
}

/* ---------- voice_delete  (/voice/delete) ---------- */

/* 自动转换自 api-enhanced module/voice_delete.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const voice_delete = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    ids: query.ids,
  }
  return request('/api/content/voice/delete', data, createOption(query))
}

/* ---------- voice_detail  (/voice/detail) ---------- */

/* 自动转换自 api-enhanced module/voice_detail.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const voice_detail = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
  }
  return request(`/api/voice/workbench/voice/detail`, data, createOption(query))
}

/* ---------- voice_lyric  (/voice/lyric) ---------- */

/* 自动转换自 api-enhanced module/voice_lyric.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const voice_lyric = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    programId: query.id,
  }
  return request(`/api/voice/lyric/get`, data, createOption(query))
}

/* ---------- voice_upload  (/voice/upload) ---------- */

/** 声音上传 — 对齐 api-enhanced module/voice_upload.js（nos 分块上传，XML 用正则解析） */

/** 从 nos InitiateMultipartUpload XML 响应提取 UploadId（替代 xml2js） */

function voice_upload__createDupkey(): string {
  const s: string[] = [];
  const hexDigits = "0123456789abcdef";
  for (let i = 0; i < 36; i++) {
    s[i] = hexDigits.substr(Math.floor(Math.random() * 0x10), 1);
  }
  s[14] = "4";
  s[19] = hexDigits.substr((Number(s[19]) & 0x3) | 0x8, 1);
  s[8] = s[13] = s[18] = s[23] = "-";
  return s.join("");
}

function voice_upload__parseUploadId(xml: string): string {
  const m = String(xml).match(/<UploadId>([^<]+)<\/UploadId>/);
  if (!m) throw new Error("解析 UploadId 失败: " + String(xml).slice(0, 200));
  return m[1];
}

const voice_upload__handler: NcmModule = async (query: NcmQuery, request: NcmRequestFn) => {
  if (!query.songFile) {
    throw { status: 500, body: { msg: "请上传音频文件", code: 500 } } as NcmResponse;
  }

  const ext = getFileExtension(query.songFile.name);
  const filename =
    query.songName ||
    query.songFile.name.replace("." + ext, "").replace(/\s/g, "").replace(/\./g, "_");
  const coverImgId = query.imgFile ? (await uploadImage(query, request)).imgId : query.coverImgId;

  const tokenRes = await request(
    "/api/nos/token/alloc",
    {
      bucket: "ymusic",
      ext,
      filename,
      local: false,
      nos_product: 0,
      type: "other",
    },
    createOption(query, "weapi"),
  );

  const objectKey = tokenRes.body.result.objectKey.replace(/\//g, "%2F");
  const docId = tokenRes.body.result.docId;
  const res = await axiosLike.post(
    `https://ymusic.nos-hz.163yun.com/${objectKey}?uploads`,
    null,
    {
      headers: {
        "x-nos-token": tokenRes.body.result.token,
        "X-Nos-Meta-Content-Type": query.songFile.mimetype || "audio/mpeg",
      },
    },
  );

  const uploadId = voice_upload__parseUploadId(res.data);

  const useTempFile = !!query.songFile.tempFilePath;
  let fileSize = query.songFile.size;
  if (useTempFile) {
    const fs = await import("node:fs");
    const stats = await fs.promises.stat(query.songFile.tempFilePath);
    fileSize = stats.size;
  }

  const blockSize = 10 * 1024 * 1024;
  let offset = 0;
  let blockIndex = 1;
  const etags: string[] = [];

  while (offset < fileSize) {
    let chunk: Buffer;
    if (useTempFile) {
      chunk = await readFileChunk(query.songFile.tempFilePath, offset, Math.min(blockSize, fileSize - offset));
    } else {
      chunk = query.songFile.data.slice(offset, Math.min(offset + blockSize, fileSize));
    }

    const res3 = await axiosLike.request({
      method: "put",
      url: `https://ymusic.nos-hz.163yun.com/${objectKey}?partNumber=${blockIndex}&uploadId=${uploadId}`,
      headers: {
        "x-nos-token": tokenRes.body.result.token,
        "Content-Type": query.songFile.mimetype || "audio/mpeg",
      },
      data: chunk,
    });
    etags.push(res3.headers.etag);
    offset += blockSize;
    blockIndex++;
  }

  let completeStr = "<CompleteMultipartUpload>";
  for (let i = 0; i < etags.length; i++) {
    completeStr += `<Part><PartNumber>${i + 1}</PartNumber><ETag>${etags[i]}</ETag></Part>`;
  }
  completeStr += "</CompleteMultipartUpload>";

  await axiosLike.post(
    `https://ymusic.nos-hz.163yun.com/${objectKey}?uploadId=${uploadId}`,
    completeStr,
    {
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
        "X-Nos-Meta-Content-Type": query.songFile.mimetype || "audio/mpeg",
        "x-nos-token": tokenRes.body.result.token,
      },
    },
  );

  const voiceData = JSON.stringify([
    {
      name: filename,
      autoPublish: query.autoPublish == 1 ? true : false,
      autoPublishText: query.autoPublishText || "",
      description: query.description,
      voiceListId: query.voiceListId,
      coverImgId,
      dfsId: docId,
      categoryId: query.categoryId,
      secondCategoryId: query.secondCategoryId,
      composedSongs: query.composedSongs ? query.composedSongs.split(",") : [],
      privacy: query.privacy == 1 ? true : false,
      publishTime: query.publishTime || 0,
      orderNo: query.orderNo || 1,
    },
  ]);

  await request(
    "/api/voice/workbench/voice/batch/upload/preCheck",
    { dupkey: voice_upload__createDupkey(), voiceData },
    { ...createOption(query), headers: { "x-nos-token": tokenRes.body.result.token } },
  );
  const result = await request(
    "/api/voice/workbench/voice/batch/upload/v2",
    { dupkey: voice_upload__createDupkey(), voiceData },
    { ...createOption(query), headers: { "x-nos-token": tokenRes.body.result.token } },
  );
  return {
    status: 200,
    body: { code: 200, data: result.body.data },
  };
};

export const voice_upload = voice_upload__handler;

/* ---------- voicelist_detail  (/voicelist/detail) ---------- */

/* 自动转换自 api-enhanced module/voicelist_detail.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const voicelist_detail = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    id: query.id,
  }
  return request(
    `/api/voice/workbench/voicelist/detail`,
    data,
    createOption(query),
  )
}

/* ---------- voicelist_list  (/voicelist/list) ---------- */

/* 自动转换自 api-enhanced module/voicelist_list.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const voicelist_list = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || '200',
    offset: query.offset || '0',
    voiceListId: query.voiceListId,
  }
  return request(
    `/api/voice/workbench/voices/by/voicelist`,
    data,
    createOption(query),
  )
}

/* ---------- voicelist_list_search  (/voicelist/list/search) ---------- */

/* 自动转换自 api-enhanced module/voicelist_list_search.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

//声音搜索

export const voicelist_list_search = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || '200',
    offset: query.offset || '0',
    name: query.name || null,
    displayStatus: query.displayStatus || null,
    type: query.type || null,
    voiceFeeType: query.voiceFeeType || null,
    radioId: query.voiceListId,
  }
  return request('/api/voice/workbench/voice/list', data, createOption(query))
}

/* ---------- voicelist_my_created  (/voicelist/my/created) ---------- */

/* 自动转换自 api-enhanced module/voicelist_my_created.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

// 我创建的播客声音

export const voicelist_my_created = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || 20,
  }
  return request(
    `/api/social/my/created/voicelist/v1`,
    data,
    createOption(query, 'weapi'),
  )
}

/* ---------- voicelist_search  (/voicelist/search) ---------- */

/* 自动转换自 api-enhanced module/voicelist_search.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const voicelist_search = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    keyword: query.keyword || '',
    scene: 'normal',
    limit: query.limit || '10',
    offset: query.offset || '30',
    e_r: true,
  }
  return request(`/api/search/voicelist/get`, data, createOption(query))
}

/* ---------- voicelist_trans  (/voicelist/trans) ---------- */

/* 自动转换自 api-enhanced module/voicelist_trans.js — 由 scripts/convert-netease-modules.mjs 生成，请勿手工修改 */

export const voicelist_trans = (query: NcmQuery, request: NcmRequestFn) => {
  const data = {
    limit: query.limit || '200', // 每页数量
    offset: query.offset || '0', // 偏移量
    radioId: query.radioId || null, // 电台id
    programId: query.programId || '0', // 节目id
    position: query.position || '1', // 排序编号
  }
  return request(
    `/api/voice/workbench/radio/program/trans`,
    data,
    createOption(query),
  )
}
