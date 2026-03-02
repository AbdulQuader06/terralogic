import { useState } from "react";
import MapViewer from "@/components/MapViewer";
import ChatPanel from "@/components/ChatPanel";
import InsightsPanel from "@/components/InsightsPanel";
import LayerControls from "@/components/LayerControls";
import { Button } from "@/components/ui/button";
import { Menu, MessageSquare, BarChart3, Layers } from "lucide-react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

export default function Home() {
  const [activeRightPanel, setActiveRightPanel] = useState<"insights" | "chat" | null>("insights");
  const [activeLeftPanel, setActiveLeftPanel] = useState<"layers" | null>("layers");
  
  // Selected location coordinates (mock initial state for San Francisco)
  const [selectedLocation, setSelectedLocation] = useState<{lat: number, lon: number, name: string} | null>({
    lat: 37.7749, 
    lon: -122.4194,
    name: "San Francisco, CA"
  });

  const handleLocationSelect = (lat: number, lon: number, name: string) => {
    setSelectedLocation({ lat, lon, name });
  };

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden flex-col">
      {/* Top Header */}
      <header className="h-14 border-b border-border bg-card flex items-center px-4 justify-between z-10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-primary-foreground font-bold">
            A
          </div>
          <h1 className="font-semibold text-lg text-foreground tracking-tight">Aino <span className="font-light text-muted-foreground">Spatial Analysis</span></h1>
        </div>
        
        <div className="flex items-center gap-2">
          <Button 
            variant={activeRightPanel === "insights" ? "default" : "ghost"} 
            size="sm" 
            onClick={() => setActiveRightPanel(activeRightPanel === "insights" ? null : "insights")}
            className="flex items-center gap-2"
          >
            <BarChart3 className="w-4 h-4" />
            <span className="hidden md:inline">Insights</span>
          </Button>
          <Button 
            variant={activeRightPanel === "chat" ? "default" : "ghost"} 
            size="sm" 
            onClick={() => setActiveRightPanel(activeRightPanel === "chat" ? null : "chat")}
            className="flex items-center gap-2"
          >
            <MessageSquare className="w-4 h-4" />
            <span className="hidden md:inline">AI Assistant</span>
          </Button>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="flex-1 flex overflow-hidden relative">
        <ResizablePanelGroup direction="horizontal">
          {/* Left Panel: Layers */}
          {activeLeftPanel === "layers" && (
            <>
              <ResizablePanel defaultSize={20} minSize={15} maxSize={30} className="bg-card border-r border-border z-10 flex flex-col h-full shadow-md relative">
                <LayerControls />
              </ResizablePanel>
              <ResizableHandle />
            </>
          )}

          {/* Center Panel: Map */}
          <ResizablePanel defaultSize={activeRightPanel ? 55 : 80} className="relative z-0">
            {/* Absolute positioned toggle for left panel if closed */}
            {activeLeftPanel === null && (
              <Button 
                variant="secondary" 
                size="icon" 
                className="absolute top-4 left-4 z-20 shadow-md"
                onClick={() => setActiveLeftPanel("layers")}
              >
                <Layers className="w-5 h-5" />
              </Button>
            )}
            
            <MapViewer onLocationSelect={handleLocationSelect} />
            
            {/* Floating Selection Card */}
            {selectedLocation && (
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-card/90 backdrop-blur-md border border-border p-4 rounded-xl shadow-lg z-10 flex items-center gap-4 animate-in slide-in-from-bottom-5">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Selected Area</p>
                  <h3 className="font-medium">{selectedLocation.name}</h3>
                </div>
                <div className="h-8 w-px bg-border mx-2"></div>
                <div className="flex gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Lat</p>
                    <p className="font-mono text-sm">{selectedLocation.lat.toFixed(4)}°</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Lon</p>
                    <p className="font-mono text-sm">{selectedLocation.lon.toFixed(4)}°</p>
                  </div>
                </div>
              </div>
            )}
          </ResizablePanel>

          {/* Right Panel: Insights or Chat */}
          {activeRightPanel && (
            <>
              <ResizableHandle />
              <ResizablePanel defaultSize={25} minSize={20} maxSize={40} className="bg-card border-l border-border z-10 shadow-[-4px_0_15px_rgba(0,0,0,0.05)]">
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