"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Moon, BookOpen, Loader2, ArrowRight, SkipForward, Sparkles, Copy, Check, Film, ChevronDown, Users, Wand2, Upload, Info, Save, Mic, Image, RefreshCw } from "lucide-react";
import DreamHeroHeadline from "@/components/DreamHeroHeadline";
import VoiceRecorder from "@/components/VoiceRecorder";
import ProbeChat from "@/components/ProbeChat";
import AudioPlayer from "@/components/AudioPlayer";
import { useDreamStore } from "@/stores/dream-store";
import type { Dream, ProbeMessage, StyleGuide } from "@/types/dream";
import { messageFromErrorResponse } from "@/lib/llm-utils";
import {
  DEFAULT_SCENE_IMAGE_MODEL,
  SCENE_IMAGE_MODEL_OPTIONS,
  type SceneImageModelId,
} from "@/lib/scene-image-model";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createDefaultStoryboard } from "@/lib/storyboard";
import {
  LLM_MODEL_OPTIONS,
  readStoredLlmModel,
  writeStoredLlmModel,
} from "@/lib/llm-model-options";

interface ScenePrompt {
  sceneIndex: number;
  description: string;
  prompts: string[];
}

const SCENE_IMAGE_BATCH_SIZE = 3;
const CAPTURE_DRAFT_KEY = "dreamcup-quick-capture-draft-v1";

type SceneImageRow = { sceneIndex: number; imageUrl: string; prompt: string; error?: string };

function mergeSceneImageRows(prev: SceneImageRow[], incoming: SceneImageRow[]): SceneImageRow[] {
  const map = new Map<number, SceneImageRow>();
  for (const r of prev) map.set(r.sceneIndex, r);
  for (const r of incoming) map.set(r.sceneIndex, r);
  return [...map.values()].sort((a, b) => a.sceneIndex - b.sceneIndex);
}

interface PolishMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
}

/** Prefer locally edited 润色稿 (`polishedText`), then latest assistant reply, then raw transcript. */
function getFinalPolishTextForParse(
  messages: PolishMessage[],
  polishedTextState: string,
  rawFallback: string
): string {
  if (polishedTextState.trim()) {
    return polishedTextState;
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    if (m.content.startsWith("整理失败：")) continue;
    if (m.content.trim()) return m.content;
  }
  return rawFallback.trim();
}

/** So LLM follow-up sees manual edits in the textarea, not the last chat bubble only. */
function withDraftSyncedToPolishHistory(
  messages: PolishMessage[],
  draft: string
): PolishMessage[] {
  const next = messages.map((m) => ({ ...m }));
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i].role === "assistant" && !next[i].content.startsWith("整理失败：")) {
      next[i] = { ...next[i], content: draft };
      break;
    }
  }
  return next;
}

function audioFilenameForBlob(blob: Blob): string {
  const t = (blob.type || "").toLowerCase();
  if (t.includes("ogg")) return "recording.ogg";
  if (t.includes("mpeg") || t.includes("mp3")) return "recording.mp3";
  if (t.includes("wav")) return "recording.wav";
  if (t.includes("mp4") || t.includes("m4a") || t.includes("aac")) return "recording.m4a";
  return "recording.webm";
}

async function transcribeViaAsr(file: File | Blob, filename: string): Promise<{ text: string; audioFileName?: string }> {
  const formData = new FormData();
  formData.append("audio", file, filename);
  const response = await fetch("/api/asr", { method: "POST", body: formData });
  if (!response.ok) {
    throw new Error(await messageFromErrorResponse(response));
  }
  return response.json();
}

