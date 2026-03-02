import { useState, useEffect } from "react";
import MapViewer from "@/components/MapViewer";
import ChatPanel from "@/components/ChatPanel";
import InsightsPanel from "@/components/InsightsPanel";
import LayerControls from "@/components/LayerControls";
import { Button } from "@/components/ui/button";
import { MessageSquare, BarChart3, Layers } from "lucide-react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

export default function Home() {
  const [activeRightPanel, setActiveRightPanel] = useState<"insights" | "chat" | null>("insights");
  const [activeLeftPanel, setActiveLeftPanel] = useState<"layers" | null>("layers");
  const [arcgisApiKey, setArcgisApiKey] = useState("");

  const [selectedLocation, setSelectedLocation] = useState<{lat: number, lon: number, name: string} | null>({
    lat: 37.7749,
    lon: -122.4194,
    name: "San Francisco, CA"
  });

  useEffect(() => {
    fetch("/api/config")
      .then(res => res.json())
      .then(data => setArcgisApiKey(data.arcgisApiKey || ""))
      .catch(() => {});
  }, []);

  const handleLocationSelect = (lat: number, lon: number, name: string) => {
    setSelectedLocation({ lat, lon, name });
  };

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden flex-col">
      <header className="h-14 border-b border-border bg-card flex items-center px-4 justify-between z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm" data-testid="logo">
            A
          </div>
          <h1 className="font-semibold text-base text-foreground tracking-tight">
            Aino <span className="font-light text-muted-foreground">Spatial Analysis</span>
          </h1>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant={activeLeftPanel === "layers" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveLeftPanel(activeLeftPanel === "layers" ? null : "layers")}
            className="flex items-center gap-2"
            data-testid="button-toggle-layers"
          >
            <Layers className="w-4 h-4" />
            <span className="hidden md:inline">Layers</span>
          </Button>
          <Button
            variant={activeRightPanel === "insights" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveRightPanel(activeRightPanel === "insights" ? null : "insights")}
            className="flex items-center gap-2"
            data-testid="button-toggle-insights"
          >
            <BarChart3 className="w-4 h-4" />
            <span className="hidden md:inline">Insights</span>
          </Button>
          <Button
            variant={activeRightPanel === "chat" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveRightPanel(activeRightPanel === "chat" ? null : "chat")}
            className="flex items-center gap-2"
            data-testid="button-toggle-chat"
          >
            <MessageSquare className="w-4 h-4" />
            <span className="hidden md:inline">AI Assistant</span>
          </Button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden relative">
        <ResizablePanelGroup direction="horizontal">
          {activeLeftPanel === "layers" && (
            <>
              <ResizablePanel defaultSize={18} minSize={14} maxSize={28} className="bg-card border-r border-border z-10 flex flex-col h-full">
                <LayerControls />
              </ResizablePanel>
              <ResizableHandle />
            </>
          )}

          <ResizablePanel defaultSize={activeRightPanel ? 57 : 82} className="relative z-0">
            <MapViewer onLocationSelect={handleLocationSelect} arcgisApiKey={arcgisApiKey} />

            {selectedLocation && (
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-card/90 backdrop-blur-md border border-border p-3 px-5 rounded-xl shadow-lg z-[500] flex items-center gap-4 animate-in slide-in-from-bottom-5" data-testid="card-selected-location">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Selected Area</p>
                  <h3 className="font-medium text-sm">{selectedLocation.name}</h3>
                </div>
                <div className="h-8 w-px bg-border"></div>
                <div className="flex gap-4">
                  <div>
                    <p className="text-[10px] text-muted-foreground">Lat</p>
                    <p className="font-mono text-xs">{selectedLocation.lat.toFixed(4)}°</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">Lon</p>
                    <p className="font-mono text-xs">{selectedLocation.lon.toFixed(4)}°</p>
                  </div>
                </div>
              </div>
            )}
          </ResizablePanel>

          {activeRightPanel && (
            <>
              <ResizableHandle />
              <ResizablePanel defaultSize={25} minSize={20} maxSize={40} className="bg-card border-l border-border z-10">
                {activeRightPanel === "insights" && <InsightsPanel location={selectedLocation} />}
                {activeRightPanel === "chat" && <ChatPanel location={selectedLocation} />}
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>
    </div>
  );
}