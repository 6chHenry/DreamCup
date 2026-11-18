"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, ChevronDown, ChevronRight, CircleDashed, Clapperboard, Download, Film, History, Loader2, Mic2, Music2, Pause, Play, Plus, RefreshCw, RotateCcw, Settings2, Sparkles, Subtitles, Upload, X } from "lucide-react";
import type { Dream, DreamStoryboard, NarrationProvider, VideoGenerationQuality, VideoRenderJob, VideoRenderProvider } from "@/types/dream";
import { timelineDuration } from "@/lib/timeline";
import { getProductionReview, storyboardSignature } from "@/lib/production-review";

const stageLabels = { shots: "准备镜头素材", narration: "生成旁白", assembly: "合成与混音", complete: "已完成" };
const statusLabels = { queued: "等待", running: "处理中", waiting_api: "等待模型", ready: "完成", failed: "需处理", cancelled: "已暂停" };
interface ProviderOption { id: string; configured: boolean; supported?: boolean; label: string; description?: string }
type RenderSettings = { provider: VideoRenderProvider; narrationProvider: NarrationProvider; narrationVolume: number; musicVolume: number; showSubtitles: boolean; backgroundAudioUrl: string; audioName: string; generationQuality: VideoGenerationQuality };

function readSettings(dreamId: string): RenderSettings {
  const defaults: RenderSettings = { provider: "comfyui_h3", narrationProvider: "silent", narrationVolume: 1, musicVolume: 0.18, showSubtitles: true, backgroundAudioUrl: "", audioName: "", generationQuality: "quality" };
  if (typeof window === "undefined") return defaults;
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(`dreamcup-render-settings-${dreamId}`) || "{}") }; } catch { return defaults; }
}

