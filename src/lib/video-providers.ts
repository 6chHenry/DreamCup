import fs from "fs";
import path from "path";
import type { Dream, StoryboardShot, VideoRenderJob, VideoRenderProvider } from "@/types/dream";
import { getJobDirectory } from "@/lib/ffmpeg-render";
import { llmFetch } from "@/lib/llm-fetch";
import { materializeMedia } from "@/lib/media-files";
import { missingProviderConfig, providerError, providerResponseError } from "@/lib/provider-errors";
import { comfyUIConfigured, comfyUIMissingConfigMessage, pollH3Video, stableGenerationSeed, submitH3Video } from "@/lib/comfyui-local";

export interface VideoTaskInput { job: VideoRenderJob; shot: StoryboardShot; shotIndex: number; dream: Dream }
export interface VideoSubmission { requestId?: string; videoUrl?: string; model: string }
export interface VideoTaskResult { status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "expired"; videoUrl?: string; error?: string }
export interface VideoProviderAdapter {
  configured(): boolean;
  missingConfigMessage(): string;
  submit(input: VideoTaskInput): Promise<VideoSubmission>;
  poll(job: VideoRenderJob, requestId: string): Promise<VideoTaskResult>;
}

function arkConfig() {
  const apiKey = process.env.JIMENG_API_KEY?.trim() || process.env.ARK_API_KEY?.trim() || "";
  const apiUrl = (process.env.JIMENG_API_URL?.trim() || process.env.ARK_API_URL?.trim() || "https://ark.cn-beijing.volces.com/api/v3").replace(/\/$/, "");
  return { apiKey, apiUrl, model: process.env.JIMENG_VIDEO_MODEL?.trim() || "doubao-seedance-1-0-pro-250528" };
}

async function firstFrame(input: VideoTaskInput): Promise<string | undefined> {
  const url = input.dream.scenes.find((scene) => scene.sceneIndex === input.shot.sceneIndex && scene.imageUrl)?.imageUrl;
  if (!url) return undefined;
  const directory = path.join(getJobDirectory(input.job.id), "first-frames");
  const file = await materializeMedia(url, directory, input.shot.id);
  const mime = path.extname(file) === ".png" ? "image/png" : path.extname(file) === ".webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
}

export const jimengVideoAdapter: VideoProviderAdapter = {
  configured: () => Boolean(arkConfig().apiKey),
  missingConfigMessage: () => "即梦/方舟视频未配置 JIMENG_API_KEY 或 ARK_API_KEY；本镜头将使用离线分镜样片。",
  async submit(input) {
    const { apiKey, apiUrl, model } = arkConfig();
    if (!apiKey) throw missingProviderConfig(this.missingConfigMessage());
    const image = await firstFrame(input);
    const modern = /seedance-(1-5|2-|2_)/.test(model);
    const duration = Math.round(input.shot.duration);
    try {
      const response = await llmFetch(`${apiUrl}/contents/generations/tasks`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model, content: [{ type: "text", text: input.shot.videoPrompt }, ...(image ? [{ type: "image_url", image_url: { url: image }, role: "first_frame" }] : [])],
          ...(modern && duration < 4 ? { duration: -1 } : { duration: Math.max(modern ? 4 : 2, Math.min(modern ? 15 : 12, duration)) }),
          resolution: "720p", ratio: image ? "adaptive" : input.job.storyboard.aspectRatio,
          ...(!image && !modern && input.shot.cameraMotion === "still" ? { camera_fixed: true } : {}),
          watermark: process.env.JIMENG_VIDEO_WATERMARK === "true",
          ...(process.env.JIMENG_RETURN_LAST_FRAME === "true" ? { return_last_frame: true } : {}),
        }),
      });
      if (!response.ok) throw await providerResponseError(response, "即梦/方舟");
      const result = await response.json() as { id?: string };
      if (!result.id) throw providerError(new Error("创建成功但未返回任务 ID"), "即梦/方舟");
      return { requestId: result.id, model };
    } catch (error) { throw providerError(error, "即梦/方舟"); }
  },
  async poll(_job, requestId) {
    const { apiKey, apiUrl } = arkConfig();
    if (!apiKey) throw missingProviderConfig(this.missingConfigMessage());
    try {
      const response = await llmFetch(`${apiUrl}/contents/generations/tasks/${encodeURIComponent(requestId)}`, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!response.ok) throw await providerResponseError(response, "即梦/方舟");
      const result = await response.json() as { status?: VideoTaskResult["status"]; content?: { video_url?: string }; error?: { message?: string } };
      if (!result.status) throw providerError(new Error("查询响应缺少任务状态"), "即梦/方舟");
      return { status: result.status, videoUrl: result.content?.video_url, error: result.error?.message };
    } catch (error) { throw providerError(error, "即梦/方舟"); }
  },
};

