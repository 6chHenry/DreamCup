import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";
import { createHash } from "crypto";
import sharp from "sharp";
import { ProviderError, providerError, providerResponseError } from "@/lib/provider-errors";

const providerName = "本地 ComfyUI";
const dispatcher = new Agent({
  connectTimeout: 15_000,
  headersTimeout: 120_000,
  bodyTimeout: 120_000,
});

type ComfyWorkflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
type ComfyOutputFile = { filename: string; subfolder?: string; type?: string };
type ComfyHistory = {
  status?: { status_str?: string; completed?: boolean };
  outputs?: Record<string, { images?: ComfyOutputFile[] }>;
};
export type H3VideoQuality = "draft" | "quality";
export type H3Reference = { bytes: Buffer; filename: string };

export function stableGenerationSeed(...parts: Array<string | number>): number {
  const digest = createHash("sha256").update(parts.join(":")).digest();
  return digest.readUInt32BE(0) & 0x7fffffff;
}

function config() {
  return {
    baseUrl: (process.env.COMFYUI_LOCAL_URL?.trim() || "http://127.0.0.1:8190").replace(/\/$/, ""),
    imageModel: process.env.COMFYUI_H3_IMAGE_MODEL?.trim() || "minimax_h3_image_pruned_int8_convrot.safetensors",
    videoModel: process.env.COMFYUI_H3_VIDEO_MODEL?.trim() || "MiniMax-H3-FL2VA-Q8_0.gguf",
    textEncoder: process.env.COMFYUI_H3_TEXT_ENCODER?.trim() || "qwen3vl_32b_minimax_h3-Q4_K_M.gguf",
    imageVae: process.env.COMFYUI_H3_IMAGE_VAE?.trim() || "minimax_h3_image_vae_fp16.safetensors",
    videoVae: process.env.COMFYUI_H3_VIDEO_VAE?.trim() || "minimax_h3_video_vae_fp16.safetensors",
    audioVae: process.env.COMFYUI_H3_AUDIO_VAE?.trim() || "minimax_h3_audio_vae_fp32.safetensors",
    imageSteps: Math.max(1, Math.min(100, Number(process.env.COMFYUI_H3_IMAGE_STEPS) || 6)),
    videoSteps: Math.max(1, Math.min(100, Number(process.env.COMFYUI_H3_VIDEO_STEPS) || 25)),
  };
}

async function comfyFetch(path: string, init?: RequestInit): Promise<Response> {
  const settings = config();
  const base = new URL(settings.baseUrl);
  if (base.protocol !== "http:" && base.protocol !== "https:") throw new Error("COMFYUI_LOCAL_URL 仅支持 HTTP(S)");
  try {
    return await undiciFetch(new URL(path, `${settings.baseUrl}/`), {
      ...(init as UndiciRequestInit),
      dispatcher,
    }) as unknown as Response;
  } catch {
    throw new ProviderError(
      `无法连接本地 ComfyUI（${settings.baseUrl}）。请确认 A100 服务在线，并恢复 SSH 转发；连接恢复后可直接重试，提示词和已有素材不会丢失。`,
      "network",
    );
  }
}

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw await providerResponseError(response, providerName);
  return response.json() as Promise<T>;
}

async function submit(workflow: ComfyWorkflow): Promise<string> {
  const response = await comfyFetch("prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow }),
  });
  const result = await responseJson<{ prompt_id?: string; error?: unknown; node_errors?: Record<string, unknown> }>(response);
  if (!result.prompt_id || result.error || Object.keys(result.node_errors ?? {}).length) {
    throw new Error(`ComfyUI 工作流提交失败：${JSON.stringify(result).slice(0, 1000)}`);
  }
  return result.prompt_id;
}

async function uploadImage(reference: H3Reference): Promise<string> {
  const png = await sharp(reference.bytes).rotate().png().toBuffer();
  const filename = `${pathWithoutExtension(reference.filename)}.png`;
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(png)], { type: "image/png" }), filename);
  form.append("type", "input");
  form.append("overwrite", "false");
  const uploaded = await responseJson<{ name?: string }>(await comfyFetch("upload/image", { method: "POST", body: form }));
  if (!uploaded.name) throw new Error("ComfyUI 图片上传未返回文件名");
  return uploaded.name;
}

function outputUrl(file: ComfyOutputFile): string {
  const query = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder || "", type: file.type || "output" });
  return `${config().baseUrl}/view?${query}`;
}

async function history(promptId: string): Promise<ComfyHistory> {
  const response = await comfyFetch(`history/${encodeURIComponent(promptId)}`);
  const result = await responseJson<Record<string, ComfyHistory>>(response);
  return result[promptId] ?? {};
}

function completedFile(result: ComfyHistory): string | undefined {
  if (!result.status?.completed) return undefined;
  if (result.status.status_str !== "success") throw new Error(`ComfyUI 生成失败：${JSON.stringify(result).slice(-2000)}`);
  const file = Object.values(result.outputs ?? {}).flatMap((output) => output.images ?? [])[0];
  if (!file) throw new Error("ComfyUI 已完成，但历史记录没有输出素材");
  return outputUrl(file);
}

export function comfyUIConfigured(): boolean {
  return Boolean(process.env.COMFYUI_LOCAL_URL?.trim());
}

export function comfyUIMissingConfigMessage(): string {
  return "尚未配置 COMFYUI_LOCAL_URL；指向已启动的本地 ComfyUI 服务（例如 http://127.0.0.1:8190）。";
}

