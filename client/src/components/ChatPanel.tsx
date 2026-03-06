import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Bot, User, Loader2, MapPin, Navigation, Trash2, Search, BarChart3, Database, X, ChevronRight, BrainCircuit } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export interface MapAction {
  action: string;
  lat?: number;
  lon?: number;
  zoom?: number;
  name?: string;
  label?: string;
  color?: string;
  geojson?: any;
  query?: string;
  places?: Array<{ name: string; lat: number; lon: number; tags?: any }>;
  count?: number;
  analysis?: any;
}

interface ChatPanelProps {
  location: { lat: number; lon: number; name: string } | null;
  onToggleLayer?: (layerId: string) => void;
  activeLayers?: string[];
  onMapAction?: (action: MapAction) => void;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  mapActions?: MapAction[];
}

const DATA_CATEGORIES = [
  {
    name: "Terrain & Physical Geography",
    items: ["Elevation (DEM)", "Slope", "Aspect", "Terrain ruggedness", "Landforms", "Contours", "Watersheds", "Drainage basins", "Soil type", "Soil fertility"]
  },
  {
    name: "Hydrology & Water Systems",
    items: ["Rivers", "Streams", "Lakes", "Reservoirs", "Wetlands", "Flood risk zones", "Floodplains", "Groundwater aquifers", "Water table depth", "Drainage networks"]
  },
  {
    name: "Climate & Environmental",
    items: ["Rainfall distribution", "Temperature distribution", "Wind patterns", "Solar radiation", "Air pollution levels", "Noise pollution", "Heat island zones", "Climate zones", "Drought risk", "Storm paths"]
  },
  {
    name: "Land & Ecology",
    items: ["Land use", "Land cover", "Forest cover", "Deforestation areas", "Biodiversity hotspots", "Wildlife habitats", "Protected areas", "National parks", "Mangroves", "Grasslands"]
  },
  {
    name: "Agriculture & Rural",
    items: ["Cropland distribution", "Crop types", "Irrigation networks", "Agricultural productivity", "Soil moisture", "Pasture lands", "Agricultural suitability", "Farm boundaries", "Plantation areas", "Livestock density"]
  },
  {
    name: "Urban & Built Environment",
    items: ["Infrastructure", "Building footprints", "Building heights", "Land parcels", "Zoning areas", "Residential areas", "Commercial areas", "Industrial zones", "Slums", "Urban density"]
  },
  {
    name: "Transportation & Mobility",
    items: ["Road networks", "Railways", "Metro systems", "Bus routes", "Bus stops", "Airports", "Ports", "Bicycle lanes", "Pedestrian pathways", "Traffic congestion"]
  },
  {
    name: "Public Services & Facilities",
    items: ["Schools", "Colleges", "Hospitals", "Clinics", "Fire stations", "Police stations", "Government buildings", "Community centers", "Libraries", "Parks"]
  },
  {
    name: "Utilities & Infrastructure",
    items: ["Water supply pipelines", "Sewer networks", "Stormwater drainage", "Electricity grid lines", "Power substations", "Gas pipelines", "Telecommunication towers", "Internet fiber networks", "Waste collection zones", "Landfills"]
  },
  {
    name: "Risk, Hazards & Social Data",
    items: ["Landslide risk zones", "Earthquake hazard zones", "Coastal erosion zones", "Tsunami risk areas", "Fire risk zones", "Crime distribution", "Population density", "Demographic distribution", "Economic activity zones", "Poverty zones"]
  },
  {
    name: "Urban Form & Building Data",
    items: ["Floor area ratio (FAR)", "Building age", "Building construction type", "Roof type", "Roof materials", "Building energy consumption", "Historical buildings", "Vacant buildings", "Under-construction buildings", "Urban skyline profile"]
  },
  {
    name: "Urban Planning & Development",
    items: ["Master plan zones", "Development control zones", "Future land use plans", "Redevelopment zones", "Urban growth boundaries", "Special economic zones", "Smart city project areas", "Transit-oriented development zones", "Mixed-use development zones", "Land value zones"]
  },
  {
    name: "Transportation Analytics",
    items: ["Travel time surfaces", "Accessibility to public transport", "Commuting patterns", "Origin-destination travel flows", "Parking availability zones", "Electric vehicle charging stations", "Traffic accident hotspots", "Ride-sharing pickup zones", "Logistics hubs", "Freight routes"]
  },
  {
    name: "Utilities & Urban Services",
    items: ["Water demand zones", "Electricity demand zones", "Internet coverage quality", "Mobile network signal strength", "Street lighting coverage", "Smart sensors / IoT networks", "Waste recycling centers", "Waste generation zones", "Stormwater retention basins", "Urban drainage capacity"]
  },
  {
    name: "Environmental Monitoring",
    items: ["Tree canopy coverage", "Urban green corridors", "Urban biodiversity zones", "Air quality monitoring stations", "Carbon emission distribution", "Noise monitoring stations", "Soil contamination zones", "Brownfield sites", "Environmental remediation sites", "Ecological restoration zones"]
  },
  {
    name: "Climate Adaptation & Sustainability",
    items: ["Sea level rise risk areas", "Coastal flood projections", "Urban heat vulnerability", "Cooling corridors", "Renewable energy potential zones", "Solar rooftop potential", "Wind energy potential", "Carbon sequestration areas", "Climate resilience zones", "Green infrastructure networks"]
  },
  {
    name: "Public Health & Social Infrastructure",
    items: ["Disease outbreak hotspots", "Health accessibility zones", "Emergency response times", "Ambulance coverage areas", "Vaccination coverage zones", "Food deserts", "Nutrition access zones", "Childcare facilities", "Elder care facilities", "Disability accessibility infrastructure"]
  },
  {
    name: "Economic & Commercial Activity",
    items: ["Business density", "Retail clusters", "Industrial output zones", "Commercial footfall zones", "Tourism hotspots", "Night-time economy zones", "Market areas", "Property price distribution", "Rental value zones", "Employment density"]
  },
  {
    name: "Cultural & Social Spaces",
    items: ["Religious institutions", "Cultural heritage sites", "Museums and galleries", "Festivals and event zones", "Public art installations", "Historical districts", "Film shooting locations", "Cultural tourism routes", "Community gathering spaces", "Traditional craft clusters"]
  },
  {
    name: "Advanced Spatial Analytics",
    items: ["Suitability analysis results", "Multi-criteria decision analysis maps", "Network centrality maps", "Spatial autocorrelation results", "Hotspot analysis maps", "Predictive urban growth models", "Land change detection maps", "Risk probability maps", "Scenario simulation layers", "Spatial AI prediction outputs"]
  }
];

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

