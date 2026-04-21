import { create } from "zustand";
import type { Dream, DreamFlowStep, ProbeMessage } from "@/types/dream";

interface DreamState {
  currentStep: DreamFlowStep;
  currentDream: Dream | null;
  probeMessages: ProbeMessage[];
  isRecording: boolean;
  recordingDuration: number;
  rawText: string;
  isProcessing: boolean;
  audioBlobUrl: string;
  audioFileName: string;

  setCurrentStep: (step: DreamFlowStep) => void;
  setCurrentDream: (dream: Dream | null) => void;
  addProbeMessage: (message: ProbeMessage) => void;
  setProbeMessages: (messages: ProbeMessage[]) => void;
  setIsRecording: (isRecording: boolean) => void;
  setRecordingDuration: (duration: number) => void;
  setRawText: (text: string) => void;
  setIsProcessing: (isProcessing: boolean) => void;
  setAudioBlobUrl: (url: string) => void;
  setAudioFileName: (name: string) => void;
  updateDreamStructured: (structured: Dream["structured"]) => void;
  reset: () => void;
}

const initialState = {
  currentStep: "recording" as DreamFlowStep,
  currentDream: null,
  probeMessages: [],
  isRecording: false,
  recordingDuration: 0,
  rawText: "",
  isProcessing: false,
  audioBlobUrl: "",
  audioFileName: "",
};

export const useDreamStore = create<DreamState>((set) => ({
  ...initialState,

  setCurrentStep: (step) => set({ currentStep: step }),
  setCurrentDream: (dream) => set({ currentDream: dream }),
  addProbeMessage: (message) =>
    set((state) => ({ probeMessages: [...state.probeMessages, message] })),
  setProbeMessages: (messages) => set({ probeMessages: messages }),
  setIsRecording: (isRecording) => set({ isRecording }),
  setRecordingDuration: (duration) => set({ recordingDuration: duration }),
  setRawText: (text) => set({ rawText: text }),
  setIsProcessing: (isProcessing) => set({ isProcessing }),
  setAudioBlobUrl: (url) => set({ audioBlobUrl: url }),
  setAudioFileName: (name) => set({ audioFileName: name }),
  updateDreamStructured: (structured) =>
    set((state) => {
      if (!state.currentDream) return state;
      return {
        currentDream: { ...state.currentDream, structured },
      };
    }),
  reset: () => set(initialState),
}));
