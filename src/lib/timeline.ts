import type { DreamStoryboard, VideoRenderJob } from "@/types/dream";

export interface ShotTiming {
  index: number;
  start: number;
  end: number;
  duration: number;
}

function wrapSubtitle(text: string, aspectRatio: DreamStoryboard["aspectRatio"]): string {
  const width = aspectRatio === "9:16" ? 17 : aspectRatio === "1:1" ? 23 : 31;
  const compact = text.trim().replace(/\s+/g, " ");
  const lines: string[] = [];
  let remaining = compact;
  while (remaining.length > width) {
    const slice = remaining.slice(0, width + 1);
    const punctuation = Math.max(slice.lastIndexOf("，"), slice.lastIndexOf("。"), slice.lastIndexOf("；"), slice.lastIndexOf(" "));
    const split = punctuation >= Math.floor(width * 0.55) ? punctuation + 1 : width;
    lines.push(remaining.slice(0, split).trim());
    remaining = remaining.slice(split).trim();
  }
  if (remaining) lines.push(remaining);
  return lines.slice(0, 3).join("\\N");
}

export function getShotTimings(storyboard: DreamStoryboard, transitionDuration = 0.65): ShotTiming[] {
  let cursor = 0;
  return storyboard.shots.map((shot, index) => {
    const overlap = index > 0 && storyboard.shots[index - 1].transition !== "cut"
      ? Math.min(transitionDuration, shot.duration / 3, storyboard.shots[index - 1].duration / 3)
      : 0;
    const start = Math.max(0, cursor - overlap);
    const end = start + shot.duration;
    cursor = end;
    return { index, start, end, duration: shot.duration };
  });
}

export function timelineDuration(storyboard: DreamStoryboard): number {
  const timings = getShotTimings(storyboard);
  return timings.at(-1)?.end ?? 0;
}

function timestamp(seconds: number, decimalMark: "." | ","): string {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const whole = Math.floor(safe % 60);
  const milliseconds = Math.round((safe - Math.floor(safe)) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(whole).padStart(2, "0")}${decimalMark}${String(milliseconds).padStart(3, "0")}`;
}

export function createSrt(job: VideoRenderJob): string {
  const cues = getShotTimings(job.storyboard).flatMap((timing) => {
    const shot = job.storyboard.shots[timing.index];
    if (!shot.narration.trim()) return [];
    const narrationEnd = Math.max(timing.start + 0.1, timing.end - 0.15);
    return [`${timing.index + 1}\n${timestamp(timing.start, ",")} --> ${timestamp(narrationEnd, ",")}\n${wrapSubtitle(shot.narration, job.storyboard.aspectRatio)}\n`];
  });
  return cues.join("\n");
}

export function createVtt(job: VideoRenderJob): string {
  const cues = getShotTimings(job.storyboard).flatMap((timing) => {
    const shot = job.storyboard.shots[timing.index];
    if (!shot.narration.trim()) return [];
    return [`${timing.index + 1}\n${timestamp(timing.start, ".")} --> ${timestamp(timing.end, ".")}\n${shot.narration.trim()}\n`];
  });
  return `WEBVTT\n\n${cues.join("\n")}`;
}
