"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, Square, Pause, Play } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface VoiceRecorderProps {
  onRecordingComplete: (audioBlob: Blob, duration: number, transcript: string) => void;
  disabled?: boolean;
}

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message: string;
}

interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

export default function VoiceRecorder({ onRecordingComplete, disabled }: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [liveTranscript, setLiveTranscript] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const transcriptRef = useRef<string>("");
  const durationRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (recognitionRef.current) recognitionRef.current.abort();
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
        },
      });
      streamRef.current = stream;

      /** 豆包极速版支持 WAV/MP3/OGG OPUS；优先 OGG Opus 以便服务端识别（WebM 常不被支持） */
      const preferredTypes = [
        "audio/ogg;codecs=opus",
        "audio/ogg",
        "audio/webm;codecs=opus",
        "audio/webm",
      ];
      let recordMime = preferredTypes.find((t) => MediaRecorder.isTypeSupported(t)) || "audio/webm";
      let mediaRecorder: MediaRecorder;
      try {
        mediaRecorder = new MediaRecorder(stream, { mimeType: recordMime });
      } catch {
        mediaRecorder = new MediaRecorder(stream);
        recordMime = mediaRecorder.mimeType || "audio/webm";
      }

      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recordMime });
        const finalTranscript = transcriptRef.current;
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        onRecordingComplete(blob, durationRef.current, finalTranscript);
      };

      mediaRecorder.start(1000);
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      setIsPaused(false);
      setDuration(0);
      transcriptRef.current = "";
      setLiveTranscript("");

      timerRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);

      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.lang = "zh-CN";
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        recognition.onresult = (event: SpeechRecognitionEvent) => {
          let interimTranscript = "";
          let finalTranscript = "";

          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            if (result.isFinal) {
              finalTranscript += result[0].transcript;
            } else {
              interimTranscript += result[0].transcript;
            }
          }

          if (finalTranscript) {
            transcriptRef.current += finalTranscript;
          }

          setLiveTranscript(transcriptRef.current + (interimTranscript ? interimTranscript : ""));
        };

        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
          console.warn("Speech recognition error:", event.error);
        };

        recognition.onend = () => {
          if (mediaRecorderRef.current?.state === "recording") {
            try {
              recognition.start();
            } catch {
              // already started
            }
          }
        };

        recognition.start();
        recognitionRef.current = recognition;
      }
    } catch (error) {
      console.error("Failed to start recording:", error);
    }
  }, [onRecordingComplete]);

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [isRecording]);

  const togglePause = useCallback(() => {
    if (!mediaRecorderRef.current) return;

    if (isPaused) {
      mediaRecorderRef.current.resume();
      timerRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
      if (recognitionRef.current) {
        try { recognitionRef.current.start(); } catch { /* */ }
      }
    } else {
      mediaRecorderRef.current.pause();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { /* */ }
      }
    }
    setIsPaused(!isPaused);
  }, [isPaused]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex flex-col items-center gap-6">
      <AnimatePresence mode="wait">
        {isRecording && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="flex flex-col items-center gap-4"
          >
            <div className="relative">
              <motion.div
                className="absolute inset-0 rounded-full bg-red-500/20"
                animate={{ scale: [1, 1.3, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
              <div className="relative w-32 h-32 rounded-full bg-red-500/10 flex items-center justify-center border-2 border-red-500/50">
                <motion.div
                  className="flex gap-1 items-end h-8"
                  animate={isPaused ? {} : { opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 0.8, repeat: Infinity }}
                >
                  {[1, 2, 3, 4, 5].map((i) => (
                    <motion.div
                      key={i}
                      className="w-1 bg-red-500 rounded-full"
                      animate={
                        isPaused
                          ? { height: 8 }
                          : {
                              height: [8, 24 + Math.random() * 16, 8],
                            }
                      }
                      transition={{
                        duration: 0.5 + Math.random() * 0.3,
                        repeat: Infinity,
                        delay: i * 0.1,
                      }}
                    />
                  ))}
                </motion.div>
              </div>
            </div>

            <p className="text-2xl font-mono text-white/80">{formatTime(duration)}</p>

            {liveTranscript && (
              <div className="w-full max-w-md rounded-xl bg-white/5 border border-white/10 p-3 max-h-32 overflow-y-auto">
                <p className="text-xs text-white/40 mb-1">实时识别</p>
                <p className="text-sm text-white/70 leading-relaxed">{liveTranscript}</p>
              </div>
            )}

            <div className="flex gap-4">
              <button
                onClick={togglePause}
                className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
              >
                {isPaused ? <Play size={20} /> : <Pause size={20} />}
              </button>
              <button
                onClick={stopRecording}
                className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-colors"
              >
                <Square size={24} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!isRecording && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          onClick={startRecording}
          disabled={disabled}
          className="group w-32 h-32 rounded-full border-2 border-white/18 bg-white/[0.06] flex items-center justify-center shadow-[0_0_0_1px_rgba(255,255,255,0.04)] transition-colors duration-200 hover:border-white/28 hover:bg-white/[0.1] disabled:opacity-45 disabled:cursor-not-allowed"
          title="开始口述"
        >
          <Mic
            size={48}
            className="text-[#f0f1fa] transition-colors group-hover:text-white"
            strokeWidth={1.25}
          />
        </motion.button>
      )}

      {!isRecording && (
        <p className="text-dream-subtle text-sm text-center max-w-xs leading-relaxed">
          点一下，像俯身贴近水面——把梦说出来就好。
        </p>
      )}
    </div>
  );
}