function ActionChip({ action, onClick }: { action: MapAction; onClick: () => void }) {
  const icons: Record<string, any> = {
    update_map_view: Navigation,
    add_marker: MapPin,
    clear_map: Trash2,
    search_results: Search,
    analyze_site: BarChart3,
    add_geojson: MapPin,
  };
  const labels: Record<string, string> = {
    update_map_view: action.name ? `Navigate to ${action.name}` : "Map updated",
    add_marker: action.label ? `Marker: ${action.label}` : "Marker added",
    clear_map: "Map cleared",
    search_results: `${action.count || 0} ${action.query || "places"} found`,
    analyze_site: `Analysis: ${action.analysis?.score}/100`,
    add_geojson: action.label || "Overlay added",
  };
  const Icon = icons[action.action] || MapPin;
  const label = labels[action.action] || action.action;

  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-[10px] font-medium text-primary hover:bg-primary/20 transition-colors cursor-pointer"
      data-testid={`action-chip-${action.action}`}
    >
      <Icon className="w-3 h-3" />
      <span className="truncate max-w-[150px]">{label}</span>
    </button>
  );
}

const SUGGESTIONS = [
  "Show me hospitals near here",
  "Navigate to Tokyo, Japan",
  "Analyze this site for construction",
  "Find parks within 2km",
  "What's the flood risk here?",
  "Generate an AI estimate of urban heat island zones based on population density and traffic data, then plot it on the map",
];

