export type ProviderErrorKind = "configuration" | "authentication" | "permission" | "rate_limit" | "content_policy" | "timeout" | "invalid_response" | "provider" | "network";

export class ProviderError extends Error {
  constructor(message: string, readonly kind: ProviderErrorKind, readonly status?: number) {
    super(message);
    this.name = "ProviderError";
  }
}

export function missingProviderConfig(message: string): ProviderError {
  return new ProviderError(message, "configuration");
}

export async function providerResponseError(response: Response, provider: string): Promise<ProviderError> {
  const body = (await response.text()).slice(0, 500);
  let message = body;
  let code = "";
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; code?: string } | string; message?: string; code?: string };
    if (typeof parsed.error === "object") { message = parsed.error.message || body; code = parsed.error.code || ""; }
    else message = (typeof parsed.error === "string" ? parsed.error : parsed.message) || body;
    code ||= parsed.code || "";
  } catch { /* retain response body */ }
  const lower = `${code} ${message}`.toLowerCase();
  const kind: ProviderErrorKind = response.status === 401 || response.status === 403 ? "authentication"
    : response.status === 429 ? "rate_limit"
    : response.status === 408 || response.status === 504 ? "timeout"
    : response.status === 402 ? "permission"
    : lower.includes("sensitivecontent") || lower.includes("content_policy") ? "content_policy"
    : "provider";
  return new ProviderError(`${provider}请求失败（${response.status}）：${message}`, kind, response.status);
}

export function providerError(error: unknown, provider: string): Error {
  if (error instanceof ProviderError || (error instanceof Error && error.name === "AbortError")) return error;
  return new ProviderError(`${provider}网络或响应异常：${error instanceof Error ? error.message : String(error)}`, "network");
}