export const grokVideoAdapter: VideoProviderAdapter = {
  configured: () => Boolean(process.env.GROK_API_URL?.trim() && process.env.GROK_API_KEY?.trim()),
  missingConfigMessage: () => "Grok 视频未配置 GROK_API_URL / GROK_API_KEY；本镜头将使用离线分镜样片。",
  async submit({ job, shot }) {
    const apiUrl = process.env.GROK_API_URL?.replace(/\/$/, "");
    const apiKey = process.env.GROK_API_KEY?.trim();
    if (!apiUrl || !apiKey) throw missingProviderConfig(this.missingConfigMessage());
    const model = process.env.GROK_VIDEO_MODEL || "grok-imagine-video";
    try {
      const response = await llmFetch(`${apiUrl}/${process.env.GROK_VIDEO_GENERATIONS_PATH || "videos/generations"}`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, prompt: shot.videoPrompt, duration: Math.min(15, Math.max(5, Math.round(shot.duration))), aspect_ratio: job.storyboard.aspectRatio, resolution: "720p" }),
      });
      if (!response.ok) throw await providerResponseError(response, "Grok 视频");
      const result = await response.json() as { request_id?: string; video?: { url?: string }; video_url?: string; url?: string };
      return { requestId: result.request_id, videoUrl: result.video?.url || result.video_url || result.url, model };
    } catch (error) { throw providerError(error, "Grok 视频"); }
  },
  async poll(_job, requestId) {
    const apiUrl = process.env.GROK_API_URL?.replace(/\/$/, "");
    const apiKey = process.env.GROK_API_KEY?.trim();
    if (!apiUrl || !apiKey) throw missingProviderConfig(this.missingConfigMessage());
    try {
      const response = await llmFetch(`${apiUrl}/videos/${encodeURIComponent(requestId)}`, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!response.ok) throw await providerResponseError(response, "Grok 视频");
      const result = await response.json() as { status?: string; video?: { url?: string }; error?: { message?: string } };
      const status = result.status === "done" ? "succeeded" : result.status === "failed" ? "failed" : result.status === "expired" ? "expired" : "running";
      return { status, videoUrl: result.video?.url, error: result.error?.message };
    } catch (error) { throw providerError(error, "Grok 视频"); }
  },
};

export const comfyUIH3VideoAdapter: VideoProviderAdapter = {
  configured: comfyUIConfigured,
  missingConfigMessage: comfyUIMissingConfigMessage,
  async submit(input) {
    try {
      const url = input.dream.scenes.find((scene) => scene.sceneIndex === input.shot.sceneIndex && scene.imageUrl)?.imageUrl;
      if (!url) throw new Error("H3 首帧视频需要先生成场景图。");
      const directory = path.join(getJobDirectory(input.job.id), "first-frames");
      const file = await materializeMedia(url, directory, input.shot.id);
      const prompt = `integrated_multimodal_description:\n[Shot 1] Begin exactly from the supplied first-frame image. Preserve its composition, subjects and visual style. ${input.shot.videoPrompt}\n\noverall_soundscape:\nSubtle natural ambience, no speech.\n\nnon_diegetic_music:\nN/A`;
      const quality = input.job.generationQuality ?? "quality";
      const seed = stableGenerationSeed(input.job.id, input.shot.id, prompt, quality);
      return await submitH3Video({ prompt, firstFrame: fs.readFileSync(file), firstFrameName: path.basename(file), aspectRatio: input.job.storyboard.aspectRatio, duration: input.shot.duration, seed, quality });
    } catch (error) { throw providerError(error, "本地 H3 视频"); }
  },
  poll: (_job, requestId) => pollH3Video(requestId),
};

const adapters: Partial<Record<VideoRenderProvider, VideoProviderAdapter>> = { jimeng: jimengVideoAdapter, grok: grokVideoAdapter, comfyui_h3: comfyUIH3VideoAdapter };
export function getVideoProviderAdapter(provider: VideoRenderProvider): VideoProviderAdapter | undefined { return adapters[provider]; }
