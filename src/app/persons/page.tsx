"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Moon, Users, BookOpen, Info, Sparkles, Trash2, GitMerge, Loader2, X, Plus } from "lucide-react";
import type { Person } from "@/types/dream";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { messageFromErrorResponse } from "@/lib/llm-utils";
import { buildClientLlmHeadersForFetch } from "@/lib/client-llm-headers";
import { getMonochromeAvatarGradient } from "@/lib/person-avatar";

export default function PersonsPage() {
  const router = useRouter();
  const [persons, setPersons] = useState<Person[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [aiBusy, setAiBusy] = useState(false);
  const [manualBusy, setManualBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeCanonical, setMergeCanonical] = useState("");
  const [mergeKeepId, setMergeKeepId] = useState<string>("");

  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addTagsLine, setAddTagsLine] = useState("");

  const fetchPersons = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch("/api/persons", { cache: "no-store" });
      if (response.ok) {
        const data = await response.json();
        setPersons(data);
      }
    } catch (error) {
      console.error("Fetch persons error:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPersons();
  }, [fetchPersons]);

  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) fetchPersons();
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, [fetchPersons]);

  const selectedList = useMemo(
    () => persons.filter((p) => selected.has(p.id)),
    [persons, selected]
  );

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelected(new Set());
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const handlePersonOpen = (person: Person) => {
    router.push(`/person/${person.id}`);
  };

  const handleAiOrganize = async () => {
    setAiBusy(true);
    setToast(null);
    try {
      const extra = buildClientLlmHeadersForFetch();
      const res = await fetch("/api/persons/organize-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...extra },
      });
      const data = await res.json();
      if (!res.ok) {
        setToast(data.detail ? `${data.error}: ${data.detail}` : data.error || "整理失败");
        return;
      }
      setToast(data.summary || "整理完成");
      exitSelectionMode();
      await fetchPersons();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "请求失败");
    } finally {
      setAiBusy(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (selected.size === 0) return;
    if (!confirm(`确定删除选中的 ${selected.size} 个人物？相关梦境条目里的同名角色也会被移除。`)) return;
    setManualBusy(true);
    setToast(null);
    try {
      const res = await fetch("/api/persons/reorganize-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleteIds: [...selected] }),
      });
      if (!res.ok) {
        setToast(await messageFromErrorResponse(res));
        return;
      }
      const j = await res.json();
      setToast(`已删除，更新了 ${j.dreamsUpdated ?? 0} 条梦境中的角色信息`);
      exitSelectionMode();
      await fetchPersons();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "请求失败");
    } finally {
      setManualBusy(false);
    }
  };

  const openMergeModal = () => {
    if (selected.size < 2) return;
    const list = persons.filter((p) => selected.has(p.id));
    const keep = [...list].sort((a, b) => b.appearances - a.appearances)[0];
    setMergeKeepId(keep.id);
    setMergeCanonical(keep.name);
    setMergeOpen(true);
  };

  const handleMergeConfirm = async () => {
    if (!mergeCanonical.trim() || !mergeKeepId) return;
    const absorbIds = [...selected].filter((id) => id !== mergeKeepId);
    if (absorbIds.length === 0) {
      setToast("请选择至少两人合并");
      return;
    }
    setManualBusy(true);
    setToast(null);
    try {
      const res = await fetch("/api/persons/reorganize-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merge: { keepId: mergeKeepId, absorbIds, canonicalName: mergeCanonical.trim() },
        }),
      });
      if (!res.ok) {
        setToast(await messageFromErrorResponse(res));
        return;
      }
      const j = await res.json();
      setToast(`已合并，更新了 ${j.dreamsUpdated ?? 0} 条梦境`);
      setMergeOpen(false);
      exitSelectionMode();
      await fetchPersons();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "请求失败");
    } finally {
      setManualBusy(false);
    }
  };

  const parseTagsLine = (line: string): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const part of line.split(/[,，;；、]/)) {
      const s = part.trim();
      if (!s) continue;
      const k = s.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
    return out;
  };

  const handleAddPerson = async () => {
    const n = addName.trim();
    if (!n) return;
    const tags = parseTagsLine(addTagsLine);
    setManualBusy(true);
    setToast(null);
    try {
      const res = await fetch("/api/persons/reorganize-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ add: { name: n, tags } }),
      });
      if (!res.ok) {
        setToast(await messageFromErrorResponse(res));
        return;
      }
      setAddName("");
      setAddTagsLine("");
      setAddOpen(false);
      setToast(tags.length ? `已添加「${n}」（${tags.join("、")}）` : `已添加「${n}」`);
      await fetchPersons();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "请求失败");
    } finally {
      setManualBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 sm:px-6 py-4 border-b border-white/[0.06] bg-[#05040c]/75 backdrop-blur-md">
        <div className="flex items-center gap-2.5 min-w-0">
          <Moon className="shrink-0 text-sky-100/70" size={22} strokeWidth={1.5} />
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-medium text-[#f0f1fa]">人物库</h1>
            <span className="text-[10px] sm:text-xs text-white/32">{persons.length} 人</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleAiOrganize}
            disabled={aiBusy || persons.length === 0}
            className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-dream)] border border-white/12 bg-white/[0.05] hover:bg-white/[0.08] text-sm text-white/75 transition-colors disabled:opacity-40"
          >
            {aiBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            AI 一键整理
          </button>
          {selectionMode && (
            <>
              <button
                type="button"
                onClick={handleDeleteSelected}
                disabled={manualBusy || selected.size === 0}
                className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-dream)] border border-white/12 bg-white/[0.05] hover:bg-white/[0.08] text-sm text-white/70 transition-colors disabled:opacity-40"
              >
                <Trash2 size={14} />
                删除选中
              </button>
              <button
                type="button"
                onClick={openMergeModal}
                disabled={manualBusy || selected.size < 2}
                className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-dream)] border border-white/12 bg-white/[0.06] hover:bg-white/[0.09] text-sm text-white/80 transition-colors disabled:opacity-40"
              >
                <GitMerge size={14} />
                合并选中
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => {
              if (selectionMode) exitSelectionMode();
              else setSelectionMode(true);
            }}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-colors ${
              selectionMode
                ? "bg-white/15 text-white/90 border-white/20 hover:bg-white/20"
                : "bg-white/5 text-white/60 border-white/10 hover:bg-white/10 hover:text-white/80"
            }`}
          >
            {selectionMode ? "完成" : "选择"}
          </button>
          <button
            type="button"
            onClick={() => {
              setAddOpen(true);
              setAddName("");
              setAddTagsLine("");
            }}
            title="手动添加人物"
            className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/10 hover:bg-white/15 text-white/80 border border-white/10 transition-colors"
          >
            <Plus size={18} />
          </button>
          <Link
            href="/about"
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-white/50 hover:text-white/70 transition-colors"
          >
            <Info size={14} />
            关于
          </Link>
          <Link
            href="/journal"
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-white/50 hover:text-white/70 transition-colors"
          >
            <BookOpen size={14} />
            梦境日志
          </Link>
          <Link href="/" className="btn-dream-primary px-4 py-2.5 text-sm no-underline gap-2">
            <Plus size={16} />
            记录梦境
          </Link>
        </div>
      </header>

      {toast && (
        <div className="mx-6 mt-4 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/70">
          {toast}
        </div>
      )}

      {selectionMode && (
        <p className="mx-6 mt-3 text-[10px] text-white/25">
          已开启多选：勾选卡片左上角；合并时默认保留「出现次数最多」的一条为底稿，也可在弹窗里改。
        </p>
      )}

      <main className="flex-1 px-6 py-8 max-w-4xl mx-auto w-full">
        {isLoading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-2 border-white/25 border-t-white/60 rounded-full animate-spin" />
          </div>
        ) : persons.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Users size={48} className="text-white/10" />
            <p className="text-white/30 text-sm">还没有记录到梦境中的人物</p>
            <p className="text-white/20 text-xs">记录梦境时，系统会自动提取其中出现的人物</p>
            <Link href="/" className="btn-dream-primary mt-4 text-sm no-underline">
              记录第一个梦境
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {persons.map((person) => (
              <div
                key={person.id}
                className={`group relative rounded-[var(--radius-dream)] border p-5 text-left transition-colors ${
                  selectionMode && selected.has(person.id)
                    ? "bg-white/[0.08] border-white/22 ring-1 ring-white/10"
                    : "bg-white/[0.03] border-white/10 hover:bg-white/[0.06] hover:border-white/18"
                }`}
              >
                {selectionMode && (
                  <label className="absolute top-4 left-4 z-10 flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected.has(person.id)}
                      onChange={() => toggleSelect(person.id)}
                      className="rounded border-white/25 bg-white/10 text-white accent-white"
                    />
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => handlePersonOpen(person)}
                  className={`w-full text-left ${selectionMode ? "pl-8" : ""}`}
                >
                  <div className="flex items-center gap-4">
                    <div className="relative w-12 h-12 shrink-0 rounded-full overflow-hidden border border-white/10">
                      {person.referenceImageFilename ? (
                        <img
                          src={`/api/person-reference/${encodeURIComponent(person.referenceImageFilename)}`}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div
                          className={`w-full h-full bg-gradient-to-br ${getMonochromeAvatarGradient(
                            person.name
                          )} flex items-center justify-center`}
                        >
                          <span className="text-lg font-medium text-white">{person.name.charAt(0)}</span>
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-medium text-white/80 truncate group-hover:text-white transition-colors">
                        {person.name}
                      </h3>
                      <p className="text-xs text-white/30 mt-0.5">出现 {person.appearances} 次</p>
                    </div>
                  </div>

                  {person.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {person.tags.slice(0, 4).map((tag, i) => (
                        <span
                          key={i}
                          className="text-[10px] px-2 py-0.5 rounded-full border border-white/[0.08] bg-white/[0.06] text-white/60"
                        >
                          {tag}
                        </span>
                      ))}
                      {person.tags.length > 4 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-white/20">
                          +{person.tags.length - 4}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/5">
                    <span className="text-[10px] text-white/20">{person.dreamIds.length} 个梦境</span>
                    <span className="text-[10px] text-white/20">
                      最近 {new Date(person.lastSeen).toLocaleDateString("zh-CN")}
                    </span>
                  </div>
                </button>
              </div>
            ))}
          </div>
        )}
      </main>

      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0c0c14] p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-white/90">添加人物</h3>
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="p-1 rounded-lg hover:bg-white/10 text-white/40"
              >
                <X size={18} />
              </button>
            </div>
            <label className="block text-[10px] text-white/35 mb-1">姓名</label>
            <input
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder="人物姓名"
              className="w-full mb-3 bg-white/[0.06] border border-white/12 rounded-lg px-3 py-2 text-sm text-white/85 placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-white/20"
            />
            <label className="block text-[10px] text-white/35 mb-1">人物标签（可选，逗号或顿号分隔）</label>
            <input
              value={addTagsLine}
              onChange={(e) => setAddTagsLine(e.target.value)}
              placeholder="例如：朋友、同事"
              className="w-full mb-4 bg-white/[0.06] border border-white/12 rounded-lg px-3 py-2 text-sm text-white/85 placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-white/20"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="px-3 py-2 rounded-lg text-xs text-white/50 hover:bg-white/10"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleAddPerson}
                disabled={manualBusy || !addName.trim()}
                className="btn-dream-primary px-4 py-2 text-xs font-medium disabled:opacity-40"
              >
                {manualBusy ? "添加中…" : "添加"}
              </button>
            </div>
          </div>
        </div>
      )}

      {mergeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0c0c14] p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-white/90">合并人物</h3>
              <button
                type="button"
                onClick={() => setMergeOpen(false)}
                className="p-1 rounded-lg hover:bg-white/10 text-white/40"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-xs text-white/40 mb-3">
              已选 {selected.size} 人。保留条目将继承合并后的梦境列表与参考图（若仅一方有图则保留该图）。
            </p>
            <label className="block text-[10px] text-white/35 mb-1">保留哪一条（底稿）</label>
            <select
              value={mergeKeepId}
              onChange={(e) => setMergeKeepId(e.target.value)}
              className="w-full mb-4 bg-white/[0.06] border border-white/12 rounded-lg px-3 py-2 text-sm text-white/85"
            >
              {selectedList.map((p) => (
                <option key={p.id} value={p.id} className="bg-[#12121a]">
                  {p.name}（{p.appearances} 次）
                </option>
              ))}
            </select>
            <label className="block text-[10px] text-white/35 mb-1">合并后的统一姓名</label>
            <input
              value={mergeCanonical}
              onChange={(e) => setMergeCanonical(e.target.value)}
              className="w-full mb-4 bg-white/[0.06] border border-white/12 rounded-lg px-3 py-2 text-sm text-white/85"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMergeOpen(false)}
                className="px-3 py-2 rounded-lg text-xs text-white/50 hover:bg-white/10"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleMergeConfirm}
                disabled={manualBusy || !mergeCanonical.trim()}
                className="btn-dream-primary px-4 py-2 text-xs font-medium disabled:opacity-40"
              >
                {manualBusy ? "处理中…" : "确认合并"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
