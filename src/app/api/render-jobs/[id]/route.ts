import { NextRequest, NextResponse } from "next/server";
import { getRenderJob, saveRenderJob } from "@/lib/render-job-store";
import { cancelRenderJob, runRenderJob, startRenderJob } from "@/lib/render-runner";
import { getDreamById } from "@/lib/dream-store";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getRenderJob(id);
  if (!job) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  return NextResponse.json(job);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getRenderJob(id);
  if (!job) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  const body = await request.json();
  if (body.action === "retry") {
    if (["running", "waiting_api"].includes(job.status)) return NextResponse.json({ error: "任务仍在运行，请先暂停。" }, { status: 409 });
    const shotIds = new Set(body.shotIds || job.shots.filter((shot) => shot.status === "failed").map((shot) => shot.shotId));
    const resumeAssembly = shotIds.size === 0;
    const needsNarration = job.narrationProvider !== "silent" && job.shots.some((shot) => !shot.narrationUrl && job.storyboard.shots.find((item) => item.id === shot.shotId)?.narration.trim());
    const stage = resumeAssembly ? (needsNarration ? "narration" : job.shots.some((shot) => shot.status !== "ready") ? "shots" : "assembly") : "shots";
    const reset = saveRenderJob({
      ...job, status: "queued", stage, error: undefined,
      shots: job.shots.map((shot) => shotIds.has(shot.shotId) ? { ...shot, status: "queued" as const, error: undefined, providerRequestId: undefined } : shot),
    });
    startRenderJob(reset.id);
    return NextResponse.json(reset);
  }
  if (body.action === "run") {
    if (job.status === "ready" && job.outputUrl) return NextResponse.json(job);
    const reset = saveRenderJob({ ...job, status: "queued", error: undefined });
    startRenderJob(reset.id);
    return NextResponse.json(reset);
  }
  if (body.action === "run_wait") return NextResponse.json(await runRenderJob(job.id));
  if (body.action === "cancel") return NextResponse.json(cancelRenderJob(job.id));
  if (body.action === "select") {
    const dream = getDreamById(job.dreamId);
    if (dream) {
      const { updateDream } = await import("@/lib/dream-store");
      updateDream(dream.id, { activeRenderJobId: job.id, ...(job.outputUrl ? { videoUrl: job.outputUrl } : {}) });
    }
    return NextResponse.json(job);
  }
  return NextResponse.json({ error: "未知任务操作" }, { status: 400 });
}
