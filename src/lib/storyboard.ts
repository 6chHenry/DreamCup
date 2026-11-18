import type { CameraMotion, Dream, DreamStoryboard, SceneTransition, StoryboardShot } from "@/types/dream";

export const CAMERA_MOTIONS: { value: CameraMotion; label: string; description: string }[] = [
  { value: "push-in", label: "缓慢推进", description: "靠近情绪与细节" },
  { value: "pull-back", label: "缓慢拉远", description: "揭示空间与关系" },
  { value: "pan-left", label: "向左横移", description: "展开环境线索" },
  { value: "pan-right", label: "向右横移", description: "跟随视线移动" },
  { value: "drift", label: "轻微漂移", description: "保留梦境失重感" },
  { value: "still", label: "固定镜头", description: "停留与凝视" },
];

export const TRANSITIONS: { value: SceneTransition; label: string }[] = [
  { value: "dissolve", label: "柔和叠化" },
  { value: "fade", label: "淡出淡入" },
  { value: "cut", label: "直接切换" },
];

const motionPrompts: Record<CameraMotion, string> = {
  still: "Locked-off static camera, no zoom, only subtle environmental movement.",
  "push-in": "Very slow smooth cinematic dolly push-in, stable subject, no sudden movement.",
  "pull-back": "Very slow smooth cinematic dolly pull-back, gradually reveal the environment.",
  "pan-left": "Slow gentle camera pan from right to left, stable horizon, no abrupt turns.",
  "pan-right": "Slow gentle camera pan from left to right, stable horizon, no abrupt turns.",
  drift: "Subtle weightless floating camera drift, restrained dreamlike movement, stable composition.",
};

export function cameraMotionLabel(value: CameraMotion): string {
  return CAMERA_MOTIONS.find((motion) => motion.value === value)?.label ?? value;
}

export function defaultCameraMotion(index: number): CameraMotion {
  return (["push-in", "drift", "pull-back", "pan-right"] as CameraMotion[])[index % 4];
}

export function buildVideoPrompt(shot: StoryboardShot, styleGuide?: Dream["sceneStyleGuide"]): string {
  const style = [styleGuide?.artStyle, styleGuide?.colorPalette, styleGuide?.moodKeywords].filter(Boolean).join("; ");
  return [
    shot.description,
    style ? `Visual continuity: ${style}.` : "",
    motionPrompts[shot.cameraMotion],
    `Shot duration: ${shot.duration} seconds. Ending transition: ${shot.transition}.`,
    "Preserve the scene's identity, architecture, lighting and character appearance. No text, subtitles, logos, morphing faces, extra limbs, flicker or sudden cuts within the shot.",
  ].filter(Boolean).join("\n");
}

export function createDefaultStoryboard(dream: Dream): DreamStoryboard {
  const sourceScenes = dream.structured.scenes.length > 0
    ? dream.structured.scenes.map((scene, index) => ({
        sceneIndex: index,
        description: scene.description,
        imagePrompt: dream.sceneRenderPrompts?.find((prompt) => prompt.sceneIndex === index)?.prompts[0]
          ?? dream.scenes.find((image) => image.sceneIndex === index)?.promptUsed
          ?? scene.description,
      }))
    : [{ sceneIndex: 0, description: dream.structured.narrative.summary || dream.rawText, imagePrompt: dream.rawText }];

  const shots = sourceScenes.map((source, index) => {
    const shot: StoryboardShot = {
      id: crypto.randomUUID(),
      sceneIndex: source.sceneIndex,
      title: source.description.split(/[。！？!?\n]/).find(Boolean)?.trim().slice(0, 22) || `镜头 ${index + 1}`,
      description: source.description,
      narration: source.description,
      cameraMotion: defaultCameraMotion(index),
      duration: index === 0 ? 6 : 5,
      transition: index === sourceScenes.length - 1 ? "fade" : "dissolve",
      imagePrompt: source.imagePrompt,
      videoPrompt: "",
    };
    return { ...shot, videoPrompt: buildVideoPrompt(shot, dream.sceneStyleGuide) };
  });

  return {
    version: 1,
    aspectRatio: "16:9",
    title: dream.title,
    shots,
    updatedAt: new Date().toISOString(),
  };
}

export function storyboardDuration(storyboard: DreamStoryboard): number {
  return storyboard.shots.reduce((total, shot) => total + shot.duration, 0);
}

export function videoDurationForShots(shots: StoryboardShot[]): number {
  if (shots.length === 0) return 10;
  return Math.min(15, Math.max(5, Math.round(shots[0].duration)));
}
