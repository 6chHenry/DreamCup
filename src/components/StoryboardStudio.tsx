"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, ArrowDown, ArrowUp, Check, ChevronDown, ChevronUp, Clock3,
  Film, Loader2, Maximize2, Pause, Play, Plus, Save, Sparkles, Trash2, X,
} from "lucide-react";
import type { CameraMotion, Dream, DreamStoryboard, SceneTransition, StoryboardShot } from "@/types/dream";
import {
  buildVideoPrompt, CAMERA_MOTIONS, cameraMotionLabel, createDefaultStoryboard,
  TRANSITIONS,
} from "@/lib/storyboard";
import { messageFromErrorResponse } from "@/lib/llm-utils";
import RenderPipeline from "@/components/RenderPipeline";
import { useCallback } from "react";
import { getShotTimings, timelineDuration } from "@/lib/timeline";

interface StoryboardStudioProps {
  dream: Dream;
  onSaved: (dream: Dream) => void;
  onRegenerateShot: (sceneIndex: number, prompt: string) => Promise<void>;
  regeneratingScenes: Set<number>;
}

export default function StoryboardStudio({ dream, onSaved, onRegenerateShot, regeneratingScenes }: StoryboardStudioProps) {
  const [storyboard, setStoryboard] = useState<DreamStoryboard>(() => dream.storyboard ?? createDefaultStoryboard(dream));
  const [activeIndex, setActiveIndex] = useState(0);
  const [expanded, setExpanded] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(false);
  const startTimeRef = useRef(0);
  const elapsedRef = useRef(0);
  const handleRenderedOutput = useCallback((videoUrl: string) => {
    onSaved({ ...dream, videoUrl });
  }, [dream, onSaved]);

  const totalDuration = timelineDuration(storyboard);
  const shotTimings = useMemo(() => getShotTimings(storyboard), [storyboard]);
  const activeShot = storyboard.shots[Math.min(activeIndex, Math.max(0, storyboard.shots.length - 1))];
  const shotImages = new Map(dream.scenes.filter((scene) => scene.imageUrl).map((scene) => [scene.sceneIndex, scene.imageUrl]));
  const missingImages = storyboard.shots.filter((shot) => !shotImages.get(shot.sceneIndex)).length;
  const editorRef = useRef<HTMLDivElement>(null);
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const shotTabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!playing || storyboard.shots.length === 0) return;
    startTimeRef.current = performance.now() - elapsedRef.current * 1000;
    let frame = 0;
    const tick = (now: number) => {
      const nextElapsed = Math.min(totalDuration, (now - startTimeRef.current) / 1000);
      setElapsed(nextElapsed);
      const index = shotTimings.findIndex((timing) => nextElapsed < timing.end);
      setActiveIndex(index < 0 ? storyboard.shots.length - 1 : index);
      if (nextElapsed >= totalDuration) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, totalDuration, storyboard.shots.length, shotTimings]);

  const update = (next: DreamStoryboard) => {
    setStoryboard(next);
    setDirty(true);
    setSaveState("dirty");
    setPlaying(false);
  };

  const updateShot = <K extends keyof StoryboardShot>(id: string, key: K, value: StoryboardShot[K]) => {
    update({
      ...storyboard,
      shots: storyboard.shots.map((shot) => {
        if (shot.id !== id) return shot;
        const next = { ...shot, [key]: value };
        if (key === "description" || key === "cameraMotion" || key === "duration" || key === "transition") {
          next.videoPrompt = buildVideoPrompt(next, dream.sceneStyleGuide);
        }
        return next;
      }),
    });
  };

  const saveNow = useCallback(async (quiet: boolean): Promise<boolean> => {
    setSaving(true);
    setSaveState("saving");
    if (!quiet) setNotice("");
    try {
      const next = { ...storyboard, updatedAt: new Date().toISOString() };
      const response = await fetch(`/api/dreams/${dream.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyboard: next }),
      });
      if (!response.ok) throw new Error(await messageFromErrorResponse(response));
      onSaved(await response.json());
      setStoryboard(next);
      setDirty(false);
      setSaveState("saved");
      if (!quiet) setNotice("分镜已保存，之后可继续编辑。");
      return true;
    } catch (error) {
      setSaveState("error");
      setNotice(`${error instanceof Error ? error.message : "分镜保存失败"}。修改仍在当前页面，请重试。`);
      return false;
    } finally {
      setSaving(false);
    }
  }, [dream.id, onSaved, storyboard]);

  const save = useCallback((quiet = false): Promise<boolean> => {
    const request = saveQueueRef.current.then(() => dirty ? saveNow(quiet) : true, () => dirty ? saveNow(quiet) : true);
    saveQueueRef.current = request;
    return request;
  }, [dirty, saveNow]);

  useEffect(() => {
    if (!dirty || saving) return;
    const timer = window.setTimeout(() => { void saveNow(true); }, 1200);
    return () => window.clearTimeout(timer);
  }, [dirty, saveNow, saving]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const moveShot = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= storyboard.shots.length) return;
    const shots = [...storyboard.shots];
    [shots[index], shots[target]] = [shots[target], shots[index]];
    update({ ...storyboard, shots });
    setActiveIndex(target);
  };

  const addShot = () => {
    const description = dream.structured.narrative.summary || dream.rawText;
    const shot: StoryboardShot = {
      id: crypto.randomUUID(), sceneIndex: storyboard.shots.length, title: `补充镜头 ${storyboard.shots.length + 1}`,
      description, narration: "", cameraMotion: "drift", duration: 5, transition: "dissolve", imagePrompt: description,
      videoPrompt: "",
    };
    shot.videoPrompt = buildVideoPrompt(shot, dream.sceneStyleGuide);
    update({ ...storyboard, shots: [...storyboard.shots, shot].slice(0, 12) });
    setActiveIndex(storyboard.shots.length);
  };

  const removeShot = (id: string) => {
    if (storyboard.shots.length === 1) return;
    update({ ...storyboard, shots: storyboard.shots.filter((shot) => shot.id !== id) });
    setActiveIndex(0);
  };

  const seek = (value: number) => {
    elapsedRef.current = value;
    setElapsed(value);
    const index = shotTimings.findIndex((timing) => value < timing.end);
    setActiveIndex(index < 0 ? storyboard.shots.length - 1 : index);
  };

  const selectShot = (index: number) => {
    setPlaying(false);
    setActiveIndex(index);
    elapsedRef.current = shotTimings[index]?.start ?? 0;
    setElapsed(shotTimings[index]?.start ?? 0);
    shotTabRefs.current[index]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  useEffect(() => {
    if (!lightboxOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightboxOpen(false);
      if (event.key === "ArrowLeft") selectShot(Math.max(0, activeIndex - 1));
      if (event.key === "ArrowRight") selectShot(Math.min(storyboard.shots.length - 1, activeIndex + 1));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [lightboxOpen, activeIndex, storyboard.shots.length]);

  const editShot = (index: number) => {
    setActiveIndex(index);
    setPlaying(false);
    seek(shotTimings[index]?.start ?? 0);
    editorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <section className="storyboard-studio" aria-labelledby="storyboard-heading">
      <div className="storyboard-heading">
        <div>
          <p className="dream-eyebrow"><Film size={12} />02 · 分镜与放映</p>
          <h2 id="storyboard-heading" className="dream-title">先排好每一个镜头，再让梦流动。</h2>
          <p>点选镜头调整画面、旁白与节奏。改动会自动保存，模型提示词留在高级设置里。</p>
        </div>
        <button type="button" className="dream-icon-button" onClick={() => setExpanded((value) => !value)} aria-label={expanded ? "收起放映室" : "打开放映室"}>
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {expanded && (
        <>
          <div className="storyboard-status-bar">
            <span><Film size={13} />{storyboard.shots.length} 个镜头</span>
            <span><Clock3 size={13} />{totalDuration.toFixed(1)} 秒</span>
            <span className={missingImages ? "text-amber-200/60" : "text-emerald-100/55"}>
              {missingImages ? `${missingImages} 个镜头待补图` : <><Check size={13} />画面已就绪</>}
            </span>
            <span className={`storyboard-save-state is-${saveState}`} role="status">{saving ? <Loader2 size={13} className="animate-spin" /> : saveState === "error" ? <AlertCircle size={13} /> : <Check size={13} />}{saving ? "正在保存" : saveState === "dirty" ? "等待自动保存" : saveState === "error" ? "保存失败" : "所有改动已保存"}</span>
            <button type="button" onClick={() => save(false)} disabled={saving || !dirty}>{dirty ? <Save size={13} /> : null}{dirty ? "立即保存" : ""}</button>
          </div>

          <div className="storyboard-workspace">
            <div className="storyboard-shot-list" aria-label="分镜列表">
              {storyboard.shots.map((shot, index) => (
                <button ref={(element) => { shotTabRefs.current[index] = element; }} key={shot.id} type="button" aria-pressed={index === activeIndex} aria-label={`查看镜头 ${index + 1}：${shot.title}`} className={`storyboard-shot-tab ${index === activeIndex ? "is-active" : ""}`} onClick={() => selectShot(index)}>
                  <span className="storyboard-shot-number">{String(index + 1).padStart(2, "0")}</span>
                  <span className="storyboard-shot-tab-image">
                    {shotImages.get(shot.sceneIndex) ? <img src={shotImages.get(shot.sceneIndex)} alt="" /> : <Film size={16} />}
                  </span>
                  <span className="min-w-0 flex-1 text-left"><strong>{shot.title}</strong><small>{shot.duration} 秒 · {cameraMotionLabel(shot.cameraMotion)}</small></span>
                </button>
              ))}
              <button type="button" className="storyboard-add-shot" onClick={addShot} disabled={storyboard.shots.length >= 12}><Plus size={14} />补充镜头</button>
            </div>

            <div className="storyboard-stage">
              {activeShot && (
                <>
                  <div className={`storyboard-preview storyboard-preview--${storyboard.aspectRatio.replace(":", "-")}`}>
                    {shotImages.get(activeShot.sceneIndex) ? (
                      <img key={`${activeShot.id}-${playing}`} src={shotImages.get(activeShot.sceneIndex)} alt={activeShot.title} className={playing ? `is-playing motion-${activeShot.cameraMotion}` : ""} style={{ animationDuration: `${activeShot.duration}s` }} />
                    ) : (
                      <div className="storyboard-preview-empty"><Film size={28} /><p>这个镜头还没有画面</p><span>可以先编辑分镜，或回到上方生成场景图</span></div>
                    )}
                    <div className="storyboard-preview-vignette" />
                    <span className="storyboard-preview-counter">{String(activeIndex + 1).padStart(2, "0")} / {String(storyboard.shots.length).padStart(2, "0")}</span>
                    {!playing && shotImages.get(activeShot.sceneIndex) && <button type="button" className="storyboard-expand-image" onClick={() => setLightboxOpen(true)} aria-label={`放大镜头 ${activeIndex + 1} 图片`} title="放大图片"><Maximize2 size={16} /><span>查看大图</span></button>}
                    {playing && <span className="storyboard-preview-caption">{activeShot.narration}</span>}
                  </div>
                  <div className="storyboard-playback">
                    <button type="button" onClick={() => { if (elapsedRef.current >= totalDuration) seek(0); setPlaying((value) => !value); }} aria-label={playing ? "暂停预览" : "播放分镜预览"}>
                      {playing ? <Pause size={15} /> : <Play size={15} />}
                    </button>
                    <input type="range" min={0} max={totalDuration} step={0.05} value={elapsed} onChange={(event) => { setPlaying(false); seek(Number(event.target.value)); }} aria-label="预览进度" />
                    <span>{elapsed.toFixed(1)} / {totalDuration}s</span>
                  </div>

                  <div className="storyboard-editor" ref={editorRef}>
                    <div className="storyboard-editor-topline">
                      <span>镜头 {activeIndex + 1}</span>
                      <div>
                        <button type="button" disabled={activeIndex === 0} onClick={() => moveShot(activeIndex, -1)} aria-label="镜头前移"><ArrowUp size={13} /></button>
                        <button type="button" disabled={activeIndex === storyboard.shots.length - 1} onClick={() => moveShot(activeIndex, 1)} aria-label="镜头后移"><ArrowDown size={13} /></button>
                        <button type="button" disabled={storyboard.shots.length === 1} onClick={() => removeShot(activeShot.id)} aria-label="删除镜头"><Trash2 size={13} /></button>
                      </div>
                    </div>
                    <input value={activeShot.title} onChange={(event) => updateShot(activeShot.id, "title", event.target.value)} className="storyboard-title-input" aria-label="镜头标题" />
                    <label><span>画面与动作</span><textarea value={activeShot.description} onChange={(event) => updateShot(activeShot.id, "description", event.target.value)} rows={3} /></label>
                    <label><span>旁白 / 回忆线索 <small>可在下方成片设置中选择烧录字幕</small></span><textarea value={activeShot.narration} onChange={(event) => updateShot(activeShot.id, "narration", event.target.value)} rows={2} placeholder="这个镜头停留时，想听见或想起什么？" /></label>
                    <div className="storyboard-control-grid">
                      <label><span>运镜</span><select value={activeShot.cameraMotion} onChange={(event) => updateShot(activeShot.id, "cameraMotion", event.target.value as CameraMotion)}>{CAMERA_MOTIONS.map((motion) => <option key={motion.value} value={motion.value}>{motion.label}</option>)}</select></label>
                      <label><span>镜头时长</span><div className="storyboard-duration"><input type="range" min={2} max={15} step={1} value={activeShot.duration} onChange={(event) => updateShot(activeShot.id, "duration", Number(event.target.value))} /><b>{activeShot.duration}s</b></div></label>
                      <label><span>镜头结束</span><select value={activeShot.transition} onChange={(event) => updateShot(activeShot.id, "transition", event.target.value as SceneTransition)}>{TRANSITIONS.map((transition) => <option key={transition.value} value={transition.value}>{transition.label}</option>)}</select></label>
                      <label><span>画幅</span><select value={storyboard.aspectRatio} onChange={(event) => update({ ...storyboard, aspectRatio: event.target.value as DreamStoryboard["aspectRatio"] })}><option value="16:9">16:9 横屏</option><option value="9:16">9:16 竖屏</option><option value="1:1">1:1 方形</option></select></label>
                    </div>
                    <details className="storyboard-prompt-details">
                      <summary><Sparkles size={12} />生成参数与提示词</summary>
                      <label><span>生图提示词</span><textarea rows={3} value={activeShot.imagePrompt} onChange={(event) => updateShot(activeShot.id, "imagePrompt", event.target.value)} /></label>
                      <button type="button" className="btn-dream-secondary mt-2 px-3 py-2 text-xs" disabled={regeneratingScenes.has(activeShot.sceneIndex)} onClick={() => onRegenerateShot(activeShot.sceneIndex, activeShot.imagePrompt)}>{regeneratingScenes.has(activeShot.sceneIndex) ? <Loader2 size={12} className="animate-spin" /> : <Film size={12} />}重绘本镜头</button>
                      <label className="mt-3"><span>视频提示词</span><textarea rows={5} value={activeShot.videoPrompt} onChange={(event) => updateShot(activeShot.id, "videoPrompt", event.target.value)} /></label>
                    </details>
                  </div>
                </>
              )}
            </div>
          </div>

          {notice && <p className="storyboard-notice" role="status"><AlertCircle size={13} />{notice}<button onClick={() => setNotice("")} aria-label="关闭提示"><X size={12} /></button></p>}
          <RenderPipeline dream={dream} storyboard={storyboard} dirty={dirty} onSave={() => save(false)} onEditShot={editShot} onOutput={handleRenderedOutput} />
        </>
      )}
      {lightboxOpen && activeShot && shotImages.get(activeShot.sceneIndex) && (
        <div className="storyboard-lightbox" role="dialog" aria-modal="true" aria-label={`镜头 ${activeIndex + 1} 大图`} onClick={() => setLightboxOpen(false)}>
          <div className="storyboard-lightbox-toolbar" onClick={(event) => event.stopPropagation()}>
            <span>镜头 {activeIndex + 1} / {storyboard.shots.length}<strong>{activeShot.title}</strong></span>
            <button type="button" onClick={() => setLightboxOpen(false)} aria-label="关闭大图" autoFocus><X size={20} /></button>
          </div>
          <button type="button" className="storyboard-lightbox-image" onClick={() => setLightboxOpen(false)} aria-label="关闭大图"><img src={shotImages.get(activeShot.sceneIndex)} alt={activeShot.title} /></button>
          <div className="storyboard-lightbox-navigation" onClick={(event) => event.stopPropagation()}>
            <button type="button" disabled={activeIndex === 0} onClick={() => selectShot(activeIndex - 1)}>上一镜头</button>
            <span>方向键切换 · Esc 关闭</span>
            <button type="button" disabled={activeIndex === storyboard.shots.length - 1} onClick={() => selectShot(activeIndex + 1)}>下一镜头</button>
          </div>
        </div>
      )}
    </section>
  );
}
