import { NextRequest, NextResponse } from "next/server";
import { createRenderJob, getDreamRenderJobs, getLatestRenderJob } from "@/lib/render-job-store";
import { getDreamById } from "@/lib/dream-store";
import { createDefaultStoryboard } from "@/lib/storyboard";
import { DreamStoryboardSchema } from "@/lib/schema";
import { startRenderJob } from "@/lib/render-runner";
import type { NarrationProvider, VideoRenderProvider } from "@/types/dream";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const dreamId = request.nextUrl.searchParams.get("dreamId");
  if (!dreamId) return NextResponse.json({ error: "dreamId is required" }, { status: 400 });
  if (request.nextUrl.searchParams.get("history") === "1") return NextResponse.json(getDreamRenderJobs(dreamId));
  return NextResponse.json(getLatestRenderJob(dreamId) ?? null);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const dream = getDreamById(body.dreamId);
    if (!dream) return NextResponse.json({ error: "梦境不存在" }, { status: 404 });
    const storyboard = DreamStoryboardSchema.parse(body.storyboard ?? dream.storyboard ?? createDefaultStoryboard(dream));
    const provider = (body.provider || "comfyui_h3") as VideoRenderProvider;
    const narrationProvider = (body.narrationProvider || "silent") as NarrationProvider;
    if (!["storyboard_preview", "grok", "jimeng", "comfyui_h3", "generic"].includes(provider) || !["silent", "browser", "openai", "volcengine", "azure"].includes(narrationProvider)) {
      return NextResponse.json({ error: "不支持的视频或配音提供方" }, { status: 400 });
    }
    const narrationVolume = Number(body.narrationVolume ?? 1);
    const musicVolume = Number(body.musicVolume ?? 0.18);
    const generationQuality = body.generationQuality === "draft" ? "draft" : "quality";
    if (narrationVolume < 0 || narrationVolume > 2 || musicVolume < 0 || musicVolume > 1) return NextResponse.json({ error: "音量参数超出范围" }, { status: 400 });
    const job = createRenderJob(dream, storyboard, provider, narrationProvider, body.backgroundAudioUrl, { narrationVolume, musicVolume, showSubtitles: body.showSubtitles !== false, generationQuality });
    startRenderJob(job.id);
    return NextResponse.json(job, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "创建合成任务失败" }, { status: 400 });
  }
}
