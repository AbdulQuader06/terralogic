import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap, GeoJSON, CircleMarker, Tooltip, Polygon as RLPolygon, Circle as RLCircle, Rectangle as RLRectangle } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import html2canvas from "html2canvas";
import { useTheme } from "@/lib/theme";

export type DrawnRegion = {
  type: "polygon";
  coords: [number, number][];
} | {
  type: "circle";
  center: [number, number];
  radius: number;
} | {
  type: "rectangle";
  bounds: [[number, number], [number, number]];
} | null;

export function drawnRegionToPolygonParam(region: DrawnRegion): string | undefined {
  if (!region) return undefined;
  if (region.type === "polygon") {
    return JSON.stringify(region.coords);
  }
  if (region.type === "circle") {
    const [lat, lon] = region.center;
    const r = region.radius;
    const points: [number, number][] = [];
    for (let i = 0; i < 32; i++) {
      const angle = (i / 32) * 2 * Math.PI;
      const dlat = (r / 111320) * Math.cos(angle);
      const dlon = (r / (111320 * Math.cos(lat * Math.PI / 180))) * Math.sin(angle);
      points.push([lat + dlat, lon + dlon]);
    }
    points.push(points[0]);
    return JSON.stringify(points);
  }
  if (region.type === "rectangle") {
    const [[lat1, lon1], [lat2, lon2]] = region.bounds;
    return JSON.stringify([
      [lat1, lon1], [lat1, lon2], [lat2, lon2], [lat2, lon1], [lat1, lon1]
    ]);
  }
  return undefined;
}

type BasemapType = "dark" | "light" | "satellite" | "road" | "terrain";

const ESRI_BASEMAPS: Record<BasemapType, { url: string; attribution: string; maxZoom: number; label?: string; labelUrl?: string }> = {
  dark: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    attribution: 'Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
    maxZoom: 16,
    label: "Dark",
    labelUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
  },
  light: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    attribution: 'Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
    maxZoom: 16,
    label: "Light",
    labelUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: 'Esri, Maxar, Earthstar Geographics, USDA FSA, GeoEye, &copy; OpenStreetMap contributors',
    maxZoom: 19,
    label: "Satellite",
    labelUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
  },
  road: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: 'Esri, HERE, Garmin, USGS, NGA, EPA, USDA, NPS, &copy; OpenStreetMap contributors',
    maxZoom: 19,
    label: "Road",
  },
  terrain: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: 'Esri, HERE, Garmin, FAO, NOAA, USGS, EPA, NPS, &copy; OpenStreetMap contributors',
    maxZoom: 19,
    label: "Terrain",
  },
};

const markerIcon = new L.DivIcon({
  className: "custom-marker",
  html: `<div style="width:18px;height:18px;background:#00C853;border:3px solid hsl(var(--background));border-radius:50%;box-shadow:0 0 8px rgba(0,200,83,0.5);transform:translate(-50%,-50%)"></div>`,
  iconSize: [18, 18],
  iconAnchor: [0, 0],
});

interface LayerData {
  [key: string]: any;
}

interface CustomOverlay {
  id: string;
  label: string;
  color: string;
  data: any;
}

interface MapViewerProps {
  onLocationSelect: (lat: number, lon: number, name: string) => void;
  arcgisApiKey: string;
  activeLayers: string[];
  onLayerLoading?: (layerId: string, loading: boolean) => void;
  selectedLocation?: { lat: number; lon: number; name: string } | null;
  customOverlays?: CustomOverlay[];
  drawnRegion?: DrawnRegion;
  onDrawRegion?: (region: DrawnRegion) => void;
}

const LAYER_COLORS: Record<string, string> = {
  schools: "#8B5CF6",
  hospitals: "#EF4444",
  transit: "#3B82F6",
  parks: "#22C55E",
  water: "#06B6D4",
  infrastructure: "#F59E0B",
  flood: "#DC2626",
  soil: "#A16207",
  elevation: "#059669",
  landuse: "#7C3AED",
};

const LANDUSE_COLORS: Record<string, string> = {
  residential: "#FCA5A5",
  commercial: "#93C5FD",
  industrial: "#FCD34D",
  retail: "#C4B5FD",
  farmland: "#BBF7D0",
  forest: "#059669",
  grass: "#86EFAC",
  meadow: "#A7F3D0",
  orchard: "#6EE7B7",
  recreation_ground: "#5EEAD4",
  cemetery: "#94A3B8",
  construction: "#FB923C",
  military: "#F87171",
  railway: "#A1A1AA",
  reservoir: "#7DD3FC",
};

function getContourColor(elev: number): string {
  if (elev < 10) return "#2166ac";
  if (elev < 50) return "#4393c3";
  if (elev < 100) return "#92c5de";
  if (elev < 200) return "#d1e5f0";
  if (elev < 500) return "#fddbc7";
  if (elev < 1000) return "#f4a582";
  if (elev < 2000) return "#d6604d";
  return "#b2182b";
}

function getWRBSoilColor(soilType: string): string {
  const colors: Record<string, string> = {
    Acrisols: "#E8A040", Alisols: "#D4A050", Andosols: "#4A3728",
    Arenosols: "#F5DEB3", Calcisols: "#F0E68C", Cambisols: "#8FBC8F",
    Chernozems: "#2F4F2F", Cryosols: "#B0C4DE", Durisols: "#C4A882",
    Ferralsols: "#CD5C5C", Fluvisols: "#90B88C", Gleysols: "#708090",
    Gypsisols: "#FAEBD7", Histosols: "#2D1B0E", Kastanozems: "#8B6914",
    Leptosols: "#A9A9A9", Lixisols: "#DAA520", Luvisols: "#BC8F5F",
    Nitisols: "#B22222", Phaeozems: "#3B5323", Planosols: "#9ACD32",
    Plinthosols: "#DC7633", Podzols: "#C0C0C0", Regosols: "#D2B48C",
    Retisols: "#BDB76B", Solonchaks: "#F5F5DC", Solonetz: "#DDD0A8",
    Stagnosols: "#6B8E6B", Technosols: "#808080", Umbrisols: "#556B2F",
    Vertisols: "#4B3621",
    "Clay Loam": "#8B6914", "Sandy Loam": "#DAA520", "Silty Clay": "#A0522D",
    "Loam": "#BC8F5F", "Sandy Clay Loam": "#D2691E", "Silt Loam": "#D2B48C",
  };
  return colors[soilType] || "#8B7355";
}

