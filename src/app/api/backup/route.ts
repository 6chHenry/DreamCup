import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { createDream, getAllDreamRecords } from "@/lib/dream-store";
import { syncPersonsFromDream } from "@/lib/person-store";
import { DreamSchema } from "@/lib/schema";
import { isVercelDeployment } from "@/lib/deployment";
import { listOnlineDreams, saveOnlineDream } from "@/lib/online-dream-store";

export const runtime = "nodejs";

export async function GET() {
  const dreams = isVercelDeployment() ? await listOnlineDreams(true) : getAllDreamRecords();
  return NextResponse.json({
    format: "dreamcup-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    dreams,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (body?.format !== "dreamcup-backup" || body?.version !== 1 || !Array.isArray(body?.dreams)) {
      return NextResponse.json({ error: "请选择由掬梦「备份 JSON」导出的文件。" }, { status: 400 });
    }

    const imported = [];
    let skipped = 0;
    for (const value of body.dreams) {
      const parsed = DreamSchema.safeParse(value);
      if (!parsed.success) {
        skipped += 1;
        continue;
      }
      const dream = { ...parsed.data, id: uuidv4() };
      if (isVercelDeployment()) await saveOnlineDream(dream);
      else {
        createDream(dream);
        syncPersonsFromDream(dream, dream.createdAt);
      }
      imported.push(dream);
    }

    return NextResponse.json({ imported: imported.length, skipped }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "备份文件无法读取，请确认它是完整的 JSON 文件。" }, { status: 400 });
  }
}
