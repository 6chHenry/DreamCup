"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Check, CircleHelp, Pencil } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { ProbeMessage } from "@/types/dream";

interface ProbeChatProps {
  messages: ProbeMessage[];
  onSendMessage: (content: string, isVoice: boolean) => void;
  isProcessing: boolean;
  isComplete: boolean;
}

export default function ProbeChat({
  messages,
  onSendMessage,
  isProcessing,
  isComplete,
}: ProbeChatProps) {
  const [inputText, setInputText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const currentCardRef = useRef<HTMLElement>(null);
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const latestProposal = latestAssistant?.proposal;

  useEffect(() => {
    const container = messagesContainerRef.current;
    const currentCard = currentCardRef.current;
    if (!container) return;
    container.scrollTo({
      top: currentCard ? currentCard.offsetTop - container.offsetTop - 8 : container.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);


  const sendAnswer = (content: string) => {
    setSelectedOptions([]);
    onSendMessage(content, false);
  };

  const handleSendText = () => {
    if (!inputText.trim() || isProcessing) return;
    sendAnswer(inputText.trim());
    setInputText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendText();
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="memory-probe-intro"><span><i />记忆由你确认</span><p>候选只是线索，只有你的回答会写进记录。</p></div>
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        <AnimatePresence>
          {messages.filter((message) => message !== latestAssistant).map((message) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
                className={`memory-probe-history ${message.role === "user" ? "is-user" : ""}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                  message.role === "user"
                    ? "bg-white/10 text-white/90 border border-white/10"
                    : message.role === "system"
                    ? "bg-amber-500/10 text-amber-100/95 text-sm italic border border-amber-500/15"
                    : "bg-transparent text-white/60 border border-white/[0.055]"
                }`}
              >
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {latestAssistant && (
          <section ref={currentCardRef} className="memory-current-card">
            <div className="memory-current-eyebrow"><SparkleMark />此刻想核对的细节<span>待确认</span></div>
            <h3>{latestAssistant.content}</h3>
            {latestProposal && <div className="memory-proposal"><p>{latestProposal.description}</p>{latestProposal.basis && <small>依据原文：{latestProposal.basis}</small>}<span className="memory-choice-hint">{latestProposal.mode === "single" ? "选择最贴近记忆的一项，点击即提交" : "可以勾选多项，再统一确认"}</span></div>}
          </section>
        )}

        {isProcessing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex justify-start"
          >
            <div className="bg-white/10 rounded-2xl px-4 py-3">
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="w-2 h-2 rounded-full bg-white/40"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {!isComplete && (
        <div className="p-4 border-t border-white/10">
          {latestProposal && !isProcessing && (
            <div className="memory-probe-choices">
              {latestProposal.options.length > 0 && (
                <div className="memory-probe-options">
                  {latestProposal.options.map((option) => {
                    const selected = selectedOptions.includes(option.id);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={selected}
                        className={selected ? "is-selected" : ""}
                        onClick={() => {
                          if (latestProposal.mode === "single") {
                            sendAnswer(`选择「${option.label}」，以此补充刚才核对的画面。`);
                          } else {
                            setSelectedOptions((current) => selected ? current.filter((id) => id !== option.id) : [...current, option.id]);
                          }
                        }}
                      >
                        <span className="memory-probe-option-check">{selected ? <Check size={12} /> : option.id.toUpperCase()}</span>
                        <span>{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="memory-probe-decisions">
                {latestProposal.mode === "multiple" && <button type="button" className="is-confirm" disabled={!selectedOptions.length} onClick={() => sendAnswer(`这些描述符合记忆：${latestProposal.options.filter((option) => selectedOptions.includes(option.id)).map((option) => option.label).join("；")}。`)}><Check size={13} />确认所选</button>}
                <button type="button" onClick={() => sendAnswer(`不符合这个候选：${latestProposal.description}。请换一个线索，不要把它当作事实。`)}><Pencil size={13} />都不符合</button>
                <button type="button" onClick={() => sendAnswer(`记不清这个细节：${latestProposal.description}。请换一个角度，或结束补全。`)}><CircleHelp size={13} />记不清</button>
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2 items-end">
            {!latestProposal && !isProcessing && <p className="memory-free-answer-hint">没有可靠候选，直接按你的记忆回答即可。</p>}
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={latestProposal ? "纠正或补充这个画面（可选）…" : "输入你的回答…"}
              disabled={isProcessing}
              rows={1}
              className="flex-1 bg-white/[0.04] border border-white/10 rounded-[var(--radius-dream)] px-4 py-3 text-sm text-white placeholder-white/32 focus:outline-none focus:ring-1 focus:ring-white/20 resize-none disabled:opacity-50"
            />

            <button
              onClick={handleSendText}
              disabled={!inputText.trim() || isProcessing}
              className="w-10 h-10 rounded-[var(--radius-dream)] bg-[#f0f1f7] text-[#0a0912] hover:bg-white flex items-center justify-center transition-colors shrink-0 disabled:opacity-45"
              title="发送"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      )}

      {isComplete && (
        <div className="p-4 border-t border-white/10">
          <p className="text-center text-sm text-white/42">记忆补全已完成</p>
        </div>
      )}
    </div>
  );
}

function SparkleMark() {
  return <span className="memory-sparkle-mark" aria-hidden>✧</span>;
}
