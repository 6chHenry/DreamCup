import { NextRequest, NextResponse } from "next/server";
import { llmFetch } from "@/lib/llm-fetch";
import { DreamStructuredSchema } from "@/lib/schema";
import { MEMORY_PROBE_SYSTEM_PROMPT, MEMORY_PROBE_USER_PROMPT } from "@/lib/prompt-templates";
import { parseLLMJson } from "@/lib/llm-utils";
import { buildLLMRequestBody, resolveOpenAICompatLLM } from "@/lib/llm-request";

function normalizeProposal(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const proposal = value as Record<string, unknown>;
  if (typeof proposal.description !== "string" || !proposal.description.trim()) return undefined;
  const options = Array.isArray(proposal.options)
    ? proposal.options.flatMap((option, index) => {
        if (typeof option === "string" && option.trim()) return [{ id: String.fromCharCode(97 + index), label: option.trim() }];
        if (!option || typeof option !== "object") return [];
        const item = option as Record<string, unknown>;
        return typeof item.label === "string" && item.label.trim()
          ? [{ id: typeof item.id === "string" && item.id ? item.id : String.fromCharCode(97 + index), label: item.label.trim() }]
          : [];
      }).slice(0, 4)
    : [];
  return {
    description: proposal.description.trim(),
    basis: typeof proposal.basis === "string" ? proposal.basis.trim() : "",
    confidence: proposal.confidence === "medium" ? "medium" : "low",
    mode: proposal.mode === "multiple" ? "multiple" : "single",
    options,
  };
}

export async function POST(request: NextRequest) {
  try {
    const { dreamStructured, conversationHistory, userAnswer } = await request.json();
    const confirmedDream = DreamStructuredSchema.parse(dreamStructured);

    if (!dreamStructured) {
      return NextResponse.json({ error: "No dream data provided" }, { status: 400 });
    }

    const { apiUrl, apiKey, model } = resolveOpenAICompatLLM(request.headers);

    if (!apiUrl || !apiKey || !model) {
      return NextResponse.json({ error: model === "kimi-k3" ? "请在 .env.local 填写 KIMI_API_KEY 后重启应用" : "LLM API not configured" }, { status: 500 });
    }

    const prompt = MEMORY_PROBE_USER_PROMPT(
      JSON.stringify(dreamStructured, null, 2),
      conversationHistory || "（对话刚开始）",
      userAnswer
    );

    const requestBody = buildLLMRequestBody(
      model,
      [
        { role: "system", content: MEMORY_PROBE_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      { temperature: 0.5, responseFormat: { type: "json_object" } }
    );

    const response = await llmFetch(`${apiUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(90_000),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("Probe API error:", error);
      return NextResponse.json({ error: `记忆补全模型请求失败（${response.status}）`, detail: error }, { status: 500 });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return NextResponse.json({ error: "Empty response from LLM" }, { status: 500 });
    }

    const result = parseLLMJson(content) as Record<string, unknown>;

    if (result.action === "ask") {
      result.question = typeof result.question === "string" && result.question.trim()
        ? result.question.trim()
        : "这个画面与你的记忆相符吗？";
      result.proposal = normalizeProposal(result.proposal);
    }

    if (result.action === "ask") {
      // 提问阶段不修改已确认内容，无需让模型重复生成整份 Dream JSON。
      result.updatedDream = confirmedDream;
    } else if (result.updatedDream) {
      try {
        result.updatedDream = DreamStructuredSchema.parse(result.updatedDream);
      } catch (validationError) {
        console.error("Dream validation error:", validationError);
        result.updatedDream = confirmedDream;
        result.structureWarning = "本次回答已保留在核对记录中，但结构化更新未通过校验，因此未覆盖已确认的梦境内容。";
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Probe error:", error);
    const message = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
      ? "记忆补全模型响应超时，请重试或跳过补全"
      : error instanceof Error ? error.message : "记忆补全请求失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
