import { NextRequest, NextResponse } from "next/server";
import { DREAM_RENDER_PROMPT_SYSTEM, DREAM_RENDER_PROMPT_USER } from "@/lib/prompt-templates";
import { parseLLMJson } from "@/lib/llm-utils";
import { buildLLMRequestBody, resolveOpenAICompatLLM } from "@/lib/llm-request";

export async function POST(request: NextRequest) {
  try {
    const { dreamStructured } = await request.json();

    if (!dreamStructured) {
      return NextResponse.json({ error: "No dream data provided" }, { status: 400 });
    }

    const { apiUrl, apiKey, model } = resolveOpenAICompatLLM(request.headers);

    if (!apiUrl || !apiKey) {
      return NextResponse.json({ error: "LLM API not configured" }, { status: 500 });
    }

    const requestBody = buildLLMRequestBody(
      model,
      [
        { role: "system", content: DREAM_RENDER_PROMPT_SYSTEM },
        { role: "user", content: DREAM_RENDER_PROMPT_USER(JSON.stringify(dreamStructured, null, 2)) },
      ],
      { temperature: 0.7, responseFormat: { type: "json_object" } }
    );

    const promptResponse = await fetch(`${apiUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!promptResponse.ok) {
      const error = await promptResponse.text();
      console.error("Prompt generation error:", error);
      return NextResponse.json({ error: "Prompt generation failed", detail: error }, { status: 500 });
    }

    const promptData = await promptResponse.json();
    const promptsContent = promptData.choices?.[0]?.message?.content;

    if (!promptsContent) {
      return NextResponse.json({ error: "Empty prompt response" }, { status: 500 });
    }

    const scenePrompts = parseLLMJson(promptsContent) as Array<{ sceneIndex: number; prompts: string[] }>;

    const doubaoApiUrl = process.env.DOUBAO_API_URL;
    const doubaoApiKey = process.env.DOUBAO_API_KEY;
    const doubaoImageModel = process.env.DOUBAO_IMAGE_MODEL || "doubao-seedream-4-5-251128";

    if (!doubaoApiUrl || !doubaoApiKey) {
      return NextResponse.json({
        status: "prompts_ready",
        scenePrompts,
        message: "图像生成API未配置，提示词已生成",
      });
    }

    const sceneImages: Array<{
      sceneIndex: number;
      imageUrl: string;
      prompt: string;
      error?: string;
    }> = [];

    for (const scenePrompt of scenePrompts) {
      const prompt = scenePrompt.prompts[0];
      if (!prompt) continue;

      try {
        const response = await fetch(`${doubaoApiUrl}/images/generations`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${doubaoApiKey}`,
          },
          body: JSON.stringify({
            model: doubaoImageModel,
            prompt: prompt,
            size: "2K",
            response_format: "b64_json",
            stream: false,
            extra_body: {
              watermark: true,
              sequential_image_generation: "auto",
              sequential_image_generation_options: {
                max_images: 1,
              },
            },
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Image generation error for scene ${scenePrompt.sceneIndex}:`, errorText);
          
          let errorMessage = "图片生成失败";
          try {
            const errorData = JSON.parse(errorText);
            if (errorData.error?.message) {
              errorMessage = errorData.error.message;
            }
          } catch {
            // Ignore parse error
          }
          
          sceneImages.push({
            sceneIndex: scenePrompt.sceneIndex,
            imageUrl: "",
            prompt,
            error: errorMessage,
          });
          continue;
        }

        const data = await response.json();
        
        let imageUrl = "";
        if (data.data && data.data[0]) {
          const imageData = data.data[0];
          if (imageData.b64_json) {
            imageUrl = `data:image/png;base64,${imageData.b64_json}`;
          } else if (imageData.url) {
            imageUrl = imageData.url;
          }
        }

        if (!imageUrl) {
          sceneImages.push({
            sceneIndex: scenePrompt.sceneIndex,
            imageUrl: "",
            prompt,
            error: "No image in response",
          });
          continue;
        }

        sceneImages.push({
          sceneIndex: scenePrompt.sceneIndex,
          imageUrl,
          prompt,
        });
      } catch (error) {
        console.error(`Image generation error for scene ${scenePrompt.sceneIndex}:`, error);
        sceneImages.push({
          sceneIndex: scenePrompt.sceneIndex,
          imageUrl: "",
          prompt,
          error: (error as Error).message,
        });
      }
    }

    return NextResponse.json({
      status: "images_ready",
      scenePrompts,
      sceneImages,
    });
  } catch (error) {
    console.error("Render error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
