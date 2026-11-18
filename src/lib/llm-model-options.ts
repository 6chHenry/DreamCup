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
    value: "kimi-k3",
    label: "Kimi K3",
    apiUrl: "https://api.kimi.com/coding/v1",
    apiKey: "",
  },
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

export const DEFAULT_LLM_MODEL = "kimi-k3";

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

/** 浏览器只声明模型和网关；Kimi 等无公开密钥的选项由服务端读取对应密钥。 */
export function buildHeadersForStoredOrDefaultModel(): Record<string, string> {
  const preferred = getLlmModelOption(readStoredLlmModel());
  const h: Record<string, string> = {};
  if (preferred.apiUrl) {
    h["x-api-url"] = preferred.apiUrl;
    h["x-model"] = preferred.value;
    if (preferred.apiKey) h["x-api-key"] = preferred.apiKey;
  }
  return h;
}
