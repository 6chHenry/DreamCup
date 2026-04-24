"use client";

import { useEffect, useState } from "react";
import { dreamHeadlineFont } from "@/lib/fonts";

const PHRASES = [
  "你昨晚，梦见了什么？",
  "光、房间、一个模糊的人……",
  "把还没散去的，轻轻留住。",
  "醒来仍温热的那一半秒。",
];

const TYPE_MS = 88;
const DELETE_MS = 52;
const PAUSE_AFTER_TYPE_MS = 2400;
const PAUSE_BEFORE_DELETE_MS = 380;

type Phase = "typing" | "pause" | "deleting";

export default function DreamHeroHeadline() {
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [displayText, setDisplayText] = useState("");
  const [phase, setPhase] = useState<Phase>("typing");

  const full = PHRASES[phraseIndex];

  useEffect(() => {
    if (phase !== "typing") return;
    let id: ReturnType<typeof setTimeout>;
    if (displayText.length < full.length) {
      id = setTimeout(() => {
        setDisplayText(full.slice(0, displayText.length + 1));
      }, TYPE_MS);
    } else {
      id = setTimeout(() => setPhase("pause"), PAUSE_AFTER_TYPE_MS);
    }
    return () => clearTimeout(id);
  }, [phase, displayText, full, phraseIndex]);

  useEffect(() => {
    if (phase !== "pause") return;
    const id = setTimeout(() => setPhase("deleting"), PAUSE_BEFORE_DELETE_MS);
    return () => clearTimeout(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== "deleting") return;
    let id: ReturnType<typeof setTimeout>;
    if (displayText.length > 0) {
      id = setTimeout(() => setDisplayText((t) => t.slice(0, -1)), DELETE_MS);
    } else {
      id = setTimeout(() => {
        setPhraseIndex((i) => (i + 1) % PHRASES.length);
        setPhase("typing");
      }, 180);
    }
    return () => clearTimeout(id);
  }, [phase, displayText]);

  return (
    <h2
      className={`${dreamHeadlineFont.className} mb-2 flex min-h-[2.75rem] flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-center text-[1.65rem] font-light leading-snug tracking-wide sm:text-[1.85rem] text-[#f2f3fb]`}
      style={{ textShadow: "0 0 40px rgba(200, 210, 255, 0.12)" }}
      aria-live="polite"
    >
      <span>{displayText}</span>
      <span
        className="dream-hero-cursor inline-block h-[1.32em] w-px shrink-0 self-center rounded-full bg-white/50"
        aria-hidden
      />
    </h2>
  );
}
