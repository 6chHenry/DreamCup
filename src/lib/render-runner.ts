import fs from "fs";
import path from "path";
import type { RenderShotTask, VideoRenderJob } from "@/types/dream";
import { getRenderJob, getRenderJobs, saveRenderJob, saveRenderJobAtomic, updateRenderJobAtomic } from "@/lib/render-job-store";
import { getDreamById, updateDream } from "@/lib/dream-store";
import { getServerDataRoot } from "@/lib/server-data-root";
import { assembleRenderJob, getJobDirectory, synthesizeNarration } from "@/lib/ffmpeg-render";
import { materializeMedia } from "@/lib/media-files";
import { getVideoProviderAdapter } from "@/lib/video-providers";
import { ProviderError } from "@/lib/provider-errors";

const activeJobs = new Set<string>();
const activeControllers = new Map<string, AbortController>();
let recoveredJobs = false;

export class RenderCancelledError extends Error {
  constructor() { super("任务已暂停"); this.name = "RenderCancelledError"; }
}

function throwIfCancelled(jobId: string, signal: AbortSignal): void {
  if (signal.aborted || getRenderJob(jobId)?.status === "cancelled") throw new RenderCancelledError();
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(new RenderCancelledError()); }, { once: true });
  });
}

function patchShot(job: VideoRenderJob, shotId: string, patch: Partial<RenderShotTask>): Promise<VideoRenderJob> {
  return updateRenderJobAtomic(job.id, (current) => ({ ...current, shots: current.shots.map((shot) => shot.shotId === shotId ? { ...shot, ...patch } : shot) }));
}

async function cacheShotVideo(remoteUrl: string, jobId: string, shotId: string): Promise<string> {
  const directory = path.join(getJobDirectory(jobId), "shots");
  const localPath = await materializeMedia(remoteUrl, directory, shotId);
  return `/api/media/renders/${encodeURIComponent(path.basename(localPath))}`;
}

function addWarning(job: VideoRenderJob, message: string): VideoRenderJob {
  return job.warnings?.includes(message) ? job : { ...job, warnings: [...(job.warnings ?? []), message] };
}

async function createOfflineShot(job: VideoRenderJob, index: number, reason: string): Promise<VideoRenderJob> {
  const shot = job.storyboard.shots[index];
  const dream = getDreamById(job.dreamId)!;
  const image = dream.scenes.find((scene) => scene.sceneIndex === shot.sceneIndex && scene.imageUrl)?.imageUrl;
  if (!image) throw new Error(`镜头 ${index + 1} 缺少场景图，无法离线回退。`);
  const directory = path.join(getJobDirectory(job.id), "frames");
  const localPath = await materializeMedia(image, directory, shot.id);
  return updateRenderJobAtomic(job.id, (current) => ({
    ...addWarning(current, `镜头 ${index + 1}：${reason}`),
    shots: current.shots.map((task) => task.shotId === shot.id ? { ...task, status: "ready" as const, provider: "storyboard_preview" as const, videoUrl: `/api/media/renders/${encodeURIComponent(path.basename(localPath))}`, fallbackReason: reason, completedAt: new Date().toISOString() } : task),
  }));
}

async function generateNarration(job: VideoRenderJob, shotIndex: number): Promise<string | null> {
  const shot = job.storyboard.shots[shotIndex];
  const directory = path.join(getServerDataRoot(), "narration");
  const result = await synthesizeNarration(shot.narration, job.narrationProvider, directory, `${job.id}-${shot.id}`);
  return result ? `/api/media/narration/${encodeURIComponent(path.basename(result))}` : null;
}

