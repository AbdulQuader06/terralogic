import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface SiteData {
  bounds: { north: number; south: number; east: number; west: number };
  center: { lat: number; lon: number };
  elevation: number;
  amenities: AmenityMix;
  buildingFootprints: BuildingFootprint[];
  area: number;
}

interface AmenityMix {
  hospitals: number;
  schools: number;
  transit: number;
  parks: number;
  restaurants: number;
  shops: number;
  total: number;
}

interface BuildingFootprint {
  id: string;
  type: string;
  name: string;
  height: number;
  floors: number;
  polygon: [number, number][];
}

interface SiteSelectorProps {
  onSiteSelected: (data: SiteData) => void;
  initialCenter?: { lat: number; lon: number };
}

export type { SiteData, AmenityMix, BuildingFootprint };

export default function SiteSelector({ onSiteSelected, initialCenter }: SiteSelectorProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const rectRef = useRef<L.Rectangle | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<string>("Draw a rectangle on the map to select your site");
  const [siteArea, setSiteArea] = useState<number>(0);
  const [amenities, setAmenities] = useState<AmenityMix | null>(null);

  const center = initialCenter || { lat: 17.4767, lon: 78.4969 };

  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;

    const map = L.map(mapRef.current, {
      center: [center.lat, center.lon],
      zoom: 16,
      zoomControl: false,
    });

    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}", {
      attribution: "Esri",
      maxZoom: 19,
    }).addTo(map);

    L.control.zoom({ position: "bottomright" }).addTo(map);

    let drawStart: L.LatLng | null = null;
    let tempRect: L.Rectangle | null = null;

    map.on("mousedown", (e: L.LeafletMouseEvent) => {
      if (e.originalEvent.shiftKey || !e.originalEvent.ctrlKey) return;
      drawStart = e.latlng;
      map.dragging.disable();
    });

    map.on("mousemove", (e: L.LeafletMouseEvent) => {
      if (!drawStart) return;
      const bounds = L.latLngBounds(drawStart, e.latlng);
      if (tempRect) map.removeLayer(tempRect);
      tempRect = L.rectangle(bounds, {
        color: "#2C5282",
        weight: 2,
        fillOpacity: 0.15,
        dashArray: "5,5",
      }).addTo(map);
    });

    map.on("mouseup", (e: L.LeafletMouseEvent) => {
      if (!drawStart) return;
      const bounds = L.latLngBounds(drawStart, e.latlng);
      if (tempRect) map.removeLayer(tempRect);
      drawStart = null;
      map.dragging.enable();

      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      const latDiff = Math.abs(ne.lat - sw.lat);
      const lonDiff = Math.abs(ne.lng - sw.lng);
      if (latDiff < 0.0005 || lonDiff < 0.0005) return;

      if (rectRef.current) map.removeLayer(rectRef.current);
      rectRef.current = L.rectangle(bounds, {
        color: "#2C5282",
        weight: 2,
        fillOpacity: 0.12,
        fillColor: "#2C5282",
      }).addTo(map);

      fetchSiteData({
        north: ne.lat,
        south: sw.lat,
        east: ne.lng,
        west: sw.lng,
      });
    });

    leafletMap.current = map;

    return () => {
      map.remove();
      leafletMap.current = null;
    };
  }, []);

  const fetchSiteData = useCallback(async (bounds: { north: number; south: number; east: number; west: number }) => {
    setIsLoading(true);
    setStatus("Fetching elevation data...");

    const centerLat = (bounds.north + bounds.south) / 2;
    const centerLon = (bounds.east + bounds.west) / 2;

    const mPerDegLat = 111320;
    const mPerDegLon = 111320 * Math.cos(centerLat * Math.PI / 180);
    const widthM = (bounds.east - bounds.west) * mPerDegLon;
    const heightM = (bounds.north - bounds.south) * mPerDegLat;
    const areaSqm = widthM * heightM;
    setSiteArea(areaSqm);

    let elevation = 0;
    try {
      const resp = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${centerLat}&longitude=${centerLon}`);
      const data = await resp.json();
      elevation = data.elevation?.[0] || 0;
    } catch { /* fallback */ }

    setStatus("Fetching amenity data...");
    let amenityData: AmenityMix = { hospitals: 0, schools: 0, transit: 0, parks: 0, restaurants: 0, shops: 0, total: 0 };
    try {
      const radius = Math.max(widthM, heightM) * 1.5;
      const queries = [
        { key: "hospitals", q: `node["amenity"~"hospital|clinic"](around:${radius},${centerLat},${centerLon})` },
        { key: "schools", q: `node["amenity"~"school|university|college"](around:${radius},${centerLat},${centerLon})` },
        { key: "transit", q: `node["public_transport"](around:${radius},${centerLat},${centerLon})` },
        { key: "parks", q: `node["leisure"~"park|garden"](around:${radius},${centerLat},${centerLon})` },
        { key: "restaurants", q: `node["amenity"~"restaurant|cafe|fast_food"](around:${radius},${centerLat},${centerLon})` },
        { key: "shops", q: `node["shop"](around:${radius},${centerLat},${centerLon})` },
      ];
      const fullQuery = `[out:json][timeout:20];${queries.map(q => `(${q.q};);out count;`).join("")}`;
      const resp2 = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        body: `data=${encodeURIComponent(fullQuery)}`,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      const data2 = await resp2.json();
      const elements = data2.elements || [];
      let idx = 0;
      for (const q of queries) {
        const el = elements[idx];
        if (el?.tags?.total) {
          (amenityData as any)[q.key] = parseInt(el.tags.total);
        }
        idx++;
      }
      amenityData.total = amenityData.hospitals + amenityData.schools + amenityData.transit + amenityData.parks + amenityData.restaurants + amenityData.shops;
    } catch { /* fallback */ }
    setAmenities(amenityData);

    setStatus("Fetching building footprints...");
    let footprints: BuildingFootprint[] = [];
    try {
      const resp = await fetch(`/api/3d/buildings?lat=${centerLat}&lon=${centerLon}&radius=${Math.round(Math.max(widthM, heightM))}`);
      const data = await resp.json();
      footprints = (data.buildings || []).map((b: any, i: number) => ({
        id: `bld-${i}`,
        type: b.type || "yes",
        name: b.name || "",
        height: b.height || 0,
        floors: b.levels || 0,
        polygon: b.polygon || [],
      }));
    } catch { /* fallback */ }

    setIsLoading(false);
    setStatus(`Site selected: ${Math.round(areaSqm).toLocaleString()} sqm | ${footprints.length} buildings | ${amenityData.total} amenities`);

    onSiteSelected({
      bounds,
      center: { lat: centerLat, lon: centerLon },
      elevation,
      amenities: amenityData,
      buildingFootprints: footprints,
      area: areaSqm,
    });
  }, [onSiteSelected]);

  return (
    <div className="flex flex-col" data-testid="site-selector">
      <div className="px-3 py-2 border-b border-border">
        <h3 className="text-xs font-bold text-primary uppercase tracking-wider">Site Selection</h3>
        <p className="text-[10px] text-muted-foreground mt-0.5">Ctrl+Click & Drag to draw site boundary</p>
      </div>

      <div className="h-[220px] relative flex-shrink-0">
        <div ref={mapRef} className="absolute inset-0" />
        {isLoading && (
          <div className="absolute inset-0 bg-background/80 flex items-center justify-center z-[1000]">
            <div className="text-center space-y-2">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
              <div className="text-[10px] text-primary">{status}</div>
            </div>
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-border text-[10px] text-muted-foreground">
        {status}
      </div>

      {amenities && (
        <div className="px-3 pb-2 space-y-1 border-t border-border pt-2">
          <div className="text-[10px] font-bold text-primary uppercase tracking-wider">Amenity Mix</div>
          <div className="grid grid-cols-3 gap-1">
            {[
              { label: "Healthcare", value: amenities.hospitals, color: "text-red-600" },
              { label: "Education", value: amenities.schools, color: "text-amber-600" },
              { label: "Transit", value: amenities.transit, color: "text-blue-600" },
              { label: "Parks", value: amenities.parks, color: "text-green-600" },
              { label: "F&B", value: amenities.restaurants, color: "text-orange-600" },
              { label: "Retail", value: amenities.shops, color: "text-purple-600" },
            ].map(item => (
              <div key={item.label} className="bg-muted/50 rounded px-2 py-1 border border-border">
                <div className={`text-[10px] font-medium ${item.color}`}>{item.value}</div>
                <div className="text-[9px] text-muted-foreground">{item.label}</div>
              </div>
            ))}
          </div>
          {siteArea > 0 && (
            <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-border">
              <span>Site Area</span>
              <span className="text-primary font-medium">{(siteArea / 10000).toFixed(2)} Ha ({Math.round(siteArea).toLocaleString()} sqm)</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
