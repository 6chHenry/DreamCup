import { Noto_Sans_SC, Noto_Serif_SC, ZCOOL_XiaoWei } from "next/font/google";

/**
 * CatchDream 字体（ui-ux-pro-max：Chinese Simplified + Editorial）
 * - 标题/展示：站酷小薇 — 梦境字幕感
 * - 界面正文：思源黑体 — 小字号可读性（≥16px 场景）
 * - 叙事长文：思源宋体 — 日记/文学质地
 */
export const dreamHeadlineFont = ZCOOL_XiaoWei({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-dream-headline",
  display: "swap",
});

export const dreamBodyFont = Noto_Sans_SC({
  weight: ["300", "400", "500"],
  subsets: ["latin"],
  variable: "--font-dream-body",
  display: "swap",
});

export const dreamProseFont = Noto_Serif_SC({
  weight: ["300", "400", "500"],
  subsets: ["latin"],
  variable: "--font-dream-prose",
  display: "swap",
});
