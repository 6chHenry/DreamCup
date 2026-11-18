// @ts-expect-error Runtime-only validation entry uses Node's TypeScript loader.
import { assembleRenderJob } from "../src/lib/ffmpeg-render.ts";
import type { VideoRenderJob } from "../src/types/dream.ts";

const now = new Date().toISOString();
function validationJob(id: string, providers: Array<"comfyui_h3" | "storyboard_preview">): VideoRenderJob {
  const shots = providers.map((provider, index) => ({ id: String.fromCharCode(97 + index), sceneIndex: index, title: `镜头 ${index + 1}`, description: "无风的走廊", narration: `第 ${index + 1} 段，月光落在没有风的窗帘上。`, cameraMotion: "push-in" as const, duration: 5, transition: index % 2 ? "cut" as const : "dissolve" as const, imagePrompt: "", videoPrompt: "" }));
  return {
    id, dreamId: "validation", status: "running", stage: "assembly", mode: "generated", provider: "comfyui_h3", narrationProvider: "silent", narrationVolume: 1, musicVolume: 0.18, showSubtitles: true, generationQuality: "draft", storyboard: { version: 1, aspectRatio: "16:9", title: "H3 合成验证", updatedAt: now, shots },
    shots: providers.map((provider, index) => ({ shotId: shots[index].id, status: "ready", provider, attempts: 1, videoUrl: `/api/media/renders/${provider === "storyboard_preview" ? "preview.png" : `shot-${shots[index].id}.mp4`}`, startedAt: now, completedAt: now })),
    createdAt: now, updatedAt: now,
  };
}
for (const [id, providers] of [
  ["validation-h3-assembly", ["comfyui_h3"]],
  ["validation-h3-three", ["comfyui_h3", "comfyui_h3", "comfyui_h3"]],
  ["validation-preview", ["storyboard_preview"]],
  ["validation-mixed", ["comfyui_h3", "storyboard_preview"]],
] as const) console.log(JSON.stringify(await assembleRenderJob(validationJob(id, [...providers]))));
