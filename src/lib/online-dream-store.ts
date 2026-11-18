import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { Dream } from "@/types/dream";
import { getDreamJournalSortTime } from "@/lib/dream-dates";

type Sql = NeonQueryFunction<false, false>;
let schemaReady: Promise<void> | null = null;

export function onlinePersistenceConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

function database(): Sql {
  const connection = process.env.DATABASE_URL?.trim();
  if (!connection) throw new Error("线上版本尚未配置 DATABASE_URL，梦境暂时无法保存。");
  return neon(connection);
}

async function ready(sql: Sql): Promise<void> {
  schemaReady ??= sql`
    CREATE TABLE IF NOT EXISTS dreams (
      id TEXT PRIMARY KEY,
      content JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.then(() => undefined);
  return schemaReady;
}

function sortDreams(dreams: Dream[]): Dream[] {
  return dreams.sort((a, b) => getDreamJournalSortTime(b) - getDreamJournalSortTime(a) || b.createdAt.localeCompare(a.createdAt));
}

export async function listOnlineDreams(includeHidden = false): Promise<Dream[]> {
  const sql = database();
  await ready(sql);
  const rows = await sql`SELECT content FROM dreams` as Array<{ content: Dream }>;
  return sortDreams(rows.map((row) => row.content).filter((dream) => includeHidden || !dream.deletedAt));
}

export async function getOnlineDream(id: string): Promise<Dream | undefined> {
  const sql = database();
  await ready(sql);
  const rows = await sql`SELECT content FROM dreams WHERE id = ${id}` as Array<{ content: Dream }>;
  return rows[0]?.content;
}

export async function saveOnlineDream(dream: Dream): Promise<Dream> {
  const sql = database();
  await ready(sql);
  await sql`
    INSERT INTO dreams (id, content, updated_at) VALUES (${dream.id}, ${JSON.stringify(dream)}, ${dream.updatedAt})
    ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, updated_at = EXCLUDED.updated_at
  `;
  return dream;
}

export async function updateOnlineDream(id: string, updates: Partial<Dream>): Promise<Dream | undefined> {
  const current = await getOnlineDream(id);
  if (!current) return undefined;
  return saveOnlineDream({ ...current, ...updates, updatedAt: new Date().toISOString() });
}

export async function deleteOnlineDream(id: string): Promise<boolean> {
  const sql = database();
  await ready(sql);
  const rows = await sql`DELETE FROM dreams WHERE id = ${id} RETURNING id` as Array<{ id: string }>;
  return rows.length > 0;
}
