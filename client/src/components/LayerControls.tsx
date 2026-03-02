import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Layers, Mountain, Droplets, Trees, Building, Map as MapIcon, ChevronDown, ChevronRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export default function LayerControls() {
  const [layers, setLayers] = useState([
    { id: "elevation", name: "Elevation & Terrain", icon: Mountain, active: true, opacity: 80 },
    { id: "flood", name: "Flood Risk Zones", icon: Droplets, active: false, opacity: 50 },
    { id: "soil", name: "Soil Composition", icon: Trees, active: false, opacity: 60 },
    { id: "zoning", name: "Land Use / Zoning", icon: MapIcon, active: true, opacity: 70 },
    { id: "infrastructure", name: "Urban Infrastructure", icon: Building, active: true, opacity: 100 },
  ]);

  const toggleLayer = (id: string) => {
    setLayers(layers.map(l => l.id === id ? { ...l, active: !l.active } : l));
  };

  const updateOpacity = (id: string, value: number[]) => {
    setLayers(layers.map(l => l.id === id ? { ...l, opacity: value[0] } : l));
  };

  return (
    <div className="flex flex-col h-full w-full">
      <div className="p-4 border-b border-border bg-muted/30">
        <h2 className="font-semibold flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary" />
          Data Layers
        </h2>
        <p className="text-xs text-muted-foreground mt-1">Configure active map visualizations</p>
      </div>

      <ScrollArea className="flex-1 p-2">
        <div className="space-y-2 pb-4">
          {layers.map((layer) => (
            <Collapsible key={layer.id} className="border border-border rounded-lg bg-card overflow-hidden">
              <div className="flex items-center justify-between p-3">
                <div className="flex items-center gap-3">
                  <div className={`p-1.5 rounded-md ${layer.active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                    <layer.icon className="w-4 h-4" />
                  </div>
                  <Label htmlFor={`switch-${layer.id}`} className="font-medium cursor-pointer">
                    {layer.name}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch 
                    id={`switch-${layer.id}`} 
                    checked={layer.active} 
                    onCheckedChange={() => toggleLayer(layer.id)} 
                  />
                  <CollapsibleTrigger asChild>
                    <button className="p-1 hover:bg-muted rounded text-muted-foreground">
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </CollapsibleTrigger>
                </div>
              </div>
              
              <CollapsibleContent>
                <div className="px-4 pb-4 pt-1 bg-muted/20 border-t border-border/50">
                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between text-xs mb-2">
                        <span className="text-muted-foreground">Opacity</span>
                        <span className="font-mono">{layer.opacity}%</span>
                      </div>
                      <Slider 
                        value={[layer.opacity]} 
                        min={0} max={100} step={1} 
                        onValueChange={(v) => updateOpacity(layer.id, v)}
                        disabled={!layer.active}
                      />
                    </div>
                    
                    {/* Mock Legend specific to layers */}
                    {layer.active && layer.id === "flood" && (
                      <div className="mt-2 text-xs">
                        <p className="text-muted-foreground mb-1.5">Legend</p>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-sm bg-blue-500/50"></div> Low Risk</div>
                          <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-sm bg-orange-500/50"></div> Moderate</div>
                          <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-sm bg-red-500/50"></div> High Risk</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}