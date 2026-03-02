import { useEffect, useRef, useState, useCallback } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap, GeoJSON, CircleMarker, Tooltip } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const markerIcon = new L.DivIcon({
  className: "custom-marker",
  html: `<div style="width:18px;height:18px;background:#00C853;border:3px solid #0B1010;border-radius:50%;box-shadow:0 0 8px rgba(0,200,83,0.5);transform:translate(-50%,-50%)"></div>`,
  iconSize: [18, 18],
  iconAnchor: [0, 0],
});

interface LayerData {
  [key: string]: any;
}

interface MapViewerProps {
  onLocationSelect: (lat: number, lon: number, name: string) => void;
  arcgisApiKey: string;
  activeLayers: string[];
  onLayerLoading?: (layerId: string, loading: boolean) => void;
  selectedLocation?: { lat: number; lon: number; name: string } | null;
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

function getElevationColor(elev: number): string {
  if (elev < 20) return "#1a9850";
  if (elev < 50) return "#91cf60";
  if (elev < 100) return "#d9ef8b";
  if (elev < 200) return "#fee08b";
  if (elev < 500) return "#fc8d59";
  return "#d73027";
}

function getSoilColor(soilType: string): string {
  const colors: Record<string, string> = {
    "Clay Loam": "#8B4513", "Sandy Loam": "#DEB887", "Silty Clay": "#A0522D",
    "Loam": "#CD853F", "Sandy Clay Loam": "#D2691E", "Silt Loam": "#BC8F8F",
  };
  return colors[soilType] || "#8B7355";
}

function ClickHandler({ onLocationSelect }: { onLocationSelect: (lat: number, lon: number, name: string) => void }) {
  useMapEvents({
    click(e) {
      const { lat, lng } = e.latlng;
      onLocationSelect(lat, lng, `Selected Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
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

function MapControls({ position }: { position: [number, number] }) {
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

  return (
    <>
      <div
        className="absolute top-3 left-3 z-[1000]"
        data-testid="zoom-indicator"
        style={{
          background: "hsl(150 19% 8% / 0.9)",
          border: "1px solid hsl(150 20% 14%)",
          borderRadius: "6px",
          padding: "4px 10px",
          fontSize: "12px",
          fontFamily: "Inter, sans-serif",
          color: "hsl(150 12% 92%)",
          fontWeight: 500,
          backdropFilter: "blur(8px)",
        }}
      >
        Zoom: {zoom}
      </div>

      <div
        className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000]"
        data-testid="coordinate-display"
        style={{
          background: "hsl(145 100% 39% / 0.15)",
          border: "1px solid hsl(145 100% 39% / 0.4)",
          borderRadius: "20px",
          padding: "5px 14px",
          fontSize: "12px",
          fontFamily: "'Inter', monospace",
          color: "#00C853",
          fontWeight: 600,
          backdropFilter: "blur(8px)",
          letterSpacing: "0.02em",
        }}
      >
        {Math.abs(lat).toFixed(4)}°{latDir} / {Math.abs(lon).toFixed(4)}°{lonDir}
      </div>

      <div
        className="absolute top-3 right-3 z-[1000] flex flex-col gap-1"
        data-testid="map-zoom-controls"
      >
        <button
          onClick={handleZoomIn}
          data-testid="button-zoom-in"
          style={{
            width: "32px",
            height: "32px",
            background: "hsl(150 19% 8% / 0.9)",
            border: "1px solid hsl(150 20% 14%)",
            borderRadius: "6px",
            color: "hsl(150 12% 92%)",
            fontSize: "18px",
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backdropFilter: "blur(8px)",
            lineHeight: 1,
          }}
        >
          +
        </button>
        <button
          onClick={handleZoomOut}
          data-testid="button-zoom-out"
          style={{
            width: "32px",
            height: "32px",
            background: "hsl(150 19% 8% / 0.9)",
            border: "1px solid hsl(150 20% 14%)",
            borderRadius: "6px",
            color: "hsl(150 12% 92%)",
            fontSize: "18px",
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backdropFilter: "blur(8px)",
            lineHeight: 1,
          }}
        >
          −
        </button>
        <button
          onClick={toggleFullscreen}
          data-testid="button-fullscreen"
          style={{
            width: "32px",
            height: "32px",
            background: "hsl(150 19% 8% / 0.9)",
            border: "1px solid hsl(150 20% 14%)",
            borderRadius: "6px",
            color: "hsl(150 12% 92%)",
            fontSize: "14px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backdropFilter: "blur(8px)",
            marginTop: "4px",
          }}
        >
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
    </>
  );
}

function PolygonLayerRenderer({ layerData, layerId }: { layerData: any; layerId: string }) {
  if (!layerData?.features?.length) return null;

  if (layerId === "elevation") {
    return (
      <GeoJSON
        key={`elev-${JSON.stringify(layerData.features[0]?.geometry?.coordinates?.[0]?.[0])}`}
        data={layerData}
        style={(feature) => ({
          fillColor: getElevationColor(feature?.properties?.elevation || 0),
          fillOpacity: 0.45, weight: 0.5, color: "#fff", opacity: 0.5,
        })}
        onEachFeature={(feature, layer) => {
          if (feature.properties) layer.bindTooltip(`Elevation: ${feature.properties.elevation}m`, { sticky: true });
        }}
      />
    );
  }

  if (layerId === "soil") {
    return (
      <GeoJSON
        key={`soil-${JSON.stringify(layerData.features[0]?.geometry?.coordinates?.[0]?.[0])}`}
        data={layerData}
        style={(feature) => ({
          fillColor: getSoilColor(feature?.properties?.soilType || ""),
          fillOpacity: 0.5, weight: 1, color: "#fff", opacity: 0.6,
        })}
        onEachFeature={(feature, layer) => {
          if (feature.properties?.soilType) {
            layer.bindTooltip(
              `Soil: ${feature.properties.soilType}\nDrainage: ${feature.properties.drainage}\nPermeability: ${feature.properties.permeability}%`,
              { sticky: true }
            );
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
          const isHighRisk = zone.startsWith("A") || zone.startsWith("V");
          return {
            fillColor: isHighRisk ? "#DC2626" : "#3B82F6",
            fillOpacity: isHighRisk ? 0.4 : 0.15,
            weight: 1, color: isHighRisk ? "#DC2626" : "#3B82F6", opacity: 0.6,
          };
        }}
        onEachFeature={(feature, layer) => {
          const zone = feature?.properties?.FLD_ZONE || "Unknown";
          layer.bindTooltip(`Flood Zone: ${zone}`, { sticky: true });
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

export default function MapViewer({ onLocationSelect, arcgisApiKey, activeLayers, onLayerLoading, selectedLocation }: MapViewerProps) {
  const [position, setPosition] = useState<[number, number]>([37.7749, -122.4194]);
  const [layerData, setLayerData] = useState<LayerData>({});
  const layerDataRef = useRef<LayerData>({});
  const abortRef = useRef<AbortController | null>(null);

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

  useEffect(() => {
    if (!position || activeLayers.length === 0) return;
    const [lat, lon] = position;
    const controller = new AbortController();
    abortRef.current = controller;

    activeLayers.forEach(async (layerId) => {
      const cacheKey = `${layerId}-${lat.toFixed(3)}-${lon.toFixed(3)}`;
      if (layerDataRef.current[cacheKey]) return;

      layerDataRef.current[cacheKey] = "loading";
      onLayerLoading?.(layerId, true);
      try {
        const params = new URLSearchParams({ lat: lat.toString(), lon: lon.toString(), radius: "5000" });
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
  }, [position, activeLayers]);

  return (
    <div className="w-full h-full relative" data-testid="map-container">
      <MapContainer
        center={position}
        zoom={13}
        style={{ width: "100%", height: "100%" }}
        zoomControl={false}
        attributionControl={true}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
          maxZoom={20}
          subdomains="abcd"
        />

        {activeLayers.filter(id => POLYGON_LAYERS.has(id)).map(layerId => {
          const cacheKey = `${layerId}-${position[0].toFixed(3)}-${position[1].toFixed(3)}`;
          const data = layerData[cacheKey];
          if (!data) return null;
          return <PolygonLayerRenderer key={cacheKey} layerData={data} layerId={layerId} />;
        })}

        {activeLayers.filter(id => POINT_LAYERS.has(id)).map(layerId => {
          const cacheKey = `${layerId}-${position[0].toFixed(3)}-${position[1].toFixed(3)}`;
          const data = layerData[cacheKey];
          if (!data) return null;
          return <PointLayerRenderer key={cacheKey} layerData={data} layerId={layerId} />;
        })}

        <Marker position={position} icon={markerIcon} />
        <ClickHandler onLocationSelect={handleLocationSelect} />
        <MapControls position={position} />
        {selectedLocation && <FlyToLocation lat={selectedLocation.lat} lon={selectedLocation.lon} />}
      </MapContainer>

      {activeLayers.length > 0 && (
        <div
          className="absolute bottom-4 left-4 z-[500]"
          data-testid="map-legend"
          style={{
            background: "hsl(150 19% 8% / 0.9)",
            border: "1px solid hsl(150 20% 14%)",
            borderRadius: "8px",
            padding: "10px 12px",
            backdropFilter: "blur(8px)",
            boxShadow: "0 4px 16px rgb(0 0 0 / 0.4)",
          }}
        >
          <p style={{
            fontSize: "10px",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "hsl(150 7% 51%)",
            marginBottom: "8px",
            fontFamily: "Inter, sans-serif",
          }}>
            Active Layers
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {activeLayers.map(id => {
              const cacheKey = `${id}-${position[0].toFixed(3)}-${position[1].toFixed(3)}`;
              const data = layerData[cacheKey];
              return (
                <div key={id} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", fontFamily: "Inter, sans-serif" }}>
                  <div
                    style={{
                      width: "10px",
                      height: "10px",
                      borderRadius: "50%",
                      background: LAYER_COLORS[id] || "#666",
                      border: "1.5px solid hsl(150 20% 14%)",
                      boxShadow: `0 0 4px ${LAYER_COLORS[id] || "#666"}40`,
                    }}
                  />
                  <span style={{ color: "hsl(150 12% 92%)", textTransform: "capitalize" }}>{id}</span>
                  {data?.features && (
                    <span style={{ color: "hsl(150 7% 51%)", fontSize: "10px" }}>({data.features.length})</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
