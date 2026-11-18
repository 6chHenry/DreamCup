import { NextRequest, NextResponse } from "next/server";
import { getRenderJob, saveRenderJob } from "@/lib/render-job-store";
import { exportRenderProject } from "@/lib/render-project";
import { createSrt, createVtt } from "@/lib/timeline";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getRenderJob(id);
  if (!job) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  const format = request.nextUrl.searchParams.get("format");
  if (format === "srt" || format === "vtt") {
    const content = format === "srt" ? createSrt(job) : createVtt(job);
    return new NextResponse(`\uFEFF${content}`, { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${id}.${format}"` } });
  }
  const result = await exportRenderProject(job);
  saveRenderJob({ ...job, projectUrl: `/api/render-jobs/${id}/export` });
  return new NextResponse(new Uint8Array(result.zip), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${id}-project.zip"` } });
}
