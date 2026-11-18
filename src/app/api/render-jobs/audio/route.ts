import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { getServerDataRoot } from "@/lib/server-data-root";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("audio");
  if (!(file instanceof File)) return NextResponse.json({ error: "请选择音频文件" }, { status: 400 });
  if (file.size > 50 * 1024 * 1024) return NextResponse.json({ error: "音频不能超过 50 MB" }, { status: 400 });
  const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "mp3";
  if (!["mp3", "wav", "ogg", "m4a", "aac"].includes(extension)) return NextResponse.json({ error: "支持 MP3、WAV、OGG、M4A 音频" }, { status: 400 });
  const filename = `${randomUUID()}.${extension}`;
  const directory = path.join(getServerDataRoot(), "audio");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, filename), Buffer.from(await file.arrayBuffer()));
  return NextResponse.json({ url: `/api/audio/${encodeURIComponent(filename)}` }, { status: 201 });
}
