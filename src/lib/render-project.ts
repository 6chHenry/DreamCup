import fs from "fs";
import path from "path";
import JSZip from "jszip";
import type { VideoRenderJob } from "@/types/dream";
import { createSrt, createVtt, getShotTimings, timelineDuration } from "@/lib/timeline";
import { getJobDirectory } from "@/lib/ffmpeg-render";
import { getServerDataRoot } from "@/lib/server-data-root";
import { resolveLocalMedia } from "@/lib/media-files";

function localFile(url?: string): string | null {
  if (!url?.startsWith("/api/media/")) return resolveLocalMedia(url || "", "audio") ?? resolveLocalMedia(url || "", "video");
  const [, , , kind, ...parts] = url.split("/");
  if (!["renders", "narration", "audio", "video", "scene-images"].includes(kind)) return null;
  const root = path.resolve(getServerDataRoot(), kind);
  const filename = parts.map(decodeURIComponent).join("/");
  if (parts.some((part) => !/^[a-zA-Z0-9._-]+$/.test(part) || part.includes(".."))) return null;
  const candidates = kind === "renders" ? [filename, `${filename}/${filename}.mp4`] : [filename];
  for (const candidate of candidates) {
    const target = path.resolve(root, candidate);
    if (target.startsWith(`${root}${path.sep}`) && fs.existsSync(target) && fs.statSync(target).isFile()) return target;
  }
  if (kind === "renders") {
    const target = path.resolve(root, filename);
    if (target.startsWith(`${root}${path.sep}`) && fs.existsSync(target)) return target;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const child of ["", "frames", "shots", "assembly", "assembly/sources"]) {
        const candidate = path.resolve(root, entry.name, child, filename);
        if (candidate.startsWith(`${root}${path.sep}`) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      }
    }
  }
  return null;
}

export async function exportRenderProject(job: VideoRenderJob): Promise<{ zip: Buffer; path: string }> {
  const archive = new JSZip();
  const shots = archive.folder("shots")!;
  const used = new Set<string>();
  const addFile = (url: string | undefined, target: string) => {
    const file = localFile(url);
    if (!file || used.has(target)) return;
    archive.file(target, fs.readFileSync(file));
    used.add(target);
  };
  const timings = getShotTimings(job.storyboard);
  const manifest = {
    format: "dreamcup-render-project", version: 1, exportedAt: new Date().toISOString(),
    job: { ...job, outputUrl: undefined, projectUrl: undefined },
    timeline: { duration: timelineDuration(job.storyboard), shots: timings },
    ffmpeg: { transitionDuration: 0.65, frameRate: 30, audioSampleRate: 48000 },
  };
  archive.file("project.json", JSON.stringify(manifest, null, 2));
  archive.file("storyboard.json", JSON.stringify(job.storyboard, null, 2));
  archive.file("subtitles.srt", `\uFEFF${createSrt(job)}`);
  archive.file("subtitles.vtt", `\uFEFF${createVtt(job)}`);
  archive.file("README.txt", "掬梦分镜工程\nproject.json 保存任务、镜头时间轴和参数。\nmedia/ 保存旁白与音频 stems，shots/ 保存已生成镜头素材。\n外部模型生成的视频及配音需在本地存在才能一并打包。\n");
  addFile(job.backgroundAudioUrl, `media/background${path.extname(localFile(job.backgroundAudioUrl) || ".mp3")}`);
  addFile(job.narrationTrackUrl, "media/narration.m4a");
  addFile(job.musicTrackUrl, "media/music.m4a");
  addFile(job.outputUrl, "media/final.mp4");
  job.shots.forEach((shot, index) => {
    const file = localFile(shot.videoUrl);
    if (file) addFile(shot.videoUrl, `shots/${String(index + 1).padStart(2, "0")}${path.extname(file)}`);
    addFile(shot.narrationUrl, `media/shot-${String(index + 1).padStart(2, "0")}-narration${path.extname(localFile(shot.narrationUrl) || ".mp3")}`);
  });
  shots.file("index.json", JSON.stringify(job.shots, null, 2));
  const zip = await archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const target = path.join(getJobDirectory(job.id), `${job.id}-project.zip`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, zip);
  return { zip, path: target };
}
