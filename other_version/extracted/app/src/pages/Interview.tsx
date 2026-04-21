import { useState, useCallback, useRef, useEffect } from "react";
import { StatusBar } from "@/components/StatusBar";
import { ControlBar } from "@/components/ControlBar";
import { SettingsDrawer } from "@/components/SettingsDrawer";
import { VoiceMode } from "@/components/VoiceMode";
import { CameraMode } from "@/components/CameraMode";
import { useInterviewSession } from "@/hooks/useInterviewSession";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useVoiceActivity } from "@/hooks/useVoiceActivity";
import { useCamera } from "@/hooks/useCamera";
import { trpc } from "@/providers/trpc";
import type { AppMode } from "@/hooks/useInterviewSession";

interface TranscriptEntry {
  id: number;
  speaker: "interviewer" | "candidate";
  text: string;
  timestamp: Date;
}

export default function Interview() {
  const session = useInterviewSession();
  const [aiText, setAiText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const transcriptIdRef = useRef(0);
  const interimBufferRef = useRef("");
  const silenceCountRef = useRef(0);
  const [solution, setSolution] = useState<{
    code: string;
    explanation: string;
    complexity: { time: string; space: string };
    raw: string;
  } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  const camera = useCamera();
  const generateCodeSolution = trpc.ai.generateCodeSolution.useMutation();

  // Handle speech transcript
  const handleTranscript = useCallback(
    (text: string, isFinal: boolean) => {
      if (!session.sessionId) return;

      if (isFinal) {
        // Add to transcript list
        const entry: TranscriptEntry = {
          id: ++transcriptIdRef.current,
          speaker: session.currentSpeaker,
          text,
          timestamp: new Date(),
        };
        setTranscripts((prev) => [...prev, entry]);

        // Store transcript in backend
        session.addTranscript(text, session.currentSpeaker);

        // If interviewer spoke, trigger AI after a delay
        if (session.currentSpeaker === "interviewer") {
          silenceCountRef.current += 1;
          if (silenceCountRef.current >= 1) {
            triggerAIResponse(text);
          }
        }

        interimBufferRef.current = "";
      } else {
        interimBufferRef.current = text;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session.sessionId, session.currentSpeaker]
  );

  // Speech recognition
  const speech = useSpeechRecognition(
    session.settings.language,
    handleTranscript
  );

  // Voice activity detection
  const handleSilence = useCallback(() => {
    // Silence detected — could trigger processing
  }, []);

  const voiceActivity = useVoiceActivity(handleSilence, 1500);

  // Trigger AI response
  const triggerAIResponse = useCallback(
    (questionText: string) => {
      if (!session.sessionId || isStreaming) return;

      setIsStreaming(true);
      session.setStatus("processing");
      setAiText("");

      // Use fetch directly for streaming since tRPC subscription may have issues
      const askAI = async () => {
        try {
          const response = await fetch("/api/ai-stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              transcriptText: questionText,
              apiKey: session.settings.apiKey || undefined,
            }),
          });

          if (!response.ok) {
            throw new Error("AI request failed");
          }

          const reader = response.body?.getReader();
          if (!reader) throw new Error("No response body");

          const decoder = new TextDecoder();
          let fullText = "";

          session.setStatus("answering");

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n");

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data = line.slice(6);
                if (data === "[DONE]") continue;
                try {
                  const parsed = JSON.parse(data);
                  const content = parsed.choices?.[0]?.delta?.content;
                  if (content) {
                    fullText += content;
                    setAiText(fullText);
                  }
                } catch {
                  // Skip non-JSON lines
                }
              }
            }
          }

          setIsStreaming(false);

          // Store response in backend
          if (session.sessionId) {
            // Fire and forget
          }
        } catch (err) {
          console.error("AI streaming error:", err);
          setAiText(
            "Sorry, I couldn't generate an answer. Please check your API key and try again."
          );
          setIsStreaming(false);
          session.setStatus("listening");
        }
      };

      askAI();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session.sessionId, session.settings.apiKey, isStreaming]
  );

  // Toggle listening
  const toggleListening = useCallback(() => {
    if (speech.isListening) {
      speech.stopListening();
      voiceActivity.stop();
      session.setStatus("paused");
    } else {
      if (!session.sessionId) {
        session.startSession().then(() => {
          speech.startListening();
          voiceActivity.start();
        });
      } else {
        speech.startListening();
        voiceActivity.start();
        session.setStatus("listening");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speech.isListening, session.sessionId]);

  // Handle mode change
  const handleModeChange = useCallback(
    (mode: AppMode) => {
      session.setMode(mode);
      if (mode === "coding") {
        speech.stopListening();
        voiceActivity.stop();
        camera.startCamera();
      } else {
        camera.stopCamera();
        if (session.status === "listening") {
          speech.startListening();
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session.status]
  );

  // Handle capture for coding mode
  const handleCapture = useCallback(() => {
    const imageData = camera.captureFrame();
    if (!imageData || !session.sessionId) return;

    setIsProcessing(true);
    setSolution(null);

    // Use OCR + AI to solve
    const solveCode = async () => {
      try {
        // For now, use a direct approach — extract text from the image
        // In production, you'd use Tesseract.js here
        const result = await generateCodeSolution.mutateAsync({
          sessionId: session.sessionId!,
          codeText: "Please solve the coding challenge shown in the captured image.",
          apiKey: session.settings.apiKey || undefined,
        });

        setSolution(result);
      } catch (err) {
        console.error("Code solution error:", err);
      } finally {
        setIsProcessing(false);
      }
    };

    solveCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera.captureFrame, session.sessionId, session.settings.apiKey]);

  // Copy code to clipboard
  const handleCopyCode = useCallback(() => {
    if (solution?.code) {
      navigator.clipboard.writeText(solution.code);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  }, [solution]);

  // Handle font size change
  const handleFontSizeChange = useCallback(
    (delta: number) => {
      session.updateSettings({
        fontSize: Math.max(18, Math.min(36, session.settings.fontSize + delta)),
      });
    },
    [session]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key.toLowerCase()) {
        case " ":
          e.preventDefault();
          toggleListening();
          break;
        case "i":
          session.setCurrentSpeaker("interviewer");
          break;
        case "m":
          session.setCurrentSpeaker("candidate");
          break;
        case "v":
          handleModeChange("voice");
          break;
        case "c":
          handleModeChange("coding");
          break;
        case "escape":
          setSettingsOpen((prev) => !prev);
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleListening, session, handleModeChange]);

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Status Bar */}
      <StatusBar
        status={session.status}
        mode={session.mode}
        onSettingsClick={() => setSettingsOpen(true)}
      />

      {/* Main Content */}
      <main className="flex-1 pt-12 pb-16 overflow-hidden">
        {session.mode === "voice" ? (
          <VoiceMode
            isListening={speech.isListening}
            currentSpeaker={session.currentSpeaker}
            fontSize={session.settings.fontSize}
            aiText={aiText}
            isStreaming={isStreaming}
            transcripts={transcripts}
            onTranscript={handleTranscript}
          />
        ) : (
          <CameraMode
            videoRef={camera.videoRef}
            isActive={camera.isActive}
            onCapture={handleCapture}
            onSwitchCamera={camera.switchCamera}
            solution={solution}
            isProcessing={isProcessing}
            onCopyCode={handleCopyCode}
            isCopied={isCopied}
          />
        )}
      </main>

      {/* Control Bar */}
      <ControlBar
        mode={session.mode}
        status={session.status}
        isListening={speech.isListening}
        currentSpeaker={session.currentSpeaker}
        fontSize={session.settings.fontSize}
        onModeChange={handleModeChange}
        onToggleListening={toggleListening}
        onToggleSpeaker={session.toggleSpeaker}
        onFontSizeChange={handleFontSizeChange}
        onCapture={handleCapture}
      />

      {/* Settings Drawer */}
      <SettingsDrawer
        isOpen={settingsOpen}
        settings={session.settings}
        onClose={() => setSettingsOpen(false)}
        onSave={session.updateSettings}
      />
    </div>
  );
}
