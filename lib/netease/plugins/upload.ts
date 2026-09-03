/** 头像/图片上传插件 — 对齐 api-enhanced plugins/upload.js */
import axiosLike from "../axios-compat";
import { createOption } from "../option";
import { getUploadData } from "../file-helper";
import type { NcmQuery, NcmRequestFn, NcmResponse } from "../types";

export default async function upload(query: NcmQuery, request: NcmRequestFn): Promise<{ url_pre: string; imgId: any }> {
  const data = {
    bucket: "yyimgs",
    ext: "jpg",
    filename: query.imgFile.name,
    local: false,
    nos_product: 0,
    return_body: `{"code":200,"size":"$(ObjectSize)"}`,
    type: "other",
  };
  const res = await request("/api/nos/token/alloc", data, createOption(query, "weapi"));

  await axiosLike.post(
    `https://nosup-hz1.127.net/yyimgs/${res.body.result.objectKey}?offset=0&complete=true&version=1.0`,
    getUploadData(query.imgFile),
    {
      headers: {
        "x-nos-token": res.body.result.token,
        "Content-Type": query.imgFile.mimetype || "image/jpeg",
      },
    },
  );

  return {
    url_pre: "https://p1.music.126.net/" + res.body.result.objectKey,
    imgId: res.body.result.docId,
  };
}
