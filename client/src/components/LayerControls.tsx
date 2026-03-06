import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface LayerConfig {
  id: string;
  name: string;
  icon: string;
  color: string;
  description: string;
}

const LAYERS: LayerConfig[] = [
  { id: "elevation", name: "Elevation", icon: "mountain", color: "#2A9D8F", description: "Terrain contours & height" },
  { id: "soil", name: "Soil Type", icon: "soil", color: "#A16207", description: "Soil classification grid" },
  { id: "flood", name: "Flood Risk", icon: "flood", color: "#DC2626", description: "Flood zones & wetlands" },
  { id: "landuse", name: "Land Use", icon: "landuse", color: "#7C3AED", description: "Zoning & land classification" },
  { id: "water", name: "Water Bodies", icon: "water", color: "#06B6D4", description: "Rivers, lakes & canals" },
  { id: "schools", name: "Schools", icon: "school", color: "#8B5CF6", description: "Educational institutions" },
  { id: "hospitals", name: "Healthcare", icon: "hospital", color: "#EF4444", description: "Medical facilities" },
  { id: "transit", name: "Transit", icon: "transit", color: "#3B82F6", description: "Public transport stops" },
  { id: "parks", name: "Parks", icon: "parks", color: "#22C55E", description: "Green spaces & recreation" },
  { id: "infrastructure", name: "Infrastructure", icon: "infra", color: "#F59E0B", description: "Civic & utility facilities" },
];

function LayerIcon({ type, color, size = 14 }: { type: string; color: string; size?: number }) {
  const s = { width: size, height: size, color };
  switch (type) {
    case "mountain": return <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>;
    case "soil": return <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M2 22h20"/><path d="M12 2v6"/><path d="m8 6 4 4 4-4"/><path d="M6 14h12"/><path d="M4 18h16"/></svg>;
    case "flood": return <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M2 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M2 18c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M2 6c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/></svg>;
    case "landuse": return <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 3v18"/></svg>;
    case "water": return <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2c-4.97 5.33-8 9.33-8 12.5C4 19.14 7.58 22 12 22s8-2.86 8-7.5C20 11.33 16.97 7.33 12 2z"/></svg>;
    case "school": return <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>;
    case "hospital": return <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 6v12"/><path d="M6 12h12"/><rect x="3" y="3" width="18" height="18" rx="2"/></svg>;
    case "transit": return <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="m7 21 5-5 5 5"/></svg>;
    case "parks": return <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2c-4 4-8 6-8 10 0 4.42 3.58 8 8 8s8-3.58 8-8c0-4-4-6-8-10z"/><path d="M12 12v10"/></svg>;
    case "infra": return <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg>;
    default: return <div style={{ width: size, height: size, background: color, borderRadius: "50%" }} />;
  }
}

interface LayerControlsProps {
  activeLayers: string[];
  onToggleLayer: (id: string) => void;
  loadingLayers: string[];
}

export default function LayerControls({ activeLayers, onToggleLayer, loadingLayers }: LayerControlsProps) {
  return (
    <ScrollArea className="flex-1 h-full">
      <div className="px-3 pb-3">
        <h3 className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2 px-1">Data Layers</h3>
        <div className="space-y-0.5">
          {LAYERS.map((layer) => {
            const isActive = activeLayers.includes(layer.id);
            const isLoading = loadingLayers.includes(layer.id);
            return (
              <div
                key={layer.id}
                className={`flex items-center justify-between p-2 rounded-lg transition-all cursor-pointer group ${
                  isActive ? "bg-muted/60" : "hover:bg-muted/30"
                }`}
                onClick={() => onToggleLayer(layer.id)}
                data-testid={`layer-toggle-${layer.id}`}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all"
                    style={{
                      backgroundColor: isActive ? `${layer.color}25` : "hsl(var(--muted))",
                      border: isActive ? `2px solid ${layer.color}60` : "2px solid transparent",
                      boxShadow: isActive ? `0 0 8px ${layer.color}20` : "none",
                    }}
                  >
                    {isLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                    ) : (
                      <LayerIcon type={layer.icon} color={isActive ? layer.color : "hsl(var(--muted-foreground))"} />
                    )}
                  </div>
                  <div>
                    <span className={`text-xs font-semibold block ${isActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"}`}>
                      {layer.name}
                    </span>
                    <span className="text-[9px] text-muted-foreground/70">{layer.description}</span>
                  </div>
                </div>
                <Switch
                  checked={isActive}
                  onCheckedChange={() => onToggleLayer(layer.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="scale-[0.8]"
                />
              </div>
            );
          })}
        </div>
      </div>
    </ScrollArea>
  );
}
