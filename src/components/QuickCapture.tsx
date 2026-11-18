"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Calendar, Check, Feather, Loader2, Moon, Plus, Save, X } from "lucide-react";
import { createQuickCaptureDream, dateInputValue, QUICK_CAPTURE_DRAFT_KEY } from "@/lib/quick-capture";
import { messageFromErrorResponse } from "@/lib/llm-utils";

interface StoredDraft {
  title: string;
  rawText: string;
  dreamDate: string;
  tagsText: string;
  isLucidDream: boolean;
}

const emptyDraft = (): StoredDraft => ({
  title: "",
  rawText: "",
  dreamDate: dateInputValue(),
  tagsText: "",
  isLucidDream: false,
});

export default function QuickCapture() {
  const router = useRouter();
  const [draft, setDraft] = useState<StoredDraft>(emptyDraft);
  const [draftReady, setDraftReady] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const tagInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const stored = localStorage.getItem(QUICK_CAPTURE_DRAFT_KEY);
        if (stored) setDraft({ ...emptyDraft(), ...JSON.parse(stored) });
      } catch {
        localStorage.removeItem(QUICK_CAPTURE_DRAFT_KEY);
      } finally {
        setDraftReady(true);
      }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    const timer = window.setTimeout(() => {
      localStorage.setItem(QUICK_CAPTURE_DRAFT_KEY, JSON.stringify(draft));
      setSavedAt(new Date());
    }, 450);
    return () => window.clearTimeout(timer);
  }, [draft, draftReady]);

  const tags = draft.tagsText.split(/[,，、]/).map((tag) => tag.trim()).filter(Boolean);
  const wordCount = draft.rawText.trim().length;

  const update = <K extends keyof StoredDraft>(key: K, value: StoredDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setError("");
  };

  const addTag = () => {
    const value = tagInputRef.current?.value.trim();
    if (!value) return;
    if (!tags.includes(value)) update("tagsText", [...tags, value].join("，"));
    if (tagInputRef.current) tagInputRef.current.value = "";
  };

  const save = async (openAfterSave: boolean) => {
    if (!draft.rawText.trim()) return;
    setSaving(true);
    setError("");
    try {
      const dream = createQuickCaptureDream({
        ...draft,
        tags,
      });
      const response = await fetch("/api/dreams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dream),
      });
      if (!response.ok) throw new Error(await messageFromErrorResponse(response));
      localStorage.removeItem(QUICK_CAPTURE_DRAFT_KEY);
      setDraft(emptyDraft());
      if (openAfterSave) router.push(`/dream/${dream.id}`);
      else router.push("/journal");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败，草稿仍保留在本机。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="quick-capture" aria-labelledby="quick-capture-title">
      <div className="quick-capture-heading">
        <div className="quick-capture-mark"><Feather size={19} strokeWidth={1.5} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 id="quick-capture-title" className="dream-title text-xl">留下一页梦</h2>
            <span className="dream-local-badge"><span />无需 AI</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-dream-muted">先接住此刻记得的碎片，画面和整理可以留给以后。</p>
        </div>
        <button
          type="button"
          className="dream-icon-button"
          onClick={() => setExpanded((value) => !value)}
          aria-label={expanded ? "收起记录选项" : "展开记录选项"}
          aria-expanded={expanded}
        >
          {expanded ? <X size={16} /> : <Plus size={16} />}
        </button>
      </div>

      <div className="quick-capture-paper">
        <input
          value={draft.title}
          onChange={(event) => update("title", event.target.value)}
          placeholder="给这个梦一个名字（可留空）"
          aria-label="梦境标题"
          className="quick-capture-title-input"
        />
        <textarea
          value={draft.rawText}
          onChange={(event) => update("rawText", event.target.value)}
          placeholder={"醒来先写下几个碎片就好。\n一间房、一个人、一种说不清的感觉……"}
          aria-label="梦境原文"
          rows={6}
          className="quick-capture-textarea"
        />
        <div className="quick-capture-writing-meta">
          <span>{wordCount > 0 ? `${wordCount} 字` : "你的原文会一字不改地保留"}</span>
          <span className="inline-flex items-center gap-1.5">
            {savedAt && <Check size={11} />}
            {savedAt ? "草稿已自动保存" : "仅保存在这台设备"}
          </span>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="quick-capture-options">
              <label className="quick-capture-date">
                <Calendar size={14} />
                <span>梦见的日期</span>
                <input type="date" value={draft.dreamDate} onChange={(event) => update("dreamDate", event.target.value)} />
              </label>
              <label className="quick-capture-lucid">
                <input type="checkbox" checked={draft.isLucidDream} onChange={(event) => update("isLucidDream", event.target.checked)} />
                <Moon size={14} />
                <span>这是一个清醒梦</span>
              </label>
              <div className="quick-capture-tags">
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <button key={tag} type="button" onClick={() => update("tagsText", tags.filter((item) => item !== tag).join("，"))} className="dream-badge" title="点击移除标签">
                      {tag}<X size={11} />
                    </button>
                  ))}
                </div>
                <input
                  ref={tagInputRef}
                  placeholder="添加标签，回车确认"
                  aria-label="添加梦境标签"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addTag();
                    }
                  }}
                  onBlur={addTag}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && <p role="alert" className="mt-3 text-xs leading-relaxed text-rose-300">{error}</p>}
      <div className="quick-capture-actions">
        <button type="button" onClick={() => save(false)} disabled={!draft.rawText.trim() || saving} className="btn-dream-primary">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          存进梦境日志
        </button>
        <button type="button" onClick={() => save(true)} disabled={!draft.rawText.trim() || saving} className="btn-dream-secondary">
          保存后继续整理 <ArrowRight size={14} />
        </button>
      </div>
    </section>
  );
}
