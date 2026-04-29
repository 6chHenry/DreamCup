import { execFile } from "child_process";
import { createRequire } from "node:module";
import { randomUUID } from "crypto";
import { promisify } from "util";
import fsSync from "fs";
import fs from "fs/promises";
import os from "os";
import path from "path";

const execFileAsync = promisify(execFile);

function isLikelyExecutableFile(absPath: string): boolean {
  try {
    return fsSync.statSync(absPath).isFile();
  } catch {
    return false;
  }
}

/**
 * ffmpeg-static：包内路径依赖真实磁盘上的 node_modules；
 * Next / Vercel 若未将该包与外置二进制打上追踪，则需回退路径与 `serverExternalPackages`。
 */
export function getFfmpegBinaryPath(): string | null {
  const fromEnv = process.env.FFMPEG_BIN?.trim();
  if (fromEnv) {
    if (isLikelyExecutableFile(fromEnv)) return fromEnv;
    return null;
  }

  try {
    const requireFromProject = createRequire(path.join(process.cwd(), "package.json"));
    const p = requireFromProject("ffmpeg-static") as string | null;
    if (p && isLikelyExecutableFile(p)) return p;
  } catch {
    /* 试回退路径 */
  }

  const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const direct = path.join(process.cwd(), "node_modules", "ffmpeg-static", exe);
  if (isLikelyExecutableFile(direct)) return direct;

  return null;
}

/** 豆包极速版明确支持 WAV / MP3 / OGG OPUS；其余（m4a、webm 等）先转码再送识别。 */
export function shouldTranscodeToWavForDoubao(ext: string, mime: string): boolean {
  const e = (ext || "").replace(/^\./, "").toLowerCase();
  const m = (mime || "").toLowerCase();
  if (["wav", "mp3", "ogg"].includes(e)) return false;
  if (m.includes("audio/wav") || m.includes("audio/wave")) return false;
  if (m.includes("audio/mpeg") || m.includes("audio/mp3")) return false;
  if (m.includes("audio/ogg")) return false;
  return true;
}

/** 转为 16kHz 单声道 PCM WAV，与常见语音识别输入一致。 */
export async function transcodeBufferToWavPcm16kMono(input: Buffer, inputExt: string): Promise<Buffer> {
  const ffmpegPath = getFfmpegBinaryPath();
  if (!ffmpegPath) {
    throw new Error("未找到 ffmpeg 可执行文件（ffmpeg-static）。请执行 npm install（或在本机核对 node_modules/ffmpeg-static 下二进制是否存在）；部署环境可使用环境变量 FFMPEG_BIN。");
  }

  const id = randomUUID();
  let safeExt = (inputExt || "bin").replace(/[^a-z0-9]/gi, "");
  if (!safeExt) safeExt = "bin";
  const inPath = path.join(os.tmpdir(), `dreamcup-asr-in-${id}.${safeExt}`);
  const outPath = path.join(os.tmpdir(), `dreamcup-asr-out-${id}.wav`);

  await fs.writeFile(inPath, input);
  try {
    await execFileAsync(
      ffmpegPath,
      ["-y", "-i", inPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", outPath],
      { maxBuffer: 80 * 1024 * 1024 }
    );
    return await fs.readFile(outPath);
  } finally {
    await fs.unlink(inPath).catch(() => {});
    await fs.unlink(outPath).catch(() => {});
  }
}
