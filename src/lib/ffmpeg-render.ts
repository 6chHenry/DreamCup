import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { getFfmpegBinaryPath } from "@/lib/audio-convert";
import { materializeMedia, resolveLocalMedia } from "@/lib/media-files";
import { getServerDataRoot } from "@/lib/server-data-root";
import type { VideoRenderJob } from "@/types/dream";
import { createSrt, createVtt, getShotTimings, timelineDuration } from "@/lib/timeline";
import { getNarrationAdapter } from "@/lib/narration-providers";
import { ProviderError } from "@/lib/provider-errors";

const execFileAsync = promisify(execFile);

function ffmpegPath(): string {
  const binary = getFfmpegBinaryPath();
  if (!binary) throw new Error("未找到 FFmpeg，请安装依赖或配置 FFMPEG_BIN。");
  return binary;
}

async function runFfmpeg(args: string[], signal?: AbortSignal): Promise<void> {
  try {
    await execFileAsync(ffmpegPath(), args, { maxBuffer: 16 * 1024 * 1024, timeout: 15 * 60 * 1000, signal });
  } catch (error) {
    const stderr = typeof error === "object" && error && "stderr" in error ? String(error.stderr) : "";
    throw new Error(`FFmpeg 合成失败：${stderr.slice(-1600) || (error instanceof Error ? error.message : String(error))}`);
  }
}

function dimensions(aspectRatio: string): { width: number; height: number } {
  if (aspectRatio === "9:16") return { width: 720, height: 1280 };
  if (aspectRatio === "1:1") return { width: 960, height: 960 };
  return { width: 1280, height: 720 };
}

function motionFilter(motion: string, duration: number, width: number, height: number): string {
  const frames = Math.ceil(duration * 30);
  if (motion === "pull-back") return `zoompan=z='max(1.0,1.12-0.12*on/${frames})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=30`;
  if (motion === "pan-left") return `zoompan=z=1.1:x='(iw-iw/zoom)*(1-on/${frames})':y='(ih-ih/zoom)/2':d=${frames}:s=${width}x${height}:fps=30`;
  if (motion === "pan-right") return `zoompan=z=1.1:x='(iw-iw/zoom)*on/${frames}':y='(ih-ih/zoom)/2':d=${frames}:s=${width}x${height}:fps=30`;
  if (motion === "drift") return `zoompan=z='1.06+0.025*on/${frames}':x='iw/2-(iw/zoom/2)+on/${frames}*12':y='ih/2-(ih/zoom/2)-on/${frames}*8':d=${frames}:s=${width}x${height}:fps=30`;
  if (motion === "still") return `zoompan=z=1.02:d=${frames}:s=${width}x${height}:fps=30`;
  return `zoompan=z='min(1.14,1.02+0.12*on/${frames})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=30`;
}

export async function synthesizeNarration(text: string, provider: string, directory: string, id: string): Promise<string | null> {
  if (provider === "silent" || !text.trim()) return null;
  const adapter = getNarrationAdapter(provider as Parameters<typeof getNarrationAdapter>[0]);
  if (!adapter) throw new ProviderError(`配音供应商 ${provider} 尚未实现；将保留字幕继续无声合成。`, "configuration");
  return adapter.synthesize(text, directory, id);
}

export interface AssemblyResult {
  outputUrl: string;
  subtitleUrl?: string;
  narrationTrackUrl?: string;
  musicTrackUrl?: string;
}