export default function RenderPipeline({ dream, storyboard, dirty, onSave, onEditShot, onOutput }: { dream: Dream; storyboard: DreamStoryboard; dirty: boolean; onSave: () => Promise<boolean>; onEditShot: (index: number) => void; onOutput: (url: string) => void }) {
  const [job, setJob] = useState<VideoRenderJob | null>(null);
  const [history, setHistory] = useState<VideoRenderJob[]>([]);
  const [settings, setSettings] = useState<RenderSettings>(() => readSettings(dream.id));
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showTasks, setShowTasks] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [notice, setNotice] = useState("");
  const [providers, setProviders] = useState<{ video: ProviderOption[]; narration: ProviderOption[] }>({ video: [], narration: [] });
  const [uploadBusy, setUploadBusy] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const { provider, narrationProvider, narrationVolume, musicVolume, showSubtitles, backgroundAudioUrl, audioName, generationQuality } = settings;
  const currentSignature = storyboardSignature(storyboard);
  const review = getProductionReview(storyboard, dream);
  const hasBlockingIssue = review.some((item) => item.id.startsWith("image-") || item.id === "empty");
  const isStale = Boolean(job && storyboardSignature(job.storyboard) !== currentSignature);
  const videoOption = providers.video.find((item) => item.id === provider);
  const narrationOption = providers.narration.find((item) => item.id === narrationProvider);

  useEffect(() => {
    fetch("/api/render-providers", { cache: "no-store" }).then((response) => response.json()).then(setProviders).catch(() => {});
  }, []);

  useEffect(() => {
    localStorage.setItem(`dreamcup-render-settings-${dream.id}`, JSON.stringify(settings));
  }, [dream.id, settings]);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(`/api/render-jobs?dreamId=${dream.id}`, { cache: "no-store" }).then((response) => response.json()),
      fetch(`/api/render-jobs?dreamId=${dream.id}&history=1`, { cache: "no-store" }).then((response) => response.json()),
    ]).then(([latest, jobs]) => { if (active) { setJob(latest); setHistory(jobs); } }).catch(() => {});
    return () => { active = false; };
  }, [dream.id]);

  useEffect(() => {
    if (!job || !["queued", "running", "waiting_api"].includes(job.status)) return;
    const timer = window.setTimeout(async () => {
      const response = await fetch(`/api/render-jobs/${job.id}`, { cache: "no-store" });
      if (!response.ok) return;
      const next = await response.json() as VideoRenderJob;
      setJob(next);
      if (next.status === "ready" && next.outputUrl) onOutput(next.outputUrl);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [job, onOutput]);

  const updateSettings = <K extends keyof RenderSettings>(key: K, value: RenderSettings[K]) => setSettings((current) => ({ ...current, [key]: value }));

  const start = async () => {
    if (hasBlockingIssue) { setReviewing(true); return; }
    setBusy(true); setNotice("");
    try {
      if (dirty && !(await onSave())) throw new Error("分镜尚未保存，请处理保存错误后再合成。");
      const response = await fetch("/api/render-jobs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dreamId: dream.id, storyboard, provider, narrationProvider, backgroundAudioUrl: backgroundAudioUrl || undefined, narrationVolume, musicVolume, showSubtitles, generationQuality }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setJob(result); setReviewing(false); setShowSettings(false);
      const historyResponse = await fetch(`/api/render-jobs?dreamId=${dream.id}&history=1`, { cache: "no-store" });
      if (historyResponse.ok) setHistory(await historyResponse.json());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "创建任务失败");
    } finally { setBusy(false); }
  };

  const retry = async (shotId?: string) => {
    if (!job) return;
    setBusy(true); setNotice("");
    try {
      const action = shotId || job.status === "ready" ? "retry" : job.status === "cancelled" ? "run" : "retry";
      const response = await fetch(`/api/render-jobs/${job.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, shotIds: shotId ? [shotId] : undefined }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setJob(result);
    } catch (error) { setNotice(error instanceof Error ? error.message : "任务操作失败"); }
    finally { setBusy(false); }
  };

  const cancel = async () => {
    if (!job) return;
    setBusy(true);
    const response = await fetch(`/api/render-jobs/${job.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel" }) });
    if (response.ok) setJob(await response.json());
    setBusy(false);
  };

  const uploadAudio = async (file: File) => {
    setUploadBusy(true); setNotice("");
    try {
      const formData = new FormData(); formData.append("audio", file);
      const response = await fetch("/api/render-jobs/audio", { method: "POST", body: formData });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "音乐上传失败");
      setSettings((current) => ({ ...current, backgroundAudioUrl: result.url, audioName: file.name }));
    } catch (error) { setNotice(error instanceof Error ? error.message : "音乐上传失败"); }
    finally { setUploadBusy(false); }
  };

  const readyCount = job?.shots.filter((shot) => shot.status === "ready").length ?? 0;
  const progress = job ? job.status === "ready" ? 100 : job.stage === "assembly" ? 90 : job.stage === "narration" ? 82 : Math.round((readyCount / Math.max(1, job.shots.length)) * 75) : 0;
  const activeTask = job?.shots.find((task) => ["running", "waiting_api", "failed"].includes(task.status));

  return (
    <section className="render-pipeline" aria-label="视频合成任务">
      <div className="render-pipeline-title">
        <div><Clapperboard size={17} /><span><strong>03 · 合成与导出</strong><small>确认这一版，再把梦带走</small></span></div>
        <div className="render-title-actions"><button type="button" onClick={() => { setShowHistory((value) => !value); setShowSettings(false); }} aria-label="合成历史" aria-expanded={showHistory}><History size={15} /></button><button type="button" onClick={() => { setShowSettings((value) => !value); setShowHistory(false); }} aria-label="合成设置" aria-expanded={showSettings}><Settings2 size={15} /></button></div>
      </div>

      {showSettings && (
        <div className="render-provider-settings">
          <div className="render-settings-heading"><Sparkles size={13} /><span>画面与声音</span><small>设置会保存在本机，下次继续使用</small></div>
          <label><span><Film size={13} />画面来源</span><select value={provider} onChange={(event) => updateSettings("provider", event.target.value as VideoRenderProvider)}>
            {providers.video.length ? providers.video.filter((option) => option.supported !== false).map((option) => <option key={option.id} value={option.id}>{option.label}</option>) : <option value="storyboard_preview">本地分镜样片 · 无需 API</option>}
          </select></label>
          <label><span><Mic2 size={13} />旁白配音</span><select value={narrationProvider} onChange={(event) => updateSettings("narrationProvider", event.target.value as NarrationProvider)}>
            {providers.narration.length ? providers.narration.map((option) => <option key={option.id} value={option.id}>{option.label}</option>) : <option value="silent">字幕 / 无声</option>}
          </select></label>
          {provider === "comfyui_h3" && <label><span><Clapperboard size={13} />H3 生成档位</span><select value={generationQuality} onChange={(event) => updateSettings("generationQuality", event.target.value as VideoGenerationQuality)}>
            <option value="quality">精细 · 25 步（默认）</option><option value="draft">草稿 · 12 步（先试构图与运动）</option>
          </select></label>}
          <div className="render-provider-note"><CircleDashed size={13} /><span>{videoOption?.description || "正在检查供应商配置…"}<small>{provider !== "storyboard_preview" && videoOption && !videoOption.configured ? "本地 H3 需要连接 A100 上的 ComfyUI；外部模型未配置时会回退为分镜画面。" : "配置与密钥只保留在服务端。"}</small></span></div>
          <div className="render-provider-note"><Mic2 size={13} /><span>{narrationOption?.description || "正在检查配音配置…"}</span></div>
          <div className="render-audio-setting">
            <label className="render-audio-upload"><Music2 size={13} /><span>{uploadBusy ? "正在上传…" : audioName || "上传氛围音乐（可选）"}</span>{uploadBusy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}<input type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a" disabled={uploadBusy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadAudio(file); event.target.value = ""; }} /></label>
            {!backgroundAudioUrl && <button type="button" disabled={uploadBusy} onClick={async () => { setUploadBusy(true); setNotice(""); try { const response = await fetch("/api/render-jobs/ambience", { method: "POST" }); const result = await response.json(); if (!response.ok) throw new Error(result.error); setSettings((current) => ({ ...current, backgroundAudioUrl: result.url, audioName: result.name })); } catch (error) { setNotice(error instanceof Error ? error.message : "氛围音生成失败"); } finally { setUploadBusy(false); } }}><Sparkles size={12} />生成氛围音</button>}
            {backgroundAudioUrl && <><audio ref={audioRef} src={backgroundAudioUrl} onPlay={() => setAudioPlaying(true)} onPause={() => setAudioPlaying(false)} onEnded={() => setAudioPlaying(false)} /><button type="button" onClick={() => { if (audioRef.current?.paused) void audioRef.current.play(); else audioRef.current?.pause(); }}>{audioPlaying ? <Pause size={12} /> : <Play size={12} />}{audioPlaying ? "暂停" : "试听"}</button><button type="button" aria-label="移除氛围音乐" onClick={() => { audioRef.current?.pause(); setAudioPlaying(false); setSettings((current) => ({ ...current, backgroundAudioUrl: "", audioName: "" })); }}><X size={12} /></button></>}
          </div>
          <label className="render-subtitle-toggle"><input type="checkbox" checked={showSubtitles} onChange={(event) => updateSettings("showSubtitles", event.target.checked)} /><Subtitles size={14} /><span>烧录旁白字幕，同时导出 SRT / VTT</span></label>
          <label className="render-volume"><span>旁白音量 <b>{Math.round(narrationVolume * 100)}%</b></span><input type="range" min={0} max={2} step={0.05} value={narrationVolume} onChange={(event) => updateSettings("narrationVolume", Number(event.target.value))} /></label>
          <label className="render-volume"><span>音乐音量 <b>{Math.round(musicVolume * 100)}%</b></span><input type="range" min={0} max={1} step={0.01} value={musicVolume} onChange={(event) => updateSettings("musicVolume", Number(event.target.value))} /></label>
          <p>默认用本地 H3 逐镜头生成。想先检查节奏时，可切换为分镜样片。</p>
        </div>
      )}

      {showHistory && <div className="render-history">{history.length === 0 ? <p>还没有历史版本</p> : history.map((item) => <button key={item.id} type="button" className={item.id === job?.id ? "is-active" : ""} onClick={() => { setJob(item); setShowHistory(false); }}><span>{new Date(item.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span><strong>{item.mode === "preview" ? "离线样片" : "模型成片"} · {statusLabels[item.status]}</strong><ChevronDown size={12} /></button>)}</div>}

      {!job ? (
        <div className="render-start-panel">
          <div className="render-start-summary"><span className="render-mode-badge">{provider === "storyboard_preview" ? "离线样片" : provider === "comfyui_h3" && generationQuality === "draft" ? "H3 快速草稿" : "模型成片"} · {narrationProvider === "silent" ? "字幕 / 无声" : "含旁白"}</span><p>{storyboard.shots.length} 个镜头 · {timelineDuration(storyboard).toFixed(1)} 秒 · {storyboard.aspectRatio}。{provider === "storyboard_preview" ? "先用现有画面确认完整节奏。" : provider === "comfyui_h3" && generationQuality === "draft" ? "12 步快速验证运动与衔接，满意后换精细档。" : "逐镜头生成后，再合成转场与声音。"}</p></div>
          <div className="render-start-actions"><button type="button" className="render-review-trigger" onClick={() => setReviewing((value) => !value)} aria-expanded={reviewing}>{review.some((item) => item.tone === "warning") ? `${review.filter((item) => item.tone === "warning").length} 条生成前建议` : "生成前检查"}<ChevronRight size={13} /></button><button type="button" className="dream-accent-btn" onClick={start} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}{dirty ? "保存并开始合成" : "开始合成"}</button></div>
        </div>
      ) : (
        <div className="render-job-panel">
          <div className="render-job-summary"><span>{job.mode === "preview" ? "离线样片" : "模型成片"} · {stageLabels[job.stage]}</span><strong>{statusLabels[job.status]}</strong></div>
          <div className="render-job-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div>
          {job.status !== "ready" && <div className="render-current-task"><span>{activeTask ? `镜头 ${job.shots.indexOf(activeTask) + 1} · ${statusLabels[activeTask.status]}` : stageLabels[job.stage]}</span><small>{readyCount}/{job.shots.length} 镜头已就绪 · 可以离开，任务会保存在本机</small></div>}
          {isStale && <div className="render-stale-note"><AlertCircle size={14} /><span><strong>当前分镜已有新版本</strong>这个任务仍保留生成时的镜头、时长和画幅，不会被编辑覆盖。</span><button type="button" onClick={() => { setJob(null); setReviewing(true); }}>用新版制作</button></div>}
          {(job.error || notice) && <p className="render-job-error"><AlertCircle size={13} />{notice || job.error}</p>}
          {job.warnings && job.warnings.length > 0 && <details className="render-warnings"><summary><AlertCircle size={13} />{job.warnings.length} 条离线回退或配音说明</summary>{job.warnings.map((warning) => <p key={warning}>{warning}</p>)}</details>}
          <div className="render-job-actions">
            {["queued", "running", "waiting_api"].includes(job.status) && <button type="button" onClick={cancel} disabled={busy}><Pause size={13} />暂停</button>}
            {["failed", "cancelled"].includes(job.status) && <button type="button" onClick={() => retry()} disabled={busy}><RotateCcw size={13} />从当前进度继续</button>}
            {job.status === "ready" && <button type="button" onClick={() => retry()} disabled={busy}><RefreshCw size={13} />重新合成此版本</button>}
            <button type="button" onClick={() => setShowTasks((value) => !value)} aria-expanded={showTasks}>镜头详情<ChevronDown size={13} /></button>
            <button type="button" className="render-new-version" onClick={() => setJob(null)} disabled={busy}><Plus size={13} />新版本</button>
          </div>
          {showTasks && <div className="render-shot-tasks">
            {job.shots.map((task, index) => (
              <div key={task.shotId} className={`render-shot-task is-${task.status}`}>
                <span>{index + 1}</span><div><strong>{job.storyboard.shots[index]?.title}</strong><small>{statusLabels[task.status]} · {task.provider === "storyboard_preview" ? "离线画面" : task.provider === "jimeng" ? "即梦" : task.provider === "comfyui_h3" ? "本地 H3" : "Grok"}{task.providerModel ? ` · ${task.providerModel}` : ""}{task.attempts ? ` · 第 ${task.attempts} 次` : ""}{task.startedAt && task.completedAt ? ` · ${((new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()) / 60000).toFixed(1)} 分钟` : ""}</small></div>
                {task.status === "ready" ? <Check size={13} /> : task.status === "running" || task.status === "waiting_api" ? <Loader2 size={13} className="animate-spin" /> : task.status === "failed" ? <button type="button" onClick={() => retry(task.shotId)} aria-label={`重试镜头 ${index + 1}`}><RefreshCw size={13} /></button> : null}
                {task.error && <p>{task.error}</p>}
                {task.fallbackReason && <p className="render-shot-fallback">{task.fallbackReason}</p>}
              </div>
            ))}
          </div>}
          {job.outputUrl && <div className="render-output"><video key={job.outputUrl} src={job.outputUrl} controls preload="metadata">{job.subtitleUrl && <track kind="subtitles" src={job.subtitleUrl} srcLang="zh" label="旁白" />}</video><div><span>{job.mode === "preview" ? "完整分镜样片 MP4" : "模型成片 MP4"}</span><a href={job.outputUrl} download>下载视频</a></div></div>}
          <div className="render-export-bar"><span><Download size={12} />交付与精剪</span><a href={`/api/render-jobs/${job.id}/export?format=srt`} download>SRT</a><a href={`/api/render-jobs/${job.id}/export?format=vtt`} download>VTT</a><a href={`/api/render-jobs/${job.id}/export`} download>工程 ZIP</a>{job.narrationTrackUrl && <a href={job.narrationTrackUrl} download>旁白轨</a>}{job.musicTrackUrl && <a href={job.musicTrackUrl} download>音乐轨</a>}</div>
          <p className="render-job-meta">{readyCount}/{job.shots.length} 镜头 · {timelineDuration(job.storyboard).toFixed(1)} 秒 · 版本 {new Date(job.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
        </div>
      )}

      {reviewing && <div className="render-review" aria-label="生成前检查">
        <div className="render-review-heading"><div><Check size={14} /><strong>生成前检查</strong></div><button type="button" onClick={() => setReviewing(false)} aria-label="关闭生成前检查"><X size={13} /></button></div>
        {review.map((item) => <div className={`render-review-item is-${item.tone}`} key={item.id}><span>{item.tone === "ready" ? <Check size={13} /> : <AlertCircle size={13} />}</span><div><strong>{item.title}</strong><p>{item.detail}</p></div>{item.shotIndex !== undefined && <button type="button" onClick={() => { onEditShot(item.shotIndex!); setReviewing(false); }}>去调整<ChevronRight size={12} /></button>}</div>)}
        <p className="render-review-footnote">建议不阻断创作；缺少画面时才需要先补齐素材。</p>
      </div>}
      {notice && !job && <p className="render-job-error render-start-error" role="alert"><AlertCircle size={13} />{notice}</p>}
    </section>
  );
}
