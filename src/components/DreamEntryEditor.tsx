"use client";

import { useState } from "react";
import { Feather, Loader2, Pencil, Save, Tag, X } from "lucide-react";
import type { Dream } from "@/types/dream";
import { messageFromErrorResponse } from "@/lib/llm-utils";

export default function DreamEntryEditor({ dream, onSaved }: { dream: Dream; onSaved: (dream: Dream) => void }) {
  const [editing, setEditing] = useState(false);
  const [rawText, setRawText] = useState(dream.rawText);
  const [tagsText, setTagsText] = useState((dream.tags ?? []).join("，"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!rawText.trim()) {
      setError("梦境原文不能为空。");
      return;
    }
    setSaving(true);
    setError("");
    const tags = [...new Set(tagsText.split(/[,，、]/).map((tag) => tag.trim()).filter(Boolean))].slice(0, 12);
    try {
      const response = await fetch(`/api/dreams/${dream.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: rawText.trim(), tags }),
      });
      if (!response.ok) throw new Error(await messageFromErrorResponse(response));
      onSaved(await response.json());
      setEditing(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="dream-entry-section">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm text-white/55"><Feather size={14} />梦境原文</h2>
        <button type="button" className="dream-icon-button" onClick={() => {
          if (editing) {
            setRawText(dream.rawText);
            setTagsText((dream.tags ?? []).join("，"));
          }
          setEditing((value) => !value);
          setError("");
        }} aria-label={editing ? "取消编辑" : "编辑原文和标签"}>
          {editing ? <X size={14} /> : <Pencil size={13} />}
        </button>
      </div>

      {editing ? (
        <div className="space-y-3">
          <textarea value={rawText} onChange={(event) => setRawText(event.target.value)} rows={7} className="dream-entry-textarea" aria-label="编辑梦境原文" />
          <label className="flex items-center gap-2 text-xs text-white/45"><Tag size={13} /><input value={tagsText} onChange={(event) => setTagsText(event.target.value)} placeholder="标签，用逗号分隔" className="flex-1 border-b border-white/10 bg-transparent py-2 outline-none placeholder:text-white/20" /></label>
          {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
          <button type="button" className="btn-dream-primary px-4 py-2 text-xs" onClick={save} disabled={saving}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}保存修改
          </button>
        </div>
      ) : (
        <>
          <p className="dream-prose text-sm leading-8 text-dream-subtle whitespace-pre-wrap">{dream.rawText}</p>
          {dream.tags && dream.tags.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{dream.tags.map((tag) => <span key={tag} className="dream-badge dream-badge--tag"><Tag size={11} />{tag}</span>)}</div>}
        </>
      )}
    </section>
  );
}
