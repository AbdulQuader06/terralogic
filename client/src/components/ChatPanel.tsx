import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Bot, User, Loader2 } from "lucide-react";
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

export default function ChatPanel({ location }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content: "Hello! I'm **TerraLogic AI**, your spatial analysis assistant. Select a location on the map, and I can analyze its suitability for construction.\n\nToggle **data layers** to see real GIS overlays."
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
            content: `Analyzing **${location.name}** (${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}).\n\n* Flood risks and elevation\n* Infrastructure proximity\n* Soil composition\n* Construction suitability`
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
      toast({ title: "Analysis Failed", description: "Could not generate AI insights.", variant: "destructive" });
      setMessages(prev => [...prev, { id: Date.now().toString(), role: "assistant", content: "I couldn't reach the analysis service. Please try again." }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full w-full">
      <ScrollArea className="flex-1 px-3 pt-2" ref={scrollRef}>
        <div className="flex flex-col gap-3 pb-3">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`} data-testid={`chat-message-${msg.role}-${msg.id}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-muted' : 'bg-primary/20'}`}>
                {msg.role === 'user' ? <User className="w-3 h-3 text-muted-foreground" /> : <Bot className="w-3 h-3 text-primary" />}
              </div>
              <div className={`p-2.5 rounded-lg max-w-[85%] text-xs leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-primary/15 text-foreground rounded-tr-none'
                  : 'bg-muted/50 border border-border rounded-tl-none text-foreground'
              }`}>
                {msg.role === 'user' ? msg.content : renderMarkdown(msg.content)}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex gap-2 flex-row">
              <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-primary/20">
                <Loader2 className="w-3 h-3 animate-spin text-primary" />
              </div>
              <div className="p-2.5 rounded-lg bg-muted/50 border border-border rounded-tl-none flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
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
