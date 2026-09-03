import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: [
    "better-sqlite3",
    "music-metadata",
    "ffmpeg-static",
    "@neteasecloudmusicapienhanced/unblockmusic-utils",
    "qrcode",
    "jsdom",
  ],
};

export default nextConfig;