export default function ChatPanel({ location, onToggleLayer, activeLayers, onMapAction }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Hi! I'm **CartoAI**, your intelligent map assistant. I can navigate to places, find nearby amenities, analyze sites, and add markers to the map.\n\nTry asking me something, browse the **Data Catalog**, or use a suggestion below.",
    }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current.querySelector("[data-radix-scroll-area-viewport]");
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages, isLoading]);

  const executeMapAction = (action: MapAction) => {
    if (!onMapAction) return;
    onMapAction(action);
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;
    setShowCatalog(false);
    const userMessage: Message = { id: `u-${Date.now()}`, role: "user", content: text };
    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const history = [
        ...messages.filter(m => m.id !== "welcome").map(m => ({ role: m.role, content: m.content })),
        { role: "user", content: text },
      ];

      const response = await fetch("/api/cartoai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history,
          location: location || undefined,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || "Failed to get response");
      }

      const data = await response.json();
      const mapActions: MapAction[] = data.mapActions || [];

      for (const action of mapActions) {
        executeMapAction(action);
      }

      setMessages(prev => [...prev, {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: data.content,
        mapActions: mapActions.length > 0 ? mapActions : undefined,
      }]);
    } catch (error: any) {
      toast({ title: "CartoAI Error", description: error.message || "Could not reach AI service.", variant: "destructive" });
      setMessages(prev => [...prev, {
        id: `e-${Date.now()}`,
        role: "assistant",
        content: "I couldn't process that request. Please try again.",
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = () => sendMessage(input);

  const handleCatalogItemClick = (item: string) => {
    const locationCtx = location ? ` near ${location.name}` : "";
    sendMessage(`Find and show ${item}${locationCtx} on the map`);
  };

  return (
    <div className="flex flex-col h-full w-full relative">
      <div className="px-3 pt-2 pb-1.5 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "#2C5282" }}>
            <Bot className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-foreground">CartoAI</p>
            <p className="text-[9px] text-muted-foreground">Geospatial Assistant</p>
          </div>
          <button
            onClick={() => setShowCatalog(!showCatalog)}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
              showCatalog
                ? "text-white"
                : "bg-muted/50 border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
            style={showCatalog ? { background: "#2C5282" } : undefined}
            data-testid="button-data-catalog"
          >
            <Database className="w-3 h-3" />
            Catalog
          </button>
        </div>
        {location && (
          <div className="flex items-center gap-1 mt-1.5 px-1">
            <MapPin className="w-2.5 h-2.5 text-primary shrink-0" />
            <span className="text-[9px] text-muted-foreground truncate">{location.name}</span>
          </div>
        )}
      </div>

      {showCatalog && (
        <div className="absolute top-[52px] left-0 right-0 bottom-0 bg-background z-50 flex flex-col border-t border-border">
          <div className="px-3 py-2 border-b border-border flex items-center justify-between bg-background">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4" style={{ color: "#2C5282" }} />
              <h2 className="text-xs font-semibold text-foreground">GIS Data Catalog</h2>
            </div>
            <button
              onClick={() => setShowCatalog(false)}
              className="p-1 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-close-catalog"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="px-3 py-1.5 bg-muted/30 border-b border-border">
            <p className="text-[10px] text-muted-foreground">Click any item to ask CartoAI to find and display that data on the map.</p>
          </div>
          <ScrollArea className="flex-1">
            <div className="px-2 py-2 space-y-0.5">
              {DATA_CATEGORIES.map((category, idx) => (
                <div key={idx}>
                  <button
                    onClick={() => setExpandedCategory(expandedCategory === idx ? null : idx)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors text-left group"
                    data-testid={`catalog-category-${idx}`}
                  >
                    <ChevronRight className={`w-3 h-3 text-muted-foreground transition-transform ${expandedCategory === idx ? "rotate-90" : ""}`} />
                    <span className="text-[10px] font-semibold text-foreground uppercase tracking-wider">{category.name}</span>
                    <span className="text-[9px] text-muted-foreground ml-auto">{category.items.length}</span>
                  </button>
                  {expandedCategory === idx && (
                    <div className="flex flex-wrap gap-1 px-2 pb-2 pt-1">
                      {category.items.map((item, i) => (
                        <button
                          key={i}
                          onClick={() => handleCatalogItemClick(item)}
                          disabled={isLoading}
                          className="px-2 py-1 bg-muted/40 border border-border/60 hover:border-[#2A9D8F]/40 hover:bg-[#2A9D8F]/10 text-foreground text-[10px] rounded-full transition-colors disabled:opacity-50"
                          data-testid={`catalog-item-${idx}-${i}`}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      <ScrollArea className="flex-1 px-3 pt-2" ref={scrollRef}>
        <div className="flex flex-col gap-3 pb-3">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`} data-testid={`chat-message-${msg.role}-${msg.id}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-muted' : ''}`} style={msg.role !== 'user' ? { background: "rgba(44,82,130,0.12)" } : undefined}>
                {msg.role === 'user' ? <User className="w-3 h-3 text-muted-foreground" /> : <Bot className="w-3 h-3" style={{ color: "#2C5282" }} />}
              </div>
              <div className="max-w-[85%] space-y-1.5">
                <div className={`p-2.5 rounded-lg text-xs leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-primary/15 text-foreground rounded-tr-none'
                    : 'bg-muted/50 border border-border rounded-tl-none text-foreground'
                }`}>
                  {msg.role === 'user' ? msg.content : renderMarkdown(msg.content)}
                </div>
                {msg.mapActions && msg.mapActions.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {msg.mapActions.map((action, i) => (
                      <ActionChip key={i} action={action} onClick={() => executeMapAction(action)} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex gap-2 flex-row">
              <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(44,82,130,0.12)" }}>
                <Loader2 className="w-3 h-3 animate-spin" style={{ color: "#2C5282" }} />
              </div>
              <div className="max-w-[85%]">
                <div className="p-2.5 rounded-lg bg-muted/50 border border-border rounded-tl-none flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">CartoAI is thinking</span>
                  <span className="w-1 h-1 rounded-full animate-bounce" style={{ background: "#2C5282", animationDelay: "0ms" }} />
                  <span className="w-1 h-1 rounded-full animate-bounce" style={{ background: "#2C5282", animationDelay: "150ms" }} />
                  <span className="w-1 h-1 rounded-full animate-bounce" style={{ background: "#2C5282", animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}

          {messages.length <= 1 && !isLoading && (
            <div className="space-y-1.5 mt-1">
              <p className="text-[10px] text-muted-foreground font-medium px-1">Try asking:</p>
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(s)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-[11px] transition-colors ${
                    i === SUGGESTIONS.length - 1
                      ? "border flex items-center gap-1.5 font-medium"
                      : "bg-muted/30 border border-border/50 text-foreground hover:bg-muted/60 hover:border-border"
                  }`}
                  style={i === SUGGESTIONS.length - 1 ? { background: "rgba(42,157,143,0.08)", borderColor: "rgba(42,157,143,0.3)", color: "#2A9D8F" } : undefined}
                  data-testid={`suggestion-${i}`}
                >
                  {i === SUGGESTIONS.length - 1 && <BrainCircuit className="w-3 h-3 shrink-0" />}
                  {i === SUGGESTIONS.length - 1 ? "Generative AI GIS — Estimate & Plot Spatial Data" : s}
                </button>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="p-3 border-t border-border">
        <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex gap-1.5">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask CartoAI anything..."
            className="flex-1 bg-input border-border text-xs h-8"
            disabled={isLoading}
            data-testid="input-chat-message"
          />
          <Button type="submit" size="icon" disabled={!input.trim() || isLoading} className="h-8 w-8 text-white" style={{ background: "#2C5282" }} data-testid="button-send-message">
            <Send className="w-3 h-3" />
          </Button>
        </form>
      </div>
    </div>
  );
}