export async function assembleRenderJob(job: VideoRenderJob, signal?: AbortSignal): Promise<AssemblyResult> {
  const jobDir = path.join(getJobDirectory(job.id), "assembly");
  fs.mkdirSync(jobDir, { recursive: true });
  const { width, height } = dimensions(job.storyboard.aspectRatio);
  const sourceFilters: string[] = [];
  const inputPaths: string[] = [];
  const segments: Array<{ label: string }> = [];

  for (let index = 0; index < job.storyboard.shots.length; index++) {
    const shot = job.storyboard.shots[index];
    const task = job.shots.find((item) => item.shotId === shot.id);
    if (!task?.videoUrl) throw new Error(`镜头 ${index + 1} 没有可合成素材。`);
    const source = await materializeMedia(task.videoUrl, path.join(jobDir, "sources"), `shot-${index}-${job.generationQuality ?? "quality"}`);
    const output = path.join(jobDir, `shot-${index}.mp4`);
    const isPreview = task.provider === "storyboard_preview";
    if (isPreview) {
      const filters = `scale=${width * 2}:${height * 2}:force_original_aspect_ratio=increase,crop=${width * 2}:${height * 2},${motionFilter(shot.cameraMotion, shot.duration, width, height)},trim=duration=${shot.duration},setpts=PTS-STARTPTS,format=yuv420p`;
      await runFfmpeg(["-y", "-loop", "1", "-i", source, "-vf", filters, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-t", String(shot.duration), output], signal);
      const label = `preview${index}`;
      sourceFilters.push(`[${index}:v]fps=30,settb=AVTB,format=yuv420p[${label}]`);
      inputPaths.push(output);
      segments.push({ label });
    } else {
      const label = `shot${index}`;
      sourceFilters.push(`[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,trim=duration=${shot.duration},setpts=PTS-STARTPTS,fps=30,settb=AVTB,format=yuv420p[${label}]`);
      inputPaths.push(source);
      segments.push({ label });
    }
  }

  const visualPath = path.join(jobDir, "visual.mp4");
  const videoInputs = inputPaths.flatMap((source) => ["-i", source]);
  const transitionDuration = 0.65;
  let previousLabel = segments[0]?.label ?? "0:v";
  let offset = 0;
  const filters: string[] = [...sourceFilters];
  for (let index = 1; index < segments.length; index++) {
    const transition = job.storyboard.shots[index - 1].transition;
    const outputLabel = index === segments.length - 1 ? "vout" : `vx${index}`;
    if (transition === "cut") {
      filters.push(`[${previousLabel}][${segments[index].label}]concat=n=2:v=1:a=0[${outputLabel}]`);
      offset += job.storyboard.shots[index - 1].duration;
    } else {
      const overlap = Math.min(transitionDuration, job.storyboard.shots[index - 1].duration / 3, job.storyboard.shots[index].duration / 3);
      offset += job.storyboard.shots[index - 1].duration - overlap;
      filters.push(`[${previousLabel}][${segments[index].label}]xfade=transition=${transition === "dissolve" ? "fade" : "fadeblack"}:duration=${overlap.toFixed(3)}:offset=${Math.max(0, offset).toFixed(3)}[${outputLabel}]`);
    }
    previousLabel = outputLabel;
  }
  const subtitlePath = path.join(getJobDirectory(job.id), `${job.id}.srt`);
  const vttPath = path.join(getJobDirectory(job.id), `${job.id}.vtt`);
  fs.writeFileSync(subtitlePath, `\uFEFF${createSrt(job)}`, "utf8");
  fs.writeFileSync(vttPath, `\uFEFF${createVtt(job)}`, "utf8");
  const subtitleFilter = job.showSubtitles && job.storyboard.shots.some((shot) => shot.narration.trim())
    ? `,subtitles='${subtitlePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'")}':force_style='FontName=Microsoft YaHei,FontSize=20,PrimaryColour=&H00F4F0E8,OutlineColour=&H80080812,BorderStyle=1,Outline=1,Shadow=0,MarginV=42,Alignment=2'`
    : "";
  const visualFilters = `${filters.length ? `${filters.join(";")};` : ""}[${previousLabel}]format=yuv420p${subtitleFilter}[vfinal]`;
  await runFfmpeg(["-y", ...videoInputs, "-filter_complex", visualFilters, "-map", "[vfinal]", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-t", String(timelineDuration(job.storyboard)), visualPath], signal);

  const narrationPaths: (string | null)[] = [];
  for (let index = 0; index < job.storyboard.shots.length; index++) {
    const task = job.shots.find((item) => item.shotId === job.storyboard.shots[index].id);
    narrationPaths.push(task?.narrationUrl ? resolveLocalMedia(task.narrationUrl, "audio") : null);
  }
  const narrationInputs = narrationPaths.filter(Boolean) as string[];
  const background = job.backgroundAudioUrl ? resolveLocalMedia(job.backgroundAudioUrl, "audio") : null;
  const finalPath = path.join(getJobDirectory(job.id), `${job.id}.mp4`);
  const timings = getShotTimings(job.storyboard);
  const totalDuration = Math.ceil(timelineDuration(job.storyboard) * 30) / 30;
  const finalInputs = ["-i", visualPath, ...narrationInputs.flatMap((input) => ["-i", input]), ...(background ? ["-stream_loop", "-1", "-i", background] : [])];
  const audioFilters: string[] = [];
  const audioLabels: string[] = [];
  let narrationIndex = 0;
  narrationPaths.forEach((narration, index) => {
    if (!narration) return;
    const label = `voice${index}`;
    const delay = Math.round(timings[index].start * 1000);
    audioFilters.push(`[${narrationIndex + 1}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${delay}|${delay},volume=${job.narrationVolume}[${label}]`);
    audioLabels.push(`[${label}]`);
    narrationIndex++;
  });
  if (background) {
    audioFilters.push(`[${narrationInputs.length + 1}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${job.musicVolume},atrim=duration=${totalDuration}[music]`);
    audioLabels.push("[music]");
  }
  if (audioLabels.length > 0) audioFilters.push(`${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=2:normalize=0,alimiter=limit=0.95,atrim=duration=${totalDuration}[aout]`);
  const audioFilter = audioFilters.join(";") || `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${totalDuration}[aout]`;
  const narrationTrack = path.join(getJobDirectory(job.id), `${job.id}-narration.m4a`);
  const musicTrack = path.join(getJobDirectory(job.id), `${job.id}-music.m4a`);
  if (narrationLabels(narrationPaths).length) {
    await runFfmpeg(["-y", ...narrationInputs.flatMap((input) => ["-i", input]), "-filter_complex", `${audioFilters.filter((filter) => filter.includes("[voice")).join(";")};${audioLabels.filter((label) => label.includes("voice")).join("")}amix=inputs=${narrationInputs.length}:duration=longest:normalize=0,atrim=duration=${totalDuration}[voiceout]`, "-map", "[voiceout]", "-c:a", "aac", narrationTrack], signal);
  }
  if (background) {
    await runFfmpeg(["-y", "-stream_loop", "-1", "-i", background, "-af", `volume=${job.musicVolume},atrim=duration=${totalDuration}`, "-c:a", "aac", musicTrack], signal);
  }
  await runFfmpeg(["-y", ...finalInputs, "-filter_complex", audioFilter, "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", String(totalDuration), "-movflags", "+faststart", finalPath], signal);
  return {
    outputUrl: `/api/media/renders/${encodeURIComponent(job.id)}`,
    subtitleUrl: `/api/media/renders/${encodeURIComponent(job.id)}.vtt`,
    narrationTrackUrl: fs.existsSync(narrationTrack) ? `/api/media/renders/${encodeURIComponent(job.id)}-narration.m4a` : undefined,
    musicTrackUrl: fs.existsSync(musicTrack) ? `/api/media/renders/${encodeURIComponent(job.id)}-music.m4a` : undefined,
  };
}

function narrationLabels(paths: (string | null)[]): string[] {
  return paths.flatMap((value, index) => value ? [`voice${index}`] : []);
}

export function getJobDirectory(jobId: string): string {
  return path.join(getServerDataRoot(), "renders", jobId);
}
