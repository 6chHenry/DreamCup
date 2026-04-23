"use client";

import type { Dream } from "@/types/dream";
import { Moon, MapPin, Users, Heart, Sparkles, Video } from "lucide-react";

interface DreamCardProps {
  dream: Dream;
  onClick?: (dream: Dream) => void;
}

export default function DreamCard({ dream, onClick }: DreamCardProps) {
  const { structured } = dream;
  const dominantEmotion = structured.emotions[0];
  const selectedScene = dream.scenes.find((s) => s.isSelected);
  const hasVideo = Boolean(dream.videoUrl);

  return (
    <div
      onClick={() => onClick?.(dream)}
      className="group cursor-pointer rounded-2xl bg-white/5 border border-white/10 p-5 hover:bg-white/10 hover:border-white/20 transition-all"
    >
      {/* 优先展示视频缩略图，fallback 到场景图 */}
      {hasVideo ? (
        <div className="mb-4 rounded-lg overflow-hidden aspect-video bg-black/40 relative">
          <video
            src={dream.videoUrl}
            muted
            autoPlay
            loop
            playsInline
            preload="metadata"
            className="w-full h-full object-cover"
          />
          <span className="absolute bottom-2 right-2 flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-black/50 text-white/70 backdrop-blur-sm">
            <Video size={10} />
            视频
          </span>
        </div>
      ) : selectedScene ? (
        <div className="mb-4 rounded-lg overflow-hidden aspect-video bg-black/20">
          <img
            src={selectedScene.imageUrl}
            alt={dream.title}
            className="w-full h-full object-cover"
          />
        </div>
      ) : null}

      <div className="flex items-start justify-between mb-2">
        <h3 className="text-lg font-medium text-white/90 group-hover:text-white transition-colors">
          {dream.title}
        </h3>
        <span className="text-xs text-white/40">
          {new Date(dream.createdAt).toLocaleDateString("zh-CN")}
        </span>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {structured.scenes.length > 0 && (
          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-indigo-500/20 text-indigo-300">
            <MapPin size={12} />
            {structured.scenes.length} 个场景
          </span>
        )}
        {structured.characters.length > 0 && (
          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-purple-500/20 text-purple-300">
            <Users size={12} />
            {structured.characters.length} 个人物
          </span>
        )}
        {dominantEmotion && (
          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-pink-500/20 text-pink-300">
            <Heart size={12} />
            {dominantEmotion.type}
          </span>
        )}
        {structured.anomalies.length > 0 && (
          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-amber-500/20 text-amber-300">
            <Sparkles size={12} />
            {structured.anomalies.length} 个异常
          </span>
        )}
        {structured.meta.isLucidDream && (
          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-cyan-500/20 text-cyan-300">
            <Moon size={12} />
            清醒梦
          </span>
        )}
        {hasVideo && (
          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-violet-500/20 text-violet-300">
            <Video size={12} />
            有视频
          </span>
        )}
      </div>

      <p className="text-sm text-white/50 line-clamp-2">
        {structured.narrative.summary || dream.rawText.slice(0, 100)}
      </p>
    </div>
  );
}
