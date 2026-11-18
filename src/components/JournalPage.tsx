"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import JournalWorkspace from "@/components/JournalWorkspace";
import type { Dream } from "@/types/dream";
import { messageFromErrorResponse } from "@/lib/llm-utils";

export default function JournalPage({ online = false }: { online?: boolean }) {
  const router = useRouter();
  const [dreams, setDreams] = useState<Dream[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [importZipBusy, setImportZipBusy] = useState(false);
  const importZipInputRef = useRef<HTMLInputElement>(null);

  const fetchDreams = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch("/api/dreams", { cache: "no-store" });
      if (response.ok) setDreams(await response.json());
    } catch (error) {
      console.error("Fetch dreams error:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(fetchDreams, 0);
    return () => window.clearTimeout(timer);
  }, [fetchDreams]);

  const handleDeleteSelected = async () => {
    if (!selected.size || !confirm(`从日志隐藏选中的 ${selected.size} 条？原始数据仍会保留。`)) return;
    setDeleteBusy(true);
    try {
      for (const id of selected) {
        const response = await fetch(`/api/dreams/${id}`, { method: "DELETE" });
        if (!response.ok) throw new Error(await messageFromErrorResponse(response));
      }
      setSelectionMode(false);
      setSelected(new Set());
      await fetchDreams();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "操作失败");
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleImportZipChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportZipBusy(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/dreams/import-zip", { method: "POST", body: formData });
      if (!response.ok) throw new Error(await messageFromErrorResponse(response));
      const dream = await response.json() as Dream;
      await fetchDreams();
      router.push(`/dream/${dream.id}`);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "导入失败");
    } finally {
      setImportZipBusy(false);
    }
  };

  return (
    <JournalWorkspace
      dreams={dreams}
      isLoading={isLoading}
      selectionMode={selectionMode}
      selected={selected}
      deleteBusy={deleteBusy}
      importZipBusy={importZipBusy}
      importZipInputRef={importZipInputRef}
      onDreamClick={(dream) => router.push(`/dream/${dream.id}`)}
      onToggleSelect={(dream) => setSelected((current) => {
        const next = new Set(current);
        if (next.has(dream.id)) next.delete(dream.id); else next.add(dream.id);
        return next;
      })}
      onDeleteSelected={handleDeleteSelected}
      onToggleSelectionMode={() => {
        setSelectionMode((value) => !value);
        setSelected(new Set());
      }}
      onImportZipPick={() => importZipInputRef.current?.click()}
      onImportZipChange={handleImportZipChange}
      online={online}
    />
  );
}
