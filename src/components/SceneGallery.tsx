"use client";

import { motion } from "framer-motion";
import { Check, Image as ImageIcon, FileText } from "lucide-react";
import type { DreamSceneImage } from "@/types/dream";

interface SceneGalleryProps {
  scenes: DreamSceneImage[];
  onSelectScene: (sceneId: string) => void;
  isLoading?: boolean;
}

export default function SceneGallery({ scenes, onSelectScene, isLoading }: SceneGalleryProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="aspect-video rounded-xl bg-white/5 border border-white/10 animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (scenes.length === 0) {
    return (
      <div className="text-center py-12 text-white/30">
        <ImageIcon size={48} className="mx-auto mb-4 opacity-50" />
        <p>场景图正在生成中...</p>
      </div>
    );
  }

  const hasAnyImage = scenes.some((s) => s.imageUrl);

  const groupedByScene = scenes.reduce(
    (acc, scene) => {
      if (!acc[scene.sceneIndex]) acc[scene.sceneIndex] = [];
      acc[scene.sceneIndex].push(scene);
      return acc;
    },
    {} as Record<number, DreamSceneImage[]>
  );

  if (!hasAnyImage) {
    return (
      <div className="space-y-6">
        <div className="text-center py-4 text-white/40 text-sm">
          <FileText size={32} className="mx-auto mb-2 opacity-50" />
          <p>图像生成API未配置，以下为生成的提示词</p>
        </div>
        {Object.entries(groupedByScene).map(([sceneIndex, sceneImages]) => (
          <div key={sceneIndex}>
            <h4 className="text-sm font-medium text-white/60 mb-3">
              场景 {Number(sceneIndex) + 1}
            </h4>
            <div className="space-y-2">
              {sceneImages.map((scene, i) => (
                <div
                  key={scene.id}
                  className="rounded-lg bg-white/5 border border-white/10 p-3 text-xs text-white/50"
                >
                  <span className="text-white/30 mr-2">变体 {i + 1}:</span>
                  {scene.promptUsed}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {Object.entries(groupedByScene).map(([sceneIndex, sceneImages]) => (
        <div key={sceneIndex}>
          <h4 className="text-sm font-medium text-white/60 mb-3">
            场景 {Number(sceneIndex) + 1}
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {sceneImages.map((scene) => (
              <motion.div
                key={scene.id}
                whileHover={{ scale: 1.02 }}
                onClick={() => onSelectScene(scene.id)}
                className={`relative aspect-video rounded-xl overflow-hidden cursor-pointer border-2 transition-all ${
                  scene.isSelected
                    ? "border-indigo-500 shadow-lg shadow-indigo-500/25"
                    : "border-white/10 hover:border-white/30"
                }`}
              >
                <img
                  src={scene.imageUrl}
                  alt={`Scene ${sceneIndex}`}
                  className="w-full h-full object-cover"
                />
                {scene.isSelected && (
                  <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center">
                    <Check size={14} />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 hover:opacity-100 transition-opacity flex items-end p-3">
                  <p className="text-xs text-white/80 line-clamp-2">
                    选择最接近记忆的图
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
