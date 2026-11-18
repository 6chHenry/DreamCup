"use client";

import { useMemo, useState, type ChangeEvent, type RefObject } from "react";
import Link from "next/link";
import {
  BookOpen, Check, ChevronDown, Download, Info, Loader2, Moon, Plus,
  Search, Trash2, Upload, Users, X,
} from "lucide-react";
import JournalTimeline from "@/components/JournalTimeline";
import type { Dream } from "@/types/dream";

type JournalFilter = "all" | "lucid" | "visual" | "text";

interface JournalWorkspaceProps {
  dreams: Dream[];
  isLoading: boolean;
  selectionMode: boolean;
  selected: Set<string>;
  deleteBusy: boolean;
  importZipBusy: boolean;
  importZipInputRef: RefObject<HTMLInputElement | null>;
  onDreamClick: (dream: Dream) => void;
  onToggleSelect: (dream: Dream) => void;
  onDeleteSelected: () => void;
  onToggleSelectionMode: () => void;
  onImportZipPick: () => void;
  onImportZipChange: (event: ChangeEvent<HTMLInputElement>) => void;
}

function searchText(dream: Dream): string {
  return [
    dream.title, dream.rawText, dream.userNotes, ...(dream.tags ?? []),
    dream.structured.narrative.summary,
    ...dream.structured.scenes.map((scene) => scene.description),
    ...dream.structured.characters.flatMap((character) => [character.name, character.identity]),
    ...dream.structured.emotions.map((emotion) => emotion.type),
  ].filter(Boolean).join(" ").toLocaleLowerCase("zh-CN");
}

export default function JournalWorkspace(props: JournalWorkspaceProps) {
  const { dreams, isLoading, selectionMode, selected, deleteBusy, importZipBusy, importZipInputRef } = props;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<JournalFilter>("all");
  const [notice, setNotice] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);

  const filteredDreams = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    return dreams.filter((dream) => {
      if (normalized && !searchText(dream).includes(normalized)) return false;
      if (filter === "lucid") return Boolean(dream.structured.meta.isLucidDream);
      if (filter === "visual") return dream.scenes.some((scene) => scene.imageUrl) || Boolean(dream.videoUrl);
      if (filter === "text") return dream.scenes.length === 0 && !dream.videoUrl;
      return true;
    });
  }, [dreams, filter, query]);

  const exportBackup = async () => {
    setBackupBusy(true);
    try {
      const response = await fetch("/api/backup", { cache: "no-store" });
      if (!response.ok) throw new Error("备份生成失败");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `dreamcup-backup-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice("备份已导出；音视频文件需另行保存。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "备份生成失败");
    } finally {
      setBackupBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="dream-site-header">
        <Link href="/" className="dream-brand-link">
          <Moon className="dream-moon-icon shrink-0" size={22} strokeWidth={1.5} />
          <span><span className="dream-title block text-base sm:text-lg">梦境日志</span><span className="hidden sm:block text-[10px] text-dream-muted">把散落的夜，慢慢收成一本书</span></span>
        </Link>
        <nav className="dream-header-nav" aria-label="主导航">
          <Link href="/persons"><Users size={15} /><span className="hidden sm:inline">人物库</span></Link>
          <Link href="/about"><Info size={15} /><span className="hidden sm:inline">关于</span></Link>
          <Link href="/" className="btn-dream-primary px-3.5 py-2 text-xs"><Plus size={15} />记录梦境</Link>
        </nav>
      </header>

      <main className="journal-main">
        <section className="journal-intro">
          <div>
            <p className="dream-eyebrow"><BookOpen size={12} />YOUR PRIVATE ATLAS</p>
            <h1 className="dream-title">每一次醒来，都留下一点线索。</h1>
            <p>搜索原文、标题、人物、场景与标签，找到曾经相似的梦。</p>
          </div>
          <div className="journal-count"><strong>{dreams.length}</strong><span>页梦</span></div>
        </section>

        <section className="journal-toolbar" aria-label="日志工具">
          <label className="journal-search">
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索梦里的碎片…" aria-label="搜索梦境" />
            {query && <button type="button" onClick={() => setQuery("")} aria-label="清空搜索"><X size={14} /></button>}
          </label>
          <div className="journal-filter-wrap">
            <select value={filter} onChange={(event) => setFilter(event.target.value as JournalFilter)} aria-label="筛选梦境">
              <option value="all">全部梦境</option>
              <option value="lucid">清醒梦</option>
              <option value="visual">有画面</option>
              <option value="text">纯文字</option>
            </select>
            <ChevronDown size={13} />
          </div>
        </section>

        <div className="journal-subtoolbar">
          <p>{query || filter !== "all" ? `找到 ${filteredDreams.length} 条相关记录` : "按梦见的日期排列"}</p>
          <div className="journal-utility-actions">
            <button type="button" disabled={backupBusy} onClick={exportBackup}>{backupBusy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}备份 JSON</button>
            <button type="button" disabled={importZipBusy} onClick={props.onImportZipPick}>
              {importZipBusy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}导入 ZIP
            </button>
            <input ref={importZipInputRef} type="file" accept=".zip,application/zip,application/x-zip-compressed" className="hidden" onChange={props.onImportZipChange} />
            {dreams.length > 0 && <button type="button" onClick={props.onToggleSelectionMode}>{selectionMode ? <Check size={13} /> : null}{selectionMode ? "完成" : "管理"}</button>}
          </div>
        </div>

        {notice && <p className="journal-notice" role="status">{notice}<button onClick={() => setNotice("")} aria-label="关闭提示"><X size={13} /></button></p>}
        {selectionMode && (
          <div className="journal-selection-bar">
            <span>已选择 {selected.size} 条</span>
            <button type="button" disabled={!selected.size || deleteBusy} onClick={props.onDeleteSelected}>
              {deleteBusy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}从日志隐藏
            </button>
          </div>
        )}

        <div className="mt-8">
          {isLoading ? (
            <div className="flex justify-center py-24"><Loader2 size={28} className="animate-spin text-white/30" /></div>
          ) : filteredDreams.length > 0 ? (
            <JournalTimeline dreams={filteredDreams} onDreamClick={props.onDreamClick} selectionMode={selectionMode} selectedIds={selected} onToggleSelect={props.onToggleSelect} />
          ) : (
            <div className="journal-empty">
              <Moon size={28} strokeWidth={1} />
              <h2 className="dream-title">{dreams.length ? "这一页还没有相符的梦" : "第一页，留给下一个清晨"}</h2>
              <p>{dreams.length ? "换个关键词，或者清除筛选再看看。" : "不需要组织好语言，写下还记得的一点就够了。"}</p>
              {dreams.length ? <button className="btn-dream-secondary" onClick={() => { setQuery(""); setFilter("all"); }}>清除筛选</button> : <Link href="/" className="btn-dream-primary"><Plus size={15} />记录第一个梦</Link>}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
