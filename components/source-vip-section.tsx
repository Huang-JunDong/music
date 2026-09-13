"use client";

/**
 * 账户页 VIP 状态区（P1 A1）— 依次探测网易/QQ 登录态，渲染已登录源的 VIP 卡。
 * 双源都登录则并排展示；都未登录不渲染（无空态假数据）。
 */
import { useEffect, useState } from "react";
import { VipCard } from "@/components/vip-card";
import { apiQRLoginStatus, apiVipInfo } from "@/lib/client/api";
import type { UserVipInfo } from "@/lib/types";

const SOURCES = ["netease", "qq"] as const;

export function SourceVipSection() {
  const [loggedIn, setLoggedIn] = useState<string[]>([]);
  const [vips, setVips] = useState<Record<string, UserVipInfo | null>>({});
  const [probing, setProbing] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const detected: string[] = [];
      await Promise.allSettled(
        SOURCES.map(async (s) => {
          try {
            const st = await apiQRLoginStatus(s);
            if (st.logged_in) detected.push(s);
          } catch {
            /* ignore */
          }
        }),
      );
      if (!alive) return;
      setLoggedIn(detected);
      setProbing(false);
      await Promise.allSettled(
        detected.map(async (s) => {
          try {
            const r = await apiVipInfo(s);
            if (alive) setVips((prev) => ({ ...prev, [s]: r.vip ?? null }));
          } catch {
            if (alive) setVips((prev) => ({ ...prev, [s]: null }));
          }
        }),
      );
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (probing || !loggedIn.length) return null;

  return (
    <div className="mt-5 flex flex-col gap-4">
      {loggedIn.map((s, i) => (
        <VipCard key={s} vip={vips[s] ?? null} source={s} loading={!(s in vips)} delay={0.05 * i} compact />
      ))}
    </div>
  );
}
