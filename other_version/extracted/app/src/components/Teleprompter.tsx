import { useRef, useEffect, useState } from "react";
import { Lightbulb, Sparkles } from "lucide-react";

interface TeleprompterProps {
  text: string;
  fontSize: number;
  isStreaming?: boolean;
}

export function Teleprompter({ text, fontSize, isStreaming }: TeleprompterProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll to bottom when new text arrives
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [text, autoScroll]);

  // Pause auto-scroll on manual interaction
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let scrollTimeout: ReturnType<typeof setTimeout>;

    const handleScroll = () => {
      setAutoScroll(false);
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => setAutoScroll(true), 3000);
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", handleScroll);
      clearTimeout(scrollTimeout);
    };
  }, []);

  // Parse markdown-style bold text
  const renderText = (content: string) => {
    const parts = content.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={i} className="text-foreground font-semibold">
            {part.slice(2, -2)}
          </strong>
        );
      }
      return part;
    });
  };

  // Split into paragraphs
  const paragraphs = text.split("\n").filter(Boolean);

  return (
    <div className="relative w-full h-full flex flex-col">
      {/* Reading guide line */}
      <div className="absolute left-0 right-0 top-1/2 h-[2px] bg-primary/10 pointer-events-none z-10" />

      {/* Top gradient fade */}
      <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-background to-transparent pointer-events-none z-10" />

      {/* Content */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto teleprompter-scroll px-6 sm:px-12 py-16"
        onClick={() => setAutoScroll((prev) => !prev)}
      >
        {text ? (
          <div className="max-w-3xl mx-auto space-y-4">
            {paragraphs.map((paragraph, i) => (
              <p
                key={i}
                className="animate-text-appear text-foreground/90 leading-relaxed"
                style={{ fontSize: `${fontSize}px`, lineHeight: 1.7 }}
              >
                {paragraph.startsWith("- ") || paragraph.startsWith("• ") ? (
                  <span className="flex gap-3">
                    <span className="text-primary mt-1.5 flex-shrink-0">
                      <Sparkles className="w-4 h-4" />
                    </span>
                    <span>{renderText(paragraph.slice(2))}</span>
                  </span>
                ) : (
                  renderText(paragraph)
                )}
              </p>
            ))}
            {isStreaming && (
              <div className="flex items-center gap-2 mt-4">
                <div className="w-1.5 h-4 bg-primary animate-pulse rounded-full" />
                <span className="text-xs text-muted-foreground uppercase tracking-wider">
                  Generating...
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-secondary/50 flex items-center justify-center">
              <Lightbulb className="w-8 h-8 text-muted-foreground/50" />
            </div>
            <p className="text-lg text-muted-foreground/60 max-w-md">
              Ready for your interview. Start speaking and I'll generate answers
              for you.
            </p>
          </div>
        )}
      </div>

      {/* Bottom gradient fade */}
      <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-background to-transparent pointer-events-none z-10" />

      {/* Auto-scroll indicator */}
      {!autoScroll && text && (
        <div className="absolute bottom-4 right-4 z-20">
          <div className="bg-secondary/80 backdrop-blur-sm text-xs text-muted-foreground px-3 py-1.5 rounded-full border border-border/30">
            Auto-scroll paused — tap to resume
          </div>
        </div>
      )}
    </div>
  );
}
