"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Mic, Square } from "lucide-react";
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
  const [isVoiceInput, setIsVoiceInput] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [voiceChunks, setVoiceChunks] = useState<Blob[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendText = () => {
    if (!inputText.trim() || isProcessing) return;
    onSendMessage(inputText.trim(), false);
    setInputText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendText();
    }
  };

  const startVoiceInput = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: "audio/webm" });
        onSendMessage("[语音输入]", true);
        setVoiceChunks([]);
      };

      recorder.start();
      setMediaRecorder(recorder);
      setVoiceChunks(chunks);
      setIsVoiceInput(true);
    } catch (error) {
      console.error("Voice input failed:", error);
    }
  };

  const stopVoiceInput = () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
      setIsVoiceInput(false);
      setMediaRecorder(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <AnimatePresence>
          {messages.map((message) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                  message.role === "user"
                    ? "bg-indigo-500/20 text-indigo-100"
                    : message.role === "system"
                    ? "bg-amber-500/10 text-amber-200 text-sm italic"
                    : "bg-white/10 text-white/90"
                }`}
              >
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

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
          <div className="flex gap-2 items-end">
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入你的回答..."
              disabled={isProcessing}
              rows={1}
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-indigo-500/50 resize-none disabled:opacity-50"
            />

            {isVoiceInput ? (
              <button
                onClick={stopVoiceInput}
                className="w-10 h-10 rounded-xl bg-red-500 hover:bg-red-600 flex items-center justify-center transition-colors shrink-0"
              >
                <Square size={16} />
              </button>
            ) : (
              <button
                onClick={startVoiceInput}
                disabled={isProcessing}
                className="w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors shrink-0 disabled:opacity-50"
              >
                <Mic size={16} />
              </button>
            )}

            <button
              onClick={handleSendText}
              disabled={!inputText.trim() || isProcessing}
              className="w-10 h-10 rounded-xl bg-indigo-500 hover:bg-indigo-600 flex items-center justify-center transition-colors shrink-0 disabled:opacity-50"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      )}

      {isComplete && (
        <div className="p-4 border-t border-white/10">
          <p className="text-center text-sm text-white/40">记忆补全已完成 ✓</p>
        </div>
      )}
    </div>
  );
}
