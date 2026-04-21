import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File | null;

    if (!audioFile) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
    }

    const buffer = Buffer.from(await audioFile.arrayBuffer());
    const ext = audioFile.name.split(".").pop() || "webm";
    const audioId = crypto.randomUUID();
    const audioFileName = `${audioId}.${ext}`;

    const audioDir = path.join(process.cwd(), "data", "audio");
    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true });
    }
    fs.writeFileSync(path.join(audioDir, audioFileName), buffer);

    let asrResult: { text: string; segments: any[]; dreamSegments: any[] };

    try {
      asrResult = await geminiASR(buffer, ext);
    } catch (geminiError) {
      console.warn("Gemini ASR failed, trying Doubao:", geminiError);
      try {
        asrResult = await doubaoASR(buffer, ext);
      } catch (doubaoError) {
        console.error("Both ASR methods failed. Gemini:", geminiError, "Doubao:", doubaoError);
        throw new Error("ASR failed: all methods unavailable");
      }
    }

    return NextResponse.json({
      ...asrResult,
      audioFileName,
    });
  } catch (error) {
    console.error("ASR error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
}

async function geminiASR(buffer: Buffer, ext: string) {
  const apiUrl = process.env.GEMINI_API_URL;
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL;

  if (!apiUrl || !apiKey || !model) {
    throw new Error("Gemini API not configured");
  }

  const base64Audio = buffer.toString("base64");
  const mimeType = ext === "webm" ? "audio/webm" : ext === "mp3" ? "audio/mp3" : ext === "ogg" ? "audio/ogg" : "audio/wav";

  const response = await fetch(`${apiUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Please transcribe the following audio into text. Output only the transcribed text, no explanations or labels. If there is no speech, output nothing.",
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Audio}`,
              },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini ASR failed: ${error}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || "";

  if (!text.trim()) {
    throw new Error("Gemini ASR returned empty text");
  }

  const segments = text
    .split(/\n+/)
    .filter((s: string) => s.trim())
    .map((t: string, i: number) => ({
      start: i * 3,
      end: (i + 1) * 3,
      text: t.trim(),
    }));

  return {
    text,
    segments,
    dreamSegments: splitDreamSegments(segments),
  };
}

async function doubaoASR(buffer: Buffer, ext: string) {
  const asrApiUrl = process.env.DOUBAO_ASR_API_URL;
  const asrApiKey = process.env.DOUBAO_ASR_API_KEY;
  const resourceId = process.env.DOUBAO_ASR_RESOURCE_ID;

  if (!asrApiUrl || !asrApiKey || !resourceId) {
    throw new Error("Doubao ASR API not configured");
  }

  const base64Audio = buffer.toString("base64");

  const submitResponse = await fetch(asrApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": asrApiKey,
      "X-Api-Resource-Id": resourceId,
      "X-Api-Request-Id": crypto.randomUUID(),
      "X-Api-Sequence": "-1",
    },
    body: JSON.stringify({
      user: { uid: "dreamcatch" },
      audio: {
        data: base64Audio,
        format: ext === "webm" ? "wav" : ext,
        codec: "raw",
        rate: 16000,
        bits: 16,
        channel: 1,
      },
      request: {
        model_name: "bigmodel",
        enable_itn: true,
        enable_punc: false,
        enable_ddc: false,
        enable_speaker_info: false,
        enable_channel_split: false,
        show_utterances: false,
        vad_segment: false,
        sensitive_words_filter: "",
      },
    }),
  });

  if (!submitResponse.ok) {
    const error = await submitResponse.text();
    throw new Error(`Doubao ASR submit failed: ${error}`);
  }

  const submitData = await submitResponse.json();
  const taskId = submitData.task_id;

  if (!taskId) {
    throw new Error(`Doubao ASR no task_id: ${JSON.stringify(submitData)}`);
  }

  const resultUrl = asrApiUrl.replace("/submit", "/query") + `/${taskId}`;
  let attempts = 0;
  const maxAttempts = 30;

  while (attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const resultResponse = await fetch(resultUrl, {
      method: "GET",
      headers: {
        "x-api-key": asrApiKey,
        "X-Api-Resource-Id": resourceId,
      },
    });

    if (!resultResponse.ok) {
      attempts++;
      continue;
    }

    const resultData = await resultResponse.json();

    if (resultData.status === "done" && resultData.result?.text) {
      const fullText = resultData.result.text;
      const segments = fullText
        .split(/\n+/)
        .filter((s: string) => s.trim())
        .map((text: string, i: number) => ({
          start: i * 3,
          end: (i + 1) * 3,
          text: text.trim(),
        }));

      return {
        text: fullText,
        segments,
        dreamSegments: splitDreamSegments(segments),
      };
    } else if (resultData.status === "failed") {
      throw new Error(`Doubao ASR processing failed: ${JSON.stringify(resultData)}`);
    }

    attempts++;
  }

  throw new Error("Doubao ASR timeout");
}

function splitDreamSegments(
  segments: { start: number; end: number; text: string }[]
): { start: number; end: number; text: string }[] {
  if (segments.length === 0) return [];

  const dreamSegments: { start: number; end: number; text: string }[] = [];
  let currentSegment = {
    start: segments[0].start,
    end: segments[0].end,
    text: segments[0].text,
  };

  const GAP_THRESHOLD = 2.0;

  for (let i = 1; i < segments.length; i++) {
    const gap = segments[i].start - segments[i - 1].end;
    if (gap > GAP_THRESHOLD) {
      dreamSegments.push(currentSegment);
      currentSegment = {
        start: segments[i].start,
        end: segments[i].end,
        text: segments[i].text,
      };
    } else {
      currentSegment.end = segments[i].end;
      currentSegment.text += segments[i].text;
    }
  }

  dreamSegments.push(currentSegment);
  return dreamSegments;
}
