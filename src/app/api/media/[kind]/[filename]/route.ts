import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getServerDataRoot } from "@/lib/server-data-root";
import { safeMediaFilename } from "@/lib/media-files";

export const runtime = "nodejs";

const mimeTypes: Record<string, string> = {
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4",
  srt: "application/x-subrip; charset=utf-8", vtt: "text/vtt; charset=utf-8", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string; filename: string }> }) {
  const { kind, filename } = await params;
  if (!["renders", "narration", "audio", "video", "scene-images"].includes(kind) || !safeMediaFilename(filename)) {
    return NextResponse.json({ error: "Invalid media path" }, { status: 400 });
  }
  const base = path.resolve(getServerDataRoot(), kind);
  let filePath = path.resolve(base, filename);
  const rootCandidate = kind === "renders" ? path.resolve(base, filename, `${filename}.mp4`) : "";
  if (kind === "renders" && rootCandidate.startsWith(`${base}${path.sep}`) && fs.existsSync(rootCandidate)) filePath = rootCandidate;
  if (kind === "renders" && fs.existsSync(base)) {
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const child of ["", "frames", "shots", "assembly", "assembly/sources"]) {
        const candidate = path.resolve(base, entry.name, child, filename);
        if (candidate.startsWith(`${base}${path.sep}`) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) filePath = candidate;
      }
    }
  }
  const servedFilename = kind === "renders" && filename === path.basename(filePath, ".mp4") ? `${filename}.mp4` : filename;
  if (!filePath.startsWith(`${base}${path.sep}`) || !fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Media not found" }, { status: 404 });
  }
  const stat = fs.statSync(filePath);
  const contentType = mimeTypes[servedFilename.split(".").pop()?.toLowerCase() || ""] || "application/octet-stream";
  const range = request.headers.get("range")?.match(/bytes=(\d+)-(\d*)/);
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Number(range[2]) : stat.size - 1;
  if (start >= stat.size || end >= stat.size || start > end) return new NextResponse(null, { status: 416 });
  const nodeStream = fs.createReadStream(filePath, { start, end });
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on("data", (chunk: string | Buffer) => controller.enqueue(new Uint8Array(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))));
      nodeStream.on("end", () => { try { controller.close(); } catch { /* browser cancelled */ } });
      nodeStream.on("error", (error) => { try { controller.error(error); } catch { /* browser cancelled */ } });
    },
    cancel() { nodeStream.destroy(); },
  });
  return new NextResponse(stream, {
    status: range ? 206 : 200,
    headers: {
      "Accept-Ranges": "bytes", "Content-Type": contentType,
      "Content-Length": String(end - start + 1),
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${stat.size}` } : {}),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
