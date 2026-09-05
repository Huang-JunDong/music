"use client";

/**
 * 我的音源账号 — 每个访客扫码登录自己的网易云/QQ 等音源账号（凭证存本浏览器）。
 * 登录后全站（搜索/歌单/下载音质/VIP 解析）自动使用自己的账号。
 */
import { motion } from "motion/react";
import { QrCode, Sparkles, ShieldCheck, Check } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { MySourceAccounts } from "@/components/my-source-accounts";

/** 登录后功能生效范围 */
const EFFECT_LIST = [
  "搜索与歌单：会员内容、个人收藏歌单同步",
  "试听与下载：按你的账号音质解析（含 VIP 无损）",
  "视频渲染、本地缓存取源同样走你的凭证",
];

/** 凭证安全说明 */
const SECURITY_LIST = [
  "凭证仅存当前浏览器（HttpOnly Cookie，90 天有效）",
  "退出即清除；不落服务器，不影响管理员配置",
  "「网易 API / QQ API」页直连你自己的账号数据",
];

function InfoCard({
  icon: Icon,
  title,
  items,
  delay,
}: {
  icon: typeof Sparkles;
  title: string;
  items: string[];
  delay: number;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
      className="glass rounded-3xl border border-white/[.07] p-5"
      aria-label={title}
    >
      <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-zinc-200">
        <Icon className="h-4 w-4 text-fuchsia-300" aria-hidden="true" /> {title}
      </h3>
      <ul className="mt-3 flex flex-col gap-2">
        {items.map((text) => (
          <li key={text} className="flex items-start gap-2 text-xs leading-relaxed text-zinc-400">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300/70" aria-hidden="true" />
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </motion.section>
  );
}

export default function AccountsPage() {
  return (
    <div className="mx-auto w-full max-w-[880px] px-4 py-6 lg:px-8 lg:py-10">
      <PageHeader
        icon={QrCode}
        title="我的音源账号"
        subtitle="扫码登录自己的网易云 / QQ 账号，同步个人收藏歌单与会员内容"
      />
      <MySourceAccounts />
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <InfoCard icon={Sparkles} title="登录后全站生效" items={EFFECT_LIST} delay={0.08} />
        <InfoCard icon={ShieldCheck} title="凭证安全" items={SECURITY_LIST} delay={0.14} />
      </div>
    </div>
  );
}
