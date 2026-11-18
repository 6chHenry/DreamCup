"use client";

import type { Dream } from "@/types/dream";
import { getDreamJournalGroupLabel } from "@/lib/dream-dates";
import DreamCard from "./DreamCard";

interface JournalTimelineProps {
  dreams: Dream[];
  onDreamClick: (dream: Dream) => void;
  selectionMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (dream: Dream) => void;
}

export default function JournalTimeline({
  dreams,
  onDreamClick,
  selectionMode = false,
  selectedIds,
  onToggleSelect,
}: JournalTimelineProps) {
  if (dreams.length === 0) {
    return (
      <div className="text-center py-20 text-dream-muted">
        <p className="text-lg mb-2 font-light">还没有梦境记录</p>
        <p className="text-sm">像雾一样，第一个梦尚未成形</p>
      </div>
    );
  }

  const groupedByDate = dreams.reduce(
    (acc, dream) => {
      const date = getDreamJournalGroupLabel(dream);
      if (!acc[date]) acc[date] = [];
      acc[date].push(dream);
      return acc;
    },
    {} as Record<string, Dream[]>
  );

  return (
    <div className="space-y-8">
      {Object.entries(groupedByDate).map(([date, dateDreams]) => (
        <div key={date}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-2 h-2 rounded-full bg-[var(--dream-moon)]/50 shadow-[0_0_12px_rgba(180,200,255,0.2)] ring-4 ring-white/[0.04]" />
            <h3 className="text-sm font-normal tracking-wide text-dream-subtle">{date}</h3>
            <div className="flex-1 h-px bg-gradient-to-r from-white/12 to-transparent" />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {dateDreams.map((dream) => (
              <DreamCard
                key={dream.id}
                dream={dream}
                onClick={onDreamClick}
                selectionMode={selectionMode}
                selected={Boolean(selectedIds?.has(dream.id))}
                onToggleSelect={onToggleSelect}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
