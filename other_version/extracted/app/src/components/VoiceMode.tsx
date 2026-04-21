import { useState, useRef, useEffect } from "react";
import { Teleprompter } from "./Teleprompter";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Mic, UserCircle, User, Sparkles } from "lucide-react";

interface TranscriptEntry {
  id: number;
  speaker: "interviewer" | "candidate";
  text: string;
  timestamp: Date;
}

interface VoiceModeProps {
  isListening: boolean;
  currentSpeaker: "interviewer" | "candidate";
  fontSize: number;
  aiText: string;
  isStreaming: boolean;
  transcripts: TranscriptEntry[];
  onTranscript: (text: string, isFinal: boolean) => void;
}

export function VoiceMode({
  isListening,
  currentSpeaker,
  fontSize,
  aiText,
  isStreaming,
  transcripts,
}: VoiceModeProps) {
  const [showTranscript, setShowTranscript] = useState(true);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [transcripts]);

  return (
    <div className="flex h-full">
      {/* Transcript Panel */}
      {showTranscript && (
        <div className="w-72 border-r border-border/50 bg-card/30 flex flex-col animate-fade-in">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Transcript
            </span>
            <button
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowTranscript(false)}
            >
              Hide
            </button>
          </div>
          <ScrollArea className="flex-1 px-3 py-2">
            <div className="space-y-3">
              {transcripts.length === 0 && (
                <div className="text-center py-8">
                  <Mic className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground/50">
                    Start speaking to see transcripts
                  </p>
                </div>
              )}
              {transcripts.map((entry) => (
                <div
                  key={entry.id}
                  className="animate-text-appear flex gap-2 items-start"
                >
                  <div
                    className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${
                      entry.speaker === "interviewer"
                        ? "bg-primary/20"
                        : "bg-blue-400/20"
                    }`}
                  >
                    {entry.speaker === "interviewer" ? (
                      <UserCircle className="w-3 h-3 text-primary" />
                    ) : (
                      <User className="w-3 h-3 text-blue-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span
                        className={`text-[10px] font-semibold uppercase tracking-wider ${
                          entry.speaker === "interviewer"
                            ? "text-primary"
                            : "text-blue-400"
                        }`}
                      >
                        {entry.speaker === "interviewer" ? "INT" : "YOU"}
                      </span>
                      <span className="text-[10px] text-muted-foreground/50">
                        {entry.timestamp.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <p className="text-xs text-foreground/80 leading-relaxed">
                      {entry.text}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={transcriptEndRef} />
            </div>
          </ScrollArea>

          {/* Listening indicator */}
          {isListening && (
            <div className="px-3 py-2 border-t border-border/30">
              <div className="flex items-center gap-2">
                <div className="relative">
                  <div className="w-2 h-2 rounded-full bg-emerald-400" />
                  <div className="absolute inset-0 w-2 h-2 rounded-full bg-emerald-400 animate-listening-pulse" />
                </div>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  {currentSpeaker === "interviewer"
                    ? "Interviewer speaking..."
                    : "You speaking..."}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main Teleprompter */}
      <div className="flex-1 relative">
        {!showTranscript && transcripts.length > 0 && (
          <button
            className="absolute left-4 top-4 z-20 text-[10px] text-muted-foreground hover:text-foreground bg-card/80 backdrop-blur-sm px-2 py-1 rounded-md border border-border/30 transition-colors"
            onClick={() => setShowTranscript(true)}
          >
            Show Transcript
          </button>
        )}

        <Teleprompter
          text={aiText}
          fontSize={fontSize}
          isStreaming={isStreaming}
        />

        {/* AI badge */}
        {aiText && (
          <div className="absolute top-4 right-4 z-20">
            <div className="flex items-center gap-1.5 bg-primary/10 border border-primary/20 px-2.5 py-1 rounded-full">
              <Sparkles className="w-3 h-3 text-primary" />
              <span className="text-[10px] font-medium text-primary">
                AI Generated
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
