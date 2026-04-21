import {
  Mic,
  MicOff,
  Camera,
  Type,
  UserCircle,
  User,
  Plus,
  Minus,
  Aperture,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AppMode, AppStatus } from "@/hooks/useInterviewSession";

interface ControlBarProps {
  mode: AppMode;
  status: AppStatus;
  isListening: boolean;
  currentSpeaker: "interviewer" | "candidate";
  fontSize: number;
  onModeChange: (mode: AppMode) => void;
  onToggleListening: () => void;
  onToggleSpeaker: () => void;
  onFontSizeChange: (delta: number) => void;
  onCapture?: () => void;
}

export function ControlBar({
  mode,
  status,
  isListening,
  currentSpeaker,
  fontSize,
  onModeChange,
  onToggleListening,
  onToggleSpeaker,
  onFontSizeChange,
  onCapture,
}: ControlBarProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 h-16 bg-background/90 backdrop-blur-xl border-t border-border/50 z-50 flex items-center justify-between px-4">
      {/* Left: Mic + Speaker */}
      <div className="flex items-center gap-2">
        <Button
          variant={isListening ? "default" : "outline"}
          size="icon"
          className={`w-10 h-10 rounded-xl ${
            isListening
              ? "bg-gradient-to-br from-primary to-blue-400 text-primary-foreground border-0"
              : "border-border/50 hover:bg-secondary"
          }`}
          onClick={onToggleListening}
        >
          {isListening ? (
            <Mic className="w-4 h-4" />
          ) : (
            <MicOff className="w-4 h-4" />
          )}
        </Button>

        {mode === "voice" && status !== "idle" && (
          <Button
            variant="outline"
            size="sm"
            className={`h-10 rounded-xl border-border/50 gap-2 text-xs font-medium ${
              currentSpeaker === "interviewer"
                ? "bg-primary/10 border-primary/30 text-primary"
                : "hover:bg-secondary"
            }`}
            onClick={onToggleSpeaker}
          >
            {currentSpeaker === "interviewer" ? (
              <>
                <UserCircle className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Interviewer</span>
              </>
            ) : (
              <>
                <User className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">You</span>
              </>
            )}
          </Button>
        )}
      </div>

      {/* Center: Mode Toggle */}
      <div className="flex items-center bg-secondary/50 rounded-xl p-0.5 border border-border/30">
        <Button
          variant={mode === "voice" ? "secondary" : "ghost"}
          size="sm"
          className={`h-8 rounded-lg gap-1.5 text-xs font-medium ${
            mode === "voice"
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => onModeChange("voice")}
        >
          <Type className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Voice</span>
        </Button>
        <Button
          variant={mode === "coding" ? "secondary" : "ghost"}
          size="sm"
          className={`h-8 rounded-lg gap-1.5 text-xs font-medium ${
            mode === "coding"
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => onModeChange("coding")}
        >
          <Camera className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Camera</span>
        </Button>
      </div>

      {/* Right: Font Size / Capture */}
      <div className="flex items-center gap-2">
        {mode === "voice" ? (
          <>
            <Button
              variant="outline"
              size="icon"
              className="w-8 h-8 rounded-lg border-border/50 hover:bg-secondary"
              onClick={() => onFontSizeChange(-2)}
            >
              <Minus className="w-3.5 h-3.5" />
            </Button>
            <span className="text-xs font-medium text-muted-foreground w-8 text-center">
              {fontSize}px
            </span>
            <Button
              variant="outline"
              size="icon"
              className="w-8 h-8 rounded-lg border-border/50 hover:bg-secondary"
              onClick={() => onFontSizeChange(2)}
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
          </>
        ) : (
          <Button
            variant="default"
            size="sm"
            className="h-10 rounded-xl bg-gradient-to-br from-primary to-blue-400 text-primary-foreground border-0 gap-2"
            onClick={onCapture}
          >
            <Aperture className="w-4 h-4" />
            <span className="hidden sm:inline">Capture</span>
          </Button>
        )}
      </div>
    </div>
  );
}
