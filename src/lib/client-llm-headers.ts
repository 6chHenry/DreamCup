import { buildHeadersForStoredOrDefaultModel } from "@/lib/llm-model-options";

/** 与首页所选「处理梦境文字」模型一致（localStorage + NEXT_PUBLIC_*），供人物库 AI 整理等使用。 */
export function buildClientLlmHeadersForFetch(): Record<string, string> {
  return buildHeadersForStoredOrDefaultModel();
}
