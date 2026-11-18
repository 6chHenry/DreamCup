import fs from "fs";
import path from "path";
import { getServerDataRoot } from "@/lib/server-data-root";

export function safeMediaFilename(filename: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(filename) && !filename.includes("..") && filename.length < 200;
}

export function resolveLocalMedia(url: string, kind: "audio" | "video"): string | null {
  const prefixes = kind === "audio" ? ["/api/audio/", "/api/media/narration/", "/api/media/audio/"] : ["/api/video-file/"];
  for (const prefix of prefixes) {
    if (!url.startsWith(prefix)) continue;
    const filename = decodeURIComponent(url.slice(prefix.length));
    if (!safeMediaFilename(filename)) return null;
    const directory = path.resolve(getServerDataRoot(), prefix.includes("narration") ? "narration" : kind);
    const result = path.resolve(directory, filename);
    if (result.startsWith(`${directory}${path.sep}`) && fs.existsSync(result)) return result;
  }
  return null;
}

function resolveRenderMedia(url: string): string | null {
  const prefix = "/api/media/renders/";
  if (!url.startsWith(prefix)) return null;
  const filename = decodeURIComponent(url.slice(prefix.length));
  if (!safeMediaFilename(filename)) return null;
  const root = path.resolve(getServerDataRoot(), "renders");
  const direct = path.resolve(root, filename);
  if (direct.startsWith(`${root}${path.sep}`) && fs.existsSync(direct)) return direct;
  if (!fs.existsSync(root)) return null;
  for (const jobDirectory of fs.readdirSync(root, { withFileTypes: true })) {
    if (!jobDirectory.isDirectory()) continue;
    for (const child of ["", "frames", "shots", "assembly", "assembly/sources"]) {
      const candidate = path.resolve(root, jobDirectory.name, child, filename);
      if (candidate.startsWith(`${root}${path.sep}`) && fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function resolveSceneImageMedia(url: string): string | null {
  const prefix = "/api/media/scene-images/";
  if (!url.startsWith(prefix)) return null;
  const filename = decodeURIComponent(url.slice(prefix.length));
  if (!safeMediaFilename(filename)) return null;
  const directory = path.resolve(getServerDataRoot(), "scene-images");
  const result = path.resolve(directory, filename);
  return result.startsWith(`${directory}${path.sep}`) && fs.existsSync(result) ? result : null;
}

export async function materializeMedia(url: string, directory: string, filenameBase: string, fetcher: typeof fetch = fetch): Promise<string> {
  if (!url) throw new Error("缺少媒体地址");
  if (url.startsWith("data:")) {
    const match = url.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
    if (!match) throw new Error("无法解析内联媒体");
    const mime = match[1] || "application/octet-stream";
    const extension = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : mime.includes("wav") ? "wav" : mime.includes("mpeg") ? "mp3" : mime.includes("webm") ? "webm" : "mp4";
    const target = path.join(directory, `${filenameBase}.${extension}`);
    fs.mkdirSync(directory, { recursive: true });
    const content = match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]));
    fs.writeFileSync(target, content);
    return target;
  }
  const local = resolveLocalMedia(url, "video") ?? resolveLocalMedia(url, "audio") ?? resolveRenderMedia(url) ?? resolveSceneImageMedia(url);
  if (local) return local;
  if (url.startsWith("/api/media/renders/")) {
    const filename = decodeURIComponent(url.slice("/api/media/renders/".length));
    if (safeMediaFilename(filename)) {
      const sceneImage = resolveSceneImageMedia(`/api/media/scene-images/${encodeURIComponent(filename)}`);
      if (sceneImage) return sceneImage;
    }
  }
  if (/^https?:\/\//i.test(url)) {
    const response = await fetcher(url);
    if (!response.ok) throw new Error(`媒体下载失败（${response.status}）`);
    const contentType = response.headers.get("content-type") || "";
    const extension = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : contentType.includes("webm") ? "webm" : contentType.includes("wav") ? "wav" : contentType.includes("mpeg") ? "mp3" : "mp4";
    const target = path.join(directory, `${filenameBase}.${extension}`);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
    return target;
  }
  throw new Error("仅支持本地媒体、内联图片或 HTTP(S) 媒体地址");
}
