import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { llmFetch } from "@/lib/llm-fetch";
import { getServerDataRoot } from "@/lib/server-data-root";
import { buildVideoPrompt, videoDurationForShots } from "@/lib/storyboard";
import type { DreamStoryboard } from "@/types/dream";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 图生视频首帧需公网 URL；中转站常不接受 data: 超长内联。 */
function isHttpPublicImageUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

function videoErrTextSuggestsBadImageField(msg: string): boolean {
  const m = msg.toLowerCase();
  return m.includes("invalid url") && !m.includes("/videos/");
}

function videoErrTextSuggestsRouteUnsupported(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    (m.includes("invalid url") && m.includes("videos/generations")) ||
    m.includes("post /v1/videos/generations")
  );
}

function extractFirstHttpUrl(text: string): string {
  const match = text.match(/https?:\/\/[^\s"'<>\\)]+/i);
  return match?.[0] || "";
}

function extractTextFromChatContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const p = part as Record<string, unknown>;
      return typeof p.text === "string" ? p.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function extractVideoUrlFromJson(value: unknown): string {
  if (typeof value === "string") return extractFirstHttpUrl(value);
  if (!value || typeof value !== "object") return "";

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractVideoUrlFromJson(item);
      if (found) return found;
    }
    return "";
  }

  const obj = value as Record<string, unknown>;
  for (const key of ["videoUrl", "video_url", "url", "output_url"]) {
    const v = obj[key];
    if (typeof v === "string") {
      const found = extractFirstHttpUrl(v);
      if (found) return found;
    }
  }

  const choices = obj.choices;
  if (Array.isArray(choices)) {
    for (const choice of choices) {
      if (!choice || typeof choice !== "object") continue;
      const c = choice as Record<string, unknown>;
      const message = c.message as Record<string, unknown> | undefined;
      const delta = c.delta as Record<string, unknown> | undefined;
      const content =
        extractTextFromChatContent(message?.content) ||
        extractTextFromChatContent(delta?.content) ||
        extractTextFromChatContent(c.content);
      const found = extractFirstHttpUrl(content);
      if (found) return found;
    }
  }

  for (const key of ["video", "data", "output", "result"]) {
    const found = extractVideoUrlFromJson(obj[key]);
    if (found) return found;
  }

  return "";
}

function extractVideoUrlFromText(text: string): string {
  const direct = extractFirstHttpUrl(text);
  if (direct) return direct;

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && line !== "data: [DONE]");

  for (const line of lines) {
    const jsonText = line.startsWith("data:") ? line.slice(5).trim() : line;
    try {
      const found = extractVideoUrlFromJson(JSON.parse(jsonText));
      if (found) return found;
    } catch {
      // Some proxies return plain text chunks; keep scanning.
    }
  }

  return "";
}

function videoExtFromUrlAndType(url: string, contentType: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes("video/webm")) return "webm";
  if (ct.includes("quicktime")) return "mov";
  if (ct.includes("video/mp4") || ct.includes("application/octet-stream")) return "mp4";

  try {
    const ext = new URL(url).pathname.split(".").pop()?.toLowerCase() || "";
    if (["mp4", "webm", "mov"].includes(ext)) return ext;
  } catch {
    // Ignore malformed remote URL here; caller already validated it enough to fetch.
  }

  return "mp4";
}

