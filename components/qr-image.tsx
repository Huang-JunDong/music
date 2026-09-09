"use client";

/**
 * 扫码登录二维码图片：
 * - 上游 session.image_url（如网易云 qrimg data URL）存在时直接使用；
 * - 否则用 qrcode 库把登录链接（session.url）在前端渲染成二维码图片 ——
 *   后端部分源只返回扫码跳转链接（HTML 页面而非图片），直接塞 <img src> 必然加载失败。
 */
import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function QrImage({
  url,
  imageUrl,
  size = 220,
  className = "",
}: {
  url: string;
  imageUrl?: string;
  size?: number;
  className?: string;
}) {
  const [generated, setGenerated] = useState("");

  useEffect(() => {
    let alive = true;
    if (imageUrl || !url) return;
    QRCode.toDataURL(url, { width: size * 2, margin: 1, errorCorrectionLevel: "M" })
      .then((d) => {
        if (alive) setGenerated(d);
      })
      .catch(() => {
        if (alive) setGenerated("");
      });
    return () => {
      alive = false;
    };
  }, [url, imageUrl, size]);

  const src = imageUrl || generated;
  // 生成期间保持占位尺寸，避免布局跳动；src 未就绪时不渲染该属性（传 undefined 而非空串，避免浏览器重复拉取整页）
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src || undefined}
      alt="登录二维码"
      width={size}
      height={size}
      className={`object-contain ${src ? "" : "invisible"} ${className}`}
    />
  );
}
