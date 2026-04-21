import { useState } from "react";
import {
  X,
  Key,
  Bot,
  Type,
  Gauge,
  Globe,
  Trash2,
  Save,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { InterviewSettings } from "@/hooks/useInterviewSession";

interface SettingsDrawerProps {
  isOpen: boolean;
  settings: InterviewSettings;
  onClose: () => void;
  onSave: (settings: InterviewSettings) => void;
}

export function SettingsDrawer({
  isOpen,
  settings,
  onClose,
  onSave,
}: SettingsDrawerProps) {
  const [localSettings, setLocalSettings] = useState<InterviewSettings>(settings);
  const [showApiKey, setShowApiKey] = useState(false);

  if (!isOpen) return null;

  const handleSave = () => {
    onSave(localSettings);
    onClose();
  };

  const handleClear = () => {
    localStorage.removeItem("interview_settings");
    localStorage.removeItem("interview_transcripts");
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 animate-fade-in"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-card border-l border-border shadow-2xl z-50 flex flex-col animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/50">
          <h2 className="text-lg font-semibold">Settings</h2>
          <Button
            variant="ghost"
            size="icon"
            className="w-8 h-8 rounded-lg"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* API Key */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-primary" />
              <Label className="text-sm font-medium">OpenAI API Key</Label>
            </div>
            <div className="relative">
              <Input
                type={showApiKey ? "text" : "password"}
                placeholder="sk-..."
                value={localSettings.apiKey}
                onChange={(e) =>
                  setLocalSettings((prev) => ({
                    ...prev,
                    apiKey: e.target.value,
                  }))
                }
                className="pr-20 bg-secondary/50 border-border/50"
              />
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 text-xs"
                onClick={() => setShowApiKey(!showApiKey)}
              >
                {showApiKey ? "Hide" : "Show"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Your API key is stored locally and never shared.
            </p>
          </div>

          {/* AI Model */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-primary" />
              <Label className="text-sm font-medium">AI Model</Label>
            </div>
            <Select
              value={localSettings.aiModel}
              onValueChange={(value) =>
                setLocalSettings((prev) => ({ ...prev, aiModel: value }))
              }
            >
              <SelectTrigger className="bg-secondary/50 border-border/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gpt-4o-mini">GPT-4o Mini (Fast)</SelectItem>
                <SelectItem value="gpt-4o">GPT-4o (Best)</SelectItem>
                <SelectItem value="gpt-4-turbo">GPT-4 Turbo</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Font Size */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Type className="w-4 h-4 text-primary" />
              <Label className="text-sm font-medium">
                Teleprompter Font Size
              </Label>
            </div>
            <div className="flex items-center gap-4">
              <Slider
                value={[localSettings.fontSize]}
                onValueChange={([value]) =>
                  setLocalSettings((prev) => ({ ...prev, fontSize: value }))
                }
                min={18}
                max={36}
                step={1}
                className="flex-1"
              />
              <span className="text-sm text-muted-foreground w-10 text-right">
                {localSettings.fontSize}px
              </span>
            </div>
          </div>

          {/* Scroll Speed */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Gauge className="w-4 h-4 text-primary" />
              <Label className="text-sm font-medium">Scroll Speed (WPM)</Label>
            </div>
            <div className="flex items-center gap-4">
              <Slider
                value={[localSettings.scrollSpeed]}
                onValueChange={([value]) =>
                  setLocalSettings((prev) => ({ ...prev, scrollSpeed: value }))
                }
                min={80}
                max={200}
                step={10}
                className="flex-1"
              />
              <span className="text-sm text-muted-foreground w-10 text-right">
                {localSettings.scrollSpeed}
              </span>
            </div>
          </div>

          {/* Language */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-primary" />
              <Label className="text-sm font-medium">Speech Language</Label>
            </div>
            <Select
              value={localSettings.language}
              onValueChange={(value) =>
                setLocalSettings((prev) => ({ ...prev, language: value }))
              }
            >
              <SelectTrigger className="bg-secondary/50 border-border/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en-US">English (US)</SelectItem>
                <SelectItem value="en-GB">English (UK)</SelectItem>
                <SelectItem value="es-ES">Spanish</SelectItem>
                <SelectItem value="fr-FR">French</SelectItem>
                <SelectItem value="de-DE">German</SelectItem>
                <SelectItem value="zh-CN">Chinese</SelectItem>
                <SelectItem value="ja-JP">Japanese</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Divider */}
          <div className="border-t border-border/50 pt-4">
            <div className="flex items-center gap-2 text-destructive mb-3">
              <AlertTriangle className="w-4 h-4" />
              <Label className="text-sm font-medium">Danger Zone</Label>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full border-destructive/30 text-destructive hover:bg-destructive/10 gap-2"
              onClick={handleClear}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear All Data
            </Button>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border/50">
          <Button
            className="w-full bg-gradient-to-r from-primary to-blue-400 text-primary-foreground gap-2"
            onClick={handleSave}
          >
            <Save className="w-4 h-4" />
            Save Settings
          </Button>
        </div>
      </div>
    </>
  );
}
