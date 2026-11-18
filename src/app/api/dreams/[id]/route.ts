import { NextRequest, NextResponse } from "next/server";
import type { Dream } from "@/types/dream";
import { getDreamById, updateDream, unhideDreamFromJournal } from "@/lib/dream-store";
import { syncPersonsFromDream } from "@/lib/person-store";
import { isVercelDeployment } from "@/lib/deployment";
import { getOnlineDream, updateOnlineDream } from "@/lib/online-dream-store";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const dream = isVercelDeployment() ? await getOnlineDream(id) : getDreamById(id);
  if (!dream) {
    return NextResponse.json({ error: "Dream not found" }, { status: 404 });
  }
  return NextResponse.json(dream);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = (await request.json()) as Record<string, unknown> & { showInJournal?: boolean };
    if (body?.showInJournal === true) {
      if (isVercelDeployment()) {
        const restored = await updateOnlineDream(id, { deletedAt: undefined });
        return restored ? NextResponse.json(restored) : NextResponse.json({ error: "Dream not found" }, { status: 404 });
      }
      const restored = unhideDreamFromJournal(id);
      if (!restored) {
        return NextResponse.json({ error: "Dream not found" }, { status: 404 });
      }
      if (restored.structured?.characters?.length) {
        syncPersonsFromDream(restored, restored.updatedAt);
      }
      return NextResponse.json(restored);
    }
    const { showInJournal: _s, ...patch } = body;
    const updated = isVercelDeployment() ? await updateOnlineDream(id, patch as Partial<Dream>) : updateDream(id, patch as Partial<Dream>);
    if (!updated) {
      return NextResponse.json({ error: "Dream not found" }, { status: 404 });
    }
    if (!isVercelDeployment() && updated.structured?.characters?.length && !updated.deletedAt) {
      syncPersonsFromDream(updated, updated.updatedAt);
    }
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Update dream error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const existing = isVercelDeployment() ? await getOnlineDream(id) : getDreamById(id);
  if (!existing) {
    return NextResponse.json({ error: "Dream not found" }, { status: 404 });
  }
  if (existing.deletedAt) {
    return NextResponse.json({ success: true, hiddenFromJournal: true, alreadyHidden: true });
  }
  if (isVercelDeployment()) await updateOnlineDream(id, { deletedAt: new Date().toISOString() });
  else updateDream(id, { deletedAt: new Date().toISOString() });
  return NextResponse.json({
    success: true,
    hiddenFromJournal: true,
    message: isVercelDeployment() ? "已从日志列表隐藏，记录仍保存在线上数据库中" : "已从日志列表移除，梦境 JSON 与资源仍保留在本地 data 中",
  });
}
