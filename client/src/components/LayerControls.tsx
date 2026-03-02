import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Layers, Mountain, Droplets, Trees, Building, GraduationCap,
  Bus, Building2, MapPin, Waves, Loader2
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface LayerConfig {
  id: string;
  name: string;
  description: string;
  icon: any;
  source: string;
  color: string;
  category: "environmental" | "infrastructure" | "risk";
}

const LAYERS: LayerConfig[] = [
  { id: "elevation", name: "Elevation & Terrain", description: "USGS elevation contour data", icon: Mountain, source: "USGS", color: "#059669", category: "environmental" },
  { id: "flood", name: "Flood Risk Zones", description: "FEMA National Flood Hazard Layer", icon: Droplets, source: "FEMA", color: "#DC2626", category: "risk" },
  { id: "soil", name: "Soil Composition", description: "USDA soil survey data", icon: Trees, source: "USDA", color: "#A16207", category: "environmental" },
  { id: "landuse", name: "Land Use / Zoning", description: "OpenStreetMap land use data", icon: MapPin, source: "OSM", color: "#7C3AED", category: "environmental" },
  { id: "water", name: "Water Bodies", description: "Rivers, lakes, and waterways", icon: Waves, source: "OSM", color: "#06B6D4", category: "environmental" },
  { id: "schools", name: "Schools & Education", description: "Schools, colleges, universities", icon: GraduationCap, source: "OSM", color: "#8B5CF6", category: "infrastructure" },
  { id: "hospitals", name: "Healthcare Facilities", description: "Hospitals, clinics, doctors", icon: Building2, source: "OSM", color: "#EF4444", category: "infrastructure" },
  { id: "transit", name: "Transit & Transport", description: "Bus stops, train stations", icon: Bus, source: "OSM", color: "#3B82F6", category: "infrastructure" },
  { id: "parks", name: "Parks & Green Spaces", description: "Parks, gardens, nature reserves", icon: Trees, source: "OSM", color: "#22C55E", category: "infrastructure" },
  { id: "infrastructure", name: "Civil Infrastructure", description: "Roads, fire stations, police", icon: Building, source: "OSM", color: "#F59E0B", category: "infrastructure" },
];

interface LayerControlsProps {
  activeLayers: string[];
  onToggleLayer: (id: string) => void;
  loadingLayers: string[];
}

export default function LayerControls({ activeLayers, onToggleLayer, loadingLayers }: LayerControlsProps) {
  const envLayers = LAYERS.filter(l => l.category === "environmental" || l.category === "risk");
  const infraLayers = LAYERS.filter(l => l.category === "infrastructure");

  const renderLayerGroup = (title: string, layers: LayerConfig[]) => (
    <div className="mb-4">
      <h3 className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2 px-1">{title}</h3>
      <div className="space-y-1">
        {layers.map((layer) => {
          const isActive = activeLayers.includes(layer.id);
          const isLoading = loadingLayers.includes(layer.id);
          return (
            <div
              key={layer.id}
              className={`flex items-center justify-between p-2.5 rounded-lg border transition-all cursor-pointer ${
                isActive
                  ? "bg-card border-border shadow-sm"
                  : "bg-transparent border-transparent hover:bg-muted/50"
              }`}
              onClick={() => onToggleLayer(layer.id)}
              data-testid={`layer-toggle-${layer.id}`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className="p-1.5 rounded-md shrink-0"
                  style={{
                    backgroundColor: isActive ? `${layer.color}15` : "transparent",
                    color: isActive ? layer.color : "hsl(var(--muted-foreground))",
                  }}
                >
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <layer.icon className="w-4 h-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <Label className="font-medium text-sm cursor-pointer block truncate">
                    {layer.name}
                  </Label>
                  <p className="text-[10px] text-muted-foreground truncate">{layer.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 font-mono">
                  {layer.source}
                </Badge>
                <Switch
                  checked={isActive}
                  onCheckedChange={() => onToggleLayer(layer.id)}
                  className="scale-75"
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full w-full">
      <div className="p-4 border-b border-border bg-muted/30">
        <h2 className="font-semibold flex items-center gap-2 text-sm">
          <Layers className="w-4 h-4 text-primary" />
          Data Layers
        </h2>
        <p className="text-[11px] text-muted-foreground mt-1">
          Toggle GIS overlays from real data sources
        </p>
        {activeLayers.length > 0 && (
          <Badge variant="secondary" className="mt-2 text-[10px]">
            {activeLayers.length} active
          </Badge>
        )}
      </div>

      <ScrollArea className="flex-1 p-3">
        {renderLayerGroup("Environmental & Risk", envLayers)}
        {renderLayerGroup("Infrastructure & Amenities", infraLayers)}
      </ScrollArea>
    </div>
  );
}