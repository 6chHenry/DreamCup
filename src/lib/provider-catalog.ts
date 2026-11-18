import type { NarrationProvider, VideoRenderProvider } from "@/types/dream";
import { getNarrationAdapter } from "@/lib/narration-providers";
import { getVideoProviderAdapter } from "@/lib/video-providers";

export function getProviderCatalog() {
  const video = (["storyboard_preview", "comfyui_h3", "jimeng", "grok", "generic"] as VideoRenderProvider[]).map((id) => {
    const adapter = getVideoProviderAdapter(id);
    const configured = id === "storyboard_preview" || Boolean(adapter?.configured());
    const description = id === "storyboard_preview" ? "场景图运镜 · 转场 · FFmpeg 合成"
      : id === "jimeng" ? `${configured ? "已配置 · " : ""}首帧生视频 · 自动轮询 · 本地缓存${configured ? "" : "；未配置时自动离线回退"}`
      : id === "comfyui_h3" ? `${configured ? "已连接配置 · " : ""}H3 首帧生视频 · 单卡串行 · 本地缓存`
      : configured ? "已配置，可提交镜头" : id === "generic" ? "预留扩展接口" : adapter?.missingConfigMessage();
    return { id, configured, supported: id !== "generic", label: id === "storyboard_preview" ? "本地分镜样片" : id === "comfyui_h3" ? "MiniMax H3 · 本地 A100" : id === "jimeng" ? "即梦 · 火山方舟 Seedance" : id === "grok" ? "Grok Imagine" : "自定义供应商", description };
  });
  const narration = (["silent", "volcengine", "openai", "azure"] as NarrationProvider[]).map((id) => {
    const adapter = getNarrationAdapter(id);
    const configured = id === "silent" || Boolean(adapter?.configured());
    const description = id === "silent" ? "仅保留旁白字幕，不生成语音"
      : configured ? "已配置，可按镜头生成旁白" : "未配置密钥；保留字幕并继续无声合成";
    return { id, configured, label: id === "silent" ? "字幕 / 无声" : id === "volcengine" ? "火山引擎 TTS" : id === "openai" ? "OpenAI 兼容 TTS" : "Azure Speech", description };
  });
  return { video, narration };
}
