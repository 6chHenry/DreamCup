/** User-facing message from a failed API route that returns `{ error?, detail? }`. */
export async function messageFromErrorResponse(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string; detail?: string };
    if (data.detail) {
      try {
        const inner = JSON.parse(data.detail) as { error?: { message?: string }; message?: string };
        if (inner.error?.message) return inner.error.message;
        if (typeof inner.message === "string") return inner.message;
      } catch {
        /* detail is plain text */
      }
      const d = data.detail;
      return d.length > 600 ? `${d.slice(0, 400)}…` : d;
    }
    return data.error || `请求失败（${response.status}）`;
  } catch {
    return `请求失败（${response.status}）`;
  }
}

export function parseLLMJson(text: string): unknown {
  let cleaned = text.trim();

  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  return JSON.parse(cleaned);
}
