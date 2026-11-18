import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { Dream, DreamStoryboard, NarrationProvider, VideoGenerationQuality, VideoRenderJob, VideoRenderProvider } from "@/types/dream";
import { getServerDataRoot } from "@/lib/server-data-root";
import { VideoRenderJobSchema } from "@/lib/schema";

const filePath = () => path.join(getServerDataRoot(), "render-jobs.json");
let mutationQueue: Promise<unknown> = Promise.resolve();

function mutate<T>(action: () => T): Promise<T> {
  const result = mutationQueue.then(action, action);
  mutationQueue = result.catch(() => {});
  return result;
}

export function getRenderJobs(): VideoRenderJob[] {
  try {
    const data = JSON.parse(fs.readFileSync(filePath(), "utf8"));
    return Array.isArray(data) ? data.map((job) => VideoRenderJobSchema.parse(job)) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("Read render jobs:", error);
    return [];
  }
}

export function saveRenderJob(job: VideoRenderJob): VideoRenderJob {
  const jobs = getRenderJobs();
  const next = { ...job, updatedAt: new Date().toISOString() };
  const index = jobs.findIndex((item) => item.id === job.id);
  const current = index >= 0 ? jobs[index] : undefined;
  if (current?.status === "cancelled" && job.status !== "queued") {
    next.status = "cancelled";
    next.shots = current.shots;
  }
  if (index >= 0) jobs[index] = next;
  else jobs.unshift(next);
  fs.mkdirSync(getServerDataRoot(), { recursive: true });
  const temporary = `${filePath()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(jobs, null, 2), "utf8");
  fs.renameSync(temporary, filePath());
  return next;
}

export function saveRenderJobAtomic(job: VideoRenderJob): Promise<VideoRenderJob> {
  return mutate(() => saveRenderJob(job));
}

export function updateRenderJobAtomic(id: string, update: (job: VideoRenderJob) => VideoRenderJob): Promise<VideoRenderJob> {
  return mutate(() => {
    const current = getRenderJob(id);
    if (!current) throw new Error("合成任务不存在");
    return saveRenderJob({ ...update(current), id });
  });
}

export function updateRenderJob(id: string, update: (job: VideoRenderJob) => VideoRenderJob): VideoRenderJob {
  const current = getRenderJob(id);
  if (!current) throw new Error("合成任务不存在");
  return saveRenderJob({ ...update(current), id });
}

export function getRenderJob(id: string): VideoRenderJob | undefined {
  return getRenderJobs().find((job) => job.id === id);
}

export function getLatestRenderJob(dreamId: string): VideoRenderJob | undefined {
  return getRenderJobs().filter((job) => job.dreamId === dreamId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

export function getDreamRenderJobs(dreamId: string): VideoRenderJob[] {
  return getRenderJobs().filter((job) => job.dreamId === dreamId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function createRenderJob(
  dream: Dream, storyboard: DreamStoryboard, provider: VideoRenderProvider,
  narrationProvider: NarrationProvider, backgroundAudioUrl?: string,
  mix: { narrationVolume?: number; musicVolume?: number; showSubtitles?: boolean; generationQuality?: VideoGenerationQuality } = {},
): VideoRenderJob {
  const now = new Date().toISOString();
  return saveRenderJob({
    id: randomUUID(), dreamId: dream.id, status: "queued", stage: "shots",
    mode: provider === "storyboard_preview" ? "preview" : "generated", provider, narrationProvider,
    backgroundAudioUrl, storyboard,
    narrationVolume: mix.narrationVolume ?? 1,
    musicVolume: mix.musicVolume ?? 0.18,
    showSubtitles: mix.showSubtitles ?? true,
    generationQuality: mix.generationQuality ?? "quality",
    shots: storyboard.shots.map((shot) => ({ shotId: shot.id, status: "queued", provider, attempts: 0 })),
    createdAt: now, updatedAt: now,
  });
}
