import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["better-sqlite3", "music-metadata", "ffmpeg-static"],
};

export default nextConfig;
