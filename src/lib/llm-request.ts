/**
 * OpenAI-compatible chat: when `x-api-key` is empty (no NEXT_PUBLIC_* in browser), pick the
 * **server** URL+key pair that matches `x-api-url` (openclaudecode / 4Router / 豆包 Ark are different
 * gateways — do not send openclaudecode models to 4Router keys).
 */
export function resolveOpenAICompatLLM(headers: Headers): {
  apiUrl: string;
  apiKey: string;
  model: string;
} {
  const headerKey = headers.get("x-api-key")?.trim() ?? "";
  const headerUrl = headers.get("x-api-url")?.trim() ?? "";
  const model =
    headers.get("x-model")?.trim() ||
    process.env.GEMINI_MODEL?.trim() ||
    "gpt-5.4-mini";

  const geminiUrl = process.env.GEMINI_API_URL?.trim() ?? "";
  const geminiKey = process.env.GEMINI_API_KEY?.trim() ?? "";

  if (headerKey) {
    return {
      apiUrl: headerUrl || geminiUrl,
      apiKey: headerKey,
      model,
    };
  }

  const host = headerUrl.toLowerCase();
  const isClaudeModel = model.toLowerCase().includes("claude");

  if (host.includes("openclaudecode.cn")) {
    const apiUrl =
      headerUrl ||
      process.env.OPENCLAUDECODE_API_URL?.trim() ||
      "https://www.openclaudecode.cn/v1";
    const apiKey =
      (isClaudeModel
        ? process.env.OPENCLAUDECODE_API_KEY_CLAUDE?.trim()
        : process.env.OPENCLAUDECODE_API_KEY_GPT?.trim()) ||
      process.env.OPENCLAUDECODE_API_KEY?.trim() ||
      "";
    return { apiUrl, apiKey, model };
  }

  if (host.includes("4router.net") || host.includes("4router")) {
    return {
      apiUrl: headerUrl || geminiUrl,
      apiKey: geminiKey,
      model,
    };
  }

  if (host.includes("volces.com") || host.includes("ark.cn-beijing")) {
    const apiUrl = headerUrl || process.env.DOUBAO_API_URL?.trim() || "";
    const apiKey = process.env.DOUBAO_API_KEY?.trim() || "";
    return { apiUrl, apiKey, model };
  }

  if (!headerUrl) {
    return { apiUrl: geminiUrl, apiKey: geminiKey, model };
  }

  return { apiUrl: headerUrl, apiKey: geminiKey, model };
}

const CLIENT_OR_SERVER_GPT_DEFAULT_MODEL = "gpt-5.4-mini";

/**
 * 优先使用请求里的 x-api-key（浏览器 NEXT_PUBLIC 与所选模型）；若无则避免落到 Gemini/4Router，
 * 改用服务端 OpenCode GPT + gpt-5.4-mini（人物库整理、梦境解读等共用）。
 */
export function resolveLlmPreferClientKeyElseOpenCodeGpt(requestHeaders: Headers): {
  apiUrl: string;
  apiKey: string;
  model: string;
} {
  const headerKey = requestHeaders.get("x-api-key")?.trim() ?? "";
  if (headerKey) {
    return resolveOpenAICompatLLM(requestHeaders);
  }

  const ocUrl =
    process.env.OPENCLAUDECODE_API_URL?.trim() || "https://www.openclaudecode.cn/v1";
  const ocKey =
    process.env.OPENCLAUDECODE_API_KEY_GPT?.trim() ||
    process.env.OPENCLAUDECODE_API_KEY?.trim() ||
    "";
  if (ocKey) {
    let model = requestHeaders.get("x-model")?.trim() || CLIENT_OR_SERVER_GPT_DEFAULT_MODEL;
    if (model.toLowerCase().includes("gemini")) {
      model = CLIENT_OR_SERVER_GPT_DEFAULT_MODEL;
    }
    return { apiUrl: ocUrl, apiKey: ocKey, model };
  }

  return resolveOpenAICompatLLM(requestHeaders);
}

/** @deprecated 使用 resolveLlmPreferClientKeyElseOpenCodeGpt */
export const resolveLlmForPersonOrganize = resolveLlmPreferClientKeyElseOpenCodeGpt;

export function buildLLMRequestBody(
  model: string,
  messages: Array<{ role: string; content: string }>,
  options?: {
    temperature?: number;
    responseFormat?: { type: string };
  }
): Record<string, unknown> {
  const isClaudeModel = model.toLowerCase().includes("claude");
  const isDoubaoModel = model.toLowerCase().includes("doubao") || model.toLowerCase().includes("seed");

  const body: Record<string, unknown> = {
    model,
    messages,
  };

  if (options?.temperature !== undefined) {
    body.temperature = options.temperature;
  }

  if (isClaudeModel) {
    body.max_tokens = 8192;
  }

  if (options?.responseFormat && !isDoubaoModel) {
    body.response_format = options.responseFormat;
  }

  return body;
}
