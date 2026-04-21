"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Moon, ArrowLeft, MapPin, Users, Heart, Sparkles, Volume2, Download } from "lucide-react";
import type { Dream } from "@/types/dream";
import JSZip from "jszip";
import AudioPlayer from "@/components/AudioPlayer";

export default function DreamDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [dream, setDream] = useState<Dream | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (params.id) {
      fetchDream(params.id as string);
    }
  }, [params.id]);

  const fetchDream = async (id: string) => {
    try {
      const response = await fetch(`/api/dreams/${id}`);
      if (response.ok) {
        const data = await response.json();
        setDream(data);
      }
    } catch (error) {
      console.error("Fetch dream error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportMarkdown = async () => {
    if (!dream) return;

    const md = `# ${dream.title}

**日期**: ${new Date(dream.createdAt).toLocaleDateString("zh-CN")}

## 原始口述

${dream.rawText}

## 场景

${dream.structured.scenes.map((s, i) => {
  let sceneMd = `### 场景 ${i + 1}\n${s.description}`;
  if (s.lighting) sceneMd += `\n光线: ${s.lighting}`;
  if (s.colorTone) sceneMd += `\n色调: ${s.colorTone}`;
  if (s.weather) sceneMd += `\n天气: ${s.weather}`;
  if (s.spatialLayout) sceneMd += `\n空间布局: ${s.spatialLayout}`;
  const sceneImage = dream.scenes.find((sc) => sc.sceneIndex === i && sc.imageUrl);
  if (sceneImage) {
    const imgFilename = `scene-${i + 1}.png`;
    sceneMd += `\n![场景 ${i + 1}](${imgFilename})`;
  }
  return sceneMd;
}).join("\n\n")}

## 人物

${dream.structured.characters.map((c) => `- **${c.identity}**${c.appearance ? `: ${c.appearance}` : ""}${c.relationship ? ` (${c.relationship})` : ""}`).join("\n")}

## 叙事

${dream.structured.narrative.summary}

## 情绪

${dream.structured.emotions.map((e) => `- ${e.type} (强度: ${e.intensity}/10)${e.trigger ? ` — 触发: ${e.trigger}` : ""}`).join("\n")}

## 异常

