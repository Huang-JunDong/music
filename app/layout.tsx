import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { AppShell } from "@/components/shell/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Music DL — 全网音乐聚合",
  description: "多源聚合音乐搜索、试听与下载",
  applicationName: "Music DL",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#09090f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="app-bg min-h-dvh antialiased">
        <AppShell>{children}</AppShell>
        <Toaster
          position="top-center"
          theme="dark"
          toastOptions={{
            style: {
              background: "rgba(24,24,32,0.92)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "#f4f4f5",
              backdropFilter: "blur(16px)",
            },
          }}
        />
      </body>
    </html>
  );
}
