import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Loader2, Database, Map, ChevronDown, ChevronRight, ExternalLink, X } from "lucide-react";
import type { DrawnRegion } from "@/components/MapViewer";
import { drawnRegionToPolygonParam } from "@/components/MapViewer";

interface QuickOSMProps {
  location: { lat: number; lon: number; name: string } | null;
  onDataLoaded: (data: any, label: string, color: string) => void;
  drawnRegion?: DrawnRegion;
}

const PRESET_QUERIES = [
  { label: "Buildings", key: "building", value: "", icon: "🏢", color: "#F59E0B" },
  { label: "Roads", key: "highway", value: "", icon: "🛣️", color: "#94A3B8" },
  { label: "Restaurants", key: "amenity", value: "restaurant", icon: "🍽️", color: "#EF4444" },
  { label: "ATMs", key: "amenity", value: "atm", icon: "💳", color: "#8B5CF6" },
  { label: "Petrol Pumps", key: "amenity", value: "fuel", icon: "⛽", color: "#F97316" },
  { label: "Places of Worship", key: "amenity", value: "place_of_worship", icon: "🛕", color: "#A855F7" },
  { label: "Shops", key: "shop", value: "", icon: "🛒", color: "#EC4899" },
  { label: "Hotels", key: "tourism", value: "hotel", icon: "🏨", color: "#06B6D4" },
  { label: "Railway Lines", key: "railway", value: "rail", icon: "🚂", color: "#64748B" },
  { label: "Power Lines", key: "power", value: "line", icon: "⚡", color: "#EAB308" },
  { label: "Pipelines", key: "man_made", value: "pipeline", icon: "🔧", color: "#78716C" },
  { label: "Bridges", key: "man_made", value: "bridge", icon: "🌉", color: "#0EA5E9" },
  { label: "Boundary Walls", key: "barrier", value: "wall", icon: "🧱", color: "#A8A29E" },
  { label: "Temples", key: "religion", value: "hindu", icon: "🕉️", color: "#FB923C" },
  { label: "Drinking Water", key: "amenity", value: "drinking_water", icon: "🚰", color: "#22D3EE" },
  { label: "Toilets", key: "amenity", value: "toilets", icon: "🚻", color: "#A3E635" },
];

const OPENCITY_PRESETS = [
  { label: "Water Bodies", city: "hyderabad", q: "water bodies", icon: "💧" },
  { label: "Microwatersheds", city: "", q: "microwatersheds", icon: "🌊" },
  { label: "Bus Stops", city: "", q: "bus stops", icon: "🚌" },
  { label: "Police Stations", city: "", q: "police stations", icon: "🚔" },
  { label: "Schools", city: "", q: "schools", icon: "🏫" },
  { label: "Ward Info", city: "", q: "ward", icon: "📍" },
  { label: "Fire Stations", city: "", q: "fire stations", icon: "🚒" },
  { label: "Slums", city: "", q: "slums", icon: "🏚️" },
  { label: "Air Quality", city: "", q: "air quality", icon: "🌫️" },
  { label: "Rainfall Data", city: "", q: "rainfall", icon: "🌧️" },
];

interface OpenCityDataset {
  id: string;
  title: string;
  organization: string;
  city: string;
  resources: { id: string; name: string; format: string; url: string }[];
}

