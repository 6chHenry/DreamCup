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
