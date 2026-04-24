"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Moon, ArrowLeft, Users, Calendar, Link2, ImagePlus, Trash2, Loader2, Pencil, X } from "lucide-react";
import type { Person, Dream } from "@/types/dream";
import { formatJournalDateZh } from "@/lib/dream-dates";
import { messageFromErrorResponse } from "@/lib/llm-utils";
import { getMonochromeAvatarGradient } from "@/lib/person-avatar";

/** 兼容未迁移的 API 或缓存中的旧形（仅有 relationships、无 tags） */
function personTagsFromPayload(p: { tags?: unknown; relationships?: unknown }): string[] {
  if (Array.isArray(p.tags)) {
    return p.tags.filter((x): x is string => typeof x === "string");
  }
  if (Array.isArray(p.relationships)) {
    return p.relationships.filter((x): x is string => typeof x === "string");
  }
  return [];
}

function personNotesFromPayload(p: { relationshipNotes?: unknown }): string[] {
  if (Array.isArray(p.relationshipNotes)) {
    return p.relationshipNotes.filter((x): x is string => typeof x === "string");
  }
  return [];
}

function personFromApiResponse(raw: Person): Person {
  return {
    ...raw,
    tags: personTagsFromPayload(raw),
    relationshipNotes: personNotesFromPayload(raw),
  };
}

