import type { Dream } from "@/types/dream";

export const QUICK_CAPTURE_DRAFT_KEY = "dreamcup-quick-capture-draft-v1";

export interface QuickCaptureInput {
  title: string;
  rawText: string;
  dreamDate: string;
  tags: string[];
  isLucidDream: boolean;
}

export function dateInputValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createQuickCaptureDream(input: QuickCaptureInput): Dream {
  const now = new Date().toISOString();
  const rawText = input.rawText.trim();
  const title = input.title.trim() || rawText.split(/[\n。！？!?]/).find(Boolean)?.trim().slice(0, 24) || "未命名梦境";

  return {
    id: crypto.randomUUID(),
    title,
    rawText,
    tags: [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 12),
    structured: {
      scenes: [],
      characters: [],
      narrative: { events: [], summary: rawText },
      emotions: [],
      sensory: {},
      anomalies: [],
      meta: {
        dreamDate: input.dreamDate || undefined,
        isLucidDream: input.isLucidDream || undefined,
      },
      lowConfidence: [],
    },
    scenes: [],
    createdAt: now,
    updatedAt: now,
  };
}
