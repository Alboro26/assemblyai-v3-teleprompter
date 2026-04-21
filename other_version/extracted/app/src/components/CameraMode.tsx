import { useState } from "react";
import { Camera, SwitchCamera, Copy, Check, Loader2, Code2, Clock, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface CodeSolution {
  code: string;
  explanation: string;
  complexity: {
    time: string;
    space: string;
  };
  raw: string;
}

interface CameraModeProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isActive: boolean;
  onCapture: () => void;
  onSwitchCamera: () => void;
  solution: CodeSolution | null;
  isProcessing: boolean;
  onCopyCode: () => void;
  isCopied: boolean;
}

export function CameraMode({
  videoRef,
  isActive,
  onCapture,
  onSwitchCamera,
  solution,
  isProcessing,
  onCopyCode,
  isCopied,
}: CameraModeProps) {
  const [showExplanation] = useState(true);

  // Simple syntax highlighting
  const highlightCode = (code: string) => {
    // Split by common token patterns
    const tokens = code.split(/(\s+|[{}();,]|\b\d+\b|"[^"]*"|'[^']*'|\b(?:function|const|let|var|return|if|else|for|while|class|import|export|from|async|await|new|this|true|false|null|undefined|try|catch|throw|def|print|class|import|return|if|else|for|in|while|try|except|with|as|lambda|yield|pass|break|continue)\b|[+\-*/=<>!&|]+)/g);
    
    return tokens.map((token, i) => {
      if (!token) return null;
      if (/^\s+$/.test(token)) {
        return <span key={i}>{token}</span>;
      }
      if (/^\b(?:function|const|let|var|return|if|else|for|while|class|import|export|from|async|await|new|this|true|false|null|undefined|try|catch|throw|def|print|class|import|return|if|else|for|in|while|try|except|with|as|lambda|yield|pass|break|continue)\b$/.test(token)) {
        return <span key={i} className="text-[#C792EA]">{token}</span>;
      }
      if (/^"[^"]*"$/.test(token) || /^'[^']*'$/.test(token)) {
        return <span key={i} className="text-[#C3E88D]">{token}</span>;
      }
      if (/^\d+$/.test(token)) {
        return <span key={i} className="text-[#F78C6C]">{token}</span>;
      }
      if (/^[{}();,]+$/.test(token)) {
        return <span key={i} className="text-[#89DDFF]">{token}</span>;
      }
      if (/^[+\-*/=<>!&|]+$/.test(token)) {
        return <span key={i} className="text-[#89DDFF]">{token}</span>;
      }
      if (/^\/$/.test(token) || /^\/$/.test(token)) {
        return <span key={i} className="text-[#89DDFF]">{token}</span>;
      }
      return <span key={i}>{token}</span>;
    });
  };

  return (
    <div className="flex flex-col h-full lg:flex-row">
      {/* Camera Preview */}
      <div className="relative lg:w-2/5 h-64 lg:h-full bg-black/50 border-b lg:border-b-0 lg:border-r border-border/50">
        {isActive ? (
          <>
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              muted
              playsInline
            />
            {/* Frame guides */}
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute top-4 left-4 w-8 h-8 border-l-2 border-t-2 border-primary/50 rounded-tl-sm" />
              <div className="absolute top-4 right-4 w-8 h-8 border-r-2 border-t-2 border-primary/50 rounded-tr-sm" />
              <div className="absolute bottom-4 left-4 w-8 h-8 border-l-2 border-b-2 border-primary/50 rounded-bl-sm" />
              <div className="absolute bottom-4 right-4 w-8 h-8 border-r-2 border-b-2 border-primary/50 rounded-br-sm" />
            </div>
            {/* Controls overlay */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3">
              <Button
                variant="outline"
                size="icon"
                className="w-10 h-10 rounded-full bg-black/50 border-white/20 text-white hover:bg-black/70"
                onClick={onSwitchCamera}
              >
                <SwitchCamera className="w-4 h-4" />
              </Button>
              <Button
                variant="default"
                size="icon"
                className="w-14 h-14 rounded-full bg-gradient-to-br from-primary to-blue-400 text-primary-foreground border-0 shadow-lg"
                onClick={onCapture}
              >
                <Camera className="w-6 h-6" />
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <Camera className="w-10 h-10 opacity-30" />
            <p className="text-sm">Camera not active</p>
          </div>
        )}
      </div>

      {/* Solution Panel */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Processing overlay */}
        {isProcessing && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">
              Analyzing code challenge...
            </p>
          </div>
        )}

        {/* Solution display */}
        {!isProcessing && solution && (
          <>
            {/* Code block */}
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="flex items-center justify-between px-4 py-2 bg-secondary/50 border-b border-border/30">
                <div className="flex items-center gap-2">
                  <Code2 className="w-4 h-4 text-primary" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Solution
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={onCopyCode}
                >
                  {isCopied ? (
                    <>
                      <Check className="w-3 h-3" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
              <ScrollArea className="flex-1">
                <pre className="p-4 text-sm leading-relaxed font-mono bg-[#0E0E12]">
                  <code>{highlightCode(solution.code)}</code>
                </pre>
              </ScrollArea>
            </div>

            {/* Explanation + Complexity */}
            {showExplanation && (
              <div className="border-t border-border/50 bg-card/30 p-4 space-y-3">
                {solution.explanation && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                      Explanation
                    </h4>
                    <p className="text-sm text-foreground/80 leading-relaxed">
                      {solution.explanation}
                    </p>
                  </div>
                )}
                <div className="flex gap-4">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-xs text-muted-foreground">
                      Time:{" "}
                    </span>
                    <span className="text-xs font-medium text-foreground">
                      {solution.complexity.time}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-xs text-muted-foreground">
                      Space:{" "}
                    </span>
                    <span className="text-xs font-medium text-foreground">
                      {solution.complexity.space}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Empty state */}
        {!isProcessing && !solution && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <div className="w-16 h-16 rounded-2xl bg-secondary/50 flex items-center justify-center">
              <Code2 className="w-8 h-8 opacity-30" />
            </div>
            <p className="text-sm max-w-xs text-center">
              Point your camera at a coding challenge and tap the capture button
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
