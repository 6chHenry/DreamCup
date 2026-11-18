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
    "kimi-k3";

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

  if (host.includes("api.kimi.com") || model.toLowerCase() === "kimi-k3") {
    return {
      apiUrl: headerUrl || process.env.KIMI_API_URL?.trim() || "https://api.kimi.com/coding/v1",
      apiKey: process.env.KIMI_API_KEY?.trim() || "",
      model,
    };
  }

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
    if (model.toLowerCase() === "kimi-k3") {
      return {
        apiUrl: process.env.KIMI_API_URL?.trim() || "https://api.kimi.com/coding/v1",
        apiKey: process.env.KIMI_API_KEY?.trim() || "",
        model,
      };
    }
    return { apiUrl: geminiUrl, apiKey: geminiKey, model };
  }

  return { apiUrl: headerUrl, apiKey: geminiKey, model };
}

function resolveKimiServerLLM(model: string) {
  return {
    apiUrl: process.env.KIMI_API_URL?.trim() || "https://api.kimi.com/coding/v1",
    apiKey: process.env.KIMI_API_KEY?.trim() || "",
    model,
  };
}

const SERVER_DEFAULT_LLM_MODEL = "kimi-k3";

/**
 * 优先使用请求里的 x-api-key（浏览器 NEXT_PUBLIC 与所选模型）；服务端默认使用 Kimi K3。
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

  const requestedModel = requestHeaders.get("x-model")?.trim() || SERVER_DEFAULT_LLM_MODEL;
  const requestedUrl = requestHeaders.get("x-api-url")?.trim() ?? "";
  if (requestedModel.toLowerCase() === "kimi-k3" || requestedUrl.includes("api.kimi.com")) {
    return resolveOpenAICompatLLM(requestHeaders);
  }
  if (!requestHeaders.has("x-model") && !requestHeaders.has("x-api-url")) {
    return resolveKimiServerLLM(SERVER_DEFAULT_LLM_MODEL);
  }

  const ocUrl =
    process.env.OPENCLAUDECODE_API_URL?.trim() || "https://www.openclaudecode.cn/v1";
  const ocKey =
    process.env.OPENCLAUDECODE_API_KEY_GPT?.trim() ||
    process.env.OPENCLAUDECODE_API_KEY?.trim() ||
    "";
  if (ocKey) {
    let model = requestHeaders.get("x-model")?.trim() || SERVER_DEFAULT_LLM_MODEL;
    if (model.toLowerCase().includes("gemini")) {
      model = SERVER_DEFAULT_LLM_MODEL;
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
  const isKimiK3 = model.toLowerCase() === "kimi-k3";

  const body: Record<string, unknown> = {
    model,
    messages,
  };

  if (options?.temperature !== undefined) {
    body.temperature = isKimiK3 ? 1 : options.temperature;
  }

  if (isClaudeModel) {
    body.max_tokens = 8192;
  }

  if (options?.responseFormat && !isDoubaoModel) {
    body.response_format = options.responseFormat;
  }

  return body;
}
