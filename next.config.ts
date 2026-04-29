import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev-only: allow HMR / dev assets when opening the app via Cloudflare Quick Tunnel
  // (origin is *.trycloudflare.com, not localhost). Safe in production (ignored).
  allowedDevOrigins: ["*.trycloudflare.com"],
  /** 包含原生 ffmpeg 可执行文件的包；不参与打包，否则会找不到二进制或 nft 遗漏 */
  serverExternalPackages: ["ffmpeg-static"],
  /** NFT 未必跟踪 postinstall 下载的二进制，显式纳入 ASR 路由的产物 */
  outputFileTracingIncludes: {
    "/api/asr": ["./node_modules/ffmpeg-static/**/*"],
  },
};

export default nextConfig;