function ClickHandler({ onLocationSelect, disabled }: { onLocationSelect: (lat: number, lon: number, name: string) => void; disabled?: boolean }) {
  const map = useMap();
  useMapEvents({
    click(e) {
      if (disabled) return;
      const { lat, lng } = e.latlng;
      onLocationSelect(lat, lng, `Selected Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`);

      fetch(`/api/esri/identify?lat=${lat}&lon=${lng}`)
        .then(r => r.json())
        .then(data => {
          if (!data.address && (!data.layers || data.layers.length === 0)) return;
          const addr = data.address || {};
          let html = `<div style="font-family:Inter,sans-serif;font-size:12px;max-width:280px;color:var(--tooltip-text);">`;
          if (addr.LongLabel || addr.Address) {
            html += `<div style="font-weight:600;font-size:13px;margin-bottom:6px;color:#00C853;">${addr.LongLabel || addr.Address}</div>`;
            const details = [addr.City, addr.Region, addr.CountryCode].filter(Boolean).join(", ");
            if (details) html += `<div style="color:hsl(var(--muted-foreground));margin-bottom:4px;">${details}</div>`;
            if (addr.Postal) html += `<div style="color:hsl(var(--muted-foreground));font-size:11px;">Postal: ${addr.Postal}</div>`;
            if (addr.Type) html += `<div style="color:hsl(var(--muted-foreground));font-size:11px;">Type: ${addr.Type}</div>`;
          }
          if (data.layers && data.layers.length > 0) {
            html += `<div style="margin-top:6px;padding-top:6px;border-top:1px solid hsl(var(--border));">`;
            const seen = new Set<string>();
            for (const layer of data.layers.slice(0, 5)) {
              const key = `${layer.layerName}-${layer.value}`;
              if (seen.has(key)) continue;
              seen.add(key);
              html += `<div style="margin-bottom:3px;"><span style="color:#00C853;font-size:10px;">${layer.layerName}:</span> <span style="font-size:11px;">${layer.value || "—"}</span></div>`;
            }
            html += `</div>`;
          }
          html += `</div>`;

          L.popup({
            className: "esri-identify-popup",
            maxWidth: 300,
          })
            .setLatLng([lat, lng])
            .setContent(html)
            .openOn(map);
        })
        .catch(() => {});
    },
  });
  return null;
}