export default function PersonDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [person, setPerson] = useState<Person | null>(null);
  const [dreams, setDreams] = useState<Dream[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refUploading, setRefUploading] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [tagsDraft, setTagsDraft] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [tagsBusy, setTagsBusy] = useState(false);
  const [tagsToast, setTagsToast] = useState<string | null>(null);
  const [notesBusy, setNotesBusy] = useState(false);

  const fetchPerson = useCallback(async (id: string) => {
    try {
      const [personRes, dreamsRes] = await Promise.all([
        fetch(`/api/persons/${id}`, { cache: "no-store" }),
        fetch(`/api/dreams`, { cache: "no-store" }),
      ]);

      if (personRes.ok) {
        const personData = personFromApiResponse((await personRes.json()) as Person);
        setPerson(personData);
        setTagsDraft([...personData.tags]);

        if (dreamsRes.ok) {
          const allDreams: Dream[] = await dreamsRes.json();
          const dreamIds = Array.isArray(personData.dreamIds) ? personData.dreamIds : [];
          const relatedDreams = allDreams.filter((d) => dreamIds.includes(d.id));
          setDreams(relatedDreams);
        }
      }
    } catch (error) {
      console.error("Fetch person error:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (params.id) {
      fetchPerson(params.id as string);
    }
  }, [params.id, fetchPerson]);

  const referenceImageUrl = person?.referenceImageFilename
    ? `/api/person-reference/${encodeURIComponent(person.referenceImageFilename)}`
    : null;

  const handleReferenceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !person) return;
    setRefUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/persons/${person.id}/reference-image`, {
        method: "POST",
        body: fd,
      });
      if (res.ok) {
        setPerson(personFromApiResponse((await res.json()) as Person));
      }
    } catch (err) {
      console.error("Reference upload error:", err);
    } finally {
      setRefUploading(false);
    }
  };

  const handleRenameConfirm = async () => {
    if (!person || !renameDraft.trim()) return;
    setRenameBusy(true);
    setTagsToast(null);
    try {
      const res = await fetch("/api/persons/reorganize-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rename: { personId: person.id, newName: renameDraft.trim() },
        }),
      });
      if (!res.ok) {
        setTagsToast(await messageFromErrorResponse(res));
        return;
      }
      const j = await res.json();
      setTagsToast(`已重命名，同步了 ${j.dreamsUpdated ?? 0} 条梦境中的称呼`);
      setRenameOpen(false);
      await fetchPerson(person.id);
    } catch (e) {
      setTagsToast(e instanceof Error ? e.message : "请求失败");
    } finally {
      setRenameBusy(false);
    }
  };

  const handleSaveTags = async () => {
    if (!person) return;
    setTagsBusy(true);
    setTagsToast(null);
    try {
      const res = await fetch(`/api/persons/${person.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: tagsDraft }),
      });
      if (!res.ok) {
        setTagsToast(await messageFromErrorResponse(res));
        return;
      }
      const updated = personFromApiResponse((await res.json()) as Person);
      setPerson(updated);
      setTagsDraft([...updated.tags]);
      setTagsToast("标签已保存");
    } catch (e) {
      setTagsToast(e instanceof Error ? e.message : "请求失败");
    } finally {
      setTagsBusy(false);
    }
  };

  const addTagFromInput = () => {
    const s = tagInput.trim();
    if (!s) return;
    const k = s.toLowerCase();
    if (tagsDraft.some((t) => t.toLowerCase() === k)) {
      setTagInput("");
      return;
    }
    setTagsDraft((prev) => [...prev, s]);
    setTagInput("");
  };

  const removeTagAt = (index: number) => {
    setTagsDraft((prev) => prev.filter((_, i) => i !== index));
  };

  const removeRelationshipNoteAt = async (index: number) => {
    if (!person) return;
    const next = person.relationshipNotes.filter((_, i) => i !== index);
    setNotesBusy(true);
    setTagsToast(null);
    try {
      const res = await fetch(`/api/persons/${person.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relationshipNotes: next }),
      });
      if (!res.ok) {
        setTagsToast(await messageFromErrorResponse(res));
        return;
      }
      const updated = personFromApiResponse((await res.json()) as Person);
      setPerson(updated);
      setTagsToast("已更新关系备注");
    } catch (e) {
      setTagsToast(e instanceof Error ? e.message : "请求失败");
    } finally {
      setNotesBusy(false);
    }
  };

  const handleReferenceDelete = async () => {
    if (!person) return;
    setRefUploading(true);
    try {
      const res = await fetch(`/api/persons/${person.id}/reference-image`, { method: "DELETE" });
      if (res.ok) {
        setPerson(personFromApiResponse((await res.json()) as Person));
      }
    } catch (err) {
      console.error("Reference delete error:", err);
    } finally {
      setRefUploading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white/25 border-t-white/60 rounded-full animate-spin" />
      </div>
    );
  }

  if (!person) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-white/40">人物未找到</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-white/[0.06] bg-[#05040c]/75 backdrop-blur-md">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={() => router.back()}
            className="w-8 h-8 shrink-0 rounded-[var(--radius-dream)] border border-white/10 bg-white/[0.05] hover:bg-white/[0.09] flex items-center justify-center transition-colors"
            aria-label="返回"
          >
            <ArrowLeft size={16} className="text-white/80" />
          </button>
          <Moon className="text-sky-100/70 shrink-0" size={20} strokeWidth={1.5} />
          <h1 className="text-base sm:text-lg font-medium text-[#f0f1fa]">人物详情</h1>
        </div>
        <button
          onClick={() => router.push("/persons")}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-white/50 hover:text-white/70 transition-colors"
        >
          <Users size={14} />
          人物库
        </button>
      </header>

      <main className="flex-1 px-6 py-8 max-w-4xl mx-auto w-full space-y-8">
        <div className="flex items-center gap-6">
          <div className="relative shrink-0">
            {referenceImageUrl ? (
              <div className="w-20 h-20 rounded-full overflow-hidden border border-white/15 ring-2 ring-white/[0.08]">
                <img
                  src={referenceImageUrl}
                  alt={`${person.name} 参考图`}
                  className="w-full h-full object-cover"
                />
              </div>
            ) : (
              <div
                className={`w-20 h-20 rounded-full bg-gradient-to-br ${getMonochromeAvatarGradient(
                  person.name
                )} flex items-center justify-center`}
              >
                <span className="text-3xl font-medium text-white">{person.name.charAt(0)}</span>
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-2xl font-light text-white/90">{person.name}</h2>
              <button
                type="button"
                onClick={() => {
                  setRenameDraft(person.name);
                  setRenameOpen(true);
                }}
                className="flex items-center gap-1 text-xs text-white/55 hover:text-white/85 px-2 py-1 rounded-lg hover:bg-white/[0.06]"
              >
                <Pencil size={12} />
                重命名
              </button>
            </div>
            <div className="flex items-center gap-4 mt-2">
              <span className="text-sm text-white/40 flex items-center gap-1.5">
                <Calendar size={12} />
                出现 {person.appearances} 次
              </span>
              <span className="text-sm text-white/40 flex items-center gap-1.5">
                <Link2 size={12} />
                {person.dreamIds.length} 个梦境
              </span>
            </div>
            <p className="text-xs text-white/20 mt-1">
              首次出现 {new Date(person.firstSeen).toLocaleDateString("zh-CN")}
              {" · "}
              最近出现 {new Date(person.lastSeen).toLocaleDateString("zh-CN")}
            </p>
          </div>
        </div>

        <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-medium text-white/70">生图参考图</h3>
              <p className="text-xs text-white/35 mt-1 max-w-xl">
                上传一张该人物的照片或画像。之后在梦境场景描述里若出现 Ta，生成场景图时会一并传给模型以保持外貌一致（需场景文案里能对应到该人物姓名或身份）。
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {referenceImageUrl && (
                <button
                  type="button"
                  onClick={handleReferenceDelete}
                  disabled={refUploading}
                  className="p-2 rounded-lg bg-white/5 text-white/50 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                  title="移除参考图"
                >
                  {refUploading ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                </button>
              )}
              <label className="flex items-center gap-1.5 px-3 py-2 rounded-[var(--radius-dream)] border border-white/12 bg-white/[0.06] text-white/80 text-xs cursor-pointer hover:bg-white/[0.09] transition-colors disabled:opacity-50">
                {refUploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                {referenceImageUrl ? "更换" : "上传"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  disabled={refUploading}
                  onChange={handleReferenceUpload}
                />
              </label>
            </div>
          </div>
          {referenceImageUrl && (
            <div className="mt-4 rounded-lg overflow-hidden border border-white/10 max-w-xs">
              <img src={referenceImageUrl} alt="参考图预览" className="w-full h-auto object-cover max-h-48" />
            </div>
          )}
        </section>

        <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <h3 className="text-sm font-medium text-white/70 mb-1">人物标签</h3>
          <p className="text-xs text-white/35 mb-3">
            短词分类（如老师、同学）。系统会从各梦「关系」长句里自动抽常见身份词；你可再增删。
          </p>
          <div className="flex flex-wrap gap-2 mb-3">
            {tagsDraft.map((rel, i) => (
              <span
                key={`${rel}-${i}`}
                className="inline-flex items-center gap-1 text-xs pl-3 pr-1 py-1.5 rounded-full bg-white/[0.06] text-white/75 border border-white/12"
              >
                {rel}
                <button
                  type="button"
                  onClick={() => removeTagAt(i)}
                  className="p-0.5 rounded-full hover:bg-white/10 text-white/40 hover:text-white/70"
                  title="移除"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTagFromInput();
                }
              }}
              placeholder="输入标签后按回车添加"
              className="flex-1 min-w-[12rem] bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-white/88 placeholder:text-white/28 focus:outline-none focus:ring-1 focus:ring-white/20"
            />
            <button
              type="button"
              onClick={addTagFromInput}
              className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs text-white/70"
            >
              添加
            </button>
            <button
              type="button"
              onClick={handleSaveTags}
              disabled={tagsBusy}
              className="btn-dream-primary px-4 py-2 text-xs font-medium disabled:opacity-40"
            >
              {tagsBusy ? "保存中…" : "保存标签"}
            </button>
          </div>
          {tagsToast && <p className="text-xs text-white/45 mt-2">{tagsToast}</p>}
        </section>

        <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <h3 className="text-sm font-medium text-white/70 mb-1">关系备注</h3>
          <p className="text-xs text-white/35 mb-3">
            从梦境解析里汇总的「关系」原文（长句），仅作备忘；不会当作标签展示。
          </p>
          {person.relationshipNotes.length === 0 ? (
            <p className="text-xs text-white/25">暂无。新解析的梦境若含关系描述，会自动出现在这里。</p>
          ) : (
            <ul className="space-y-2">
              {person.relationshipNotes.map((line, i) => (
                <li
                  key={`${i}-${line.slice(0, 24)}`}
                  className="flex gap-2 items-start rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-xs text-white/55 leading-relaxed"
                >
                  <span className="flex-1 min-w-0">{line}</span>
                  <button
                    type="button"
                    disabled={notesBusy}
                    onClick={() => removeRelationshipNoteAt(i)}
                    className="shrink-0 p-1 rounded-md hover:bg-white/10 text-white/35 hover:text-white/65 disabled:opacity-40"
                    title="移除此条备注"
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {renameOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
            <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0c0c14] p-6 shadow-xl">
              <h3 className="text-sm font-medium text-white/90 mb-3">重命名人物</h3>
              <p className="text-xs text-white/35 mb-3">会同步更新各条梦境结构化数据中的称呼。</p>
              <input
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                className="w-full mb-4 bg-white/[0.06] border border-white/12 rounded-lg px-3 py-2 text-sm text-white/85"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRenameOpen(false)}
                  className="px-3 py-2 rounded-lg text-xs text-white/50 hover:bg-white/10"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleRenameConfirm}
                  disabled={renameBusy || !renameDraft.trim()}
                  className="btn-dream-primary px-4 py-2 text-xs font-medium disabled:opacity-40"
                >
                  {renameBusy ? "保存中…" : "保存"}
                </button>
              </div>
            </div>
          </div>
        )}

        <section>
          <h3 className="text-sm font-medium text-white/50 mb-4">相关梦境</h3>
          {dreams.length === 0 ? (
            <p className="text-sm text-white/30">暂无关联梦境</p>
          ) : (
            <div className="space-y-3">
              {dreams.map((dream) => (
                <button
                  key={dream.id}
                  onClick={() => router.push(`/dream/${dream.id}`)}
                  className="w-full rounded-xl bg-white/[0.03] border border-white/10 p-4 text-left hover:bg-white/[0.06] hover:border-white/20 transition-all group"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h4 className="text-sm font-medium text-white/70 group-hover:text-white transition-colors">
                        {dream.title}
                      </h4>
                      <p className="text-xs text-white/30 mt-1 line-clamp-2">
                        {dream.structured.narrative.summary || dream.rawText.slice(0, 100)}
                      </p>
                      {dream.structured.characters.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {dream.structured.characters
                            .filter((c) => (c.name || c.identity) !== person.name)
                            .slice(0, 3)
                            .map((c, i) => (
                              <span
                                key={i}
                                className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/30"
                              >
                                {c.name || c.identity}
                              </span>
                            ))}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="text-[10px] text-white/20">
                        {formatJournalDateZh(dream)}
                      </span>
                      {dream.scenes.filter((s) => s.imageUrl).length > 0 && (
                        <div className="mt-1 w-16 h-10 rounded overflow-hidden">
                          <img
                            src={dream.scenes.find((s) => s.imageUrl)?.imageUrl}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
