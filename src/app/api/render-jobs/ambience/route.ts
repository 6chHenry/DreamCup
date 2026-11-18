import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { getFfmpegBinaryPath } from "@/lib/audio-convert";
import { getServerDataRoot } from "@/lib/server-data-root";

const execFileAsync = promisify(execFile);
export const runtime = "nodejs";

export async function POST() {
  const binary = getFfmpegBinaryPath();
  if (!binary) return NextResponse.json({ error: "当前环境没有 FFmpeg，暂时无法生成氛围音。" }, { status: 500 });
  const filename = `dream-ambience-${randomUUID()}.wav`;
  const directory = path.join(getServerDataRoot(), "audio");
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, filename);
  const filter = "anoisesrc=color=pink:amplitude=0.07:duration=90:sample_rate=48000,lowpass=f=420,highpass=f=65,volume=0.65";
  try {
    await execFileAsync(binary, ["-y", "-f", "lavfi", "-i", filter, "-c:a", "pcm_s16le", target], { timeout: 30_000 });
    return NextResponse.json({ url: `/api/audio/${filename}`, name: "夜间呼吸 · 本地氛围音" }, { status: 201 });
  } catch {
    fs.rmSync(target, { force: true });
    return NextResponse.json({ error: "氛围音生成失败，请重试或上传自己的音乐。" }, { status: 500 });
  }
}
