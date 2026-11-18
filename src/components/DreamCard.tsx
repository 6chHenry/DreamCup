"use client";

import type { Dream } from "@/types/dream";
import { formatJournalDateZh } from "@/lib/dream-dates";
import { Moon, MapPin, Users, Heart, Sparkles, Video, Tag, Feather } from "lucide-react";

interface DreamCardProps {
  dream: Dream;
  onClick?: (dream: Dream) => void;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (dream: Dream) => void;
}

export default function DreamCard({
  dream,
  onClick,
  selectionMode = false,
  selected = false,
  onToggleSelect,
}: DreamCardProps) {
  const { structured } = dream;
  const dominantEmotion = structured.emotions[0];
  const selectedScene = dream.scenes.find((scene) => scene.isSelected && scene.imageUrl) ?? dream.scenes.find((scene) => scene.imageUrl);
  const hasVideo = Boolean(dream.videoUrl);
  const hasVisual = Boolean(selectedScene || hasVideo);

  const handleCardClick = () => {
    if (selectionMode) onToggleSelect?.(dream);
    else onClick?.(dream);
  };

  return (
    <div
      role={selectionMode ? "button" : undefined}
      onClick={handleCardClick}
      className={`dream-card group ${selected ? "dream-card--selected" : ""}`}
    >
      {selectionMode && (
        <div
          className="absolute top-4 left-4 z-10 flex h-5 w-5 items-center justify-center rounded border border-white/20 bg-black/50 pointer-events-none"
          aria-hidden
        >
          {selected ? (
            <span className="text-[10px] font-normal text-white/75">✓</span>
          ) : null}
        </div>
      )}
      {hasVideo ? (
        <div className="mb-4 rounded-[calc(var(--radius-dream)-4px)] overflow-hidden aspect-video bg-black/50 relative">
          {selectedScene ? <img src={selectedScene.imageUrl} alt="" className="h-full w-full object-cover opacity-80" /> : <div className="flex h-full items-center justify-center"><Video size={26} className="text-white/20" /></div>}
          <span className="absolute bottom-2 right-2 flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-black/55 text-white/65 backdrop-blur-sm border border-white/10">
            <Video size={10} />
            视频
          </span>
        </div>
      ) : selectedScene ? (
        <div className="mb-4 rounded-[calc(var(--radius-dream)-4px)] overflow-hidden aspect-video bg-black/30">
          <img
            src={selectedScene.imageUrl}
            alt={dream.title}
            className="w-full h-full object-cover opacity-90"
          />
        </div>
      ) : null}

      <div className={`flex items-start justify-between mb-2 ${selectionMode ? "pl-7" : ""}`}>
        <h3 className="text-lg font-normal text-white/88 group-hover:text-[var(--dream-pearl)] transition-colors duration-300">
          {dream.title}
        </h3>
        <span className="text-xs text-dream-muted">{formatJournalDateZh(dream)}</span>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {!hasVisual && (
          <span className="dream-badge dream-badge--text">
            <Feather size={12} />
            文字碎片
          </span>
        )}
        {structured.scenes.length > 0 && (
          <span className="dream-badge">
            <MapPin size={12} />
            {structured.scenes.length} 个场景
          </span>
        )}
        {structured.characters.length > 0 && (
          <span className="dream-badge">
            <Users size={12} />
            {structured.characters.length} 个人物
          </span>
        )}
        {dominantEmotion && (
          <span className="dream-badge dream-badge--emotion">
            <Heart size={12} />
            {dominantEmotion.type}
          </span>
        )}
        {structured.anomalies.length > 0 && (
          <span className="dream-badge dream-badge--anomaly">
            <Sparkles size={12} />
            {structured.anomalies.length} 个异常
          </span>
        )}
        {structured.meta.isLucidDream && (
          <span className="dream-badge dream-badge--lucid">
            <Moon size={12} />
            清醒梦
          </span>
        )}
        {hasVideo && (
          <span className="dream-badge dream-badge--video">
            <Video size={12} />
            有视频
          </span>
        )}
        {dream.tags?.map((tag) => (
          <span key={tag} className="dream-badge dream-badge--tag">
            <Tag size={11} />
            {tag}
          </span>
        ))}
      </div>

      <p className="text-sm text-dream-muted line-clamp-2 leading-relaxed">
        {structured.narrative.summary || dream.rawText.slice(0, 100)}
      </p>
    </div>
  );
}
