import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Bot, User, Loader2, Sparkles, Map, Compass, Zap, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ChatPanelProps {
  location: { lat: number; lon: number; name: string } | null;
  onToggleLayer?: (layerId: string) => void;
  activeLayers?: string[];
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: string;
}

interface AIModel {
  id: string;
  name: string;
  description: string;
  available: boolean;
  icon: string;
}

const MODEL_ICONS: Record<string, any> = {
  sparkles: Sparkles,
  map: Map,
  compass: Compass,
  bot: Bot,
  zap: Zap,
};

function renderMarkdown(text: string) {
  const lines = text.split("\n");
  const elements: JSX.Element[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("### ")) {
      elements.push(<h3 key={i} className="font-semibold text-xs mt-2 mb-1 text-foreground">{line.slice(4)}</h3>);
    } else if (line.startsWith("## ")) {
      elements.push(<h2 key={i} className="font-semibold text-sm mt-2 mb-1 text-foreground">{line.slice(3)}</h2>);
    } else if (line.startsWith("# ")) {
      elements.push(<h1 key={i} className="font-bold text-sm mt-2 mb-1 text-foreground">{line.slice(2)}</h1>);
    } else if (line.startsWith("* ") || line.startsWith("- ")) {
      elements.push(
        <div key={i} className="flex gap-1.5 ml-2 text-[11px]">
          <span className="text-muted-foreground mt-0.5">•</span>
          <span>{renderInline(line.slice(2))}</span>
        </div>
      );
    } else if (line.trim() === "") {
      elements.push(<div key={i} className="h-1.5" />);
    } else {
      elements.push(<p key={i} className="leading-relaxed text-[11px]">{renderInline(line)}</p>);
    }
    i++;
  }
  return elements;
}

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i} className="text-foreground">{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i} className="bg-muted px-1 py-0.5 rounded text-[10px] font-mono text-primary">{part.slice(1, -1)}</code>;
    return part;
  });
}

