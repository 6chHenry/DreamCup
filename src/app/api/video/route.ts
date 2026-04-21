import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { sceneImageUrls, dreamStructured } = await request.json();

    if (!dreamStructured) {
      return NextResponse.json({ error: "No dream data provided" }, { status: 400 });
    }

    const grokApiUrl = process.env.GROK_API_URL;
    const grokApiKey = process.env.GROK_API_KEY;
    const grokVideoModel = process.env.GROK_VIDEO_MODEL || "grok-imagine-video";

    if (!grokApiUrl || !grokApiKey) {
      const narrativeSummary = dreamStructured.narrative?.summary || "";
      const sceneDescriptions = (dreamStructured.scenes || [])
        .map((s: { description: string }, i: number) => `场景${i + 1}: ${s.description}`)
        .join("\n");
      const emotionSummary = (dreamStructured.emotions || [])
        .map((e: { type: string; intensity: number }) => `${e.type}(强度${e.intensity})`)
        .join("、");

      return NextResponse.json({
        status: "not_configured",
        message: "视频生成API未配置",
        videoPrompt: `基于以下梦境数据生成一段流畅的梦境视频：\n\n叙事概要：${narrativeSummary}\n\n场景序列：\n${sceneDescriptions}\n\n情绪氛围：${emotionSummary}`,
        sceneImageUrls: sceneImageUrls || [],
      });
    }

    const narrativeSummary = dreamStructured.narrative?.summary || "";
    const sceneDescriptions = (dreamStructured.scenes || [])
      .map((s: { description: string }, i: number) => `场景${i + 1}: ${s.description}`)
      .join("; ");
    const emotionSummary = (dreamStructured.emotions || [])
      .map((e: { type: string; intensity: number }) => `${e.type}`)
      .join(", ");

    const videoPrompt = `A dreamlike video: ${sceneDescriptions}. Mood: ${emotionSummary}. Narrative: ${narrativeSummary}`;

    const videoResponse = await fetch(`${grokApiUrl}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${grokApiKey}`,
      },
      body: JSON.stringify({
        model: grokVideoModel,
        prompt: videoPrompt,
        n: 1,
      }),
    });

    if (!videoResponse.ok) {
      const errorText = await videoResponse.text();
      console.error("Video generation error:", errorText);
      return NextResponse.json({
        status: "error",
        message: "视频生成失败",
        detail: errorText,
        videoPrompt,
      }, { status: 500 });
    }

    const videoData = await videoResponse.json();
    const videoUrl = videoData.data?.[0]?.url || "";

    return NextResponse.json({
      status: "video_ready",
      videoUrl,
      videoPrompt,
    });
  } catch (error) {
    console.error("Video generation error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
