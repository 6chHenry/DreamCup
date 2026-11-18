import type { Dream, DreamStoryboard } from "@/types/dream";

export interface ProductionReviewItem {
  id: string;
  tone: "ready" | "warning";
  title: string;
  detail: string;
  shotIndex?: number;
}

export function getProductionReview(storyboard: DreamStoryboard, dream: Dream): ProductionReviewItem[] {
  const images = new Map(dream.scenes.filter((scene) => scene.imageUrl).map((scene) => [scene.sceneIndex, scene.imageUrl]));
  const items: ProductionReviewItem[] = storyboard.shots.flatMap((shot, shotIndex) => {
    if (!images.get(shot.sceneIndex)) return [{ id: `image-${shot.id}`, tone: "warning" as const, title: `镜头 ${shotIndex + 1} 缺少画面`, detail: "补齐场景图后才能合成；其余编辑不会丢失。", shotIndex }];
    if (!shot.description.trim()) return [{ id: `description-${shot.id}`, tone: "warning" as const, title: `镜头 ${shotIndex + 1} 缺少画面描述`, detail: "补充动作或场景线索，让画面更可控。", shotIndex }];
    if (!shot.narration.trim()) return [{ id: `narration-${shot.id}`, tone: "warning" as const, title: `镜头 ${shotIndex + 1} 没有旁白`, detail: "可以保留为呼吸停顿，也可以补一句回忆线索。", shotIndex }];
    if (shot.narration.trim().length > shot.duration * 7) return [{ id: `pace-${shot.id}`, tone: "warning" as const, title: `镜头 ${shotIndex + 1} 的旁白偏满`, detail: `${shot.duration} 秒约容纳 ${shot.duration * 7} 字；当前 ${shot.narration.trim().length} 字，建议精简或延长。`, shotIndex }];
    return [];
  });
  if (storyboard.shots.length === 0) items.push({ id: "empty", tone: "warning", title: "还没有镜头", detail: "先补充一个镜头，再开始制作。" });
  if (items.length === 0) items.push({ id: "ready", tone: "ready", title: "节奏与素材已就绪", detail: `${storyboard.shots.length} 个镜头都有画面，旁白长度与镜头时长基本匹配。` });
  return items;
}

export function storyboardSignature(storyboard: DreamStoryboard): string {
  return JSON.stringify({ aspectRatio: storyboard.aspectRatio, shots: storyboard.shots });
}
