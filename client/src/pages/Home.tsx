import { useState, useEffect, useCallback, useRef } from "react";
import MapViewer from "@/components/MapViewer";
import type { MapViewerHandle, DrawnRegion } from "@/components/MapViewer";
import { drawnRegionToPolygonParam } from "@/components/MapViewer";
import ChatPanel from "@/components/ChatPanel";
import type { MapAction } from "@/components/ChatPanel";
import InsightsPanel from "@/components/InsightsPanel";
import LayerControls from "@/components/LayerControls";
import QuickOSM from "@/components/QuickOSM";
import { Button } from "@/components/ui/button";
import { Download, CheckCircle, ChevronDown, Search, Loader2, X, Camera, Sun, Moon, FileText, Image, Map, Eye, EyeOff, Lock, Unlock, MapPin, Navigation } from "lucide-react";
import { useTheme } from "@/lib/theme";

interface CustomOverlay {
  id: string;
  label: string;
  color: string;
  data: any;
  visible?: boolean;
}

export default function Home() {
  const mapRef = useRef<MapViewerHandle>(null);
  const { theme, toggleTheme, isDark } = useTheme();
  const [arcgisApiKey, setArcgisApiKey] = useState("");
  const [activeLayers, setActiveLayers] = useState<string[]>([]);
  const [loadingLayers, setLoadingLayers] = useState<string[]>([]);
  const [leftTab, setLeftTab] = useState<"layers" | "chat" | "query">("layers");
  const [selectedLocation, setSelectedLocation] = useState<{lat: number, lon: number, name: string}>({
    lat: 37.7749,
    lon: -122.4194,
    name: "San Francisco, CA"
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [analysisReady, setAnalysisReady] = useState(false);
  const [customOverlays, setCustomOverlays] = useState<CustomOverlay[]>([]);
  const [drawnRegion, setDrawnRegion] = useState<DrawnRegion>(null);
  const [showMapExportMenu, setShowMapExportMenu] = useState(false);
  const [showReportExportMenu, setShowReportExportMenu] = useState(false);
  const [locationLocked, setLocationLocked] = useState(true);

  const [geolocating, setGeolocating] = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then(res => res.json())
      .then(data => setArcgisApiKey(data.arcgisApiKey || ""))
      .catch(() => {});
  }, []);

  const geolocateAbortRef = useRef(false);

  useEffect(() => {
    if (!navigator.geolocation) return;
    setGeolocating(true);
    geolocateAbortRef.current = false;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (geolocateAbortRef.current) { setGeolocating(false); return; }
        const { latitude, longitude } = pos.coords;
        try {
          const resp = await fetch(`/api/reverse-geocode?lat=${latitude}&lon=${longitude}`);
          const data = await resp.json();
          const name = data.name || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
          setLocationLocked(false);
          setSelectedLocation({ lat: latitude, lon: longitude, name });
          setAnalysisReady(false);
          setLocationLocked(true);
        } catch {
          setLocationLocked(false);
          setSelectedLocation({ lat: latitude, lon: longitude, name: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}` });
          setLocationLocked(true);
        }
        setGeolocating(false);
      },
      () => { setGeolocating(false); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
    return () => { geolocateAbortRef.current = true; };
  }, []);

  const handleLocationSelect = useCallback((lat: number, lon: number, name: string) => {
    if (locationLocked) return;
    setSelectedLocation({ lat, lon, name });
    setAnalysisReady(false);
    setLocationLocked(true);
  }, [locationLocked]);

  const handleToggleLayer = useCallback((id: string) => {
    setActiveLayers(prev =>
      prev.includes(id) ? prev.filter(l => l !== id) : [...prev, id]
    );
  }, []);

  const handleLayerLoading = useCallback((layerId: string, loading: boolean) => {
    setLoadingLayers(prev =>
      loading ? [...prev.filter(l => l !== layerId), layerId] : prev.filter(l => l !== layerId)
    );
  }, []);

  const handleCustomDataLoaded = useCallback((data: any, label: string, color: string) => {
    const id = `custom-${Date.now()}`;
    setCustomOverlays(prev => [...prev, { id, label, color, data }]);
  }, []);

  const removeCustomOverlay = useCallback((id: string) => {
    setCustomOverlays(prev => prev.filter(o => o.id !== id));
  }, []);

  const toggleOverlayVisibility = useCallback((id: string) => {
    setCustomOverlays(prev => prev.map(o => o.id === id ? { ...o, visible: o.visible === false ? true : false } : o));
  }, []);

  const handleMapAction = useCallback((action: MapAction) => {
    switch (action.action) {
      case "update_map_view":
        if (action.lat !== undefined && action.lon !== undefined) {
          setLocationLocked(false);
          setSelectedLocation({ lat: action.lat, lon: action.lon, name: action.name || `${action.lat.toFixed(4)}, ${action.lon.toFixed(4)}` });
          setAnalysisReady(false);
          setLocationLocked(true);
          if (action.zoom && mapRef.current) {
            setTimeout(() => {
              const map = (mapRef.current as any)?._leafletMap || (document.querySelector('.leaflet-container') as any)?._leaflet_map;
              if (map?.setZoom) map.setZoom(action.zoom);
            }, 300);
          }
        }
        break;
      case "add_marker":
        if (action.lat !== undefined && action.lon !== undefined) {
          const markerGeoJSON = {
            type: "FeatureCollection",
            features: [{
              type: "Feature",
              geometry: { type: "Point", coordinates: [action.lon, action.lat] },
              properties: { name: action.label || "Marker", _color: action.color || "#3B82F6" },
            }],
          };
          setCustomOverlays(prev => [...prev, {
            id: `cartoai-marker-${Date.now()}`,
            label: action.label || "CartoAI Marker",
            color: action.color || "#3B82F6",
            data: markerGeoJSON,
          }]);
        }
        break;
      case "add_geojson":
        if (action.geojson) {
          setCustomOverlays(prev => [...prev, {
            id: `cartoai-geojson-${Date.now()}`,
            label: action.label || "CartoAI Overlay",
            color: action.color || "#3B82F6",
            data: action.geojson,
          }]);
        }
        break;
      case "clear_map":
        setCustomOverlays(prev => prev.filter(o => !o.id.startsWith("cartoai-")));
        break;
      case "search_results":
        if (action.places && action.places.length > 0) {
          const searchGeoJSON = {
            type: "FeatureCollection",
            features: action.places.map((p: any) => ({
              type: "Feature",
              geometry: { type: "Point", coordinates: [p.lon, p.lat] },
              properties: { name: p.name, ...p.tags },
            })),
          };
          setCustomOverlays(prev => [...prev, {
            id: `cartoai-search-${Date.now()}`,
            label: `${action.query || "Search"} (${action.count})`,
            color: "#F59E0B",
            data: searchGeoJSON,
          }]);
        }
        break;
      case "analyze_site":
        if (action.analysis) {
          setAnalysisReady(true);
        }
        break;
    }
  }, [handleLocationSelect]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(searchQuery)}`);
      const data = await response.json();
      setSearchResults(data || []);
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const selectSearchResult = (result: any) => {
    const { x, y } = result.location;
    setLocationLocked(false);
    setSelectedLocation({ lat: y, lon: x, name: result.address });
    setAnalysisReady(false);
    setLocationLocked(true);
    setSearchResults([]);
    setSearchQuery(result.address);
  };

  const getAnalysisData = async () => {
    if (!selectedLocation) return null;
    const r = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: selectedLocation.lat, lon: selectedLocation.lon, name: selectedLocation.name }),
    });
    return r.json();
  };

  const buildReportText = (analysis: any) => {
    const sunPath = analysis.sunPathData;
    const luMix = analysis.landUseMix?.map((l: any) => `${l.label}: ${l.value}%`).join(", ") || "N/A";
    const amMix = analysis.amenityMix?.map((a: any) => `${a.label}: ${a.value}%`).join(", ") || "N/A";
    return `TerraLogic AI - Site Analysis Report
==========================================
Location: ${selectedLocation.name}
Coordinates: ${selectedLocation.lat.toFixed(6)}, ${selectedLocation.lon.toFixed(6)}
Date: ${new Date().toLocaleDateString()}

Overall Suitability: ${analysis.overallScore}/100 (${analysis.rating})

AI Narrative:
${analysis.aiNarrative || 'N/A'}

Site Information:
- Elevation: ${analysis.siteInfo?.elevation || 'N/A'} ${analysis.siteInfo?.elevationUnit || 'm ASL'}
- Zoning: ${analysis.siteInfo?.zoning || 'N/A'}

Environmental Metrics:
- Sun Exposure: ${analysis.environmentalMetrics?.sunExposure || 'N/A'}%
- Soil Quality: ${analysis.environmentalMetrics?.soilQuality || 'N/A'}%
- Wind Exposure: ${analysis.environmentalMetrics?.windExposure || 'N/A'}%
- Flood Risk: ${analysis.environmentalMetrics?.floodRisk || 'N/A'}

Land Use Mix:
${luMix}

Amenity Mix:
${amMix}

${sunPath ? `Sun Path Data:
- Sunrise: ${sunPath.sunrise}
- Sunset: ${sunPath.sunset}
- Day Length: ${sunPath.dayLength}h
- Solar Noon: ${sunPath.solarNoon}
- Max Solar Altitude: ${sunPath.maxAltitude}°
` : ''}
Development Density:
- Density Index: ${analysis.developmentDensity?.densityIndex || 'N/A'}
- Label: ${analysis.developmentDensity?.densityLabel || 'N/A'}
- Building Footprint: ${analysis.developmentDensity?.buildingFootprint || 'N/A'}%
- Infrastructure Coverage: ${analysis.developmentDensity?.infrastructureCoverage || 'N/A'}%

Factors:
${analysis.factors?.map((f: any) => `- ${f.name}: ${f.value}% (${f.category})`).join('\n') || 'N/A'}

Nearby Amenities:
- Schools: ${analysis.amenities?.schools || 0}
- Transit Stops: ${analysis.amenities?.transitStops || 0}
- Hospitals: ${analysis.amenities?.hospitals || 0}
- Parks: ${analysis.amenities?.parks || 0}

Elevation Profile:
${analysis.elevationProfile?.map((p: any) => `${p.distance}m: ${p.elevation}m`).join(', ') || 'N/A'}

Recommendations:
${analysis.recommendations?.map((r: any) => `[${r.type.toUpperCase()}] ${r.title}: ${r.description}`).join('\n') || 'N/A'}

Generated by TerraLogic AI - GIS Spatial Analysis Platform`;
  };

  const generatePDF = (text: string, locationName: string, analysis: any): Uint8Array => {
    const lines = text.split('\n');
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const margin = 50;
    const lineHeight = 14;
    const maxWidth = pageWidth - margin * 2;
    let y = pageHeight - margin;
    const contentLines: string[] = [];

    for (const line of lines) {
      if (line.length > 90) {
        const words = line.split(' ');
        let current = '';
        for (const word of words) {
          if ((current + ' ' + word).length > 90 && current) {
            contentLines.push(current);
            current = word;
          } else {
            current = current ? current + ' ' + word : word;
          }
        }
        if (current) contentLines.push(current);
      } else {
        contentLines.push(line);
      }
    }

    let pageContent = '';
    let pages: string[] = [];
    let currentPageLines: string[] = [];

    for (const line of contentLines) {
      if (y - lineHeight < margin) {
        pages.push(currentPageLines.join('\n'));
        currentPageLines = [];
        y = pageHeight - margin;
      }
      const escaped = line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
      currentPageLines.push(`BT /F1 10 Tf ${margin} ${y.toFixed(2)} Td (${escaped}) Tj ET`);
      y -= lineHeight;
    }
    if (currentPageLines.length > 0) pages.push(currentPageLines.join('\n'));

    let objects: string[] = [];
    let offsets: number[] = [];
    let output = '%PDF-1.4\n';

    const addObj = (content: string) => {
      offsets.push(output.length);
      const num = objects.length + 1;
      const obj = `${num} 0 obj\n${content}\nendobj\n`;
      objects.push(obj);
      output += obj;
      return num;
    };

    addObj('<< /Type /Catalog /Pages 2 0 R >>');

    const pageRefs = pages.map((_, i) => `${i + 4} 0 R`).join(' ');
    addObj(`<< /Type /Pages /Kids [${pageRefs}] /Count ${pages.length} >>`);
    addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

    for (let i = 0; i < pages.length; i++) {
      const streamContent = pages[i];
      const streamLen = new TextEncoder().encode(streamContent).length;
      const streamObjNum = objects.length + 2;
      addObj(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${streamObjNum} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
      addObj(`<< /Length ${streamLen} >>\nstream\n${streamContent}\nendstream`);
    }

    const xrefOffset = output.length;
    output += 'xref\n';
    output += `0 ${objects.length + 1}\n`;
    output += '0000000000 65535 f \n';
    for (const offset of offsets) {
      output += `${String(offset).padStart(10, '0')} 00000 n \n`;
    }
    output += 'trailer\n';
    output += `<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
    output += 'startxref\n';
    output += `${xrefOffset}\n`;
    output += '%%EOF\n';

    return new TextEncoder().encode(output);
  };

  const exportReport = async (format: string) => {
    const analysis = await getAnalysisData();
    if (!analysis || !selectedLocation) return;
    const safeName = selectedLocation.name.replace(/[^a-zA-Z0-9]/g, '_');

    if (format === "txt") {
      const text = buildReportText(analysis);
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `TerraLogic_Report_${safeName}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } else if (format === "csv") {
      const rows: string[][] = [["Field", "Value"]];
      rows.push(["Location", selectedLocation.name]);
      rows.push(["Latitude", selectedLocation.lat.toFixed(6)]);
      rows.push(["Longitude", selectedLocation.lon.toFixed(6)]);
      rows.push(["Date", new Date().toLocaleDateString()]);
      rows.push(["Overall Score", `${analysis.overallScore}/100`]);
      rows.push(["Rating", analysis.rating]);
      rows.push(["Elevation", `${analysis.siteInfo?.elevation || 'N/A'} ${analysis.siteInfo?.elevationUnit || ''}`]);
      rows.push(["Zoning", analysis.siteInfo?.zoning || 'N/A']);
      rows.push(["Sun Exposure", `${analysis.environmentalMetrics?.sunExposure || 'N/A'}%`]);
      rows.push(["Soil Quality", `${analysis.environmentalMetrics?.soilQuality || 'N/A'}%`]);
      rows.push(["Wind Exposure", `${analysis.environmentalMetrics?.windExposure || 'N/A'}%`]);
      rows.push(["Flood Risk", analysis.environmentalMetrics?.floodRisk || 'N/A']);
      rows.push(["Schools", String(analysis.amenities?.schools || 0)]);
      rows.push(["Transit Stops", String(analysis.amenities?.transitStops || 0)]);
      rows.push(["Hospitals", String(analysis.amenities?.hospitals || 0)]);
      rows.push(["Parks", String(analysis.amenities?.parks || 0)]);
      rows.push(["Density Index", String(analysis.developmentDensity?.densityIndex || 'N/A')]);
      rows.push(["Density Label", analysis.developmentDensity?.densityLabel || 'N/A']);
      if (analysis.sunPathData) {
        rows.push(["Sunrise", analysis.sunPathData.sunrise]);
        rows.push(["Sunset", analysis.sunPathData.sunset]);
        rows.push(["Day Length", `${analysis.sunPathData.dayLength}h`]);
        rows.push(["Max Solar Altitude", `${analysis.sunPathData.maxAltitude}°`]);
      }
      if (analysis.landUseMix) {
        analysis.landUseMix.forEach((l: any) => rows.push([`Land Use: ${l.label}`, `${l.value}%`]));
      }
      if (analysis.amenityMix) {
        analysis.amenityMix.forEach((a: any) => rows.push([`Amenity: ${a.label}`, `${a.value}%`]));
      }
      analysis.factors?.forEach((f: any) => rows.push([`Factor: ${f.name}`, `${f.value}% (${f.category})`]));
      analysis.recommendations?.forEach((r: any) => rows.push([`Rec [${r.type}]: ${r.title}`, r.description]));

      const csvContent = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
      const blob = new Blob([csvContent], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `TerraLogic_Report_${safeName}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } else if (format === "pdf") {
      const text = buildReportText(analysis);
      const pdfContent = generatePDF(text, selectedLocation.name, analysis);
      const blob = new Blob([pdfContent], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `TerraLogic_Report_${safeName}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    }
    setShowReportExportMenu(false);
  };

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden flex-col">
      <header className="h-12 border-b border-border bg-card flex items-center px-4 justify-between z-10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center" data-testid="logo">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
            </div>
            <span className="font-semibold text-sm text-foreground tracking-tight">TerraLogic AI</span>
          </div>

          <div className="hidden md:flex items-center gap-1 ml-2 px-3 py-1.5 bg-muted/60 rounded-md border border-border cursor-default" data-testid="project-selector">
            <span className="text-xs text-muted-foreground truncate max-w-[200px]">
              {selectedLocation.name || "Select Location"}
            </span>
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={toggleTheme}
            data-testid="button-theme-toggle"
            className="relative w-8 h-8 rounded-lg border border-border flex items-center justify-center transition-all duration-300 hover:scale-105"
            style={{
              background: isDark
                ? "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)"
                : "#F7F9FB",
              borderColor: isDark ? "hsl(220, 30%, 25%)" : "#E5E7EB",
            }}
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          >
            {isDark ? (
              <Moon className="w-4 h-4 text-blue-300" />
            ) : (
              <Sun className="w-4 h-4 text-amber-600" />
            )}
          </button>

          <div className="relative">
            <Button
              size="sm"
              onClick={() => { setShowMapExportMenu(!showMapExportMenu); setShowReportExportMenu(false); }}
              className="border-primary/40 text-primary hover:bg-primary/10 text-xs h-7 px-3"
              variant="outline"
              data-testid="button-export-map"
            >
              <Camera className="w-3 h-3 mr-1" />
              Export Map
              <ChevronDown className="w-3 h-3 ml-1" />
            </Button>
            {showMapExportMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMapExportMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-lg shadow-xl py-1 min-w-[140px]" data-testid="menu-export-map">
                  {[
                    { format: "png", label: "PNG Image", icon: "🖼️" },
                    { format: "jpeg", label: "JPEG Image", icon: "📷" },
                    { format: "dxf", label: "DXF (CAD)", icon: "📐" },
                    { format: "geojson", label: "GeoJSON", icon: "🗺️" },
                    { format: "kml", label: "KML (Google Earth)", icon: "🌍" },
                  ].map(opt => (
                    <button
                      key={opt.format}
                      onClick={() => { mapRef.current?.exportMapAs(opt.format); setShowMapExportMenu(false); }}
                      className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-muted/80 flex items-center gap-2 transition-colors"
                      data-testid={`export-map-${opt.format}`}
                    >
                      <span className="text-sm">{opt.icon}</span>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="relative">
            <Button
              size="sm"
              onClick={() => { setShowReportExportMenu(!showReportExportMenu); setShowMapExportMenu(false); }}
              className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs h-7 px-3"
              data-testid="button-export"
            >
              <Download className="w-3 h-3 mr-1" />
              Export Report
              <ChevronDown className="w-3 h-3 ml-1" />
            </Button>
            {showReportExportMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowReportExportMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-lg shadow-xl py-1 min-w-[140px]" data-testid="menu-export-report">
                  {[
                    { format: "pdf", label: "PDF Document", icon: "📄" },
                    { format: "csv", label: "CSV Spreadsheet", icon: "📊" },
                    { format: "txt", label: "Text File", icon: "📝" },
                  ].map(opt => (
                    <button
                      key={opt.format}
                      onClick={() => exportReport(opt.format)}
                      className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-muted/80 flex items-center gap-2 transition-colors"
                      data-testid={`export-report-${opt.format}`}
                    >
                      <span className="text-sm">{opt.icon}</span>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-[300px] min-w-[260px] border-r border-border bg-card flex flex-col shrink-0">
          <div className="p-4 pb-3">
            <h2 className="font-semibold text-sm text-foreground" data-testid="text-project-overview">Project Overview</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">Urban analysis & site intelligence</p>
          </div>

          <div className="px-4 pb-3">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">Search Location</label>
            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder="City, address, or coordinates..."
                  className="w-full bg-input border border-border rounded-md px-3 pl-8 py-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/50"
                  data-testid="input-search-location"
                />
              </div>
              <Button
                size="sm"
                onClick={handleSearch}
                disabled={!searchQuery.trim() || isSearching}
                className="h-[34px] w-[34px] p-0 bg-primary hover:bg-primary/90"
                data-testid="button-search"
              >
                {isSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  if (!navigator.geolocation) return;
                  setGeolocating(true);
                  navigator.geolocation.getCurrentPosition(
                    async (pos) => {
                      const { latitude, longitude } = pos.coords;
                      try {
                        const resp = await fetch(`/api/reverse-geocode?lat=${latitude}&lon=${longitude}`);
                        const data = await resp.json();
                        setLocationLocked(false);
                        setSelectedLocation({ lat: latitude, lon: longitude, name: data.name || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}` });
                        setAnalysisReady(false);
                        setLocationLocked(true);
                      } catch {
                        setLocationLocked(false);
                        setSelectedLocation({ lat: latitude, lon: longitude, name: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}` });
                        setLocationLocked(true);
                      }
                      setGeolocating(false);
                    },
                    () => { setGeolocating(false); },
                    { enableHighAccuracy: true, timeout: 10000 }
                  );
                }}
                disabled={geolocating}
                className="h-[34px] w-[34px] p-0"
                variant="outline"
                title="Use my current location"
                data-testid="button-locate-me"
              >
                {geolocating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Navigation className="w-3.5 h-3.5" />}
              </Button>
            </div>
            {searchResults.length > 0 && (
              <div className="mt-1 bg-card border border-border rounded-md shadow-lg overflow-hidden max-h-[180px] overflow-y-auto">
                {searchResults.map((r, i) => (
                  <div
                    key={i}
                    onClick={() => selectSearchResult(r)}
                    className="px-3 py-2 text-xs text-foreground hover:bg-muted/60 cursor-pointer border-b border-border/50 last:border-0"
                    data-testid={`search-result-${i}`}
                  >
                    {r.address}
                  </div>
                ))}
              </div>
            )}

            {selectedLocation && (
              <div className="mt-2 flex items-center gap-1.5 px-1" data-testid="location-lock-bar">
                <MapPin className="w-3 h-3 shrink-0" style={{ color: "#2A9D8F" }} />
                <span className="text-[10px] text-foreground truncate flex-1" title={selectedLocation.name}>
                  {selectedLocation.name}
                </span>
                <button
                  onClick={() => setLocationLocked(!locationLocked)}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors shrink-0"
                  style={{
                    background: locationLocked ? "rgba(42,157,143,0.1)" : "rgba(107,114,128,0.1)",
                    color: locationLocked ? "#2A9D8F" : "#6B7280",
                  }}
                  title={locationLocked ? "Location locked — click to unlock and allow map clicks to change it" : "Location unlocked — map clicks will change analysis location"}
                  data-testid="button-toggle-location-lock"
                >
                  {locationLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                  {locationLocked ? "Locked" : "Unlocked"}
                </button>
              </div>
            )}
          </div>

          <div className="px-4 pb-2 flex gap-1">
            <button
              onClick={() => setLeftTab("layers")}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                leftTab === "layers"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
              }`}
              data-testid="button-tab-layers"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m12 2 10 6.5v7L12 22 2 15.5v-7L12 2z"/><path d="M12 22V15.5"/><path d="m22 8.5-10 7-10-7"/></svg>
              Layers
            </button>
            <button
              onClick={() => setLeftTab("query")}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                leftTab === "query"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
              }`}
              data-testid="button-tab-query"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              QuickOSM
            </button>
            <button
              onClick={() => setLeftTab("chat")}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                leftTab === "chat"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
              }`}
              data-testid="button-tab-chat"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="m2 14 6-6 6 6"/></svg>
              AI
            </button>
          </div>

          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            {leftTab === "layers" ? (
              <LayerControls
                activeLayers={activeLayers}
                onToggleLayer={handleToggleLayer}
                loadingLayers={loadingLayers}
              />
            ) : leftTab === "query" ? (
              <QuickOSM location={selectedLocation} onDataLoaded={handleCustomDataLoaded} drawnRegion={drawnRegion} />
            ) : (
              <ChatPanel
                location={selectedLocation}
                onToggleLayer={handleToggleLayer}
                activeLayers={activeLayers}
                onMapAction={handleMapAction}
                drawnRegion={drawnRegion}
                customOverlays={customOverlays}
                getMapBounds={() => mapRef.current?.getMapBounds?.() || null}
              />
            )}
          </div>

          {customOverlays.length > 0 && (
            <div className="px-3 py-2 border-t border-border">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">Custom Overlays</p>
              <div className="space-y-0.5 max-h-[80px] overflow-y-auto">
                {customOverlays.map((overlay) => (
                  <div key={overlay.id} className="flex items-center gap-2 text-[11px]">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: overlay.visible === false ? "var(--muted-foreground)" : overlay.color }} />
                    <span className={`truncate flex-1 ${overlay.visible === false ? "text-muted-foreground line-through" : "text-foreground"}`}>{overlay.label}</span>
                    <span className="text-muted-foreground text-[10px]">{overlay.data?.features?.length || 0}</span>
                    <button onClick={() => toggleOverlayVisibility(overlay.id)} className="text-muted-foreground hover:text-foreground shrink-0" data-testid={`toggle-overlay-${overlay.id}`}>
                      {overlay.visible === false ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    </button>
                    <button onClick={() => removeCustomOverlay(overlay.id)} className="text-muted-foreground hover:text-foreground shrink-0" data-testid={`remove-overlay-${overlay.id}`}>
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="px-4 py-2.5 border-t border-border flex flex-col gap-1 text-[11px] text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>Active Layers <strong className="text-foreground">{activeLayers.length + customOverlays.length}/{10 + customOverlays.length}</strong></span>
              <span className="flex items-center gap-1">
                Analysis Ready
                {analysisReady ? (
                  <CheckCircle className="w-3 h-3 text-primary" />
                ) : (
                  <span className="w-3 h-3 rounded-full border border-muted-foreground/40 inline-block" />
                )}
              </span>
            </div>
            {drawnRegion && (
              <div className="flex items-center justify-between">
                <span className="text-primary flex items-center gap-1">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 22 8.5 18 20 6 20 2 8.5" /></svg>
                  Region filter active ({drawnRegion.type})
                </span>
                <button
                  onClick={() => setDrawnRegion(null)}
                  className="text-red-400 hover:text-red-300 text-[10px] underline"
                  data-testid="button-clear-region"
                >
                  Clear
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 relative z-0">
          <MapViewer
            ref={mapRef}
            onLocationSelect={handleLocationSelect}
            arcgisApiKey={arcgisApiKey}
            activeLayers={activeLayers}
            onLayerLoading={handleLayerLoading}
            selectedLocation={selectedLocation}
            customOverlays={customOverlays.filter(o => o.visible !== false)}
            drawnRegion={drawnRegion}
            onDrawRegion={setDrawnRegion}
          />
        </div>

        <div className="w-[320px] min-w-[280px] border-l border-border bg-card overflow-hidden shrink-0">
          <InsightsPanel location={selectedLocation} onAnalysisReady={() => setAnalysisReady(true)} drawnRegion={drawnRegion} />
        </div>
      </div>
    </div>
  );
}