async function cacheRemoteVideoUrl(videoUrl: string, apiKey: string): Promise<string | null> {
  if (!/^https?:\/\//i.test(videoUrl)) return null;

  const res = await llmFetch(videoUrl, {
    headers: {
      Accept: "video/*,*/*",
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn("Video cache: remote download failed", res.status, text.slice(0, 300));
    return null;
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0) {
    console.warn("Video cache: remote download returned empty body");
    return null;
  }

  const videoDir = path.join(getServerDataRoot(), "video");
  fs.mkdirSync(videoDir, { recursive: true });
  const ext = videoExtFromUrlAndType(videoUrl, res.headers.get("content-type") || "");
  const filename = `${randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(videoDir, filename), buffer);
  return `/api/video-file/${encodeURIComponent(filename)}`;
}

export async function POST(request: NextRequest) {
  try {
    const { sceneImageUrls, dreamStructured, storyboard } = await request.json() as {
      sceneImageUrls?: string[];
      dreamStructured?: Record<string, unknown>;
      storyboard?: DreamStoryboard;
    };

    if (!dreamStructured) {
      return NextResponse.json({ error: "No dream data provided" }, { status: 400 });
    }

    const grokApiUrl = process.env.GROK_API_URL?.replace(/\/$/, "");
    const grokApiKey = process.env.GROK_API_KEY;
    const grokVideoModel = process.env.GROK_VIDEO_MODEL || "grok-imagine-video";
    const videoGenPath =
      process.env.GROK_VIDEO_GENERATIONS_PATH?.replace(/^\/+/, "") || "videos/generations";
    const pollIntervalMs = Math.max(
      1000,
      Number(process.env.GROK_VIDEO_POLL_INTERVAL_MS) || 5000
    );
    const pollTimeoutMs = Math.max(
      60_000,
      Number(process.env.GROK_VIDEO_POLL_TIMEOUT_MS) || 900_000
    );

    if (!grokApiUrl || !grokApiKey) {
      const narrativeSummary = (dreamStructured.narrative as { summary?: string } | undefined)?.summary || "";
      const sceneDescriptions = ((dreamStructured.scenes || []) as { description: string }[])
        .map((s: { description: string }, i: number) => `场景${i + 1}: ${s.description}`)
        .join("\n");
      const emotionSummary = ((dreamStructured.emotions || []) as { type: string; intensity: number }[])
        .map((e: { type: string; intensity: number }) => `${e.type}(强度${e.intensity})`)
        .join("、");

      return NextResponse.json({
        status: "not_configured",
        message: "视频生成API未配置",
        videoPrompt: `基于以下梦境数据生成一段流畅的梦境视频：\n\n叙事概要：${narrativeSummary}\n\n场景序列：\n${sceneDescriptions}\n\n情绪氛围：${emotionSummary}`,
        sceneImageUrls: sceneImageUrls || [],
      });
    }

    const typedStructured = dreamStructured as {
      narrative?: { summary?: string };
      scenes?: { description: string }[];
      emotions?: { type: string; intensity: number }[];
    };
    const narrativeSummary = typedStructured.narrative?.summary || "";
    const sceneDescriptions = (typedStructured.scenes || [])
      .map((scene, index) => `场景${index + 1}: ${scene.description}`)
      .join("; ");
    const emotionSummary = (typedStructured.emotions || []).map((emotion) => emotion.type).join(", ");
    const firstShot = storyboard?.shots?.[0];
    const videoPrompt = firstShot
      ? `${firstShot.videoPrompt || buildVideoPrompt(firstShot)}\n\nThis is the opening shot of a larger dream film titled \"${storyboard?.title || "Dream"}\". Establish visual motifs that can continue through the following shots.`
      : `A dreamlike cinematic video: ${sceneDescriptions}. Mood: ${emotionSummary}. Narrative: ${narrativeSummary}`;
    const videoDuration = storyboard ? videoDurationForShots(storyboard.shots) : 10;
    const aspectRatio = storyboard?.aspectRatio || "16:9";

    const urls: string[] = Array.isArray(sceneImageUrls) ? sceneImageUrls.filter(Boolean) : [];
    const startImageUrl = typeof urls[0] === "string" ? urls[0] : "";
    const canFirstFrame = Boolean(startImageUrl && isHttpPublicImageUrl(startImageUrl));
    if (startImageUrl && !canFirstFrame) {
      console.warn(
        "Video: scene image is not http(s); skipping image-to-video first frame (use hosted URL or text-only)"
      );
    }

    const buildStartBody = (withFirstFrame: boolean): Record<string, unknown> => {
      const b: Record<string, unknown> = {
        model: grokVideoModel,
        prompt: videoPrompt,
        duration: videoDuration,
        aspect_ratio: aspectRatio,
        resolution: "720p",
      };
      if (withFirstFrame && startImageUrl) {
        b.image = { url: startImageUrl, type: "image_url" };
      }
      return b;
    };

    const postVideoStart = (body: Record<string, unknown>) =>
      llmFetch(`${grokApiUrl}/${videoGenPath}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${grokApiKey}`,
        },
        body: JSON.stringify(body),
      });

    const postChatVideo = () =>
      llmFetch(`${grokApiUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${grokApiKey}`,
        },
        body: JSON.stringify({
          model: grokVideoModel,
          messages: [
            {
              role: "user",
              content: `${videoPrompt}\n\nGenerate a ${videoDuration}-second ${aspectRatio} 720p video. Return the generated video URL when complete.`,
            },
          ],
          stream: false,
        }),
      });

    let startRes = await postVideoStart(buildStartBody(canFirstFrame));
    let errorText = "";

    if (!startRes.ok) {
      errorText = await startRes.text();
      if (canFirstFrame && videoErrTextSuggestsBadImageField(errorText)) {
        console.warn("Video: retrying text-to-video without first-frame image");
        startRes = await postVideoStart(buildStartBody(false));
        if (!startRes.ok) errorText = await startRes.text();
        else errorText = "";
      }
    }

    if (!startRes.ok) {
      console.error("Video generation start error:", errorText);
      const routeUnsupported = videoErrTextSuggestsRouteUnsupported(errorText);
      if (routeUnsupported) {
        const chatRes = await postChatVideo();
        const chatText = await chatRes.text();
        if (chatRes.ok) {
          const chatVideoUrl = extractVideoUrlFromText(chatText);
          if (chatVideoUrl) {
            const cachedVideoUrl = await cacheRemoteVideoUrl(chatVideoUrl, grokApiKey).catch((error) => {
              console.warn("Video cache error:", error);
              return null;
            });
            if (!cachedVideoUrl) {
              return NextResponse.json(
                {
                  status: "error",
                  message: "视频已生成，但远程视频无法缓存到本地，当前地址可能无法直接播放",
                  detail:
                    "浏览器需要能访问远程视频源；当前环境对 assets.grok.com 解析/访问不稳定。可配置 LLM_HTTPS_PROXY 后重新生成并缓存。",
                  sourceVideoUrl: chatVideoUrl,
                  videoPrompt,
                },
                { status: 502 }
              );
            }
            return NextResponse.json({
              status: "video_ready",
              videoUrl: cachedVideoUrl,
              videoPrompt,
              sourceVideoUrl: chatVideoUrl,
            });
          }
          console.error("Video chat fallback: missing video URL", chatText);
          return NextResponse.json(
            {
              status: "error",
              message: "视频生成失败（chat/completions 未返回可解析的视频 URL）",
              detail: chatText,
              videoPrompt,
            },
            { status: 500 }
          );
        }
        console.error("Video chat fallback error:", chatText);
        return NextResponse.json(
          {
            status: "error",
            message: "视频生成失败（chat/completions 兜底失败）",
            detail: chatText,
            videoPrompt,
          },
          { status: 500 }
        );
      }
      return NextResponse.json(
        {
          status: "error",
          message: routeUnsupported
            ? "中转站未识别视频生成路径（可能未开放 Grok 视频）"
            : "视频生成失败（提交任务）",
          detail: errorText,
          videoPrompt,
          ...(routeUnsupported
            ? {
                proxyHint:
                  "返回体指向 POST /v1/videos/generations，多为网关未实现 xAI 异步视频接口。请向服务商确认是否支持 grok-imagine-video，或参考 https://docs.x.ai/developers/model-capabilities/video/generation 换用直连/其它兼容地址。也可设置 GROK_VIDEO_GENERATIONS_PATH 若对方文档要求不同子路径。",
              }
            : {}),
        },
        { status: 500 }
      );
    }

    const startJson = (await startRes.json()) as { request_id?: string };
    const requestId = startJson.request_id;
    if (!requestId) {
      console.error("Video generation: missing request_id", startJson);
      return NextResponse.json(
        {
          status: "error",
          message: "视频生成失败（未返回 request_id）",
          detail: JSON.stringify(startJson),
          videoPrompt,
        },
        { status: 500 }
      );
    }

    const deadline = Date.now() + pollTimeoutMs;
    let videoUrl = "";

    while (Date.now() < deadline) {
      const statusRes = await llmFetch(`${grokApiUrl}/videos/${requestId}`, {
        headers: { Authorization: `Bearer ${grokApiKey}` },
      });

      if (!statusRes.ok) {
        const errorText = await statusRes.text();
        console.error("Video poll error:", errorText);
        return NextResponse.json(
          {
            status: "error",
            message: "视频生成失败（查询状态）",
            detail: errorText,
            videoPrompt,
          },
          { status: 500 }
        );
      }

      const statusJson = (await statusRes.json()) as {
        status?: string;
        video?: { url?: string };
        error?: { message?: string };
      };

      if (statusJson.status === "done" && statusJson.video?.url) {
        videoUrl = statusJson.video.url;
        break;
      }
      if (statusJson.status === "expired") {
        return NextResponse.json({
          status: "error",
          message: "视频生成已过期",
          videoPrompt,
        });
      }
      if (statusJson.status === "failed") {
        return NextResponse.json({
          status: "error",
          message: "视频生成失败",
          detail: statusJson.error?.message || JSON.stringify(statusJson),
          videoPrompt,
        });
      }

      await sleep(pollIntervalMs);
    }

    if (!videoUrl) {
      return NextResponse.json({
        status: "error",
        message: "视频生成超时",
        videoPrompt,
      });
    }

    const cachedVideoUrl = await cacheRemoteVideoUrl(videoUrl, grokApiKey).catch((error) => {
      console.warn("Video cache error:", error);
      return null;
    });
    if (!cachedVideoUrl) {
      return NextResponse.json(
        {
          status: "error",
          message: "视频已生成，但远程视频无法缓存到本地，当前地址可能无法直接播放",
          detail:
            "浏览器需要能访问远程视频源；当前环境对视频资源域名解析/访问不稳定。可配置 LLM_HTTPS_PROXY 后重新生成并缓存。",
          sourceVideoUrl: videoUrl,
          videoPrompt,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      status: "video_ready",
      videoUrl: cachedVideoUrl,
      videoPrompt,
      sourceVideoUrl: videoUrl,
    });
  } catch (error) {
    console.error("Video generation error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
