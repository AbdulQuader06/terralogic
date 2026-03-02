import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const markerIcon = new L.DivIcon({
  className: "custom-marker",
  html: `<div style="width:24px;height:24px;background:#2C3E50;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.3);transform:translate(-50%,-50%)"></div>`,
  iconSize: [24, 24],
  iconAnchor: [0, 0],
});

interface MapViewerProps {
  onLocationSelect: (lat: number, lon: number, name: string) => void;
  arcgisApiKey: string;
}

function ClickHandler({ onLocationSelect }: { onLocationSelect: (lat: number, lon: number, name: string) => void }) {
  useMapEvents({
    click(e) {
      const { lat, lng } = e.latlng;
      onLocationSelect(lat, lng, `Selected Location (${lat.toFixed(2)}, ${lng.toFixed(2)})`);
    },
  });
  return null;
}

function SearchControl({ onLocationSelect, arcgisApiKey }: { onLocationSelect: (lat: number, lon: number, name: string) => void; arcgisApiKey: string }) {
  const map = useMap();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="Search for a location..."
            data-testid="input-search-location"
            style={{
              padding: "8px 12px",
              borderRadius: "6px",
              border: "1px solid #ddd",
              fontSize: "13px",
              width: "260px",
              outline: "none",
              boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
              fontFamily: "Inter, sans-serif",
            }}
          />
          <button
            onClick={search}
            data-testid="button-search"
            style={{
              padding: "8px 14px",
              borderRadius: "6px",
              border: "none",
              background: "#2C3E50",
              color: "white",
              fontSize: "13px",
              cursor: "pointer",
              boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
              fontFamily: "Inter, sans-serif",
            }}
          >
            {isSearching ? "..." : "Search"}
          </button>
        </div>
        {results.length > 0 && (
          <div style={{
            marginTop: "4px",
            background: "white",
            borderRadius: "6px",
            border: "1px solid #ddd",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            overflow: "hidden",
          }}>
            {results.map((r, i) => (
              <div
                key={i}
                onClick={() => selectResult(r)}
                data-testid={`search-result-${i}`}
                style={{
                  padding: "10px 12px",
                  cursor: "pointer",
                  fontSize: "13px",
                  borderBottom: i < results.length - 1 ? "1px solid #eee" : "none",
                  fontFamily: "Inter, sans-serif",
                  transition: "background 0.15s",
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

export default function MapViewer({ onLocationSelect, arcgisApiKey }: MapViewerProps) {
  const [position, setPosition] = useState<[number, number]>([37.7749, -122.4194]);

  const handleLocationSelect = (lat: number, lon: number, name: string) => {
    setPosition([lat, lon]);
    onLocationSelect(lat, lon, name);
  };

  const basemapUrl = arcgisApiKey
    ? `https://basemapstyles-api.arcgis.com/arcgis/rest/services/styles/v2/styles/arcgis/light-gray?token=${arcgisApiKey}`
    : "";

  const tileUrl = arcgisApiKey
    ? `https://basemaps-api.arcgis.com/arcgis/rest/services/World_Basemap_v2/VectorTileServer/tile/{z}/{y}/{x}.pbf?token=${arcgisApiKey}`
    : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

  return (
    <div className="w-full h-full relative" data-testid="map-container">
      <MapContainer
        center={position}
        zoom={12}
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
        <Marker position={position} icon={markerIcon} />
        <ClickHandler onLocationSelect={handleLocationSelect} />
        <SearchControl onLocationSelect={handleLocationSelect} arcgisApiKey={arcgisApiKey} />
      </MapContainer>
    </div>
  );
}