/** 首页「处理梦境文字」与人物库 AI 整理共用的模型列表（仅 NEXT_PUBLIC_* 在浏览器可用）。 */

function publicEnv(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export type LlmModelOption = {
  value: string;
  label: string;
  apiUrl: string;
  apiKey: string;
};

export const LLM_MODEL_OPTIONS: LlmModelOption[] = [
  {
    value: "gpt-5.4-mini",
    label: "GPT 5.4 Mini",
    apiUrl: publicEnv("NEXT_PUBLIC_LLM_OPENCLAUDECODE_URL") || "https://www.openclaudecode.cn/v1",
    apiKey: publicEnv("NEXT_PUBLIC_LLM_OPENCLAUDECODE_KEY_GPT"),
  },
  {
    value: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    apiUrl: publicEnv("NEXT_PUBLIC_LLM_OPENCLAUDECODE_URL") || "https://www.openclaudecode.cn/v1",
    apiKey: publicEnv("NEXT_PUBLIC_LLM_OPENCLAUDECODE_KEY_CLAUDE"),
  },
  {
    value: "doubao-seed-2-0-mini-260215",
    label: "Doubao Seed 2.0 Mini",
    apiUrl: publicEnv("NEXT_PUBLIC_LLM_DOUBAO_URL") || "https://ark.cn-beijing.volces.com/api/v3",
    apiKey: publicEnv("NEXT_PUBLIC_LLM_DOUBAO_KEY"),
  },
];

export const DEFAULT_LLM_MODEL = "gpt-5.4-mini";

/** localStorage：与首页所选文字模型同步 */
export const LLM_MODEL_STORAGE_KEY = "dreamcup-llm-model";

export function getLlmModelOption(value: string): LlmModelOption {
  return LLM_MODEL_OPTIONS.find((m) => m.value === value) ?? LLM_MODEL_OPTIONS[0];
}

export function readStoredLlmModel(): string {
  if (typeof window === "undefined") return DEFAULT_LLM_MODEL;
  try {
    const v = localStorage.getItem(LLM_MODEL_STORAGE_KEY)?.trim();
    if (v && LLM_MODEL_OPTIONS.some((m) => m.value === v)) return v;
  } catch {
    /* ignore */
  }
  return DEFAULT_LLM_MODEL;
}

export function writeStoredLlmModel(value: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LLM_MODEL_STORAGE_KEY, value);
  } catch {
    /* ignore */
  }
}

/** 用于构建 fetch 头：与当前（或默认）选项一致，并在缺 key 时回退到首个可用的配置（优先 GPT）。 */
export function buildHeadersForStoredOrDefaultModel(): Record<string, string> {
  const preferred = getLlmModelOption(readStoredLlmModel());
  const order = [
    preferred,
    getLlmModelOption(DEFAULT_LLM_MODEL),
    ...LLM_MODEL_OPTIONS.filter((m) => m.value !== preferred.value && m.value !== DEFAULT_LLM_MODEL),
  ];
  const config = order.find((m) => m.apiUrl && m.apiKey) ?? preferred;
  const h: Record<string, string> = {};
  if (config.apiUrl && config.apiKey) {
    h["x-api-url"] = config.apiUrl;
    h["x-api-key"] = config.apiKey;
    h["x-model"] = config.value;
  }
  return h;
}