function FlyToLocation({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  const prevRef = useRef(`${lat},${lon}`);
  useEffect(() => {
    const key = `${lat},${lon}`;
    if (prevRef.current !== key) {
      prevRef.current = key;
      map.flyTo([lat, lon], 13, { duration: 1.5 });
    }
  }, [lat, lon, map]);
  return null;
}

function MapControls({ position, basemap, onBasemapChange }: { position: [number, number]; basemap: BasemapType; onBasemapChange: (b: BasemapType) => void }) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  const [isFullscreen, setIsFullscreen] = useState(false);

  useMapEvents({
    zoomend() {
      setZoom(map.getZoom());
    },
  });

  const handleZoomIn = () => map.zoomIn();
  const handleZoomOut = () => map.zoomOut();

  const toggleFullscreen = () => {
    const container = map.getContainer().closest('[data-testid="map-container"]');
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const lat = position[0];
  const lon = position[1];
  const latDir = lat >= 0 ? "N" : "S";
  const lonDir = lon >= 0 ? "E" : "W";

  const ctrlStyle: React.CSSProperties = {
    width: "34px",
    height: "34px",
    background: "var(--map-ctrl-bg)",
    border: "1px solid var(--map-ctrl-border)",
    borderRadius: "8px",
    color: "var(--map-ctrl-text)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backdropFilter: "blur(8px)",
    transition: "all 0.2s ease",
    boxShadow: "0 2px 8px rgb(0 0 0 / 0.15)",
  };

  return (
    <>
      <div
        className="absolute top-3 left-3 z-[1000]"
        data-testid="zoom-indicator"
        style={{
          background: "var(--map-ctrl-bg)",
          border: "1px solid var(--map-ctrl-border)",
          borderRadius: "8px",
          padding: "5px 12px",
          fontSize: "12px",
          fontFamily: "Inter, sans-serif",
          color: "var(--map-ctrl-text)",
          fontWeight: 600,
          backdropFilter: "blur(8px)",
          boxShadow: "0 2px 8px rgb(0 0 0 / 0.15)",
        }}
      >
        Zoom: {zoom}
      </div>

      <div
        className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000]"
        data-testid="coordinate-display"
        style={{
          background: "var(--map-coord-bg)",
          border: "1px solid var(--map-coord-border)",
          borderRadius: "20px",
          padding: "5px 16px",
          fontSize: "12px",
          fontFamily: "'Inter', monospace",
          color: "var(--map-coord-text)",
          fontWeight: 600,
          backdropFilter: "blur(8px)",
          letterSpacing: "0.02em",
          boxShadow: "0 2px 8px rgb(0 0 0 / 0.1)",
        }}
      >
        {Math.abs(lat).toFixed(4)}°{latDir} / {Math.abs(lon).toFixed(4)}°{lonDir}
      </div>

      <div
        className="absolute top-3 right-3 z-[1000] flex flex-col gap-1.5"
        data-testid="map-zoom-controls"
      >
        <button onClick={handleZoomIn} data-testid="button-zoom-in" style={{ ...ctrlStyle, fontSize: "18px", fontWeight: 700, lineHeight: 1 }}>+</button>
        <button onClick={handleZoomOut} data-testid="button-zoom-out" style={{ ...ctrlStyle, fontSize: "18px", fontWeight: 700, lineHeight: 1 }}>−</button>
        <button onClick={toggleFullscreen} data-testid="button-fullscreen" style={{ ...ctrlStyle, marginTop: "4px", fontSize: "14px" }}>
          {isFullscreen ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
              <line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          )}
        </button>
      </div>

      <div
        className="absolute bottom-6 left-3 z-[1000]"
        data-testid="basemap-picker"
        style={{
          display: "flex",
          gap: "6px",
          alignItems: "flex-end",
        }}
      >
        {(["dark", "light", "satellite", "road", "terrain"] as BasemapType[]).map(type => {
          const active = basemap === type;
          const labels: Record<BasemapType, string> = { dark: "Dark", light: "Light", satellite: "Satellite", road: "Road", terrain: "Terrain" };
          const thumbnails: Record<BasemapType, string> = {
            dark: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/4/6/4",
            light: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/4/6/4",
            satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/4/6/4",
            road: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/4/6/4",
            terrain: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/4/6/4",
          };
          return (
            <button
              key={type}
              onClick={() => onBasemapChange(type)}
              data-testid={`basemap-${type}`}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "3px",
                cursor: "pointer",
                background: "none",
                border: "none",
                padding: 0,
              }}
            >
              <div
                style={{
                  width: active ? "64px" : "56px",
                  height: active ? "64px" : "56px",
                  borderRadius: "8px",
                  border: `2.5px solid ${active ? "#00C853" : "var(--map-ctrl-border)"}`,
                  overflow: "hidden",
                  boxShadow: active ? "0 0 12px rgba(0,200,83,0.4)" : "0 2px 8px rgb(0 0 0 / 0.5)",
                  transition: "all 0.2s ease",
                  position: "relative",
                }}
              >
                <img
                  src={thumbnails[type]}
                  alt={labels[type]}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                  }}
                  crossOrigin="anonymous"
                />
                {active && (
                  <div style={{
                    position: "absolute",
                    top: "3px",
                    right: "3px",
                    width: "14px",
                    height: "14px",
                    borderRadius: "50%",
                    background: "#00C853",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}>
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>
                  </div>
                )}
              </div>
              <span
                style={{
                  fontSize: "10px",
                  fontFamily: "Inter, sans-serif",
                  fontWeight: active ? 700 : 500,
                  color: active ? "#00C853" : "var(--map-ctrl-text)",
                  textShadow: "0 1px 3px rgb(0 0 0 / 0.6)",
                  transition: "color 0.2s ease",
                }}
              >
                {labels[type]}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

type DrawMode = "polygon" | "circle" | "rectangle" | null;

function DrawingTools({ drawnRegion, onDrawRegion, onDrawingStateChange }: { drawnRegion: DrawnRegion; onDrawRegion: (region: DrawnRegion) => void; onDrawingStateChange?: (drawing: boolean) => void }) {
  const map = useMap();
  const [drawMode, setDrawMode] = useState<DrawMode>(null);
  const [drawingPoints, setDrawingPoints] = useState<[number, number][]>([]);
  const [circleStart, setCircleStart] = useState<[number, number] | null>(null);
  const [rectStart, setRectStart] = useState<[number, number] | null>(null);
  const [cursorPos, setCursorPos] = useState<[number, number] | null>(null);

  useMapEvents({
    click(e) {
      if (!drawMode) return;
      const { lat, lng } = e.latlng;
      L.DomEvent.stopPropagation(e);

      if (drawMode === "polygon") {
        setDrawingPoints(prev => [...prev, [lat, lng]]);
      } else if (drawMode === "circle") {
        if (!circleStart) {
          setCircleStart([lat, lng]);
        } else {
          const radius = map.distance(L.latLng(circleStart[0], circleStart[1]), e.latlng);
          onDrawRegion({ type: "circle", center: circleStart, radius });
          setCircleStart(null);
          setCursorPos(null);
          setDrawMode(null);
        }
      } else if (drawMode === "rectangle") {
        if (!rectStart) {
          setRectStart([lat, lng]);
        } else {
          onDrawRegion({ type: "rectangle", bounds: [rectStart, [lat, lng]] });
          setRectStart(null);
          setCursorPos(null);
          setDrawMode(null);
        }
      }
    },
    mousemove(e) {
      if (drawMode && (circleStart || rectStart || drawingPoints.length > 0)) {
        setCursorPos([e.latlng.lat, e.latlng.lng]);
      }
    },
    contextmenu(e) {
      if (drawMode === "polygon" && drawingPoints.length >= 3) {
        L.DomEvent.preventDefault(e);
        onDrawRegion({ type: "polygon", coords: [...drawingPoints, drawingPoints[0]] });
        setDrawingPoints([]);
        setCursorPos(null);
        setDrawMode(null);
      }
    },
  });

  useEffect(() => {
    if (drawMode) {
      map.getContainer().style.cursor = "crosshair";
      map.dragging.disable();
      onDrawingStateChange?.(true);
    } else {
      map.getContainer().style.cursor = "";
      map.dragging.enable();
      onDrawingStateChange?.(false);
    }
    return () => {
      map.getContainer().style.cursor = "";
      map.dragging.enable();
      onDrawingStateChange?.(false);
    };
  }, [drawMode, map]);

  const startDraw = (mode: DrawMode) => {
    onDrawRegion(null);
    setDrawingPoints([]);
    setCircleStart(null);
    setRectStart(null);
    setCursorPos(null);
    setDrawMode(mode);
  };

  const clearDraw = () => {
    onDrawRegion(null);
    setDrawingPoints([]);
    setCircleStart(null);
    setRectStart(null);
    setCursorPos(null);
    setDrawMode(null);
  };

  const finishPolygon = () => {
    if (drawingPoints.length >= 3) {
      onDrawRegion({ type: "polygon", coords: [...drawingPoints, drawingPoints[0]] });
      setDrawingPoints([]);
      setCursorPos(null);
      setDrawMode(null);
    }
  };

  const btnStyle = (active: boolean): React.CSSProperties => ({
    width: "32px",
    height: "32px",
    background: active ? "hsl(145 100% 39% / 0.3)" : "var(--map-ctrl-bg)",
    border: `1px solid ${active ? "#00C853" : "var(--map-ctrl-border)"}`,
    borderRadius: "8px",
    color: active ? "#00C853" : "var(--map-ctrl-text)",
    fontSize: "12px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backdropFilter: "blur(8px)",
    boxShadow: "0 2px 8px rgb(0 0 0 / 0.15)",
    transition: "all 0.2s ease",
  });

  const drawStyle = {
    color: "#00C853",
    weight: 2,
    opacity: 0.8,
    fillColor: "#00C853",
    fillOpacity: 0.12,
    dashArray: "6 4",
  };

  const previewPolygonPositions = drawingPoints.length > 0 && cursorPos
    ? [...drawingPoints, cursorPos]
    : drawingPoints;

  return (
    <>
      <div
        className="absolute top-14 right-3 z-[1000] flex flex-col gap-1"
        data-testid="draw-controls"
      >
        <button
          onClick={() => drawMode === "polygon" ? clearDraw() : startDraw("polygon")}
          data-testid="button-draw-polygon"
          title="Draw Polygon (right-click to finish)"
          style={btnStyle(drawMode === "polygon")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="12 2 22 8.5 18 20 6 20 2 8.5" />
          </svg>
        </button>
        <button
          onClick={() => drawMode === "circle" ? clearDraw() : startDraw("circle")}
          data-testid="button-draw-circle"
          title="Draw Circle (click center, then edge)"
          style={btnStyle(drawMode === "circle")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
          </svg>
        </button>
        <button
          onClick={() => drawMode === "rectangle" ? clearDraw() : startDraw("rectangle")}
          data-testid="button-draw-rectangle"
          title="Draw Rectangle (click two corners)"
          style={btnStyle(drawMode === "rectangle")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
          </svg>
        </button>
        {(drawnRegion || drawMode) && (
          <button
            onClick={clearDraw}
            data-testid="button-clear-draw"
            title="Clear drawn region"
            style={{
              ...btnStyle(false),
              color: "#EF4444",
              borderColor: "#EF4444",
              marginTop: "4px",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {drawMode && (
        <div
          className="absolute bottom-14 left-1/2 -translate-x-1/2 z-[1000]"
          style={{
            background: "var(--map-coord-bg)",
            border: "1px solid var(--map-coord-border)",
            borderRadius: "8px",
            padding: "6px 14px",
            fontSize: "12px",
            fontFamily: "Inter, sans-serif",
            color: "var(--map-coord-text)",
            backdropFilter: "blur(8px)",
            whiteSpace: "nowrap",
          }}
          data-testid="draw-hint"
        >
          {drawMode === "polygon" && drawingPoints.length === 0 && "Click to start drawing polygon"}
          {drawMode === "polygon" && drawingPoints.length > 0 && drawingPoints.length < 3 && `${drawingPoints.length} point${drawingPoints.length > 1 ? "s" : ""} — keep clicking to add more`}
          {drawMode === "polygon" && drawingPoints.length >= 3 && (
            <span>
              {drawingPoints.length} points — <button onClick={finishPolygon} style={{ textDecoration: "underline", cursor: "pointer", background: "none", border: "none", color: "inherit", font: "inherit" }}>finish</button> or right-click
            </span>
          )}
          {drawMode === "circle" && !circleStart && "Click to place circle center"}
          {drawMode === "circle" && circleStart && "Click to set circle radius"}
          {drawMode === "rectangle" && !rectStart && "Click first corner"}
          {drawMode === "rectangle" && rectStart && "Click opposite corner"}
        </div>
      )}

      {drawingPoints.length > 1 && (
        <RLPolygon positions={previewPolygonPositions as L.LatLngExpression[]} pathOptions={drawStyle} />
      )}
      {drawingPoints.length === 1 && cursorPos && (
        <RLPolygon positions={[drawingPoints[0], cursorPos] as L.LatLngExpression[]} pathOptions={{ ...drawStyle, fill: false }} />
      )}

      {circleStart && cursorPos && (
        <RLCircle
          center={circleStart}
          radius={map.distance(L.latLng(circleStart[0], circleStart[1]), L.latLng(cursorPos[0], cursorPos[1]))}
          pathOptions={drawStyle}
        />
      )}

      {rectStart && cursorPos && (
        <RLRectangle
          bounds={[rectStart, cursorPos]}
          pathOptions={drawStyle}
        />
      )}

      {drawnRegion && drawnRegion.type === "polygon" && (
        <RLPolygon
          positions={drawnRegion.coords as L.LatLngExpression[]}
          pathOptions={{ color: "#00C853", weight: 2.5, opacity: 0.9, fillColor: "#00C853", fillOpacity: 0.1 }}
        />
      )}
      {drawnRegion && drawnRegion.type === "circle" && (
        <RLCircle
          center={drawnRegion.center}
          radius={drawnRegion.radius}
          pathOptions={{ color: "#00C853", weight: 2.5, opacity: 0.9, fillColor: "#00C853", fillOpacity: 0.1 }}
        />
      )}
      {drawnRegion && drawnRegion.type === "rectangle" && (
        <RLRectangle
          bounds={drawnRegion.bounds}
          pathOptions={{ color: "#00C853", weight: 2.5, opacity: 0.9, fillColor: "#00C853", fillOpacity: 0.1 }}
        />
      )}
    </>
  );
}

function PolygonLayerRenderer({ layerData, layerId }: { layerData: any; layerId: string }) {
  if (!layerData?.features?.length) return null;

  if (layerId === "elevation") {
    return (
      <GeoJSON
        key={`elev-contour-${layerData.features.length}-${layerData.features[0]?.properties?.elevation}`}
        data={layerData}
        style={(feature) => {
          const elev = feature?.properties?.elevation || 0;
          const isMajor = feature?.properties?.isMajor;
          return {
            color: getContourColor(elev),
            weight: isMajor ? 2.5 : 1.2,
            opacity: isMajor ? 0.9 : 0.6,
            fill: false,
            dashArray: isMajor ? undefined : "4 3",
          };
        }}
        onEachFeature={(feature, layer) => {
          if (feature.properties?.elevation !== undefined) {
            layer.bindTooltip(`${feature.properties.elevation}m`, {
              sticky: true,
              permanent: feature.properties.isMajor,
              direction: "center",
              className: "contour-label",
            });
          }
        }}
      />
    );
  }

  if (layerId === "soil") {
    return (
      <GeoJSON
        key={`soil-wrb-${layerData.features.length}-${layerData.features[0]?.properties?.soilType}`}
        data={layerData}
        style={(feature) => {
          const soilType = feature?.properties?.soilType || "";
          return {
            fillColor: getWRBSoilColor(soilType),
            fillOpacity: 0.65,
            weight: 0.8,
            color: "rgba(255,255,255,0.3)",
            opacity: 0.5,
          };
        }}
        onEachFeature={(feature, layer) => {
          const p = feature?.properties;
          if (p?.soilType) {
            const tooltip = [
              `<b>${p.soilType}</b>`,
              p.description ? `<i>${p.description}</i>` : "",
              `Drainage: ${p.drainage || "N/A"}`,
              `Permeability: ${p.permeability || "N/A"}%`,
              `Bearing Capacity: ${p.bearing_capacity || "N/A"}`,
              p.probability ? `Confidence: ${p.probability}%` : "",
            ].filter(Boolean).join("<br/>");
            layer.bindTooltip(tooltip, { sticky: true });
          }
        }}
      />
    );
  }

  if (layerId === "flood") {
    return (
      <GeoJSON
        key={`flood-${layerData.features.length}`}
        data={layerData}
        style={(feature) => {
          const zone = feature?.properties?.FLD_ZONE || "";
          const risk = feature?.properties?.riskLevel || "";
          const isHighRisk = zone.startsWith("A") || zone.startsWith("V") || risk === "High";
          const isModerate = zone === "AE" || zone === "X500" || risk === "Moderate" || risk === "Low-Moderate";
          return {
            fillColor: isHighRisk ? "#DC2626" : isModerate ? "#F59E0B" : "#3B82F6",
            fillOpacity: isHighRisk ? 0.45 : isModerate ? 0.3 : 0.15,
            weight: 1,
            color: isHighRisk ? "#DC2626" : isModerate ? "#F59E0B" : "#3B82F6",
            opacity: 0.6,
          };
        }}
        onEachFeature={(feature, layer) => {
          const p = feature?.properties || {};
          const zone = p.FLD_ZONE || "Unknown";
          const risk = p.riskLevel || (zone.startsWith("A") ? "High" : "Low");
          const source = p.source === "osm" ? "OpenStreetMap" : p.source === "elevation-model" ? "Elevation Model" : p.source === "fema" ? "FEMA NFHL" : "Analysis";
          const elev = p.elevation ? ` | Elev: ${p.elevation}m` : "";
          layer.bindTooltip(`<b>Flood Risk: ${risk}</b><br/>Zone: ${zone}${elev}<br/>Source: ${source}`, { sticky: true });
        }}
      />
    );
  }

  if (layerId === "landuse") {
    return (
      <GeoJSON
        key={`landuse-${layerData.features.length}`}
        data={layerData}
        style={(feature) => {
          const lu = feature?.properties?.landuse || "";
          return {
            fillColor: LANDUSE_COLORS[lu] || "#C4B5FD",
            fillOpacity: 0.4, weight: 1, color: "#7C3AED", opacity: 0.4,
          };
        }}
        onEachFeature={(feature, layer) => {
          const lu = feature?.properties?.landuse || feature?.properties?.type || "Unknown";
          const name = feature?.properties?.name;
          layer.bindTooltip(`${name ? name + " — " : ""}${lu}`, { sticky: true });
        }}
      />
    );
  }

  if (layerId === "parks") {
    return (
      <GeoJSON
        key={`parks-${layerData.features.length}`}
        data={layerData}
        style={() => ({
          fillColor: "#22C55E", fillOpacity: 0.3, weight: 1.5, color: "#16A34A", opacity: 0.7,
        })}
        onEachFeature={(feature, layer) => {
          const name = feature?.properties?.name || "Park";
          layer.bindTooltip(name, { sticky: true });
        }}
      />
    );
  }

  if (layerId === "water") {
    return (
      <GeoJSON
        key={`water-${layerData.features.length}`}
        data={layerData}
        style={(feature) => {
          const isLine = feature?.geometry?.type === "LineString";
          return {
            fillColor: "#06B6D4", fillOpacity: isLine ? 0 : 0.4,
            weight: isLine ? 2.5 : 1, color: "#0891B2", opacity: 0.7,
          };
        }}
        onEachFeature={(feature, layer) => {
          const name = feature?.properties?.name || feature?.properties?.waterway || "Water";
          layer.bindTooltip(name, { sticky: true });
        }}
      />
    );
  }

  return null;
}

function PointLayerRenderer({ layerData, layerId }: { layerData: any; layerId: string }) {
  if (!layerData?.features?.length) return null;
  const color = LAYER_COLORS[layerId] || "#666";
  const radius = layerId === "transit" ? 5 : 7;

  return (
    <>
      {layerData.features.map((feature: any, i: number) => {
        const coords = feature.geometry?.coordinates;
        if (!coords || feature.geometry.type !== "Point") return null;
        return (
          <CircleMarker
            key={`${layerId}-pt-${i}`}
            center={[coords[1], coords[0]]}
            radius={radius}
            pathOptions={{ fillColor: color, fillOpacity: 0.85, color: "#fff", weight: 1.5, opacity: 0.9 }}
          >
            <Tooltip sticky>
              <div style={{ fontFamily: "Inter, sans-serif", fontSize: "12px" }}>
                <strong>{feature.properties?.name || "Unknown"}</strong>
                {feature.properties?.type && <div style={{ color: "#999", fontSize: "11px" }}>{feature.properties.type}</div>}
              </div>
            </Tooltip>
          </CircleMarker>
        );
      })}
    </>
  );
}

const POINT_LAYERS = new Set(["schools", "hospitals", "transit", "infrastructure"]);
const POLYGON_LAYERS = new Set(["elevation", "soil", "flood", "landuse", "parks", "water"]);

function CustomOverlayRenderer({ overlay }: { overlay: CustomOverlay }) {
  const features = overlay.data?.features || [];
  if (features.length === 0) return null;

  const pointFeatures = features.filter((f: any) => f.geometry?.type === "Point");
  const polyFeatures = features.filter((f: any) => f.geometry?.type !== "Point");

  return (
    <>
      {polyFeatures.length > 0 && (
        <GeoJSON
          key={`${overlay.id}-poly`}
          data={{ type: "FeatureCollection", features: polyFeatures }}
          style={() => ({
            color: overlay.color,
            weight: 2,
            opacity: 0.8,
            fillColor: overlay.color,
            fillOpacity: 0.25,
          })}
          onEachFeature={(feature, layer) => {
            const esc = (s: string) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
            const name = esc(String(feature.properties?.name || feature.properties?.queryKey || ""));
            const tags = Object.entries(feature.properties || {})
              .filter(([k]) => !["layer", "queryKey", "queryValue", "_source"].includes(k))
              .slice(0, 4)
              .map(([k, v]) => `<div style="color:#999;font-size:10px">${esc(String(k))}: ${esc(String(v))}</div>`)
              .join("");
            if (name || tags) {
              layer.bindTooltip(`<div style="font-family:Inter,sans-serif;font-size:12px"><strong>${name}</strong>${tags}</div>`, { sticky: true });
            }
          }}
        />
      )}
      {pointFeatures.map((feature: any, i: number) => {
        const [lon, lat] = feature.geometry.coordinates;
        const name = feature.properties?.name || "";
        return (
          <CircleMarker
            key={`${overlay.id}-pt-${i}`}
            center={[lat, lon]}
            radius={5}
            pathOptions={{ fillColor: overlay.color, fillOpacity: 0.85, color: "#fff", weight: 1, opacity: 0.8 }}
          >
            {name && (
              <Tooltip sticky>
                <div style={{ fontFamily: "Inter, sans-serif", fontSize: "12px" }}>
                  <strong>{name}</strong>
                </div>
              </Tooltip>
            )}
          </CircleMarker>
        );
      })}
    </>
  );
}

function geojsonToKML(geojson: any): string {
  let placemarks = "";
  for (const feature of (geojson.features || [])) {
    const props = feature.properties || {};
    const name = props.name || props.layer || props.soilType || "Feature";
    const desc = Object.entries(props).map(([k, v]) => `${k}: ${v}`).join(", ");
    const geom = feature.geometry;
    if (!geom) continue;

    let coordStr = "";
    if (geom.type === "Point") {
      const [lon, lat] = geom.coordinates;
      coordStr = `<Point><coordinates>${lon},${lat},0</coordinates></Point>`;
    } else if (geom.type === "LineString") {
      const coords = geom.coordinates.map(([lon, lat]: number[]) => `${lon},${lat},0`).join(" ");
      coordStr = `<LineString><coordinates>${coords}</coordinates></LineString>`;
    } else if (geom.type === "Polygon") {
      const ring = (geom.coordinates[0] || []).map(([lon, lat]: number[]) => `${lon},${lat},0`).join(" ");
      coordStr = `<Polygon><outerBoundaryIs><LinearRing><coordinates>${ring}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
    } else if (geom.type === "MultiPolygon") {
      const polys = geom.coordinates.map((poly: number[][][]) => {
        const ring = (poly[0] || []).map(([lon, lat]: number[]) => `${lon},${lat},0`).join(" ");
        return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${ring}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
      }).join("");
      coordStr = `<MultiGeometry>${polys}</MultiGeometry>`;
    }
    if (coordStr) {
      placemarks += `<Placemark><name>${escapeXml(name)}</name><description>${escapeXml(desc)}</description>${coordStr}</Placemark>\n`;
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
<name>TerraLogic AI Export</name>
${placemarks}
</Document>
</kml>`;
}

function escapeXml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function geojsonToDXF(geojson: any): string {
  let entities = "";
  for (const feature of (geojson.features || [])) {
    const geom = feature.geometry;
    if (!geom) continue;
    const layer = feature.properties?.layer || "0";

    if (geom.type === "Point") {
      const [x, y] = geom.coordinates;
      entities += `  0\nPOINT\n  8\n${layer}\n 10\n${x}\n 20\n${y}\n 30\n0.0\n`;
    } else if (geom.type === "LineString") {
      entities += `  0\nPOLYLINE\n  8\n${layer}\n 66\n1\n`;
      for (const [x, y] of geom.coordinates) {
        entities += `  0\nVERTEX\n  8\n${layer}\n 10\n${x}\n 20\n${y}\n 30\n0.0\n`;
      }
      entities += `  0\nSEQEND\n  8\n${layer}\n`;
    } else if (geom.type === "Polygon") {
      const ring = geom.coordinates[0] || [];
      entities += `  0\nPOLYLINE\n  8\n${layer}\n 66\n1\n 70\n1\n`;
      for (const [x, y] of ring) {
        entities += `  0\nVERTEX\n  8\n${layer}\n 10\n${x}\n 20\n${y}\n 30\n0.0\n`;
      }
      entities += `  0\nSEQEND\n  8\n${layer}\n`;
    } else if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates) {
        const ring = poly[0] || [];
        entities += `  0\nPOLYLINE\n  8\n${layer}\n 66\n1\n 70\n1\n`;
        for (const [x, y] of ring) {
          entities += `  0\nVERTEX\n  8\n${layer}\n 10\n${x}\n 20\n${y}\n 30\n0.0\n`;
        }
        entities += `  0\nSEQEND\n  8\n${layer}\n`;
      }
    }
  }

  return `  0\nSECTION\n  2\nHEADER\n  0\nENDSEC\n  0\nSECTION\n  2\nENTITIES\n${entities}  0\nENDSEC\n  0\nEOF\n`;
}

export interface MapViewerHandle {
  exportMapAsPNG: () => Promise<void>;
  exportMapAs: (format: string) => Promise<void>;
  isExporting: () => boolean;
  getLayerGeoJSON: () => any;
}

const MapViewer = forwardRef<MapViewerHandle, MapViewerProps>(function MapViewer({ onLocationSelect, arcgisApiKey, activeLayers, onLayerLoading, selectedLocation, customOverlays = [], drawnRegion, onDrawRegion }, ref) {
  const [position, setPosition] = useState<[number, number]>([37.7749, -122.4194]);
  const [layerData, setLayerData] = useState<LayerData>({});
  const layerDataRef = useRef<LayerData>({});
  const abortRef = useRef<AbortController | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);

  const { isDark } = useTheme();
  const [exporting, setExporting] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [basemap, setBasemap] = useState<BasemapType>(isDark ? "dark" : "light");
  const [userPickedBasemap, setUserPickedBasemap] = useState(false);

  useEffect(() => {
    if (!userPickedBasemap) {
      setBasemap(isDark ? "dark" : "light");
    }
  }, [isDark, userPickedBasemap]);

  const handleBasemapChange = useCallback((b: BasemapType) => {
    setBasemap(b);
    setUserPickedBasemap(true);
  }, []);

  const getLayerGeoJSONFn = useCallback(() => {
    const allFeatures: any[] = [];
    Object.values(layerData).forEach((data: any) => {
      if (data?.features) allFeatures.push(...data.features);
    });
    customOverlays.forEach(overlay => {
      if (overlay.data?.features) allFeatures.push(...overlay.data.features);
    });
    return { type: "FeatureCollection", features: allFeatures };
  }, [layerData, customOverlays]);

  const exportImageFn = useCallback(async (format: "png" | "jpeg") => {
    const container = mapContainerRef.current;
    if (!container || exporting) return;
    setExporting(true);
    try {
      const bgColor = getComputedStyle(document.documentElement).getPropertyValue("--background").trim();
      const exportBg = bgColor ? `hsl(${bgColor})` : "#0B1010";
      const canvas = await html2canvas(container, {
        useCORS: true, allowTaint: false, backgroundColor: exportBg, scale: 2, logging: false,
        ignoreElements: (el) => el.getAttribute("data-testid") === "map-zoom-controls" || el.getAttribute("data-testid") === "button-export-map",
      });
      const link = document.createElement("a");
      const dateStr = new Date().toISOString().slice(0, 10);
      link.download = `TerraLogic_Map_${dateStr}.${format === "jpeg" ? "jpg" : "png"}`;
      link.href = canvas.toDataURL(format === "jpeg" ? "image/jpeg" : "image/png", format === "jpeg" ? 0.92 : undefined);
      link.click();
    } catch (e) {
      console.error("Map export failed:", e);
      try {
        const canvas = await html2canvas(container!, { useCORS: false, allowTaint: true, backgroundColor: null, scale: 2, logging: false });
        const link = document.createElement("a");
        link.download = `TerraLogic_Map_${new Date().toISOString().slice(0, 10)}.${format === "jpeg" ? "jpg" : "png"}`;
        link.href = canvas.toDataURL(format === "jpeg" ? "image/jpeg" : "image/png");
        link.click();
      } catch (e2) {
        console.error("Map export fallback also failed:", e2);
        alert("Map export failed. Try zooming in first, then export again.");
      }
    } finally {
      setExporting(false);
    }
  }, [exporting]);

  const downloadBlob = useCallback((content: string | Uint8Array, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = filename;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  useImperativeHandle(ref, () => ({
    isExporting: () => exporting,
    getLayerGeoJSON: getLayerGeoJSONFn,
    async exportMapAs(format: string) {
      const dateStr = new Date().toISOString().slice(0, 10);
      if (format === "png" || format === "jpeg") {
        await exportImageFn(format);
      } else if (format === "geojson") {
        const geojson = getLayerGeoJSONFn();
        downloadBlob(JSON.stringify(geojson, null, 2), `TerraLogic_Map_${dateStr}.geojson`, "application/geo+json");
      } else if (format === "kml") {
        const geojson = getLayerGeoJSONFn();
        downloadBlob(geojsonToKML(geojson), `TerraLogic_Map_${dateStr}.kml`, "application/vnd.google-earth.kml+xml");
      } else if (format === "dxf") {
        const geojson = getLayerGeoJSONFn();
        downloadBlob(geojsonToDXF(geojson), `TerraLogic_Map_${dateStr}.dxf`, "application/dxf");
      }
    },
    async exportMapAsPNG() {
      await exportImageFn("png");
    }
  }));

  useEffect(() => {
    if (selectedLocation) {
      const newPos: [number, number] = [selectedLocation.lat, selectedLocation.lon];
      if (newPos[0] !== position[0] || newPos[1] !== position[1]) {
        if (abortRef.current) abortRef.current.abort();
        setPosition(newPos);
        setLayerData({});
        layerDataRef.current = {};
      }
    }
  }, [selectedLocation?.lat, selectedLocation?.lon]);

  const handleLocationSelect = useCallback((lat: number, lon: number, name: string) => {
    if (abortRef.current) abortRef.current.abort();
    setPosition([lat, lon]);
    setLayerData({});
    layerDataRef.current = {};
    onLocationSelect(lat, lon, name);
  }, [onLocationSelect]);

  const drawnRegionKey = drawnRegion
    ? JSON.stringify(drawnRegion).slice(0, 80)
    : "none";

  useEffect(() => {
    layerDataRef.current = {};
    setLayerData({});
  }, [drawnRegionKey]);

  useEffect(() => {
    if (!position || activeLayers.length === 0) return;
    const [lat, lon] = position;
    const controller = new AbortController();
    abortRef.current = controller;

    const polyParam = drawnRegionToPolygonParam(drawnRegion || null);

    activeLayers.forEach(async (layerId) => {
      const regionSuffix = polyParam ? `-region` : "";
      const cacheKey = `${layerId}-${lat.toFixed(3)}-${lon.toFixed(3)}${regionSuffix}`;
      if (layerDataRef.current[cacheKey]) return;

      layerDataRef.current[cacheKey] = "loading";
      onLayerLoading?.(layerId, true);
      try {
        const params = new URLSearchParams({ lat: lat.toString(), lon: lon.toString(), radius: "5000" });
        if (polyParam) params.set("polygon", polyParam);
        const resp = await fetch(`/api/layers/${layerId}?${params}`, { signal: controller.signal });
        if (resp.ok) {
          const data = await resp.json();
          if (!controller.signal.aborted) {
            layerDataRef.current[cacheKey] = data;
            setLayerData(prev => ({ ...prev, [cacheKey]: data }));
          }
        } else {
          delete layerDataRef.current[cacheKey];
        }
      } catch (e: any) {
        if (e.name !== "AbortError") {
          console.error(`Layer fetch error (${layerId}):`, e);
          delete layerDataRef.current[cacheKey];
        }
      } finally {
        if (!controller.signal.aborted) onLayerLoading?.(layerId, false);
      }
    });

    return () => { controller.abort(); };
  }, [position, activeLayers, drawnRegionKey]);

  return (
    <div className="w-full h-full relative" data-testid="map-container" ref={mapContainerRef}>
      <MapContainer
        center={position}
        zoom={13}
        style={{ width: "100%", height: "100%" }}
        zoomControl={false}
        attributionControl={true}
      >
        <TileLayer
          key={`base-${basemap}`}
          url={ESRI_BASEMAPS[basemap].url}
          attribution={ESRI_BASEMAPS[basemap].attribution}
          maxZoom={ESRI_BASEMAPS[basemap].maxZoom}
          crossOrigin="anonymous"
        />
        {ESRI_BASEMAPS[basemap].labelUrl && (
          <TileLayer
            key={`labels-${basemap}`}
            url={ESRI_BASEMAPS[basemap].labelUrl!}
            maxZoom={ESRI_BASEMAPS[basemap].maxZoom}
            crossOrigin="anonymous"
          />
        )}

        {activeLayers.filter(id => POLYGON_LAYERS.has(id)).map(layerId => {
          const regionSuffix = drawnRegion ? `-region` : "";
          const cacheKey = `${layerId}-${position[0].toFixed(3)}-${position[1].toFixed(3)}${regionSuffix}`;
          const data = layerData[cacheKey];
          if (!data) return null;
          return <PolygonLayerRenderer key={cacheKey} layerData={data} layerId={layerId} />;
        })}

        {activeLayers.filter(id => POINT_LAYERS.has(id)).map(layerId => {
          const regionSuffix = drawnRegion ? `-region` : "";
          const cacheKey = `${layerId}-${position[0].toFixed(3)}-${position[1].toFixed(3)}${regionSuffix}`;
          const data = layerData[cacheKey];
          if (!data) return null;
          return <PointLayerRenderer key={cacheKey} layerData={data} layerId={layerId} />;
        })}

        {customOverlays.map(overlay => (
          <CustomOverlayRenderer key={overlay.id} overlay={overlay} />
        ))}

        <Marker position={position} icon={markerIcon} />
        <ClickHandler onLocationSelect={handleLocationSelect} disabled={isDrawing} />
        <MapControls position={position} basemap={basemap} onBasemapChange={handleBasemapChange} />
        {onDrawRegion && <DrawingTools drawnRegion={drawnRegion || null} onDrawRegion={onDrawRegion} onDrawingStateChange={setIsDrawing} />}
        {selectedLocation && <FlyToLocation lat={selectedLocation.lat} lon={selectedLocation.lon} />}
      </MapContainer>

      {(activeLayers.length > 0 || customOverlays.length > 0) && (
        <div
          className="absolute bottom-4 left-4 z-[500]"
          data-testid="map-legend"
          style={{
            background: "var(--map-ctrl-bg)",
            border: "1px solid var(--map-ctrl-border)",
            borderRadius: "8px",
            padding: "10px 12px",
            backdropFilter: "blur(8px)",
            boxShadow: "0 4px 16px rgb(0 0 0 / 0.2)",
          }}
        >
          <p style={{
            fontSize: "10px",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "hsl(var(--muted-foreground))",
            marginBottom: "8px",
            fontFamily: "Inter, sans-serif",
          }}>
            Active Layers
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {activeLayers.map(id => {
              const regionSuffix = drawnRegion ? `-region` : "";
              const cacheKey = `${id}-${position[0].toFixed(3)}-${position[1].toFixed(3)}${regionSuffix}`;
              const data = layerData[cacheKey];
              return (
                <div key={id} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", fontFamily: "Inter, sans-serif" }}>
                  <div
                    style={{
                      width: "10px",
                      height: "10px",
                      borderRadius: "50%",
                      background: LAYER_COLORS[id] || "#666",
                      border: "1.5px solid var(--map-ctrl-border)",
                      boxShadow: `0 0 4px ${LAYER_COLORS[id] || "#666"}40`,
                    }}
                  />
                  <span style={{ color: "var(--map-ctrl-text)", textTransform: "capitalize" }}>{id}</span>
                  {data?.features && (
                    <span style={{ color: "hsl(var(--muted-foreground))", fontSize: "10px" }}>({data.features.length})</span>
                  )}
                </div>
              );
            })}
            {customOverlays.map(overlay => (
              <div key={overlay.id} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", fontFamily: "Inter, sans-serif" }}>
                <div
                  style={{
                    width: "10px",
                    height: "10px",
                    borderRadius: "50%",
                    background: overlay.color,
                    border: "1.5px solid var(--map-ctrl-border)",
                    boxShadow: `0 0 4px ${overlay.color}40`,
                  }}
                />
                <span style={{ color: "var(--map-ctrl-text)" }}>{overlay.label}</span>
                {overlay.data?.features && (
                  <span style={{ color: "hsl(var(--muted-foreground))", fontSize: "10px" }}>({overlay.data.features.length})</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {exporting && (
        <div
          className="absolute inset-0 z-[2000] flex items-center justify-center"
          style={{ background: "hsl(var(--background) / 0.6)", backdropFilter: "blur(2px)" }}
          data-testid="export-overlay"
        >
          <div className="bg-card border border-border rounded-xl px-6 py-4 flex items-center gap-3 shadow-xl">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm font-medium text-foreground">Exporting map...</span>
          </div>
        </div>
      )}
    </div>
  );
});

export default MapViewer;