export async function generateH3Image(
  prompt: string,
  references: H3Reference[] = [],
  options: { seed: number; aspectRatio?: "16:9" | "9:16" | "1:1" },
): Promise<string> {
  if (!comfyUIConfigured()) throw new Error(comfyUIMissingConfigMessage());
  const settings = config();
  const uploadedReferences = await Promise.all(references.map(async (reference, index) => ({
    nodeId: String(20 + index),
    name: await uploadImage(reference),
  })));
  const dimensions = options.aspectRatio === "9:16" ? [768, 1344] : options.aspectRatio === "1:1" ? [1024, 1024] : [1344, 768];
  const workflow: ComfyWorkflow = {
    "1": { class_type: "UNETLoader", inputs: { unet_name: settings.imageModel, weight_dtype: "default" } },
    "2": { class_type: "CLIPLoaderGGUF", inputs: { clip_name: settings.textEncoder, type: "minimax" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: settings.imageVae } },
    "4": {
      class_type: "MiniMaxH3ImageConditioning",
      inputs: {
        clip: ["2", 0], vae: ["3", 0], prompt, width: dimensions[0], height: dimensions[1],
        ...(uploadedReferences.length ? { images: Object.fromEntries(uploadedReferences.map((reference, index) => [`image_${index + 1}`, [reference.nodeId, 0]])) } : {}),
      },
    },
    "9": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["4", 0] } },
    "6": { class_type: "KSampler", inputs: { model: ["1", 0], seed: options.seed, steps: settings.imageSteps, cfg: 1, sampler_name: "euler", scheduler: "simple", positive: ["4", 0], negative: ["9", 0], latent_image: ["4", 1], denoise: 1 } },
    "7": { class_type: "VAEDecode", inputs: { samples: ["6", 0], vae: ["3", 0] } },
    "8": { class_type: "SaveImage", inputs: { images: ["7", 0], filename_prefix: "dreamcup/h3_scene" } },
  };
  for (const reference of uploadedReferences) {
    workflow[reference.nodeId] = { class_type: "LoadImage", inputs: { image: reference.name } };
  }
  const promptId = await submit(workflow);
  const deadline = Date.now() + (Number(process.env.COMFYUI_H3_IMAGE_TIMEOUT_MS) || 900_000);
  while (Date.now() < deadline) {
    const file = completedFile(await history(promptId));
    if (file) return file;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`H3 Image 生成超时，ComfyUI 任务 ${promptId} 仍保留，可稍后重试。`);
}

export async function submitH3Video(input: { prompt: string; firstFrame: Buffer; firstFrameName: string; aspectRatio: "16:9" | "9:16" | "1:1"; duration: number; seed: number; quality: H3VideoQuality }): Promise<{ requestId: string; model: string }> {
  if (!comfyUIConfigured()) throw new Error(comfyUIMissingConfigMessage());
  const settings = config();
  const uploadedName = await uploadImage({ bytes: input.firstFrame, filename: input.firstFrameName });
  const videoSteps = input.quality === "draft" ? Math.min(12, settings.videoSteps) : settings.videoSteps;
  const dimensions = input.aspectRatio === "9:16" ? [768, 1344] : input.aspectRatio === "1:1" ? [1024, 1024] : [1344, 768];
  const frames = Math.min(362, Math.max(124, 17 * Math.ceil((input.duration * 24 - 5) / 17) + 5));
  const workflow: ComfyWorkflow = {
    "1": { class_type: "UnetLoaderGGUF", inputs: { unet_name: settings.videoModel } },
    "2": { class_type: "CLIPLoaderGGUF", inputs: { clip_name: settings.textEncoder, type: "minimax" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: settings.videoVae } },
    "4": { class_type: "VAELoader", inputs: { vae_name: settings.audioVae } },
    "5": { class_type: "LoadImage", inputs: { image: uploadedName } },
    "6": { class_type: "MiniMaxH3ImageToVideo", inputs: { clip: ["2", 0], vae: ["3", 0], first_frame: ["5", 0], prompt: input.prompt, width: dimensions[0], height: dimensions[1], length: frames } },
    "7": { class_type: "BasicGuider", inputs: { model: ["1", 0], conditioning: ["6", 0] } },
    "8": { class_type: "RandomNoise", inputs: { noise_seed: input.seed } },
    "9": { class_type: "KSamplerSelect", inputs: { sampler_name: "res_multistep" } },
    "10": { class_type: "BasicScheduler", inputs: { model: ["1", 0], scheduler: "simple", steps: videoSteps, denoise: 1 } },
    "11": { class_type: "SamplerCustomAdvanced", inputs: { noise: ["8", 0], guider: ["7", 0], sampler: ["9", 0], sigmas: ["10", 0], latent_image: ["6", 1] } },
    "12": { class_type: "VAEDecodeTiled", inputs: { samples: ["11", 0], vae: ["3", 0], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8 } },
    "13": { class_type: "VAEDecodeAudio", inputs: { samples: ["11", 0], vae: ["4", 0] } },
    "14": { class_type: "CreateVideo", inputs: { images: ["12", 0], audio: ["13", 0], fps: 24 } },
    "15": { class_type: "SaveVideo", inputs: { video: ["14", 0], filename_prefix: "dreamcup/h3_shot", format: "auto", codec: "auto" } },
  };
  return { requestId: await submit(workflow), model: settings.videoModel };
}

function pathWithoutExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]/g, "_") || "first-frame";
}

export async function pollH3Video(promptId: string): Promise<{ status: "running" | "succeeded" | "failed"; videoUrl?: string; error?: string }> {
  try {
    const file = completedFile(await history(promptId));
    return file ? { status: "succeeded", videoUrl: file } : { status: "running" };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("ComfyUI 生成失败")) return { status: "failed", error: error.message };
    throw providerError(error, providerName);
  }
}
