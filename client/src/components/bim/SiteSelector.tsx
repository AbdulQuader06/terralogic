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
  sitePolygon?: [number, number][];
  contextBounds?: { north: number; south: number; east: number; west: number };
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

type DrawTool = "none" | "site-polygon" | "context-rect";

function polygonAreaSqm(latLons: [number, number][]): number {
  if (latLons.length < 3) return 0;
  const mLat = 111320;
  const mLon = 111320 * Math.cos(latLons[0][0] * Math.PI / 180);
  const pts = latLons.map(([lat, lon]) => [lat * mLat, lon * mLon]);
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area += pts[j][0] * pts[i][1];
    area -= pts[i][0] * pts[j][1];
  }
  return Math.abs(area) / 2;
}

export default function SiteSelector({ onSiteSelected, initialCenter }: SiteSelectorProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);

  // Site polygon layers
  const sitePolyLayerRef = useRef<L.Polygon | null>(null);
  const sitePolyTempRef = useRef<L.Polyline | null>(null);
  const sitePolySnapRef = useRef<L.CircleMarker | null>(null);
  const siteVertexMarkersRef = useRef<L.CircleMarker[]>([]);

  // Context rect layers
  const contextRectRef = useRef<L.Rectangle | null>(null);
  const contextTempRef = useRef<L.Rectangle | null>(null);

  // Draw state (refs for inside event handlers)
  const drawToolRef = useRef<DrawTool>("none");
  const polyVerticesRef = useRef<L.LatLng[]>([]);
  const rectStartRef = useRef<L.LatLng | null>(null);

  // Store last confirmed site data to re-emit when context changes
  const lastSiteDataRef = useRef<SiteData | null>(null);
  const onSiteSelectedRef = useRef(onSiteSelected);
  useEffect(() => { onSiteSelectedRef.current = onSiteSelected; }, [onSiteSelected]);

  // React state
  const [drawTool, setDrawTool] = useState<DrawTool>("none");
  const [isLoading, setIsLoading] = useState(false);
  const [isContextLoading, setIsContextLoading] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [contextStatus, setContextStatus] = useState<string>("");
  const [siteConfirmed, setSiteConfirmed] = useState(false);
  const [contextConfirmed, setContextConfirmed] = useState(false);
  const [siteArea, setSiteArea] = useState(0);
  const [amenities, setAmenities] = useState<AmenityMix | null>(null);
  const [vertexCount, setVertexCount] = useState(0);
  const [pendingContextBounds, setPendingContextBounds] = useState<{north:number;south:number;east:number;west:number} | null>(null);

  const center = initialCenter || { lat: 17.4767, lon: 78.4969 };

  // Sync tool ref
  useEffect(() => {
    drawToolRef.current = drawTool;
    const map = leafletMap.current;
    if (!map) return;
    if (drawTool !== "none") {
      map.dragging.disable();
      map.getContainer().style.cursor = drawTool === "site-polygon" ? "crosshair" : "cell";
    } else {
      map.dragging.enable();
      map.getContainer().style.cursor = "";
    }
  }, [drawTool]);

  const cancelDraw = useCallback(() => {
    const map = leafletMap.current;
    if (!map) return;
    polyVerticesRef.current = [];
    setVertexCount(0);
    if (sitePolyTempRef.current) { map.removeLayer(sitePolyTempRef.current); sitePolyTempRef.current = null; }
    if (sitePolySnapRef.current) { map.removeLayer(sitePolySnapRef.current); sitePolySnapRef.current = null; }
    siteVertexMarkersRef.current.forEach(m => map.removeLayer(m));
    siteVertexMarkersRef.current = [];
    if (contextTempRef.current) { map.removeLayer(contextTempRef.current); contextTempRef.current = null; }
    rectStartRef.current = null;
    drawToolRef.current = "none";
    setDrawTool("none");
    map.dragging.enable();
    map.getContainer().style.cursor = "";
  }, []);

  const commitPolygon = useCallback(() => {
    const map = leafletMap.current;
    if (!map) return;
    const verts = polyVerticesRef.current;
    if (verts.length < 3) { cancelDraw(); return; }

    if (sitePolyTempRef.current) map.removeLayer(sitePolyTempRef.current);
    if (sitePolySnapRef.current) map.removeLayer(sitePolySnapRef.current);
    siteVertexMarkersRef.current.forEach(m => map.removeLayer(m));
    siteVertexMarkersRef.current = [];
    if (sitePolyLayerRef.current) map.removeLayer(sitePolyLayerRef.current);

    sitePolyLayerRef.current = L.polygon(verts, {
      color: "#2C5282",
      weight: 2.5,
      fillColor: "#2C5282",
      fillOpacity: 0.14,
    }).addTo(map);

    const polygon: [number, number][] = verts.map(v => [v.lat, v.lng]);
    const bounds = L.latLngBounds(verts);
    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();

    polyVerticesRef.current = [];
    setVertexCount(0);
    drawToolRef.current = "none";
    setDrawTool("none");
    map.dragging.enable();
    map.getContainer().style.cursor = "";

    fetchSiteData(
      { north: ne.lat, south: sw.lat, east: ne.lng, west: sw.lng },
      polygon
    );
  }, []);

  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;
    const map = L.map(mapRef.current, { center: [center.lat, center.lon], zoom: 16, zoomControl: false });
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}", {
      attribution: "Esri", maxZoom: 19,
    }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);

    // ── CLICK: add polygon vertex OR rect start ──
    map.on("click", (e: L.LeafletMouseEvent) => {
      const tool = drawToolRef.current;
      if (tool === "none") return;
      e.originalEvent.preventDefault();
      e.originalEvent.stopPropagation();

      if (tool === "site-polygon") {
        const verts = polyVerticesRef.current;
        // Snap-close: if near first vertex, commit
        if (verts.length >= 3) {
          const first = verts[0];
          const dist = map.latLngToLayerPoint(e.latlng).distanceTo(map.latLngToLayerPoint(first));
          if (dist < 14) {
            commitPolygon();
            return;
          }
        }
        verts.push(e.latlng);
        setVertexCount(verts.length);

        // Vertex marker
        const vm = L.circleMarker(e.latlng, {
          radius: 4, color: "#2C5282", fillColor: "#fff", fillOpacity: 1, weight: 2,
        }).addTo(map);
        siteVertexMarkersRef.current.push(vm);

        // Snap indicator on first vertex
        if (verts.length === 1) {
          sitePolySnapRef.current = L.circleMarker(e.latlng, {
            radius: 10, color: "#2C5282", fillOpacity: 0, weight: 2, dashArray: "4,3",
          }).addTo(map);
        }
      }
    });

    // ── DOUBLE CLICK: close polygon ──
    map.on("dblclick", (e: L.LeafletMouseEvent) => {
      if (drawToolRef.current !== "site-polygon") return;
      e.originalEvent.preventDefault();
      e.originalEvent.stopPropagation();
      commitPolygon();
    });

    // ── MOUSE MOVE: rubber-band line for polygon / preview rect ──
    map.on("mousemove", (e: L.LeafletMouseEvent) => {
      const tool = drawToolRef.current;
      if (tool === "site-polygon") {
        const verts = polyVerticesRef.current;
        if (verts.length === 0) return;
        if (sitePolyTempRef.current) map.removeLayer(sitePolyTempRef.current);
        sitePolyTempRef.current = L.polyline([...verts, e.latlng], {
          color: "#2C5282", weight: 1.5, dashArray: "6,4", opacity: 0.8,
        }).addTo(map);
      } else if (tool === "context-rect") {
        if (!rectStartRef.current) return;
        const bounds = L.latLngBounds(rectStartRef.current, e.latlng);
        if (contextTempRef.current) map.removeLayer(contextTempRef.current);
        contextTempRef.current = L.rectangle(bounds, {
          color: "#2A9D8F", weight: 2, fillColor: "#2A9D8F", fillOpacity: 0.08, dashArray: "8,5",
        }).addTo(map);
      }
    });

    // ── MOUSE DOWN: start context rect ──
    map.on("mousedown", (e: L.LeafletMouseEvent) => {
      if (drawToolRef.current !== "context-rect") return;
      e.originalEvent.preventDefault();
      rectStartRef.current = e.latlng;
    });

    // ── MOUSE UP: commit context rect ──
    map.on("mouseup", (e: L.LeafletMouseEvent) => {
      if (drawToolRef.current !== "context-rect" || !rectStartRef.current) return;
      const bounds = L.latLngBounds(rectStartRef.current, e.latlng);
      if (contextTempRef.current) { map.removeLayer(contextTempRef.current); contextTempRef.current = null; }
      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      const latDiff = Math.abs(ne.lat - sw.lat);
      const lonDiff = Math.abs(ne.lng - sw.lng);
      rectStartRef.current = null;
      if (latDiff < 0.0002 || lonDiff < 0.0002) return;

      if (contextRectRef.current) map.removeLayer(contextRectRef.current);
      contextRectRef.current = L.rectangle(bounds, {
        color: "#2A9D8F", weight: 2, fillColor: "#2A9D8F", fillOpacity: 0.06, dashArray: "8,5",
      }).addTo(map);

      drawToolRef.current = "none";
      setDrawTool("none");
      map.dragging.enable();
      map.getContainer().style.cursor = "";

      // Trigger async building fetch for context area via state
      const ctxBounds = { north: ne.lat, south: sw.lat, east: ne.lng, west: sw.lng };
      setPendingContextBounds(ctxBounds);
    });

    // ESC to cancel
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cancelDraw(); };
    document.addEventListener("keydown", onKey);

    leafletMap.current = map;
    return () => {
      document.removeEventListener("keydown", onKey);
      map.remove();
      leafletMap.current = null;
    };
  }, [commitPolygon, cancelDraw]);

  const fetchSiteData = useCallback(async (
    bounds: { north: number; south: number; east: number; west: number },
    polygon?: [number, number][]
  ) => {
    setIsLoading(true);
    setSiteConfirmed(false);
    setStatus("Fetching elevation data...");

    const centerLat = (bounds.north + bounds.south) / 2;
    const centerLon = (bounds.east + bounds.west) / 2;
    const mPerDegLat = 111320;
    const mPerDegLon = 111320 * Math.cos(centerLat * Math.PI / 180);
    const widthM = (bounds.east - bounds.west) * mPerDegLon;
    const heightM = (bounds.north - bounds.south) * mPerDegLat;

    const areaSqm = polygon ? polygonAreaSqm(polygon) : widthM * heightM;
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
        if (el?.tags?.total) (amenityData as any)[q.key] = parseInt(el.tags.total);
        idx++;
      }
      amenityData.total = amenityData.hospitals + amenityData.schools + amenityData.transit + amenityData.parks + amenityData.restaurants + amenityData.shops;
    } catch { /* fallback */ }
    setAmenities(amenityData);

    setStatus("Fetching building footprints...");
    let footprints: BuildingFootprint[] = [];
    let siteBldgSource = "osm";
    try {
      const resp = await fetch(`/api/3d/buildings?lat=${centerLat}&lon=${centerLon}&radius=${Math.round(Math.max(widthM, heightM))}`);
      const data = await resp.json();
      siteBldgSource = data.source || "osm";
      footprints = (data.buildings || []).map((b: any, i: number) => ({
        id: `bld-${i}`, type: b.type || "yes", name: b.name || "",
        height: b.height || 0, floors: b.levels || 0, polygon: b.polygon || [],
      }));
    } catch { siteBldgSource = "error"; }

    setIsLoading(false);
    setSiteConfirmed(true);
    const shape = polygon ? `${polygon.length}-pt polygon` : "rectangle";
    const siteSrcLabel = siteBldgSource === "synthetic" ? " ~est" : "";
    setStatus(`${shape} | ${Math.round(areaSqm).toLocaleString()} sqm | ${footprints.length} bldgs${siteSrcLabel}`);

    const siteResult: SiteData = {
      bounds,
      center: { lat: centerLat, lon: centerLon },
      elevation,
      amenities: amenityData,
      buildingFootprints: footprints,
      area: areaSqm,
      sitePolygon: polygon,
    };
    lastSiteDataRef.current = siteResult;
    onSiteSelected(siteResult);
  }, [onSiteSelected]);

  // ── Fetch 3D buildings for the context / neighbourhood area ──────────
  const fetchContextData = useCallback(async (ctxBounds: {north:number;south:number;east:number;west:number}) => {
    setIsContextLoading(true);
    setContextStatus("Loading neighbourhood buildings...");

    const centerLat = (ctxBounds.north + ctxBounds.south) / 2;
    const centerLon = (ctxBounds.east + ctxBounds.west) / 2;
    const mPerDegLat = 111320;
    const mPerDegLon = 111320 * Math.cos(centerLat * Math.PI / 180);
    const widthM = (ctxBounds.east - ctxBounds.west) * mPerDegLon;
    const heightM = (ctxBounds.north - ctxBounds.south) * mPerDegLat;
    const areaSqm = widthM * heightM;

    let footprints: BuildingFootprint[] = [];
    let bldgSource = "osm";
    try {
      const resp = await fetch(`/api/3d/buildings?lat=${centerLat}&lon=${centerLon}&radius=${Math.round(Math.max(widthM, heightM))}`);
      const data = await resp.json();
      bldgSource = data.source || "osm";
      footprints = (data.buildings || []).map((b: any, i: number) => ({
        id: `ctx-${i}`, type: b.type || "yes", name: b.name || "",
        height: b.height || 0, floors: b.levels || 0, polygon: b.polygon || [],
      }));
    } catch { bldgSource = "error"; }

    setIsContextLoading(false);
    setContextConfirmed(true);
    const srcLabel = bldgSource === "synthetic" ? " (estimated)" : "";
    setContextStatus(`${footprints.length} buildings in context area${srcLabel}`);

    const existing = lastSiteDataRef.current;
    if (existing) {
      // Site polygon already drawn — update its buildings with the wider context set
      const updated: SiteData = { ...existing, contextBounds: ctxBounds, buildingFootprints: footprints };
      lastSiteDataRef.current = updated;
      onSiteSelectedRef.current(updated);
    } else {
      // Context drawn before site polygon — use context bounds as temporary site
      let elevation = 0;
      try {
        const r = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${centerLat}&longitude=${centerLon}`);
        const d = await r.json();
        elevation = d.elevation?.[0] || 0;
      } catch { /* ignore */ }

      const tempSite: SiteData = {
        bounds: ctxBounds,
        center: { lat: centerLat, lon: centerLon },
        elevation,
        amenities: { hospitals: 0, schools: 0, transit: 0, parks: 0, restaurants: 0, shops: 0, total: 0 },
        buildingFootprints: footprints,
        area: areaSqm,
        contextBounds: ctxBounds,
      };
      lastSiteDataRef.current = tempSite;
      onSiteSelectedRef.current(tempSite);
    }
    setPendingContextBounds(null);
  }, []);

  useEffect(() => {
    if (!pendingContextBounds) return;
    fetchContextData(pendingContextBounds);
  }, [pendingContextBounds, fetchContextData]);

  const activateTool = (tool: DrawTool) => {
    if (drawTool === tool) { cancelDraw(); return; }
    cancelDraw();
    setDrawTool(tool);
  };

  return (
    <div className="flex flex-col" data-testid="site-selector">
      <div className="px-3 py-2 border-b border-border">
        <h3 className="text-xs font-bold text-primary uppercase tracking-wider">Step 1 — Select Site</h3>

        <div className="flex gap-1.5 mt-2">
          <button
            onClick={() => activateTool("site-polygon")}
            className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[11px] font-medium border transition-all ${
              drawTool === "site-polygon"
                ? "bg-primary text-white border-primary shadow"
                : siteConfirmed
                  ? "bg-primary/5 text-primary border-primary/30"
                  : "bg-white text-primary border-primary/40 hover:border-primary hover:bg-primary/5"
            }`}
            data-testid="bim-draw-site-btn"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polygon points="3,12 9,3 21,3 21,21 3,21"/>
            </svg>
            {drawTool === "site-polygon" ? (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                {vertexCount > 0 ? `${vertexCount} pts — dbl-click to close` : "Click to add points"}
              </span>
            ) : (
              <span>{siteConfirmed ? "✓ Site Polygon" : "Draw Site"}</span>
            )}
          </button>

          <button
            onClick={() => activateTool("context-rect")}
            className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[11px] font-medium border transition-all ${
              drawTool === "context-rect"
                ? "bg-[#2A9D8F] text-white border-[#2A9D8F] shadow"
                : contextConfirmed
                  ? "bg-[#2A9D8F]/5 text-[#2A9D8F] border-[#2A9D8F]/30"
                  : "bg-white text-[#2A9D8F] border-[#2A9D8F]/40 hover:border-[#2A9D8F] hover:bg-[#2A9D8F]/5"
            }`}
            data-testid="bim-draw-context-btn"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray="3,2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
            </svg>
            {drawTool === "context-rect" ? (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                Drag to draw
              </span>
            ) : (
              <span>{contextConfirmed ? "✓ Context Area" : "Context Area"}</span>
            )}
          </button>
        </div>

        {drawTool === "site-polygon" && (
          <p className="text-[10px] text-primary mt-1.5 bg-primary/5 rounded px-2 py-1">
            Click on map to add vertices — double-click or click first point to close. ESC to cancel.
          </p>
        )}
        {drawTool === "context-rect" && (
          <p className="text-[10px] text-[#2A9D8F] mt-1.5 bg-[#2A9D8F]/5 rounded px-2 py-1">
            Drag to mark the wider neighbourhood study area. ESC to cancel.
          </p>
        )}
        {siteConfirmed && !drawTool && (
          <p className="text-[10px] text-green-600 font-medium mt-1.5">Site confirmed — proceed to Step 2</p>
        )}
      </div>

      <div className="h-[230px] relative flex-shrink-0">
        <div ref={mapRef} className="absolute inset-0" />

        {/* Legend overlay */}
        {(siteConfirmed || contextConfirmed) && !isLoading && (
          <div className="absolute bottom-1.5 left-1.5 z-[1000] flex flex-col gap-1 pointer-events-none">
            {siteConfirmed && (
              <div className="flex items-center gap-1.5 bg-white/90 rounded px-2 py-1 shadow text-[10px]">
                <div className="w-3 h-3 rounded-sm border-2 border-[#2C5282] bg-[#2C5282]/20" />
                <span className="text-[#2C5282] font-medium">Site Boundary</span>
              </div>
            )}
            {contextConfirmed && (
              <div className="flex items-center gap-1.5 bg-white/90 rounded px-2 py-1 shadow text-[10px]">
                <div className="w-3 h-3 rounded-sm border-2 border-dashed border-[#2A9D8F] bg-[#2A9D8F]/15" />
                <span className="text-[#2A9D8F] font-medium">Context Area</span>
              </div>
            )}
          </div>
        )}

        {isLoading && (
          <div className="absolute inset-0 bg-background/80 flex items-center justify-center z-[1000]">
            <div className="text-center space-y-2">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
              <div className="text-[10px] text-primary">{status}</div>
            </div>
          </div>
        )}
        {isContextLoading && (
          <div className="absolute inset-0 bg-background/70 flex items-center justify-center z-[1001]">
            <div className="text-center space-y-2">
              <div className="w-6 h-6 border-2 border-[#2A9D8F] border-t-transparent rounded-full animate-spin mx-auto" />
              <div className="text-[10px] text-[#2A9D8F] font-medium">Fetching neighbourhood buildings…</div>
            </div>
          </div>
        )}
      </div>

      {contextConfirmed && contextStatus && !isContextLoading && (
        <div className="px-3 py-1.5 border-t border-[#2A9D8F]/20 bg-[#2A9D8F]/5 flex items-center gap-2">
          <span className="text-[10px] text-[#2A9D8F]">🏢</span>
          <span className="text-[10px] text-[#2A9D8F] font-medium">{contextStatus}</span>
        </div>
      )}

      {siteConfirmed && (
        <div className="px-3 py-1.5 border-t border-green-200 bg-green-50 flex items-center gap-2">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          <span className="text-[10px] text-green-700 font-medium">{status}</span>
        </div>
      )}

      {amenities && siteConfirmed && (
        <div className="px-3 pb-2 space-y-1 border-t border-border pt-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-bold text-primary uppercase tracking-wider">Amenity Mix</div>
            {siteArea > 0 && (
              <span className="text-[10px] text-primary font-medium">
                {Math.round(siteArea).toLocaleString()} sqm
              </span>
            )}
          </div>
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
          <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-border">
            <span>Plot Area</span>
            <span className="text-primary font-medium">{Math.round(siteArea).toLocaleString()} sqm</span>
          </div>
        </div>
      )}
    </div>
  );
}
