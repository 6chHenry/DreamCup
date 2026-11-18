import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { NarrationProvider } from "@/types/dream";
import { llmFetch } from "@/lib/llm-fetch";
import { missingProviderConfig, providerError, providerResponseError } from "@/lib/provider-errors";

export interface NarrationAdapter { configured(): boolean; synthesize(text: string, directory: string, id: string): Promise<string | null> }

async function saveAudio(response: Response, directory: string, id: string): Promise<string> {
  const type = response.headers.get("content-type") || "";
  if (type.includes("json") || type.includes("html")) throw providerError(new Error("配音接口返回的不是音频"), "配音");
  const extension = type.includes("wav") ? "wav" : type.includes("ogg") ? "ogg" : "mp3";
  const target = path.join(directory, `${id}.${extension}`);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  return target;
}

const volcengine: NarrationAdapter = {
  configured: () => Boolean(process.env.VOLCENGINE_TTS_APP_ID?.trim() && process.env.VOLCENGINE_TTS_ACCESS_TOKEN?.trim()),
  async synthesize(text, directory, id) {
    const appId = process.env.VOLCENGINE_TTS_APP_ID?.trim();
    const accessToken = process.env.VOLCENGINE_TTS_ACCESS_TOKEN?.trim();
    if (!appId || !accessToken) throw missingProviderConfig("火山配音未配置 VOLCENGINE_TTS_APP_ID / VOLCENGINE_TTS_ACCESS_TOKEN；将保留字幕并继续无声合成。");
    try {
      const response = await llmFetch(process.env.VOLCENGINE_TTS_URL || "https://openspeech.bytedance.com/api/v1/tts", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer;${accessToken}` },
        body: JSON.stringify({
          app: { appid: appId, token: accessToken, cluster: process.env.VOLCENGINE_TTS_CLUSTER || "volcano_tts" },
          user: { uid: "dreamcup" }, audio: { voice_type: process.env.VOLCENGINE_TTS_VOICE || "zh_female_qingxin", encoding: "mp3", speed_ratio: Number(process.env.VOLCENGINE_TTS_SPEED) || 0.92 },
          request: { reqid: randomUUID(), text, text_type: "plain", operation: "query" },
        }),
      });
      if (!response.ok) throw await providerResponseError(response, "火山配音");
      const result = await response.json() as { code?: number; message?: string; data?: string };
      if (result.code !== 3000 || !result.data) throw providerError(new Error(result.message || `配音返回码 ${result.code}`), "火山配音");
      const target = path.join(directory, `${id}.mp3`);
      fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(target, Buffer.from(result.data, "base64"));
      return target;
    } catch (error) { throw providerError(error, "火山配音"); }
  },
};

const openai: NarrationAdapter = {
  configured: () => Boolean(process.env.OPENAI_TTS_API_URL?.trim() && process.env.OPENAI_TTS_API_KEY?.trim()),
  async synthesize(text, directory, id) {
    const apiUrl = process.env.OPENAI_TTS_API_URL?.trim();
    const apiKey = process.env.OPENAI_TTS_API_KEY?.trim();
    if (!apiUrl || !apiKey) throw missingProviderConfig("OpenAI 兼容配音未配置 OPENAI_TTS_API_URL / OPENAI_TTS_API_KEY；将保留字幕并继续无声合成。");
    try {
      const response = await llmFetch(`${apiUrl.replace(/\/$/, "")}/audio/speech`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts", voice: process.env.OPENAI_TTS_VOICE || "alloy", input: text, response_format: "mp3" }),
      });
      if (!response.ok) throw await providerResponseError(response, "OpenAI 兼容配音");
      return saveAudio(response, directory, id);
    } catch (error) { throw providerError(error, "OpenAI 兼容配音"); }
  },
};

const azure: NarrationAdapter = {
  configured: () => Boolean(process.env.AZURE_SPEECH_KEY?.trim() && process.env.AZURE_SPEECH_REGION?.trim()),
  async synthesize(text, directory, id) {
    const key = process.env.AZURE_SPEECH_KEY?.trim();
    const region = process.env.AZURE_SPEECH_REGION?.trim();
    if (!key || !region) throw missingProviderConfig("Azure 配音未配置 AZURE_SPEECH_KEY / AZURE_SPEECH_REGION；将保留字幕并继续无声合成。");
    const voice = process.env.AZURE_SPEECH_VOICE || "zh-CN-XiaoxiaoNeural";
    const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
    try {
      const response = await llmFetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: "POST", headers: { "Ocp-Apim-Subscription-Key": key, "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3" },
        body: `<speak version='1.0' xml:lang='zh-CN'><voice xml:lang='zh-CN' name='${voice}'><prosody rate='-8%'>${escaped}</prosody></voice></speak>`,
      });
      if (!response.ok) throw await providerResponseError(response, "Azure 配音");
      return saveAudio(response, directory, id);
    } catch (error) { throw providerError(error, "Azure 配音"); }
  },
};

const adapters: Partial<Record<NarrationProvider, NarrationAdapter>> = { volcengine, openai, azure };
export function getNarrationAdapter(provider: NarrationProvider): NarrationAdapter | undefined { return adapters[provider]; }