export default function ChatPanel({ location, onToggleLayer, activeLayers }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content: "Hello! I'm **TerraLogic AI**, your spatial analysis assistant. Select a location on the map, and I can analyze its suitability.\n\nSwitch between AI models using the selector below.",
      model: "System"
    }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [models, setModels] = useState<AIModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("auto");
  const [showModelPicker, setShowModelPicker] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const prevLocationRef = useRef<string | null>(null);

  useEffect(() => {
    fetch("/api/chat/models")
      .then(r => r.json())
      .then(data => {
        setModels(data.models || []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current.querySelector("[data-radix-scroll-area-viewport]");
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages, isLoading]);

  useEffect(() => {
    if (location) {
      const locKey = `${location.lat.toFixed(4)},${location.lon.toFixed(4)}`;
      if (prevLocationRef.current !== locKey) {
        prevLocationRef.current = locKey;
        if (messages.length <= 2) {
          setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: "assistant",
            content: `Analyzing **${location.name}** (${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}).\n\n* Flood risks and elevation\n* Infrastructure proximity\n* Soil composition\n* Sun path & solar potential\n* Construction suitability`,
            model: "System"
          }]);
        }
      }
    }
  }, [location]);

  const handleSend = async () => {
    if (!input.trim()) return;
    const userMessage: Message = { id: Date.now().toString(), role: "user", content: input };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);
    try {
      const history = newMessages.slice(1).map(m => ({ role: m.role, content: m.content }));
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: input,
          locationName: location?.name,
          lat: location?.lat,
          lon: location?.lon,
          history,
          model: selectedModel,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to get response");
      }
      const data = await response.json();
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: "assistant",
        content: data.content,
        model: data.model || selectedModel
      }]);
      if (data.action?.type === "toggleLayer" && data.action.layer && onToggleLayer) {
        if (!activeLayers?.includes(data.action.layer)) {
          onToggleLayer(data.action.layer);
        }
      }
    } catch (error: any) {
      toast({ title: "AI Error", description: error.message || "Could not reach AI service.", variant: "destructive" });
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: "assistant",
        content: "I couldn't reach the AI service. Please try again or switch to a different model.",
        model: "Error"
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const currentModel = models.find(m => m.id === selectedModel);
  const ModelIcon = currentModel ? MODEL_ICONS[currentModel.icon] || Bot : Zap;

  return (
    <div className="flex flex-col h-full w-full">
      <div className="px-3 pt-2 pb-1.5 border-b border-border">
        <div className="relative">
          <button
            onClick={() => setShowModelPicker(!showModelPicker)}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-muted/40 border border-border hover:bg-muted/60 transition-colors text-left"
            data-testid="button-model-selector"
          >
            <ModelIcon className="w-3.5 h-3.5 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-medium text-foreground truncate">{currentModel?.name || "Auto"}</p>
              <p className="text-[9px] text-muted-foreground truncate">{currentModel?.description || "Best available model"}</p>
            </div>
            <ChevronDown className={`w-3 h-3 text-muted-foreground transition-transform ${showModelPicker ? "rotate-180" : ""}`} />
          </button>
          {showModelPicker && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-xl z-50 overflow-hidden" data-testid="model-picker-dropdown">
              {models.map(model => {
                const Icon = MODEL_ICONS[model.icon] || Bot;
                return (
                  <button
                    key={model.id}
                    onClick={() => { setSelectedModel(model.id); setShowModelPicker(false); }}
                    disabled={!model.available}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                      model.id === selectedModel ? "bg-primary/10" : "hover:bg-muted/40"
                    } ${!model.available ? "opacity-40 cursor-not-allowed" : ""}`}
                    data-testid={`model-option-${model.id}`}
                  >
                    <Icon className={`w-3.5 h-3.5 shrink-0 ${model.id === selectedModel ? "text-primary" : "text-muted-foreground"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium text-foreground">{model.name}</p>
                      <p className="text-[9px] text-muted-foreground">{model.description}</p>
                    </div>
                    {!model.available && <span className="text-[9px] text-muted-foreground">No API key</span>}
                    {model.id === selectedModel && <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1 px-3 pt-2" ref={scrollRef}>
        <div className="flex flex-col gap-3 pb-3">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`} data-testid={`chat-message-${msg.role}-${msg.id}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-muted' : 'bg-primary/20'}`}>
                {msg.role === 'user' ? <User className="w-3 h-3 text-muted-foreground" /> : <Bot className="w-3 h-3 text-primary" />}
              </div>
              <div className="max-w-[85%]">
                {msg.role === 'assistant' && msg.model && (
                  <p className="text-[9px] text-muted-foreground mb-0.5 ml-1">{msg.model}</p>
                )}
                <div className={`p-2.5 rounded-lg text-xs leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-primary/15 text-foreground rounded-tr-none'
                    : 'bg-muted/50 border border-border rounded-tl-none text-foreground'
                }`}>
                  {msg.role === 'user' ? msg.content : renderMarkdown(msg.content)}
                </div>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex gap-2 flex-row">
              <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-primary/20">
                <Loader2 className="w-3 h-3 animate-spin text-primary" />
              </div>
              <div className="max-w-[85%]">
                <p className="text-[9px] text-muted-foreground mb-0.5 ml-1">{currentModel?.name || "AI"} is thinking...</p>
                <div className="p-2.5 rounded-lg bg-muted/50 border border-border rounded-tl-none flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="p-3 border-t border-border">
        <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex gap-1.5">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about site suitability..."
            className="flex-1 bg-input border-border text-xs h-8"
            disabled={isLoading}
            data-testid="input-chat-message"
          />
          <Button type="submit" size="icon" disabled={!input.trim() || isLoading} className="h-8 w-8 bg-primary hover:bg-primary/90" data-testid="button-send-message">
            <Send className="w-3 h-3" />
          </Button>
        </form>
      </div>
    </div>
  );
}