export default function Home() {
  const router = useRouter();
  const {
    currentStep, setCurrentStep,
    currentDream, setCurrentDream,
    probeMessages, addProbeMessage, setProbeMessages,
    rawText, setRawText,
    isProcessing, setIsProcessing,
    audioBlobUrl, setAudioBlobUrl,
    audioFileName, setAudioFileName,
    reset,
  } = useDreamStore();

  const [textInput, setTextInput] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { setTextInput(JSON.parse(localStorage.getItem(CAPTURE_DRAFT_KEY) || "{}").rawText || ""); } catch { /* Ignore malformed drafts. */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const audioFileInputRef = useRef<HTMLInputElement>(null);
  const [probeComplete, setProbeComplete] = useState(false);
  const [scenePrompts, setScenePrompts] = useState<ScenePrompt[]>([]);
  const [sceneStyleGuide, setSceneStyleGuide] = useState<StyleGuide | null>(null);
  const [sceneImages, setSceneImages] = useState<Array<{ sceneIndex: number; imageUrl: string; prompt: string; error?: string }>>([]);
  const [promptDraftsByScene, setPromptDraftsByScene] = useState<Record<number, string>>({});
  const [isLoadingPrompts, setIsLoadingPrompts] = useState(false);
  const [isRenderingImages, setIsRenderingImages] = useState(false);
  const [sceneImageError, setSceneImageError] = useState("");
  const [copiedIndex, setCopiedIndex] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState(readStoredLlmModel);
  const [showModelDropdown, setShowModelDropdown] = useState(false);

  // Polish step states
  const [polishedText, setPolishedText] = useState("");
  const [polishMessages, setPolishMessages] = useState<PolishMessage[]>([]);
  const [polishInput, setPolishInput] = useState("");
  const [isPolishing, setIsPolishing] = useState(false);
  const polishControllerRef = useRef<AbortController | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [sceneImageModel, setSceneImageModel] = useState<SceneImageModelId>(DEFAULT_SCENE_IMAGE_MODEL);
  const [visualContinuity, setVisualContinuity] = useState(true);

  const selectedModelConfig = LLM_MODEL_OPTIONS.find(m => m.value === selectedModel) || LLM_MODEL_OPTIONS[0];

  const confirmedPolishText = useMemo(
    () => getFinalPolishTextForParse(polishMessages, polishedText, rawText).trim(),
    [polishMessages, polishedText, rawText]
  );

  const modelHeaders = (extra?: Record<string, string>) => ({
    "Content-Type": "application/json",
    "x-model": selectedModelConfig.value,
    "x-api-url": selectedModelConfig.apiUrl,
    "x-api-key": selectedModelConfig.apiKey,
    ...extra,
  });

  const saveDraft = (text: string) => {
    try {
      const previous = JSON.parse(localStorage.getItem(CAPTURE_DRAFT_KEY) || "{}");
      localStorage.setItem(CAPTURE_DRAFT_KEY, JSON.stringify({ ...previous, rawText: text }));
    } catch { /* Local draft persistence is best effort. */ }
  };

  const clearDraft = () => {
    try { localStorage.removeItem(CAPTURE_DRAFT_KEY); } catch { /* Ignore unavailable storage. */ }
  };

  const startPolish = async (text: string) => {
    polishControllerRef.current?.abort();
    const controller = new AbortController();
    polishControllerRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort("timeout"), 120_000);
    setIsPolishing(true);
    try {
      const response = await fetch("/api/polish", {
        method: "POST",
        headers: modelHeaders(),
        body: JSON.stringify({ rawText: text }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(await messageFromErrorResponse(response));
      }
      const data = await response.json();

      const assistantMessage: PolishMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.polishedText,
      };
      setPolishedText(data.polishedText);
      setPolishMessages([
        { id: crypto.randomUUID(), role: "system", content: "以下是整理后的梦境文本，你可以继续提出修改意见。" },
        assistantMessage,
      ]);
    } catch (error) {
      if (controller.signal.aborted && controller.signal.reason === "cancelled") return;
      console.error("Polish error:", error);
      const reason = controller.signal.aborted ? "等待超过 120 秒，请重新整理；也可直接使用原文继续" : error instanceof Error ? error.message : "未知错误";
      setPolishedText(text);
      setPolishMessages([
        {
          id: crypto.randomUUID(),
          role: "system",
          content: `文本整理失败：${reason}。已使用原始文本，你可编辑后继续；若与密钥或服务商有关，请更换顶部模型或配置环境变量。`,
        },
        { id: crypto.randomUUID(), role: "assistant", content: text },
      ]);
    } finally {
      window.clearTimeout(timeout);
      if (polishControllerRef.current === controller) polishControllerRef.current = null;
      setIsPolishing(false);
    }
  };


  const handleRecordingComplete = useCallback(
    async (audioBlob: Blob, duration: number, browserTranscript: string) => {
      const blobUrl = URL.createObjectURL(audioBlob);
      setAudioBlobUrl(blobUrl);
      setIsProcessing(true);
      setCurrentStep("transcribing");

      try {
        let text = browserTranscript;

        if (!text.trim()) {
          const data = await transcribeViaAsr(audioBlob, audioFilenameForBlob(audioBlob));
          text = data.text;
          if (data.audioFileName) {
            setAudioFileName(data.audioFileName);
            URL.revokeObjectURL(blobUrl);
            setAudioBlobUrl(`/api/audio/${data.audioFileName}`);
          }
        } else {
          transcribeViaAsr(audioBlob, audioFilenameForBlob(audioBlob))
            .then((data) => {
              if (data.audioFileName) {
                setAudioFileName(data.audioFileName);
                setAudioBlobUrl(`/api/audio/${data.audioFileName}`);
              }
            })
            .catch(() => {});
        }

        setRawText(text);
        setCurrentStep("polishing");
        setIsProcessing(false);

        // Auto-start polish
        await startPolish(text);
      } catch (error) {
        console.error("Processing error:", error);
        setIsProcessing(false);
      }
    },
    [setAudioBlobUrl, setAudioFileName]
  );

  const handleTextInput = useCallback(async () => {
    if (!textInput.trim()) return;
    clearDraft();
    setRawText(textInput);
    setCurrentStep("polishing");

    // Auto-start polish
    await startPolish(textInput);
  }, [textInput]);

  const cancelPolish = () => {
    polishControllerRef.current?.abort("cancelled");
    polishControllerRef.current = null;
    setPolishedText(rawText);
    setPolishMessages([
      { id: crypto.randomUUID(), role: "system", content: "已取消本次整理，原始文本保留在下方，可直接编辑并继续。" },
      { id: crypto.randomUUID(), role: "assistant", content: rawText },
    ]);
    setIsPolishing(false);
  };

  async function handleUploadedAudio(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    setAudioBlobUrl(previewUrl);
    setAudioFileName("");
    setIsProcessing(true);
    setCurrentStep("transcribing");
    try {
      const name =
        file.name && !file.name.startsWith("blob") ? file.name : audioFilenameForBlob(file);
      const data = await transcribeViaAsr(file, name);
      const text = (data.text ?? "").trim();
      if (data.audioFileName) {
        setAudioFileName(data.audioFileName);
        URL.revokeObjectURL(previewUrl);
        setAudioBlobUrl(`/api/audio/${data.audioFileName}`);
      }
      setRawText(text);
      setCurrentStep("polishing");
      setIsProcessing(false);
      if (text) {
        await startPolish(text);
      } else {
        setPolishedText("");
        setPolishMessages([]);
      }
    } catch (err) {
      console.error("Upload ASR error:", err);
      URL.revokeObjectURL(previewUrl);
      setAudioBlobUrl("");
      setIsProcessing(false);
      setCurrentStep("recording");
    }
  }

  const handlePolishRequest = async () => {
    if (!polishInput.trim() || !rawText) return;

    const userMessage: PolishMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: polishInput,
    };
    const historySynced = withDraftSyncedToPolishHistory(polishMessages, polishedText);
    const updatedMessages = [...historySynced, userMessage];
    setPolishMessages(updatedMessages);
    setPolishInput("");
    setIsPolishing(true);

    try {
      const response = await fetch("/api/polish", {
        method: "POST",
        headers: modelHeaders(),
        body: JSON.stringify({
          rawText,
          conversationHistory: updatedMessages.map((m) => ({ role: m.role, content: m.content })),
          userRequest: polishInput,
        }),
      });
      if (!response.ok) {
        throw new Error(await messageFromErrorResponse(response));
      }
      const data = await response.json();

      const assistantMessage: PolishMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.polishedText,
      };
      setPolishedText(data.polishedText);
      setPolishMessages([...updatedMessages, assistantMessage]);
    } catch (error) {
      console.error("Polish request error:", error);
      const msg = error instanceof Error && error.name === "AbortError" ? "记忆补全响应超时，请重试或跳过" : error instanceof Error ? error.message : "未知错误";
      setPolishMessages([
        ...updatedMessages,
        { id: crypto.randomUUID(), role: "assistant", content: `整理失败：${msg}` },
      ]);
    } finally {
      setIsPolishing(false);
    }
  };

  const handleConfirmPolish = async () => {
    const textToParse = confirmedPolishText;
    if (!textToParse) return;

    setRawText(textToParse);
    setParseError(null);

    setIsProcessing(true);
    setCurrentStep("parsing");

    try {
      const parseResponse = await fetch("/api/parse", {
        method: "POST",
        headers: modelHeaders(),
        body: JSON.stringify({ text: textToParse }),
      });
      if (!parseResponse.ok) {
        const msg = await messageFromErrorResponse(parseResponse);
        setParseError(msg);
        setCurrentStep("polishing");
        return;
      }
      const parseData = await parseResponse.json() as { title?: string } & Dream["structured"];
      // parse API returns { title, ...DreamStructured }; strip title before using as structured
      const { title: llmTitle, ...structured } = parseData;

      const dream: Dream = {
        id: crypto.randomUUID(),
        title: llmTitle?.trim() || (structured as Dream["structured"]).narrative?.summary?.slice(0, 20) || "未命名梦境",
        rawText: textToParse, structured: structured as Dream["structured"], scenes: [],
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      setCurrentDream(dream);
      setCurrentStep("probing");

      const initialMessage: ProbeMessage = {
        id: crypto.randomUUID(), dreamId: dream.id, role: "system",
        content: "接下来只核对值得记住的画面。AI 的候选不会直接写进记录。",
        createdAt: new Date().toISOString(),
      };
      setProbeMessages([initialMessage]);
      await startProbing(dream, [initialMessage]);
    } catch (error) {
      console.error("Parse error:", error);
      const msg = error instanceof Error ? error.message : "未知错误";
      setParseError(msg);
      setCurrentStep("polishing");
    } finally {
      setIsProcessing(false);
    }
  };

  const startProbing = async (dream: Dream, messages: ProbeMessage[], userAnswer?: string) => {
    setIsProcessing(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 100_000);
    try {
      const conversationHistory = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
      const response = await fetch("/api/probe", {
        method: "POST",
        headers: modelHeaders(),
        body: JSON.stringify({ dreamStructured: dream.structured, conversationHistory, userAnswer }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await messageFromErrorResponse(response));
      const result = await response.json();

      if (result.action === "ask") {
        addProbeMessage({ id: crypto.randomUUID(), dreamId: dream.id, role: "assistant", content: result.question, proposal: result.proposal, createdAt: new Date().toISOString() });
        if (result.structureWarning) addProbeMessage({ id: crypto.randomUUID(), dreamId: dream.id, role: "system", content: result.structureWarning, createdAt: new Date().toISOString() });
      } else if (result.action === "complete") {
        setProbeComplete(true);
        if (result.updatedDream) setCurrentDream({ ...dream, structured: result.updatedDream });
      } else {
        throw new Error("记忆补全返回了无法识别的内容");
      }
    } catch (error) {
      console.error("Probe error:", error);
      const reason = error instanceof Error ? error.message.replace(/[。！？\s]+$/, "") : "请求失败";
      addProbeMessage({ id: crypto.randomUUID(), dreamId: dream.id, role: "system", content: `暂时无法生成候选：${reason}。可自由补充，或跳过此步。`, createdAt: new Date().toISOString() });
    } finally {
      window.clearTimeout(timeout);
      setIsProcessing(false);
    }
  };

  const handleProbeAnswer = useCallback(
    async (content: string, _isVoice: boolean) => {
      if (!currentDream) return;
      const userMessage: ProbeMessage = { id: crypto.randomUUID(), dreamId: currentDream.id, role: "user", content, createdAt: new Date().toISOString() };
      addProbeMessage(userMessage);
        const allMessages = [...probeMessages, userMessage];
        await startProbing(currentDream, allMessages, content);
    },
    [currentDream, probeMessages]
  );

  const handleSkipProbe = () => setProbeComplete(true);

  const handleGeneratePrompts = async () => {
    if (!currentDream) return;
    setCurrentStep("rendering");
    setSceneImages([]);
    setIsLoadingPrompts(true);

    try {
      const response = await fetch("/api/render", {
        method: "POST",
        headers: modelHeaders(),
        body: JSON.stringify({ dreamStructured: currentDream.structured, phase: "prompts" }),
      });
      if (!response.ok) {
        throw new Error(await messageFromErrorResponse(response));
      }
      const result = await response.json();

      if (result.scenePrompts) {
        const mapped = result.scenePrompts.map((sp: { sceneIndex: number; prompts: string[] }) => ({
          sceneIndex: sp.sceneIndex,
          description: currentDream!.structured.scenes?.[sp.sceneIndex]?.description || `场景 ${sp.sceneIndex + 1}`,
          prompts: sp.prompts,
        }));
        setScenePrompts(mapped);
        setSceneStyleGuide((result.styleGuide as StyleGuide) ?? null);
        const drafts: Record<number, string> = {};
        for (const sp of mapped) {
          drafts[sp.sceneIndex] = sp.prompts[0] || "";
        }
        setPromptDraftsByScene(drafts);
      }
    } catch (error) {
      console.error("Render error:", error);
    } finally {
      setIsLoadingPrompts(false);
    }
  };

  const handleGenerateSceneImages = async () => {
    if (!currentDream || scenePrompts.length === 0) return;
    if (isRenderingImages) return;
    const invalid = scenePrompts.some((sp) => !(promptDraftsByScene[sp.sceneIndex] ?? sp.prompts[0])?.trim());
    if (invalid) return;

    setIsRenderingImages(true);
    setSceneImageError("");
    try {
      const edited = scenePrompts.map((sp) => ({
        sceneIndex: sp.sceneIndex,
        prompts: [
          (promptDraftsByScene[sp.sceneIndex] ?? sp.prompts[0] ?? "").trim(),
          ...sp.prompts.slice(1),
        ],
      }));
      setSceneImages((previous) => previous.filter((image) => image.imageUrl && !image.error));
      for (let offset = 0; offset < edited.length; offset += SCENE_IMAGE_BATCH_SIZE) {
        const response = await fetch("/api/render", {
          method: "POST",
          headers: modelHeaders(),
          body: JSON.stringify({
            dreamStructured: currentDream.structured,
            phase: "images",
            scenePrompts: edited,
            imageModel: sceneImageModel,
            styleGuide: sceneStyleGuide ?? undefined,
            imageBatchOffset: offset,
            imageBatchSize: SCENE_IMAGE_BATCH_SIZE,
            visualContinuity: sceneImageModel === "minimax-h3-image-local" && visualContinuity,
            continuityKey: currentDream.structured.narrative.summary || currentDream.rawText,
          }),
        });
        if (!response.ok) {
          throw new Error(await messageFromErrorResponse(response));
        }
        const result = await response.json();
        if (result.sceneImages) {
          setSceneImages((prev) => mergeSceneImageRows(prev, result.sceneImages));
        }
      }
    } catch (error) {
      console.error("Scene images error:", error);
      setSceneImageError(error instanceof Error ? error.message : "生图请求失败，已保留提示词，请重试。");
    } finally {
      setIsRenderingImages(false);
    }
  };

  const handleCopyPrompt = async (prompt: string, key: string) => {
    await navigator.clipboard.writeText(prompt);
    setCopiedIndex(key);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleSaveDream = async () => {
    if (!currentDream) return;
    const storyboardScenes = sceneImages.map((img, index) => ({
      id: crypto.randomUUID(), sceneIndex: img.sceneIndex, imageUrl: img.imageUrl,
      promptUsed: img.prompt, error: img.error, isSelected: index === 0,
    }));
    const storyboard = createDefaultStoryboard({
      ...currentDream, scenes: storyboardScenes,
      sceneRenderPrompts: scenePrompts.map((prompt) => ({ sceneIndex: prompt.sceneIndex, prompts: prompt.prompts })),
      sceneStyleGuide: sceneStyleGuide ?? undefined,
    });
    try {
      const response = await fetch("/api/dreams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...currentDream,
          audioFileName,
          sceneRenderPrompts: scenePrompts.map((sp) => ({
            sceneIndex: sp.sceneIndex,
            prompts: [promptDraftsByScene[sp.sceneIndex] ?? sp.prompts[0], ...sp.prompts.slice(1)],
          })),
          sceneStyleGuide: sceneStyleGuide ?? undefined,
          scenes: storyboardScenes,
          storyboard,
        }),
      });
      if (!response.ok) throw new Error(await messageFromErrorResponse(response));
      setCurrentStep("complete");
      router.push(`/dream/${currentDream.id}`);
    } catch (error) {
      console.error("Save error:", error);
    }
  };

  const handleSaveCaptureOnly = async () => {
    const text = textInput.trim();
    if (!text) return;
    const dream: Dream = {
      id: crypto.randomUUID(), title: text.slice(0, 18), rawText: text,
      structured: { scenes: [], characters: [], narrative: { events: [], summary: "" }, emotions: [], sensory: {}, anomalies: [], meta: {}, lowConfidence: [] },
      scenes: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    setIsProcessing(true);
    try {
      const response = await fetch("/api/dreams", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dream) });
      if (!response.ok) throw new Error(await messageFromErrorResponse(response));
      clearDraft(); setTextInput(""); router.push("/journal");
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "保存失败，草稿仍保留在本机。");
    } finally { setIsProcessing(false); }
  };

  const handleNewDream = () => {
    if (audioBlobUrl) URL.revokeObjectURL(audioBlobUrl);
    reset();
    setTextInput(""); setProbeComplete(false);
    setScenePrompts([]); setSceneStyleGuide(null); setSceneImages([]); setPromptDraftsByScene({});
    setIsLoadingPrompts(false); setIsRenderingImages(false);
    setAudioFileName("");
    setPolishedText(""); setPolishMessages([]); setPolishInput("");
    setParseError(null);
  };

  const creationStage = ["recording", "transcribing"].includes(currentStep) ? 0
    : ["polishing", "parsing", "probing"].includes(currentStep) ? 1
    : currentStep === "rendering" ? 2 : 3;
  const creationStages = [
    { label: "记录", detail: "留下原始片段", icon: Mic },
    { label: "核对", detail: "确认记忆细节", icon: Sparkles },
    { label: "画面", detail: "生成场景与分镜", icon: Image },
    { label: "成片", detail: "合成、播放与导出", icon: Film },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <header className="dream-site-header gap-3">
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <Moon className="dream-moon-icon shrink-0" size={22} strokeWidth={1.5} />
          <div className="min-w-0">
            <h1 className="dream-title text-base sm:text-lg font-normal tracking-wide">掬梦</h1>
            <p className="text-[10px] sm:text-xs text-dream-muted truncate">DreamCup · 捕获尚未碎掉的梦</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <div className="relative">
            <button
              onClick={() => setShowModelDropdown(!showModelDropdown)}
              className="flex items-center gap-2 text-xs text-white/50 hover:text-white/85 transition-colors px-3 py-1.5 rounded-[var(--radius-dream)] border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06]"
            >
              <span>{LLM_MODEL_OPTIONS.find(m => m.value === selectedModel)?.label || selectedModel}</span>
              <ChevronDown size={12} className={`transition-transform ${showModelDropdown ? 'rotate-180' : ''}`} />
            </button>
            {showModelDropdown && (
              <div className="absolute right-0 top-full mt-1 w-56 rounded-[var(--radius-dream)] border border-white/10 bg-[color-mix(in_srgb,var(--color-card)_95%,transparent)] backdrop-blur-md shadow-2xl z-50 overflow-hidden">
                {LLM_MODEL_OPTIONS.map((model) => (
                  <button
                    key={model.value}
                    onClick={() => {
                      setSelectedModel(model.value);
                      writeStoredLlmModel(model.value);
                      setShowModelDropdown(false);
                    }}
                    className={`w-full px-3 py-2.5 text-left text-xs transition-colors ${
                      selectedModel === model.value ? "text-white bg-white/10" : "text-white/60 hover:bg-white/8 hover:text-white/85"
                    }`}
                  >
                    <div>{model.label}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <Link
            href="/persons"
            className="flex items-center gap-1 text-[11px] sm:text-xs text-white/45 hover:text-white/85 transition-colors"
            title="人物库"
          >
            <Users size={15} />
            <span className="hidden min-[400px]:inline">人物</span>
          </Link>
          <Link
            href="/journal"
            className="flex items-center gap-1 text-[11px] sm:text-xs text-white/45 hover:text-white/85 transition-colors"
            title="梦境日志"
          >
            <BookOpen size={15} />
            <span className="hidden min-[400px]:inline">日志</span>
          </Link>
          <Link
            href="/about"
            className="flex items-center gap-1 text-[11px] sm:text-xs text-white/45 hover:text-white/85 transition-colors"
            title="关于"
          >
            <Info size={15} />
            <span className="hidden min-[400px]:inline">关于</span>
          </Link>
        </div>
      </header>

      <nav className="creation-journey" aria-label="梦境创作流程">
        {creationStages.map((stage, index) => {
          const Icon = stage.icon;
          return <div key={stage.label} className={`creation-journey-step ${index === creationStage ? "is-current" : ""} ${index < creationStage ? "is-done" : ""}`}><span><Icon size={15} /></span><div><strong>{stage.label}</strong><small>{stage.detail}</small></div></div>;
        })}
      </nav>

      <main className="flex-1 flex flex-col items-center justify-center px-5 sm:px-6 py-10 md:py-16">
        <AnimatePresence mode="wait">
          {currentStep === "recording" && (
            <motion.div
              key="recording"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.35 }}
              className="w-full max-w-3xl flex flex-col items-center"
            >
              <DreamHeroHeadline />
              <p className="text-sm text-dream-subtle mt-1 mb-8 text-center max-w-md leading-relaxed text-pretty">
                先记下还记得的部分。之后的整理、画面与视频，都由你决定。
              </p>

              <section className="dream-capture-composer" aria-label="记录梦境">
                <div className="dream-capture-composer-heading"><span><Wand2 size={15} />此刻的梦</span><small><Check size={12} />草稿自动保存在本机</small></div>
                    <textarea
                      value={textInput}
                      onChange={(e) => { setTextInput(e.target.value); saveDraft(e.target.value); }}
                      placeholder={"一间房、一个人、一种说不清的感觉……\n不用完整，也不用合乎逻辑。"}
                      rows={6}
                      className="dream-capture-composer-input"
                    />
                    <div className="dream-capture-composer-actions">
                      <button
                        type="button"
                        onClick={handleTextInput}
                        disabled={!textInput.trim()}
                        className="btn-dream-primary"
                      >
                        整理并创作 <ArrowRight size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveCaptureOnly}
                        disabled={!textInput.trim()}
                        className="btn-dream-secondary"
                      >
                        <Save size={14} />只保存记录
                      </button>
                    </div>
                    {parseError && <p role="alert" className="dream-capture-error">{parseError}</p>}
              </section>
              <div className="dream-voice-tools">
                <VoiceRecorder onRecordingComplete={handleRecordingComplete} disabled={isProcessing} />
                <label className="dream-upload-audio">
                  <Upload size={15} /><span>上传已有录音</span><small>mp3 / wav / ogg / webm</small>
                  <input ref={audioFileInputRef} type="file" accept="audio/*,.mp3,.wav,.ogg,.webm,.m4a,.opus,.aac" className="hidden" onChange={handleUploadedAudio} />
                </label>
              </div>
            </motion.div>
          )}

          {currentStep === "transcribing" && (
            <motion.div key="transcribing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full max-w-lg flex flex-col items-center gap-4">
              <Loader2 className="animate-spin text-white/40" size={48} />
              <p className="text-white/60">正在将语音转写为文字...</p>
              {audioBlobUrl && <div className="w-full mt-2"><AudioPlayer src={audioBlobUrl} /></div>}
              {rawText && (
                <div className="w-full mt-2 rounded-xl bg-white/5 border border-white/10 p-4">
                  <p className="text-xs text-white/40 mb-2">转写文本</p>
                  <p className="text-sm text-white/60 whitespace-pre-wrap">{rawText}</p>
                </div>
              )}
            </motion.div>
          )}

          {currentStep === "polishing" && (
            <motion.div key="polishing" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="w-full max-w-2xl h-[70vh] flex flex-col">
              <div className="flex items-center justify-between mb-2 gap-2">
                <h2 className="text-lg font-medium text-white/88 flex items-center gap-2">
                  <Wand2 size={18} className="text-white/45 shrink-0" strokeWidth={1.5} />
                  文本润色
                </h2>
                <span className="text-xs text-white/32 text-right max-w-[14rem]">顺一顺口气，不擅自编故事</span>
              </div>
              {audioBlobUrl && <div className="mb-3"><AudioPlayer src={audioBlobUrl} /></div>}

              {rawText && (
                <div className="mb-3 dream-surface-ghost p-3">
                  <p className="text-[10px] text-white/30 mb-1 uppercase tracking-widest">原始文本</p>
                  <p className="text-xs text-white/45 whitespace-pre-wrap line-clamp-3">{rawText}</p>
                </div>
              )}

              <div className="flex-1 dream-surface-ghost overflow-hidden flex flex-col rounded-[1.1rem]">
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {polishMessages.length === 0 && isPolishing && (
                    <div className="flex items-center gap-2 text-white/30">
                      <Loader2 size={14} className="animate-spin" />
                      <span className="text-xs">正在整理文本...</span>
                    </div>
                  )}
                  {polishMessages.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm ${
                        msg.role === "user"
                          ? "bg-white/10 text-white/88 border border-white/10"
                          : msg.role === "system"
                          ? "bg-white/[0.04] text-white/45 text-xs"
                          : "bg-white/[0.04] text-white/75 border border-white/[0.08]"
                      }`}>
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    </div>
                  ))}
                  {isPolishing && polishMessages.length > 0 && (
                    <div className="flex items-center gap-2 text-white/30">
                      <Loader2 size={14} className="animate-spin" />
                      <span className="text-xs">正在修改...</span>
                    </div>
                  )}
                </div>

                <div className="border-t border-white/10 p-3">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={polishInput}
                      onChange={(e) => setPolishInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handlePolishRequest()}
                      placeholder="提出修改意见，例如：把第三句删掉…"
                      className="flex-1 bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/32 focus:outline-none focus:ring-1 focus:ring-white/20"
                    />
                    <button
                      onClick={handlePolishRequest}
                      disabled={!polishInput.trim() || isPolishing}
                      className="btn-dream-primary px-4 py-2 text-sm disabled:opacity-50"
                    >
                      修改
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-3 shrink-0 flex flex-col gap-2 min-h-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] text-white/30 uppercase tracking-wider">润色稿（可直接编辑）</p>
                  <span className="text-[10px] text-white/25">修改会实时用于「确认并进入结构化提取」</span>
                </div>
                <textarea
                  value={polishedText}
                  onChange={(e) => setPolishedText(e.target.value)}
                  disabled={isPolishing}
                  rows={6}
                  placeholder="模型生成后将显示在此，可直接增删改；小改动无需再点「修改」对话。"
                  className="w-full min-h-[7.5rem] max-h-[30vh] resize-y dream-surface-ghost rounded-[var(--radius-dream)] px-3 py-2.5 text-sm text-white/88 placeholder:text-white/28 focus:outline-none focus:ring-1 focus:ring-white/20 disabled:opacity-50 disabled:cursor-not-allowed whitespace-pre-wrap"
                />
              </div>

              {parseError && (
                <p className="w-full text-sm text-red-300/95 bg-red-500/10 border border-red-500/20 rounded-[var(--radius-dream)] px-3 py-2 whitespace-pre-wrap">
                  结构化提取失败：{parseError}
                </p>
              )}
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4">
                {isPolishing && <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                  <button type="button" onClick={cancelPolish} className="text-white/45 hover:text-white/80">取消并保留原文</button>
                  <button type="button" onClick={() => { cancelPolish(); void startPolish(rawText); }} className="text-white/55 hover:text-white/85">重新整理</button>
                </div>}
                <button
                  onClick={handleConfirmPolish}
                  disabled={isPolishing || !confirmedPolishText}
                  className="btn-dream-primary w-full py-3.5 text-sm font-medium flex items-center justify-center gap-2"
                >
                  确认并结构化 <ArrowRight size={16} />
                </button>
              </motion.div>
            </motion.div>
          )}

          {currentStep === "parsing" && (
            <motion.div key="parsing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full max-w-lg flex flex-col items-center gap-4">
              <Loader2 className="animate-spin text-white/40" size={48} />
              <p className="text-white/60">正在提取梦境结构...</p>
              {audioBlobUrl && <div className="w-full mt-2"><AudioPlayer src={audioBlobUrl} /></div>}
              {rawText && (
                <div className="w-full mt-2 rounded-xl bg-white/5 border border-white/10 p-4">
                  <p className="text-xs text-white/40 mb-2">润色后的文本</p>
                  <p className="text-sm text-white/60 whitespace-pre-wrap">{rawText}</p>
                </div>
              )}
            </motion.div>
          )}

          {currentStep === "probing" && currentDream && (
            <motion.div key="probing" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="w-full max-w-2xl h-[70vh] flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-lg font-medium text-white/88 flex items-center gap-2">
                  <Sparkles size={18} className="text-white/40 shrink-0" strokeWidth={1.5} />
                  记忆补全
                </h2>
                {!probeComplete && (
                  <button onClick={handleSkipProbe} className="flex items-center gap-1 text-xs text-white/30 hover:text-white/60 transition-colors">
                    <SkipForward size={14} />跳过补全
                  </button>
                )}
              </div>
              {audioBlobUrl && <div className="mb-3"><AudioPlayer src={audioBlobUrl} /></div>}
              <div className="flex-1 dream-surface-ghost overflow-hidden rounded-[1.1rem]">
                <ProbeChat messages={probeMessages} onSendMessage={handleProbeAnswer} isProcessing={isProcessing} isComplete={probeComplete} />
              </div>
              {probeComplete && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4">
                  <button
                    onClick={handleGeneratePrompts}
                    className="btn-dream-primary w-full py-3.5 text-sm font-medium flex items-center justify-center gap-2"
                  >
                    生成场景提示词 <ArrowRight size={16} />
                  </button>
                </motion.div>
              )}
            </motion.div>
          )}

          {currentStep === "rendering" && (
            <motion.div key="rendering" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="w-full max-w-3xl">
              <h2 className="text-lg font-medium text-white/88 mb-4 flex items-center gap-2">
                <Sparkles size={18} className="text-white/40 shrink-0" strokeWidth={1.5} />
                场景生图
              </h2>
              {audioBlobUrl && <div className="mb-4"><AudioPlayer src={audioBlobUrl} /></div>}

              {isLoadingPrompts ? (
                <div className="flex flex-col items-center gap-4 py-12">
                  <Loader2 className="animate-spin text-white/40" size={40} />
                  <p className="text-white/50">正在生成场景提示词...</p>
                </div>
              ) : sceneImages.length > 0 ? (
                <div className="space-y-6">
                  {isRenderingImages && (
                    <div className="flex items-center justify-center gap-2 rounded-[var(--radius-dream)] border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-xs text-white/50">
                      <Loader2 className="animate-spin shrink-0" size={16} />
                      <span>
                        正在生成场景图片…（已完成 {sceneImages.length} / {scenePrompts.length}）
                      </span>
                    </div>
                  )}
                  {sceneImages.map((img) => (
                    <div key={img.sceneIndex} className="dream-surface-ghost overflow-hidden">
                      <div className="px-4 py-3 border-b border-white/5 bg-white/[0.02]">
                        <h4 className="text-sm font-medium text-white/70">场景 {img.sceneIndex + 1}</h4>
                        <p className="text-xs text-white/40 mt-1">{img.prompt}</p>
                        {img.error && (
                          <p role="alert" className="text-xs text-red-300/85 mt-2 leading-relaxed">{img.error}</p>
                        )}
                      </div>
                      {img.imageUrl ? (
                        <div className="aspect-video"><img src={img.imageUrl} alt={`场景 ${img.sceneIndex + 1}`} className="w-full h-full object-cover" /></div>
                      ) : (
                        <div className="aspect-video flex items-center justify-center bg-white/5">
                          <p className="text-xs text-white/30">{img.error ? "生成失败" : "图片生成失败"}</p>
                        </div>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={handleGenerateSceneImages}
                    disabled={isRenderingImages}
                    className="btn-dream-secondary w-full py-3 text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isRenderingImages ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                    {isRenderingImages ? "正在重新生成…" : sceneImages.some((image) => image.imageUrl) ? "重试失败场景并重新生成" : "重试生图"}
                  </button>
                  <button
                    onClick={handleSaveDream}
                    disabled={isRenderingImages || sceneImages.some((image) => !image.imageUrl)}
                    className="btn-dream-primary w-full py-3.5 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-45 disabled:pointer-events-none"
                  >
                    <Film size={16} />
                    保存并进入分镜
                    <ArrowRight size={16} />
                  </button>
                </div>
              ) : isRenderingImages ? (
                <div className="flex flex-col items-center gap-4 py-12">
                  <Loader2 className="animate-spin text-white/40" size={40} />
                  <p className="text-white/50">正在生成首批场景图片…</p>
                </div>
              ) : scenePrompts.length > 0 ? (
                <div className="space-y-6">
                  {sceneImageError && <div role="alert" className="dream-scene-error"><p>{sceneImageError}</p><span>提示词已保留，连接恢复后可直接重试。</span></div>}
                  <p className="text-xs text-white/40">
                    以下为每个场景的提示词，可修改后再一键生图；主提示词（第一条）将用于画面生成，备选变体可对照或复制。
                  </p>
                  {scenePrompts.map((scene) => {
                    const primaryKey = `${scene.sceneIndex}-0`;
                    const primaryValue = promptDraftsByScene[scene.sceneIndex] ?? scene.prompts[0] ?? "";
                    return (
                      <div key={scene.sceneIndex} className="dream-surface-ghost overflow-hidden">
                        <div className="px-4 py-3 border-b border-white/5 bg-white/[0.02]">
                          <h4 className="text-sm font-medium text-white/70">场景 {scene.sceneIndex + 1}</h4>
                          {scene.description && (
                            <p className="text-xs text-white/40 mt-1 leading-relaxed">{scene.description}</p>
                          )}
                        </div>
                        <div className="p-4 space-y-3">
                          <div>
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <span className="text-[10px] text-white/50 uppercase tracking-wider">主提示词（用于生图）</span>
                              <button
                                type="button"
                                onClick={() => handleCopyPrompt(primaryValue, primaryKey)}
                                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                                title="复制"
                              >
                                {copiedIndex === primaryKey ? (
                                  <Check size={14} className="text-green-400" />
                                ) : (
                                  <Copy size={14} className="text-white/30" />
                                )}
                              </button>
                            </div>
                            <textarea
                              value={primaryValue}
                              onChange={(e) =>
                                setPromptDraftsByScene((prev) => ({
                                  ...prev,
                                  [scene.sceneIndex]: e.target.value,
                                }))
                              }
                              rows={5}
                              className="w-full dream-surface-ghost rounded-[var(--radius-dream)] px-3 py-2.5 text-sm text-white/88 placeholder:text-white/28 focus:outline-none focus:ring-1 focus:ring-white/20 resize-y min-h-[6rem]"
                              placeholder="编辑用于生成该场景画面的中文提示词"
                            />
                          </div>
                          {scene.prompts.length > 1 && (
                            <div className="space-y-2 pt-2 border-t border-white/5">
                              <span className="text-[10px] text-white/25 uppercase tracking-wider">备选变体（仅参考）</span>
                              {scene.prompts.slice(1).map((prompt, i) => {
                                const copyKey = `${scene.sceneIndex}-${i + 1}`;
                                return (
                                  <div key={i} className="flex items-start justify-between gap-2 rounded-lg bg-white/[0.02] px-3 py-2">
                                    <p className="text-xs text-white/45 leading-relaxed whitespace-pre-wrap break-words flex-1">
                                      变体 {i + 2}：{prompt}
                                    </p>
                                    <button
                                      type="button"
                                      onClick={() => handleCopyPrompt(prompt, copyKey)}
                                      className="shrink-0 p-1 rounded hover:bg-white/10"
                                    >
                                      {copiedIndex === copyKey ? (
                                        <Check size={12} className="text-green-400" />
                                      ) : (
                                        <Copy size={12} className="text-white/30" />
                                      )}
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <span className="text-white/40 shrink-0">生图模型</span>
                    <select
                      value={sceneImageModel}
                      onChange={(e) => setSceneImageModel(e.target.value as SceneImageModelId)}
                      disabled={isRenderingImages}
                      className="flex-1 min-w-[12rem] max-w-md dream-surface-ghost rounded-[var(--radius-dream)] px-3 py-2 text-white/88 focus:outline-none focus:ring-1 focus:ring-white/20 disabled:opacity-50"
                    >
                      {SCENE_IMAGE_MODEL_OPTIONS.map((o) => (
                        <option key={o.id} value={o.id} className="bg-[#12121a]">
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {sceneImageModel === "minimax-h3-image-local" && <label className="flex items-start gap-2 text-xs text-white/55 leading-relaxed">
                    <input type="checkbox" checked={visualContinuity} onChange={(event) => setVisualContinuity(event.target.checked)} disabled={isRenderingImages} className="mt-0.5" />
                    <span>用前一镜头参考画风与反复出现的场景元素。切换空间时仍以当前提示词为准。</span>
                  </label>}
                  <button
                    type="button"
                    onClick={handleGenerateSceneImages}
                    disabled={
                      isRenderingImages ||
                      scenePrompts.some((sp) => !(promptDraftsByScene[sp.sceneIndex] ?? sp.prompts[0])?.trim())
                    }
                    className="btn-dream-primary w-full py-3.5 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Sparkles size={16} />
                    一键生成场景图
                  </button>
                </div>
              ) : (
                <div className="text-center py-12 text-white/30">
                  <p>尚未生成提示词，请从「记忆补全」步骤进入</p>
                </div>
              )}
            </motion.div>
          )}

          {currentStep === "complete" && (
            <motion.div
              key="complete"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full max-w-lg flex flex-col items-center gap-8 text-center py-4"
            >
              <div className="w-[5.5rem] h-[5.5rem] rounded-full border border-white/16 bg-white/[0.04] flex items-center justify-center shadow-[0_0_0_1px_rgba(255,255,255,0.04)]">
                <Moon size={34} className="dream-moon-icon" strokeWidth={1.25} />
              </div>
              <div>
                <h2 className="text-2xl sm:text-[1.65rem] font-light text-white/92 mb-2 tracking-tight">这一次，被接住了</h2>
                <p className="text-sm text-white/45 leading-relaxed max-w-sm mx-auto text-pretty">
                  已写入日志。日后再读，像掀开窗帘的一角，光还会在那里。
                </p>
              </div>
              {audioBlobUrl && <div className="w-full"><AudioPlayer src={audioBlobUrl} label="回放录音" /></div>}
              <div className="flex flex-col sm:flex-row gap-3 w-full sm:justify-center">
                <button type="button" onClick={handleNewDream} className="btn-dream-secondary px-6 py-2.5 text-sm w-full sm:w-auto">
                  再记一条
                </button>
                <Link href="/journal" className="btn-dream-primary px-6 py-2.5 text-sm w-full sm:w-auto no-underline">
                  去梦境日志
                </Link>
                {currentDream && <Link href={`/dream/${currentDream.id}`} className="btn-dream-secondary px-6 py-2.5 text-sm w-full sm:w-auto no-underline">进入放映室</Link>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