export async function runRenderJob(jobId: string): Promise<VideoRenderJob> {
  let job = getRenderJob(jobId);
  if (!job) throw new Error("合成任务不存在");
  const dream = getDreamById(job.dreamId);
  if (!dream) throw new Error("任务对应的梦境不存在");
  if (activeJobs.has(jobId)) return job;
  activeJobs.add(jobId);
  const controller = new AbortController();
  activeControllers.set(jobId, controller);
  const { signal } = controller;
  job = await saveRenderJobAtomic({ ...job, status: "running", stage: job.stage === "complete" ? "assembly" : job.stage, error: undefined });
  updateDream(dream.id, { activeRenderJobId: job.id });

  try {
    for (let index = 0; index < job.storyboard.shots.length; index++) {
      throwIfCancelled(jobId, signal);
      const shot = job.storyboard.shots[index];
      let task = job.shots.find((item) => item.shotId === shot.id);
      if (!task || task.status === "ready") continue;
      const existingAdapter = getVideoProviderAdapter(job.provider);
      if (task.providerRequestId && existingAdapter) {
        job = await patchShot(job, shot.id, { status: "running", attempts: task.attempts + 1, error: undefined, startedAt: new Date().toISOString() });
        try {
          const deadline = Date.now() + (Number(process.env.GROK_VIDEO_POLL_TIMEOUT_MS) || 900_000);
          while (Date.now() < deadline) {
            throwIfCancelled(jobId, signal);
            const status = await existingAdapter.poll(job, task.providerRequestId);
            if (status.status === "succeeded" && status.videoUrl) {
              job = await patchShot(job, shot.id, { status: "ready", videoUrl: await cacheShotVideo(status.videoUrl, job.id, shot.id), completedAt: new Date().toISOString() });
              break;
            }
            if (["failed", "expired", "cancelled"].includes(status.status)) throw new Error(status.error || `镜头生成${status.status}`);
            await sleep(Number(process.env.GROK_VIDEO_POLL_INTERVAL_MS) || 5000, signal);
          }
          task = job.shots.find((item) => item.shotId === shot.id);
          if (task?.status === "ready") continue;
          throw new Error("远程任务轮询超时，可继续恢复查询。");
        } catch (error) {
          if (error instanceof RenderCancelledError) throw error;
          if (error instanceof ProviderError && error.kind === "configuration") { job = await createOfflineShot(job, index, error.message); continue; }
          job = await patchShot(job, shot.id, { status: "failed", error: error instanceof Error ? error.message : String(error) });
          return saveRenderJobAtomic({ ...job, status: "failed", error: `镜头 ${index + 1} 恢复失败；可从现有供应商任务继续。` });
        }
      }
      job = await patchShot(job, shot.id, { status: "running", attempts: task.attempts + 1, error: undefined, startedAt: new Date().toISOString() });
      try {
        if (job.provider === "storyboard_preview") {
          const image = dream.scenes.find((scene) => scene.sceneIndex === shot.sceneIndex && scene.imageUrl)?.imageUrl;
          if (!image) throw new Error("缺少场景图，请先补图或移除该镜头。");
          const directory = path.join(getJobDirectory(job.id), "frames");
          const localPath = await materializeMedia(image, directory, shot.id);
          job = await patchShot(job, shot.id, { status: "ready", videoUrl: `/api/media/renders/${encodeURIComponent(path.basename(localPath))}`, completedAt: new Date().toISOString() });
        } else {
          const adapter = getVideoProviderAdapter(job.provider);
          if (!adapter) throw new ProviderError(`${job.provider} 适配器尚未注册；本镜头将使用离线分镜样片。`, "configuration");
          if (!adapter.configured()) throw new ProviderError(adapter.missingConfigMessage(), "configuration");
          const result = await adapter.submit({ job, shot, shotIndex: index, dream });
          if (result.videoUrl) {
            job = await patchShot(job, shot.id, { status: "ready", videoUrl: await cacheShotVideo(result.videoUrl, job.id, shot.id), providerModel: result.model, completedAt: new Date().toISOString() });
          } else if (result.requestId) {
            job = await patchShot(job, shot.id, { status: "waiting_api", providerRequestId: result.requestId, providerModel: result.model });
            const deadline = Date.now() + (Number(process.env.GROK_VIDEO_POLL_TIMEOUT_MS) || 900_000);
            while (Date.now() < deadline) {
              await sleep(Number(process.env.GROK_VIDEO_POLL_INTERVAL_MS) || 5000, signal);
              throwIfCancelled(jobId, signal);
              const status = await adapter.poll(job, result.requestId);
              if (status.status === "succeeded" && status.videoUrl) {
                job = await patchShot(job, shot.id, { status: "ready", videoUrl: await cacheShotVideo(status.videoUrl, job.id, shot.id), completedAt: new Date().toISOString() });
                break;
              }
              if (["failed", "expired", "cancelled"].includes(status.status)) throw new Error(status.error || `镜头生成${status.status}`);
            }
            task = job.shots.find((item) => item.shotId === shot.id);
            if (task?.status !== "ready") throw new Error("镜头生成超时，可稍后从当前任务重试。");
          } else throw new Error("视频服务未返回任务 ID 或素材地址。");
        }
      } catch (error) {
        if (error instanceof RenderCancelledError) throw error;
        if (error instanceof ProviderError && error.kind === "configuration") {
          job = await createOfflineShot(job, index, error.message);
          continue;
        }
        job = await patchShot(job, shot.id, { status: "failed", error: error instanceof Error ? error.message : String(error) });
        if (job.mode === "generated") {
          return saveRenderJobAtomic({ ...job, status: "failed", error: `镜头 ${index + 1} 失败；修复后可从该镜头继续。` });
        }
      }
    }

    job = await saveRenderJobAtomic({ ...job, stage: "narration" });
    for (let index = 0; index < job.storyboard.shots.length; index++) {
      const shot = job.storyboard.shots[index];
      const task = job.shots.find((item) => item.shotId === shot.id);
      if (!task || task.status !== "ready" || task.narrationUrl) continue;
      throwIfCancelled(jobId, signal);
      try {
        const narrationUrl = await generateNarration(job, index);
        if (narrationUrl) job = await patchShot(job, shot.id, { narrationUrl });
      } catch (error) {
        const message = `镜头 ${index + 1} 配音失败：${error instanceof Error ? error.message : String(error)}`;
        if (error instanceof ProviderError && error.kind === "configuration") {
          job = await saveRenderJobAtomic(addWarning(job, message));
          continue;
        }
        return saveRenderJobAtomic({ ...job, status: "failed", error: message });
      }
    }

    job = await saveRenderJobAtomic({ ...job, stage: "assembly" });
    const result = await assembleRenderJob(job, signal);
    throwIfCancelled(jobId, signal);
    job = await saveRenderJobAtomic({ ...job, status: "ready", stage: "complete", ...result, error: undefined });
    updateDream(dream.id, { videoUrl: result.outputUrl, activeRenderJobId: job.id });
    return job;
  } catch (error) {
    if (error instanceof RenderCancelledError || signal.aborted || getRenderJob(jobId)?.status === "cancelled") {
      const current = getRenderJob(jobId) ?? job;
      return saveRenderJobAtomic({ ...current, status: "cancelled", error: "任务已暂停；继续时会跳过已完成镜头。", shots: current.shots.map((shot) => shot.status === "running" || shot.status === "waiting_api" ? { ...shot, status: "queued" as const } : shot) });
    }
    return saveRenderJobAtomic({ ...job, status: "failed", error: error instanceof Error ? error.message : String(error) });
  } finally {
    activeJobs.delete(jobId);
    activeControllers.delete(jobId);
  }
}

export function startRenderJob(jobId: string): void {
  if (activeJobs.has(jobId)) return;
  void runRenderJob(jobId).catch((error) => console.error("Render job failed", error));
}

export function resumeRenderJobs(): void {
  if (recoveredJobs) return;
  recoveredJobs = true;
  const directory = path.join(getServerDataRoot(), "renders");
  fs.mkdirSync(directory, { recursive: true });
  for (const job of getRenderJobs()) {
    if (!["queued", "running", "waiting_api"].includes(job.status)) continue;
    const recovered = saveRenderJob({
      ...job, status: "queued" as const, stage: "shots" as const,
      error: "服务重启后已恢复任务，将从已保存的进度继续。",
      shots: job.shots.map((shot) => shot.status === "running" ? { ...shot, status: "queued" as const } : shot),
    });
    startRenderJob(recovered.id);
  }
}

export function cancelRenderJob(jobId: string): VideoRenderJob {
  const job = getRenderJob(jobId);
  if (!job) throw new Error("合成任务不存在");
  activeControllers.get(jobId)?.abort();
  return saveRenderJob({ ...job, status: "cancelled", error: "任务已暂停；继续时会跳过已完成镜头。" });
}
