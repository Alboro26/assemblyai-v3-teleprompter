import { useState, useCallback, useRef } from "react";
import { trpc } from "@/providers/trpc";

export type AppMode = "voice" | "coding";
export type AppStatus = "idle" | "listening" | "processing" | "answering" | "paused";

export interface InterviewSettings {
  apiKey: string;
  aiModel: string;
  fontSize: number;
  scrollSpeed: number;
  language: string;
}

const DEFAULT_SETTINGS: InterviewSettings = {
  apiKey: "",
  aiModel: "gpt-4o-mini",
  fontSize: 28,
  scrollSpeed: 120,
  language: "en-US",
};

export function useInterviewSession() {
  const [mode, setMode] = useState<AppMode>("voice");
  const [status, setStatus] = useState<AppStatus>("idle");
  const [settings, setSettings] = useState<InterviewSettings>(() => {
    const stored = localStorage.getItem("interview_settings");
    return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
  });
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [currentSpeaker, setCurrentSpeaker] = useState<"interviewer" | "candidate">("interviewer");
  const transcriptSequence = useRef(0);

  const createSession = trpc.session.create.useMutation();
  const endSession = trpc.session.end.useMutation();
  const createTranscript = trpc.transcript.create.useMutation();

  const updateSettings = useCallback((updates: Partial<InterviewSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...updates };
      localStorage.setItem("interview_settings", JSON.stringify(next));
      return next;
    });
  }, []);

  const startSession = useCallback(async () => {
    const result = await createSession.mutateAsync({
      mode,
      aiModel: settings.aiModel,
    });
    setSessionId(result.id);
    transcriptSequence.current = 0;
    setStatus("listening");
    return result.id;
  }, [createSession, mode, settings.aiModel]);

  const stopSession = useCallback(async () => {
    if (sessionId) {
      await endSession.mutateAsync({ id: sessionId });
    }
    setSessionId(null);
    setStatus("idle");
  }, [sessionId, endSession]);

  const addTranscript = useCallback(
    async (text: string, speaker: "interviewer" | "candidate") => {
      if (!sessionId) return null;
      transcriptSequence.current += 1;
      return createTranscript.mutateAsync({
        sessionId,
        speaker,
        text,
        sequence: transcriptSequence.current,
      });
    },
    [sessionId, createTranscript]
  );

  const toggleSpeaker = useCallback(() => {
    setCurrentSpeaker((prev) =>
      prev === "interviewer" ? "candidate" : "interviewer"
    );
  }, []);

  return {
    mode,
    setMode,
    status,
    setStatus,
    settings,
    updateSettings,
    sessionId,
    startSession,
    stopSession,
    addTranscript,
    currentSpeaker,
    setCurrentSpeaker,
    toggleSpeaker,
  };
}
