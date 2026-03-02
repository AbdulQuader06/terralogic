import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Bot, User, MapPin, Sparkles, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ChatPanelProps {
  location: { lat: number; lon: number; name: string } | null;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

function renderMarkdown(text: string) {
  const lines = text.split("\n");
  const elements: JSX.Element[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("### ")) {
      elements.push(<h3 key={i} className="font-semibold text-sm mt-2 mb-1">{line.slice(4)}</h3>);
    } else if (line.startsWith("## ")) {
      elements.push(<h2 key={i} className="font-semibold text-sm mt-2 mb-1">{line.slice(3)}</h2>);
    } else if (line.startsWith("# ")) {
      elements.push(<h1 key={i} className="font-bold text-base mt-2 mb-1">{line.slice(2)}</h1>);
    } else if (line.startsWith("* ") || line.startsWith("- ")) {
      elements.push(
        <div key={i} className="flex gap-1.5 ml-2">
          <span className="text-muted-foreground mt-0.5">•</span>
          <span>{renderInline(line.slice(2))}</span>
        </div>
      );
    } else if (line.trim() === "") {
      elements.push(<div key={i} className="h-2" />);
    } else {
      elements.push(<p key={i} className="leading-relaxed">{renderInline(line)}</p>);
    }
    i++;
  }
  return elements;
}

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i} className="bg-background/50 px-1 py-0.5 rounded text-xs font-mono">{part.slice(1, -1)}</code>;
    return part;
  });
}

export default function ChatPanel({ location }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content: "Hello! I'm **TerraLogic AI**, your spatial analysis assistant. Select a location on the map, and I can analyze its suitability for construction — evaluating flood risk, soil types, nearby infrastructure, climate, and more.\n\nToggle the **data layers** on the left to see real GIS overlays on the map."
    }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const prevLocationRef = useRef<string | null>(null);

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
            content: `I see you've selected **${location.name}** (${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}). What would you like to know?\n\n* Flood risks and elevation analysis\n* Proximity to schools and infrastructure\n* Soil composition and drainage\n* Overall construction suitability`
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
        }),
      });
      if (!response.ok) throw new Error("Failed to get response");
      const data = await response.json();
      setMessages(prev => [...prev, { id: Date.now().toString(), role: "assistant", content: data.content }]);
    } catch (error) {
      console.error("Chat error:", error);
      toast({ title: "Analysis Failed", description: "Could not generate AI insights. Please try again.", variant: "destructive" });
      setMessages(prev => [...prev, { id: Date.now().toString(), role: "assistant", content: "I couldn't reach the analysis service right now. Please try again in a moment." }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full w-full">
      <div className="p-4 border-b border-border bg-muted/30">
        <h2 className="font-semibold flex items-center gap-2 text-primary text-sm" data-testid="text-chat-title">
          <Sparkles className="w-4 h-4 text-[hsl(204,70%,53%)]" />
          TerraLogic AI Assistant
        </h2>
        {location ? (
          <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-1 truncate" data-testid="text-chat-location">
            <MapPin className="w-3 h-3 shrink-0" /> {location.name}
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground mt-1">Select a location to begin</p>
        )}
      </div>

      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        <div className="flex flex-col gap-4 pb-4">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`} data-testid={`chat-message-${msg.role}-${msg.id}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-[hsl(204,70%,53%)] text-white'}`}>
                {msg.role === 'user' ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
              </div>
              <div className={`p-3 rounded-lg max-w-[85%] text-sm leading-relaxed ${msg.role === 'user' ? 'bg-primary text-primary-foreground rounded-tr-none' : 'bg-muted border border-border rounded-tl-none'}`}>
                {msg.role === 'user' ? msg.content : renderMarkdown(msg.content)}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex gap-3 flex-row">
              <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 bg-[hsl(204,70%,53%)] text-white">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              </div>
              <div className="p-3 rounded-lg bg-muted border border-border rounded-tl-none flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[hsl(204,70%,53%)] animate-bounce" style={{ animationDelay: "0ms" }}></span>
                <span className="w-1.5 h-1.5 rounded-full bg-[hsl(204,70%,53%)] animate-bounce" style={{ animationDelay: "150ms" }}></span>
                <span className="w-1.5 h-1.5 rounded-full bg-[hsl(204,70%,53%)] animate-bounce" style={{ animationDelay: "300ms" }}></span>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="p-4 border-t border-border bg-background">
        <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about site suitability..."
            className="flex-1 bg-muted/50"
            disabled={isLoading}
            data-testid="input-chat-message"
          />
          <Button type="submit" size="icon" disabled={!input.trim() || isLoading} data-testid="button-send-message">
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}