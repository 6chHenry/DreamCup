import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { getServerDataRoot } from "@/lib/server-data-root";

export const runtime = "nodejs";

function safeFilename(name: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(name) && !name.includes("..") && name.length < 200;
}

function contentTypeForVideo(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "webm") return "video/webm";
  if (ext === "mov") return "video/quicktime";
  return "video/mp4";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params;
    if (!safeFilename(filename)) {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }

    const base = path.resolve(path.join(getServerDataRoot(), "video"));
    const filePath = path.resolve(path.join(base, filename));
    if (!filePath.startsWith(base)) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "Video file not found" }, { status: 404 });
    }

    const stat = fs.statSync(filePath);
    const range = request.headers.get("range");
    const contentType = contentTypeForVideo(filename);

    if (range) {
      const match = range.match(/bytes=(\d+)-(\d*)/);
      if (!match) {
        return NextResponse.json({ error: "Invalid range" }, { status: 416 });
      }
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : stat.size - 1;
      if (start >= stat.size || end >= stat.size || start > end) {
        return NextResponse.json({ error: "Range not satisfiable" }, { status: 416 });
      }

      const stream = Readable.toWeb(fs.createReadStream(filePath, { start, end })) as ReadableStream;
      return new NextResponse(stream, {
        status: 206,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Content-Length": String(end - start + 1),
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    const stream = Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream;
    return new NextResponse(stream, {
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(stat.size),
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("Video file serve error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
