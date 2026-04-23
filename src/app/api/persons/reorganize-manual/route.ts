import { NextRequest, NextResponse } from "next/server";
import { createPerson } from "@/lib/person-store";
import { executePersonOrganizePlan, type PersonOrganizePlan } from "@/lib/person-organize";
import type { Person } from "@/types/dream";

export const runtime = "nodejs";

/**
 * body:
 * - { "deleteIds": string[] }
 * - { "merge": { "keepId", "absorbIds", "canonicalName" } }
 * - { "rename": { "personId", "newName" } }
 * - { "add": { "name", "dreamIds"?: string[], "tags"?: string[] } }
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;

    if (Array.isArray(body.deleteIds)) {
      const deletePersonIds = body.deleteIds.filter((x): x is string => typeof x === "string");
      const plan: PersonOrganizePlan = { deletePersonIds, mergeGroups: [], renameOnly: [] };
      const r = executePersonOrganizePlan(plan);
      if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
      return NextResponse.json({ ok: true, dreamsUpdated: r.dreamsUpdated });
    }

    if (body.merge && typeof body.merge === "object") {
      const m = body.merge as Record<string, unknown>;
      const keepId = typeof m.keepId === "string" ? m.keepId : "";
      const canonicalName = typeof m.canonicalName === "string" ? m.canonicalName : "";
      const absorbIds = Array.isArray(m.absorbIds)
        ? m.absorbIds.filter((x): x is string => typeof x === "string")
        : [];
      if (!keepId || !canonicalName.trim() || absorbIds.length === 0) {
        return NextResponse.json({ error: "merge 需要 keepId、canonicalName、absorbIds" }, { status: 400 });
      }
      const plan: PersonOrganizePlan = {
        deletePersonIds: [],
        mergeGroups: [{ keepPersonId: keepId, absorbPersonIds: absorbIds, canonicalName: canonicalName.trim() }],
        renameOnly: [],
      };
      const r = executePersonOrganizePlan(plan);
      if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
      return NextResponse.json({ ok: true, dreamsUpdated: r.dreamsUpdated });
    }

    if (body.rename && typeof body.rename === "object") {
      const r = body.rename as Record<string, unknown>;
      const personId = typeof r.personId === "string" ? r.personId : "";
      const newName = typeof r.newName === "string" ? r.newName : "";
      if (!personId || !newName.trim()) {
        return NextResponse.json({ error: "rename 需要 personId、newName" }, { status: 400 });
      }
      const plan: PersonOrganizePlan = {
        deletePersonIds: [],
        mergeGroups: [],
        renameOnly: [{ personId, newName: newName.trim() }],
      };
      const result = executePersonOrganizePlan(plan);
      if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
      return NextResponse.json({ ok: true, dreamsUpdated: result.dreamsUpdated });
    }

    if (body.add && typeof body.add === "object") {
      const a = body.add as Record<string, unknown>;
      const name = typeof a.name === "string" ? a.name.trim() : "";
      if (!name) return NextResponse.json({ error: "add 需要 name" }, { status: 400 });
      const dreamIds = Array.isArray(a.dreamIds)
        ? a.dreamIds.filter((x): x is string => typeof x === "string")
        : [];
      const tagRaw = Array.isArray(a.tags) ? a.tags.filter((x): x is string => typeof x === "string") : [];
      const seen = new Set<string>();
      const relationships: string[] = [];
      for (const raw of tagRaw) {
        const s = raw.trim();
        if (!s) continue;
        const k = s.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        relationships.push(s);
      }
      const now = new Date().toISOString();
      const person: Person = {
        id: crypto.randomUUID(),
        name,
        appearances: dreamIds.length || 1,
        firstSeen: now,
        lastSeen: now,
        relationships,
        dreamIds,
        createdAt: now,
        updatedAt: now,
      };
      createPerson(person);
      return NextResponse.json({ ok: true, person });
    }

    return NextResponse.json({ error: "未知操作：请传 deleteIds / merge / rename / add" }, { status: 400 });
  } catch (e) {
    console.error("reorganize-manual:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