export default function QuickOSM({ location, onDataLoaded, drawnRegion }: QuickOSMProps) {
  const [activeTab, setActiveTab] = useState<"osm" | "opencity">("osm");
  const [osmKey, setOsmKey] = useState("");
  const [osmValue, setOsmValue] = useState("");
  const [radius, setRadius] = useState("5000");
  const [loading, setLoading] = useState(false);
  const [resultCount, setResultCount] = useState<number | null>(null);
  const [lastQuery, setLastQuery] = useState("");

  const [ocSearch, setOcSearch] = useState("");
  const [ocResults, setOcResults] = useState<OpenCityDataset[]>([]);
  const [ocLoading, setOcLoading] = useState(false);
  const [ocExpanded, setOcExpanded] = useState<string | null>(null);
  const [ocResourceLoading, setOcResourceLoading] = useState<string | null>(null);

  const runOsmQuery = useCallback(async (key: string, value: string, color?: string) => {
    if (!key || !location) return;
    setLoading(true);
    setResultCount(null);
    setLastQuery(`${key}=${value || "*"}`);
    try {
      const polyParam = drawnRegionToPolygonParam(drawnRegion || null);
      const body: any = {
        key, value: value || undefined,
        lat: location.lat, lon: location.lon,
        radius: Number(radius),
        outputType: "all",
      };
      if (polyParam) body.polygon = polyParam;

      const resp = await fetch("/api/quickosm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error("Query failed");
      const data = await resp.json();
      setResultCount(data.features?.length || 0);
      if (data.features?.length > 0) {
        onDataLoaded(data, `${key}=${value || "*"}`, color || "#00C853");
      }
    } catch (e: any) {
      console.error("QuickOSM error:", e);
      setResultCount(-1);
    } finally {
      setLoading(false);
    }
  }, [location, radius, onDataLoaded, drawnRegion]);

  const searchOpenCity = async () => {
    if (!ocSearch.trim()) return;
    setOcLoading(true);
    try {
      const resp = await fetch(`/api/opencity/search?q=${encodeURIComponent(ocSearch)}&rows=15`);
      if (!resp.ok) throw new Error("Search failed");
      const data = await resp.json();
      setOcResults(data.datasets || []);
    } catch {
      setOcResults([]);
    } finally {
      setOcLoading(false);
    }
  };

  const loadOpenCityResource = async (resourceId: string, datasetTitle: string) => {
    setOcResourceLoading(resourceId);
    try {
      const resp = await fetch(`/api/opencity/resource/${resourceId}`);
      if (!resp.ok) throw new Error("Failed to load");
      const result = await resp.json();
      if (result.format === "geojson" && result.data) {
        onDataLoaded(result.data, `OpenCity: ${datasetTitle}`, "#E879F9");
        setResultCount(result.data.features?.length || 0);
        setLastQuery(`OpenCity: ${datasetTitle}`);
      } else if (result.format === "table") {
        setResultCount(result.rows?.length || 0);
        setLastQuery(`Table: ${datasetTitle} (${result.rows?.length} rows, no geometry)`);
      } else if (result.format === "unsupported") {
        setLastQuery(result.message);
        setResultCount(0);
      } else {
        setLastQuery(`Download: ${result.url || "unavailable"}`);
        setResultCount(0);
      }
    } catch {
      setResultCount(-1);
    } finally {
      setOcResourceLoading(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-2">
        <div className="flex gap-1 mb-3">
          <button
            onClick={() => setActiveTab("osm")}
            className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === "osm"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
            }`}
            data-testid="button-tab-osm"
          >
            <Map className="w-3 h-3" />
            QuickOSM
          </button>
          <button
            onClick={() => setActiveTab("opencity")}
            className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === "opencity"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
            }`}
            data-testid="button-tab-opencity"
          >
            <Database className="w-3 h-3" />
            OpenCity India
          </button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        {activeTab === "osm" ? (
          <div className="px-3 pb-3">
            <div className="space-y-2 mb-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1 block">OSM Tag Key</label>
                <input
                  type="text"
                  value={osmKey}
                  onChange={(e) => setOsmKey(e.target.value)}
                  placeholder="e.g. amenity, building, highway..."
                  className="w-full bg-input border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/50"
                  data-testid="input-osm-key"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1 block">Value (optional)</label>
                <input
                  type="text"
                  value={osmValue}
                  onChange={(e) => setOsmValue(e.target.value)}
                  placeholder="e.g. school, residential, yes..."
                  className="w-full bg-input border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/50"
                  data-testid="input-osm-value"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1 block">Radius (meters)</label>
                <input
                  type="number"
                  value={radius}
                  onChange={(e) => setRadius(e.target.value)}
                  className="w-full bg-input border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                  data-testid="input-osm-radius"
                />
              </div>
              <Button
                size="sm"
                onClick={() => runOsmQuery(osmKey, osmValue)}
                disabled={!osmKey.trim() || loading || !location}
                className="w-full bg-primary hover:bg-primary/90 text-xs h-8"
                data-testid="button-run-osm-query"
              >
                {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Search className="w-3 h-3 mr-1" />}
                Run Query
              </Button>
            </div>

            {resultCount !== null && (
              <div className={`mb-3 p-2 rounded-md text-xs ${resultCount > 0 ? "bg-primary/10 border border-primary/30 text-primary" : resultCount === 0 ? "bg-muted/40 border border-border text-muted-foreground" : "bg-red-500/10 border border-red-500/30 text-red-400"}`} data-testid="text-query-result">
                {resultCount > 0 ? `Found ${resultCount} features for ${lastQuery}` : resultCount === 0 ? `No results for ${lastQuery}` : `Error: ${lastQuery}`}
              </div>
            )}

            <div>
              <h4 className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">Quick Presets</h4>
              <div className="grid grid-cols-2 gap-1">
                {PRESET_QUERIES.map((preset) => (
                  <button
                    key={`${preset.key}-${preset.value}`}
                    onClick={() => {
                      setOsmKey(preset.key);
                      setOsmValue(preset.value);
                      runOsmQuery(preset.key, preset.value, preset.color);
                    }}
                    disabled={loading || !location}
                    className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-muted/30 hover:bg-muted/60 text-xs text-foreground transition-colors text-left disabled:opacity-50"
                    data-testid={`preset-${preset.key}-${preset.value || "all"}`}
                  >
                    <span className="text-sm shrink-0">{preset.icon}</span>
                    <span className="truncate">{preset.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="px-3 pb-3">
            <div className="mb-3">
              <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5 block">Search OpenCity India</label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={ocSearch}
                  onChange={(e) => setOcSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && searchOpenCity()}
                  placeholder="e.g. water bodies, bus stops..."
                  className="flex-1 bg-input border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/50"
                  data-testid="input-opencity-search"
                />
                <Button
                  size="sm"
                  onClick={searchOpenCity}
                  disabled={!ocSearch.trim() || ocLoading}
                  className="h-[30px] w-[30px] p-0 bg-primary hover:bg-primary/90"
                  data-testid="button-opencity-search"
                >
                  {ocLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                </Button>
              </div>
            </div>

            <div className="mb-3">
              <h4 className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">Quick Categories</h4>
              <div className="grid grid-cols-2 gap-1">
                {OPENCITY_PRESETS.map((preset, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setOcSearch(preset.q);
                      setOcLoading(true);
                      fetch(`/api/opencity/search?q=${encodeURIComponent(preset.q)}&rows=15`)
                        .then(r => r.json())
                        .then(d => setOcResults(d.datasets || []))
                        .catch(() => setOcResults([]))
                        .finally(() => setOcLoading(false));
                    }}
                    disabled={ocLoading}
                    className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-muted/30 hover:bg-muted/60 text-xs text-foreground transition-colors text-left disabled:opacity-50"
                    data-testid={`opencity-preset-${i}`}
                  >
                    <span className="text-sm shrink-0">{preset.icon}</span>
                    <span className="truncate">{preset.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {ocResults.length > 0 && (
              <div className="space-y-1">
                <h4 className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">
                  Results ({ocResults.length})
                </h4>
                {ocResults.map((dataset) => (
                  <div key={dataset.id} className="border border-border rounded-lg overflow-hidden">
                    <button
                      onClick={() => setOcExpanded(ocExpanded === dataset.id ? null : dataset.id)}
                      className="w-full flex items-center gap-2 p-2 text-left hover:bg-muted/30 transition-colors"
                    >
                      {ocExpanded === dataset.id ? <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-foreground truncate">{dataset.title}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{dataset.organization}{dataset.city ? ` • ${dataset.city}` : ""}</p>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">{dataset.resources.length} files</span>
                    </button>
                    {ocExpanded === dataset.id && (
                      <div className="border-t border-border bg-muted/10 p-2 space-y-1">
                        {dataset.resources.map((res) => {
                          const isLoadable = ["geojson", "csv", "json"].includes(res.format.toLowerCase());
                          return (
                            <div key={res.id} className="flex items-center gap-2 text-[11px]">
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                                res.format.toLowerCase() === "geojson" ? "bg-primary/20 text-primary" :
                                res.format.toLowerCase() === "csv" ? "bg-blue-500/20 text-blue-400" :
                                res.format.toLowerCase() === "kml" ? "bg-amber-500/20 text-amber-400" :
                                "bg-muted text-muted-foreground"
                              }`}>
                                {res.format}
                              </span>
                              <span className="truncate flex-1 text-foreground">{res.name}</span>
                              {isLoadable ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => loadOpenCityResource(res.id, dataset.title)}
                                  disabled={ocResourceLoading === res.id}
                                  className="h-6 px-2 text-[10px] text-primary hover:text-primary hover:bg-primary/10"
                                >
                                  {ocResourceLoading === res.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Load"}
                                </Button>
                              ) : (
                                <a href={res.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {resultCount !== null && lastQuery.startsWith("OpenCity") && (
              <div className="mt-2 p-2 rounded-md text-xs bg-purple-500/10 border border-purple-500/30 text-purple-300">
                Loaded {resultCount} features from {lastQuery}
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      <div className="px-3 py-2 border-t border-border text-[10px] text-muted-foreground">
        {location ? (
          <span>Query center: {location.lat.toFixed(4)}, {location.lon.toFixed(4)}</span>
        ) : (
          <span>Select a location on the map first</span>
        )}
      </div>
    </div>
  );
}
