import { useState, useRef, useEffect } from "react";
import { GoogleGenerativeAI } from "@google/generative-ai";
import ReactMarkdown from "react-markdown";
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

const API_KEY = "AIzaSyBEcS7T1J2XurGYK7oUAs46Xb8wieg8Unk";
const genAI = new GoogleGenerativeAI(API_KEY);

export default function ChatPanel({ location }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content: "Hello! I'm your Aino Spatial AI assistant. Select a location on the map, and I can help analyze its suitability for construction, evaluating factors like flood risk, soil types, nearby infrastructure, and climate."
    }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  // Context update when location changes
  useEffect(() => {
    if (location && messages.length === 1) {
      setMessages(prev => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "assistant",
          content: `I see you've selected **${location.name}** (${location.lat.toFixed(2)}, ${location.lon.toFixed(2)}). What would you like to know about this site? You can ask about:\n\n* Flood risks and elevation\n* Proximity to schools and infrastructure\n* Land use and zoning insights\n* Overall construction suitability`
        }
      ]);
    }
  }, [location]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage: Message = { id: Date.now().toString(), role: "user", content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      // In a real app, this would be a secure backend call.
      // Doing it frontend for mockup purposes as requested.
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
      
      const context = location 
        ? `Context: We are analyzing a construction site in ${location.name} (Lat: ${location.lat}, Lon: ${location.lon}). Act as a professional GIS spatial analyst.` 
        : "Context: General GIS spatial analysis. Act as a professional GIS spatial analyst.";

      const prompt = `${context}\n\nUser Question: ${input}`;
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: "assistant",
        content: text
      }]);
    } catch (error) {
      console.error("Gemini API Error:", error);
      toast({
        title: "Analysis Failed",
        description: "Could not generate AI insights. The API key might have restrictions.",
        variant: "destructive"
      });
      
      // Fallback for mockup if API fails
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: "assistant",
        content: "I couldn't reach the AI analysis service. Based on typical GIS patterns for this area, you should check local zoning boards for specific flood plain data and soil permeability."
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full w-full">
      <div className="p-4 border-b border-border bg-muted/30">
        <h2 className="font-semibold flex items-center gap-2 text-primary">
          <Sparkles className="w-4 h-4 text-secondary" /> 
          AI Spatial Analyst
        </h2>
        {location ? (
          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1 truncate">
            <MapPin className="w-3 h-3" /> {location.name}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground mt-1">Select a location to begin</p>
        )}
      </div>

      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        <div className="flex flex-col gap-4 pb-4">
          {messages.map((msg) => (
            <div 
              key={msg.id} 
              className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
              }`}>
                {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>
              
              <div className={`p-3 rounded-lg max-w-[85%] text-sm ${
                msg.role === 'user' 
                  ? 'bg-primary text-primary-foreground rounded-tr-none' 
                  : 'bg-muted border border-border rounded-tl-none prose prose-sm prose-p:leading-relaxed prose-pre:bg-background/50 prose-pre:border prose-pre:border-border max-w-full'
              }`}>
                {msg.role === 'user' ? (
                  msg.content
                ) : (
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                )}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex gap-3 flex-row">
              <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-secondary text-secondary-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
              <div className="p-3 rounded-lg bg-muted border border-border rounded-tl-none flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-secondary animate-bounce" style={{ animationDelay: "0ms" }}></span>
                <span className="w-2 h-2 rounded-full bg-secondary animate-bounce" style={{ animationDelay: "150ms" }}></span>
                <span className="w-2 h-2 rounded-full bg-secondary animate-bounce" style={{ animationDelay: "300ms" }}></span>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="p-4 border-t border-border bg-background">
        <form 
          onSubmit={(e) => { e.preventDefault(); handleSend(); }}
          className="flex gap-2"
        >
          <Input 
            value={input} 
            onChange={(e) => setInput(e.target.value)} 
            placeholder="Ask about site suitability..." 
            className="flex-1 bg-muted/50"
            disabled={isLoading}
          />
          <Button type="submit" size="icon" disabled={!input.trim() || isLoading}>
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}