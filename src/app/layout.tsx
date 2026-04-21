import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DreamCatch AI - 掬梦",
  description: "基于多模态AI的梦境捕捉与重建系统",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased dark">
      <body className="min-h-full flex flex-col bg-[#050510] font-sans">
        {children}
      </body>
    </html>
  );
}
