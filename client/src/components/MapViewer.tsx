import { useEffect, useRef, useState, useCallback } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap, GeoJSON, CircleMarker, Tooltip } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const markerIcon = new L.DivIcon({
  className: "custom-marker",
  html: `<div style="width:20px;height:20px;background:#2C3E50;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.35);transform:translate(-50%,-50%)"></div>`,
  iconSize: [20, 20],
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

function SearchControl({ onLocationSelect, arcgisApiKey }: { onLocationSelect: (lat: number, lon: number, name: string) => void; arcgisApiKey: string }) {
  const map = useMap();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const search = async () => {
    if (!query.trim()) return;
    setIsSearching(true);
    try {
      const response = await fetch(
        `https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&singleLine=${encodeURIComponent(query)}&maxLocations=5&token=${arcgisApiKey}`
      );
      const data = await response.json();
      setResults(data.candidates || []);
    } catch (err) {
      console.error("Geocode error:", err);
    } finally {
      setIsSearching(false);
    }
  };

  const selectResult = (result: any) => {
    const { x, y } = result.location;
    map.flyTo([y, x], 14, { duration: 1.5 });
    onLocationSelect(y, x, result.address);
    setResults([]);
    setQuery(result.address);
  };

  return (
    <div className="leaflet-top leaflet-right" style={{ pointerEvents: "auto" }}>
      <div style={{ margin: "10px", zIndex: 1000, position: "relative" }}>
        <div style={{ display: "flex", gap: "4px" }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="Search location..."
            data-testid="input-search-location"
            style={{
              padding: "8px 12px", borderRadius: "8px", border: "1px solid #d1d5db",
              fontSize: "13px", width: "280px", outline: "none",
              boxShadow: "0 2px 8px rgba(0,0,0,0.12)", fontFamily: "Inter, sans-serif", background: "white",
            }}
          />
          <button
            onClick={search}
            data-testid="button-search"
            style={{
              padding: "8px 16px", borderRadius: "8px", border: "none",
              background: "#2C3E50", color: "white", fontSize: "13px", cursor: "pointer",
              boxShadow: "0 2px 8px rgba(0,0,0,0.12)", fontFamily: "Inter, sans-serif", fontWeight: 500,
            }}
          >
            {isSearching ? "..." : "Search"}
          </button>
        </div>
        {results.length > 0 && (
          <div style={{
            marginTop: "4px", background: "white", borderRadius: "8px",
            border: "1px solid #e5e7eb", boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
            overflow: "hidden", maxHeight: "240px", overflowY: "auto",
          }}>
            {results.map((r, i) => (
              <div
                key={i}
                onClick={() => selectResult(r)}
                data-testid={`search-result-${i}`}
                style={{
                  padding: "10px 12px", cursor: "pointer", fontSize: "13px",
                  borderBottom: i < results.length - 1 ? "1px solid #f3f4f6" : "none",
                  fontFamily: "Inter, sans-serif", transition: "background 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f4f8")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
              >
                {r.address}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
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
                {feature.properties?.type && <div style={{ color: "#666", fontSize: "11px" }}>{feature.properties.type}</div>}
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

export default function MapViewer({ onLocationSelect, arcgisApiKey, activeLayers, onLayerLoading }: MapViewerProps) {
  const [position, setPosition] = useState<[number, number]>([37.7749, -122.4194]);
  const [layerData, setLayerData] = useState<LayerData>({});
  const abortRef = useRef<AbortController | null>(null);

  const handleLocationSelect = useCallback((lat: number, lon: number, name: string) => {
    if (abortRef.current) abortRef.current.abort();
    setPosition([lat, lon]);
    setLayerData({});
    onLocationSelect(lat, lon, name);
  }, [onLocationSelect]);

  useEffect(() => {
    if (!position || activeLayers.length === 0) return;
    const [lat, lon] = position;
    const controller = new AbortController();
    abortRef.current = controller;

    activeLayers.forEach(async (layerId) => {
      const cacheKey = `${layerId}-${lat.toFixed(3)}-${lon.toFixed(3)}`;
      if (layerData[cacheKey]) return;

      onLayerLoading?.(layerId, true);
      try {
        const params = new URLSearchParams({ lat: lat.toString(), lon: lon.toString(), radius: "5000" });
        const resp = await fetch(`/api/layers/${layerId}?${params}`, { signal: controller.signal });
        if (resp.ok) {
          const data = await resp.json();
          if (!controller.signal.aborted) {
            setLayerData(prev => ({ ...prev, [cacheKey]: data }));
          }
        }
      } catch (e: any) {
        if (e.name !== "AbortError") console.error(`Layer fetch error (${layerId}):`, e);
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
        zoomControl={true}
        attributionControl={true}
      >
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
          attribution='&copy; <a href="https://www.esri.com">Esri</a>'
          maxZoom={19}
        />
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
          maxZoom={19}
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
        <SearchControl onLocationSelect={handleLocationSelect} arcgisApiKey={arcgisApiKey} />
      </MapContainer>

      {activeLayers.length > 0 && (
        <div className="absolute bottom-4 left-4 z-[500] bg-white/90 backdrop-blur-sm rounded-lg border border-gray-200 p-3 shadow-lg" data-testid="map-legend">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2">Active Layers</p>
          <div className="space-y-1.5">
            {activeLayers.map(id => {
              const cacheKey = `${id}-${position[0].toFixed(3)}-${position[1].toFixed(3)}`;
              const data = layerData[cacheKey];
              return (
                <div key={id} className="flex items-center gap-2 text-xs">
                  <div
                    className="w-3 h-3 rounded-full border border-white shadow-sm"
                    style={{ background: LAYER_COLORS[id] || "#666" }}
                  />
                  <span className="capitalize text-gray-700">{id}</span>
                  {data?.features && (
                    <span className="text-gray-400 text-[10px]">({data.features.length})</span>
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