${dream.structured.anomalies.map((a) => `- ${a.description} [${a.type}]`).join("\n")}
`;

    const zip = new JSZip();
    zip.file("dream.md", md);

    const imagesWithDataUrl = dream.scenes.filter((s) => s.imageUrl && s.imageUrl.startsWith("data:image"));

    if (imagesWithDataUrl.length > 0) {
      for (let i = 0; i < imagesWithDataUrl.length; i++) {
        const scene = imagesWithDataUrl[i];
        const base64Data = scene.imageUrl.split(",")[1];
        const imgFilename = `scene-${scene.sceneIndex + 1}.png`;
        zip.file(imgFilename, base64Data, { base64: true });
      }
    }

    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dream-${dream.id}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!dream) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-white/40">梦境未找到</p>
      </div>
    );
  }

  const { structured } = dream;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
          >
            <ArrowLeft size={16} />
          </button>
          <Moon className="text-indigo-400" size={20} />
          <h1 className="text-lg font-semibold text-white/90">{dream.title}</h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExportMarkdown}
            className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
          >
            <Download size={16} />
          </button>
        </div>
      </header>

      <main className="flex-1 px-6 py-8 max-w-4xl mx-auto w-full space-y-8">
        <div className="text-sm text-white/30">
          {new Date(dream.createdAt).toLocaleString("zh-CN")}
        </div>

        {dream.audioFileName && (
          <AudioPlayer src={`/api/audio/${dream.audioFileName}`} label="梦境录音" />
        )}

        {dream.scenes.filter((s) => s.imageUrl).length > 0 && (
          <section>
            <h2 className="text-sm font-medium text-white/50 mb-4 flex items-center gap-2">
              <Sparkles size={14} />
              视觉锚点
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {dream.scenes
                .filter((s) => s.imageUrl)
                .map((scene) => (
                  <div key={scene.id} className="aspect-video rounded-xl overflow-hidden">
                    <img
                      src={scene.imageUrl}
                      alt="Dream scene"
                      className="w-full h-full object-cover"
                    />
                  </div>
                ))}
            </div>
          </section>
        )}

        {structured.scenes.length > 0 && (
          <section>
            <h2 className="text-sm font-medium text-white/50 mb-4 flex items-center gap-2">
              <MapPin size={14} />
              场景
            </h2>
            <div className="space-y-4">
              {structured.scenes.map((scene, i) => (
                <div key={scene.id} className="rounded-xl bg-white/5 border border-white/10 p-4">
                  <h3 className="text-sm font-medium text-white/70 mb-2">场景 {i + 1}</h3>
                  <p className="text-sm text-white/60">{scene.description}</p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {scene.lighting && (
                      <span className="text-xs px-2 py-1 rounded-full bg-amber-500/10 text-amber-300">
                        光线: {scene.lighting}
                      </span>
                    )}
                    {scene.colorTone && (
                      <span className="text-xs px-2 py-1 rounded-full bg-purple-500/10 text-purple-300">
                        色调: {scene.colorTone}
                      </span>
                    )}
                    {scene.weather && (
                      <span className="text-xs px-2 py-1 rounded-full bg-blue-500/10 text-blue-300">
                        天气: {scene.weather}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {structured.characters.length > 0 && (
          <section>
            <h2 className="text-sm font-medium text-white/50 mb-4 flex items-center gap-2">
              <Users size={14} />
              人物
            </h2>
            <div className="flex flex-wrap gap-3">
              {structured.characters.map((char) => (
                <button
                  key={char.id}
                  onClick={() => {
                    const name = char.name || char.identity;
                    if (name) {
                      fetch(`/api/persons`)
                        .then((r) => r.json())
                        .then((persons: any[]) => {
                          const match = persons.find(
                            (p) => p.name.toLowerCase() === name.toLowerCase()
                          );
                          if (match) router.push(`/person/${match.id}`);
                          else router.push("/persons");
                        })
                        .catch(() => router.push("/persons"));
                    }
                  }}
                  className="rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-left hover:bg-white/[0.08] hover:border-white/20 transition-all group"
                >
                  <p className="text-sm font-medium text-white/80 group-hover:text-white transition-colors">
                    {char.name || char.identity}
                    {char.name && char.name !== char.identity && (
                      <span className="text-xs text-white/30 ml-2">{char.identity}</span>
                    )}
                  </p>
                  {char.appearance && (
                    <p className="text-xs text-white/40 mt-1">{char.appearance}</p>
                  )}
                  {char.relationship && (
                    <p className="text-xs text-indigo-300 mt-1">{char.relationship}</p>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="text-sm font-medium text-white/50 mb-4">叙事</h2>
          <p className="text-sm text-white/60 leading-relaxed">
            {structured.narrative.summary}
          </p>
        </section>

        {structured.emotions.length > 0 && (
          <section>
            <h2 className="text-sm font-medium text-white/50 mb-4 flex items-center gap-2">
              <Heart size={14} />
              情绪轨迹
            </h2>
            <div className="space-y-2">
              {structured.emotions.map((emotion, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-sm text-white/60 w-20">{emotion.type}</span>
                  <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-pink-500 to-rose-400 rounded-full"
                      style={{ width: `${(emotion.intensity / 10) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-white/30">{emotion.intensity}/10</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {structured.anomalies.length > 0 && (
          <section>
            <h2 className="text-sm font-medium text-white/50 mb-4 flex items-center gap-2">
              <Sparkles size={14} />
              异常元素
            </h2>
            <div className="space-y-2">
              {structured.anomalies.map((anomaly, i) => (
                <div key={i} className="rounded-lg bg-amber-500/5 border border-amber-500/10 px-4 py-3">
                  <p className="text-sm text-white/60">{anomaly.description}</p>
                  <span className="text-xs text-amber-300/60">{anomaly.type}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="text-sm font-medium text-white/50 mb-4">原始口述</h2>
          <p className="text-sm text-white/40 leading-relaxed whitespace-pre-wrap">
            {dream.rawText}
          </p>
        </section>
      </main>
    </div>
  );
}
