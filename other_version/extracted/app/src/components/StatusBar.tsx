import { Mic, Settings, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AppStatus, AppMode } from "@/hooks/useInterviewSession";

interface StatusBarProps {
  status: AppStatus;
  mode: AppMode;
  onSettingsClick: () => void;
}

export function StatusBar({ status, mode, onSettingsClick }: StatusBarProps) {
  const statusConfig = {
    idle: {
      label: "Ready",
      dot: "bg-muted-foreground",
      animate: "",
    },
    listening: {
      label: "Listening",
      dot: "bg-emerald-400",
      animate: "animate-listening-pulse",
    },
    processing: {
      label: "Processing",
      dot: "bg-amber-400",
      animate: "animate-processing-spin",
    },
    answering: {
      label: "Answering",
      dot: "bg-primary",
      animate: "animate-glow-pulse",
    },
    paused: {
      label: "Paused",
      dot: "bg-muted-foreground",
      animate: "",
    },
  };

  const config = statusConfig[status];

  return (
    <div className="fixed top-0 left-0 right-0 h-12 bg-background/80 backdrop-blur-xl border-b border-border/50 z-50 flex items-center justify-between px-4">
      {/* Left: Status */}
      <div className="flex items-center gap-3">
        <div className="relative flex items-center justify-center w-5 h-5">
          <div
            className={`w-2.5 h-2.5 rounded-full ${config.dot} ${config.animate}`}
          />
          {status === "listening" && (
            <div
              className={`absolute w-2.5 h-2.5 rounded-full bg-emerald-400 ${config.animate}`}
            />
          )}
        </div>
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {config.label}
        </span>
        {mode === "voice" && status !== "idle" && (
          <div className="flex items-center gap-1.5 ml-2">
            <Radio className="w-3 h-3 text-primary" />
            <span className="text-[10px] uppercase tracking-wider text-primary/70">
              Voice
            </span>
          </div>
        )}
        {mode === "coding" && status !== "idle" && (
          <div className="flex items-center gap-1.5 ml-2">
            <Mic className="w-3 h-3 text-primary" />
            <span className="text-[10px] uppercase tracking-wider text-primary/70">
              Camera
            </span>
          </div>
        )}
      </div>

      {/* Center: Logo */}
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
        <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-primary to-blue-400 flex items-center justify-center">
          <span className="text-[10px] font-bold text-primary-foreground">IC</span>
        </div>
        <span className="text-sm font-semibold tracking-tight text-foreground/80 hidden sm:block">
          Copilot
        </span>
      </div>

      {/* Right: Settings */}
      <Button
        variant="ghost"
        size="icon"
        className="w-8 h-8 rounded-lg hover:bg-secondary"
        onClick={onSettingsClick}
      >
        <Settings className="w-4 h-4 text-muted-foreground" />
      </Button>
    </div>
  );
}
