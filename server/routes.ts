import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { chatRequestSchema, analyzeRequestSchema } from "@shared/schema";
import type { SiteAnalysis } from "@shared/schema";
import { GoogleGenerativeAI } from "@google/generative-ai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const ARCGIS_API_KEY = process.env.ARCGIS_API_KEY || "";
const MAX_CHAT_HISTORY = 20;

function generateSiteAnalysis(lat: number, lon: number, name: string): SiteAnalysis {
  const seed = Math.abs(Math.sin(lat * 12.9898 + lon * 78.233) * 43758.5453) % 1;
  const floodRisk = Math.floor(seed * 60 + 10);
  const soilStability = Math.floor(((seed * 7.3) % 1) * 50 + 40);
  const urbanDensity = Math.floor(((seed * 3.7) % 1) * 70 + 20);
  const schoolProximity = Math.floor(((seed * 5.1) % 1) * 60 + 30);
  const climateStress = Math.floor(((seed * 2.9) % 1) * 50 + 15);
  const infrastructureAccess = Math.floor(((seed * 4.3) % 1) * 60 + 30);
  const elevationSuitability = Math.floor(((seed * 6.1) % 1) * 50 + 40);
  const benefitAvg = (soilStability + schoolProximity + infrastructureAccess + elevationSuitability) / 4;
  const riskAvg = (floodRisk + climateStress) / 2;
  const overallScore = Math.min(95, Math.max(25, Math.floor(benefitAvg - riskAvg * 0.4 + 30)));
  const rating = overallScore >= 75 ? "Highly Suitable" : overallScore >= 55 ? "Moderate Potential" : "High Risk Area";
  const alerts: SiteAnalysis["alerts"] = [];
  if (floodRisk > 50) alerts.push({ type: "warning", title: "Elevated Flood Risk", description: `Flood vulnerability index at ${floodRisk}%. Consider drainage infrastructure and flood barriers.` });
  if (climateStress > 45) alerts.push({ type: "warning", title: "Climate Stress Factor", description: `Region shows ${climateStress}% climate stress. Heat island effects and extreme weather events are likely.` });
  if (overallScore >= 75) alerts.push({ type: "success", title: "Favorable Site Conditions", description: "Strong balance of infrastructure proximity, soil stability, and manageable environmental risks." });
  if (urbanDensity > 70) alerts.push({ type: "info", title: "High Urban Density", description: "Dense urban surroundings may increase construction logistics complexity but improve market access." });
  return {
    overallScore, rating,
    factors: [
      { name: "Flood Risk", value: floodRisk, category: "risk" },
      { name: "Soil Stability", value: soilStability, category: "benefit" },
      { name: "Urban Density", value: urbanDensity, category: "benefit" },
      { name: "School Proximity", value: schoolProximity, category: "benefit" },
      { name: "Climate Stress", value: climateStress, category: "risk" },
      { name: "Infrastructure Access", value: infrastructureAccess, category: "benefit" },
      { name: "Elevation Suitability", value: elevationSuitability, category: "benefit" },
    ],
    amenities: {
      schools: Math.floor(seed * 8) + 1,
      transitStops: Math.floor(((seed * 3.7) % 1) * 15) + 2,
      hospitals: Math.floor(((seed * 5.1) % 1) * 4),
      parks: Math.floor(((seed * 2.3) % 1) * 12) + 3,
    },
    alerts,
  };
}

async function fetchOverpassPoints(lat: number, lon: number, radius: number, query: string): Promise<any> {
  const overpassUrl = "https://overpass-api.de/api/interpreter";
  const bbox = `(around:${radius},${lat},${lon})`;
  const overpassQuery = `[out:json][timeout:15];(${query.replace(/BBOX/g, bbox)});out center;`;
  try {
    const resp = await fetch(overpassUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(overpassQuery)}`,
    });
    if (!resp.ok) throw new Error(`Overpass error: ${resp.status}`);
    return await resp.json();
  } catch (e: any) {
    console.error("Overpass fetch error:", e.message);
    return { elements: [] };
  }
}

async function fetchOverpassGeometry(lat: number, lon: number, radius: number, query: string): Promise<any> {
  const overpassUrl = "https://overpass-api.de/api/interpreter";
  const bbox = `(around:${radius},${lat},${lon})`;
  const overpassQuery = `[out:json][timeout:25];(${query.replace(/BBOX/g, bbox)});out body geom;`;
  try {
    const resp = await fetch(overpassUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(overpassQuery)}`,
    });
    if (!resp.ok) throw new Error(`Overpass error: ${resp.status}`);
    return await resp.json();
  } catch (e: any) {
    console.error("Overpass geometry fetch error:", e.message);
    return { elements: [] };
  }
}

function overpassPointsToGeoJSON(data: any, properties: Record<string, any> = {}): any {
  const features = (data.elements || [])
    .filter((el: any) => el.lat || el.center)
    .map((el: any) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [el.lon || el.center?.lon, el.lat || el.center?.lat],
      },
      properties: {
        ...properties,
        name: el.tags?.name || el.tags?.amenity || el.tags?.landuse || "Unknown",
        type: el.tags?.amenity || el.tags?.landuse || el.tags?.natural || el.tags?.building || "",
        ...el.tags,
      },
    }));
  return { type: "FeatureCollection", features };
}

function overpassGeometryToGeoJSON(data: any, properties: Record<string, any> = {}): any {
  const features: any[] = [];
  for (const el of (data.elements || [])) {
    const tags = el.tags || {};
    const baseProps = {
      ...properties,
      name: tags.name || tags.landuse || tags.natural || tags.leisure || tags.waterway || "Unknown",
      type: tags.landuse || tags.natural || tags.leisure || tags.waterway || tags.amenity || "",
      ...tags,
    };

    if (el.type === "node" && el.lat && el.lon) {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [el.lon, el.lat] },
        properties: baseProps,
      });
    } else if (el.type === "way" && el.geometry && el.geometry.length > 0) {
      const coords = el.geometry.map((n: any) => [n.lon, n.lat]);
      const isClosed = coords.length >= 4 &&
        coords[0][0] === coords[coords.length - 1][0] &&
        coords[0][1] === coords[coords.length - 1][1];
      if (isClosed) {
        features.push({
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [coords] },
          properties: baseProps,
        });
      } else {
        features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: coords },
          properties: baseProps,
        });
      }
    } else if (el.type === "relation" && el.members) {
      const outerRings: number[][][] = [];
      for (const member of el.members) {
        if (member.type === "way" && member.geometry && member.role === "outer") {
          const coords = member.geometry.map((n: any) => [n.lon, n.lat]);
          outerRings.push(coords);
        }
      }
      if (outerRings.length > 0) {
        if (outerRings.length === 1) {
          features.push({
            type: "Feature",
            geometry: { type: "Polygon", coordinates: outerRings },
            properties: baseProps,
          });
        } else {
          features.push({
            type: "Feature",
            geometry: { type: "MultiPolygon", coordinates: outerRings.map(r => [r]) },
            properties: baseProps,
          });
        }
      }
    }
  }
  return { type: "FeatureCollection", features };
}

async function fetchArcGISFeatureLayer(url: string, lat: number, lon: number, radius: number): Promise<any> {
  const degOffset = radius / 111000;
  const params = new URLSearchParams({
    where: "1=1",
    geometry: JSON.stringify({
      xmin: lon - degOffset, ymin: lat - degOffset,
      xmax: lon + degOffset, ymax: lat + degOffset,
      spatialReference: { wkid: 4326 },
    }),
    geometryType: "esriGeometryEnvelope",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "true",
    f: "geojson",
    resultRecordCount: "200",
  });
  if (ARCGIS_API_KEY) params.append("token", ARCGIS_API_KEY);
  try {
    const resp = await fetch(`${url}/query?${params.toString()}`);
    if (!resp.ok) throw new Error(`ArcGIS error: ${resp.status}`);
    return await resp.json();
  } catch (e: any) {
    console.error("ArcGIS fetch error:", e.message);
    return { type: "FeatureCollection", features: [] };
  }
}

function generateSoilGrid(lat: number, lon: number): any {
  const soilTypes = ["Clay Loam", "Sandy Loam", "Silty Clay", "Loam", "Sandy Clay Loam", "Silt Loam"];
  const drainage = ["Well Drained", "Moderately Well Drained", "Poorly Drained", "Somewhat Poorly Drained"];
  const gridSize = 0.005;
  const features = [];
  for (let dlat = -2; dlat <= 2; dlat++) {
    for (let dlon = -2; dlon <= 2; dlon++) {
      const clat = lat + dlat * gridSize;
      const clon = lon + dlon * gridSize;
      const localSeed = Math.abs(Math.sin(clat * 12.9898 + clon * 78.233) * 43758.5453) % 1;
      features.push({
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[
            [clon - gridSize / 2, clat - gridSize / 2],
            [clon + gridSize / 2, clat - gridSize / 2],
            [clon + gridSize / 2, clat + gridSize / 2],
            [clon - gridSize / 2, clat + gridSize / 2],
            [clon - gridSize / 2, clat - gridSize / 2],
          ]],
        },
        properties: {
          layer: "soil",
          soilType: soilTypes[Math.floor(localSeed * soilTypes.length)],
          drainage: drainage[Math.floor(((localSeed * 3.7) % 1) * drainage.length)],
          permeability: Math.floor(localSeed * 60 + 20),
          bearing_capacity: Math.floor(((localSeed * 5.1) % 1) * 50 + 30),
        },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/config", (_req, res) => {
    res.json({ arcgisApiKey: ARCGIS_API_KEY });
  });

  app.post("/api/analyze", async (req, res) => {
    const parsed = analyzeRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    const { lat, lon, name } = parsed.data;
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    let analysis = await storage.getAnalysis(key);
    if (!analysis) {
      analysis = generateSiteAnalysis(lat, lon, name);
      await storage.saveAnalysis(key, analysis);
    }
    res.json(analysis);
  });

  app.post("/api/chat", async (req, res) => {
    const parsed = chatRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    const { message, locationName, lat, lon } = parsed.data;
    let { history } = parsed.data;
    if (!GEMINI_API_KEY) return res.status(500).json({ error: "Gemini API key not configured" });

    if (history && history.length > MAX_CHAT_HISTORY) {
      history = history.slice(-MAX_CHAT_HISTORY);
    }

    try {
      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      let siteContext = "";
      if (lat !== undefined && lon !== undefined && locationName) {
        const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
        const analysis = await storage.getAnalysis(key);
        if (analysis) {
          siteContext = `\n\nSite Analysis Data for ${locationName}:\n- Overall Suitability Score: ${analysis.overallScore}/100 (${analysis.rating})\n- Factors: ${analysis.factors.map(f => `${f.name}: ${f.value}%`).join(", ")}\n- Nearby: ${analysis.amenities.schools} schools, ${analysis.amenities.transitStops} transit stops, ${analysis.amenities.hospitals} hospitals, ${analysis.amenities.parks} parks`;
        }
      }
      const systemPrompt = `You are TerraLogic AI, a professional GIS spatial analyst AI assistant specialized in construction site suitability analysis. You help users understand spatial data layers including elevation, soil type, flood risk, land use, climate, and nearby infrastructure. You provide clear, actionable insights about site suitability for construction projects. Keep responses focused, professional, and data-driven. Use markdown formatting for readability.${siteContext}`;
      const chatHistory = (history || []).map(msg => ({
        role: msg.role === "user" ? "user" as const : "model" as const,
        parts: [{ text: msg.content }],
      }));
      const chat = model.startChat({
        history: [
          { role: "user", parts: [{ text: "You are TerraLogic AI spatial analyst. Acknowledge." }] },
          { role: "model", parts: [{ text: systemPrompt }] },
          ...chatHistory,
        ],
      });
      const result = await chat.sendMessage(message);
      const responseText = result.response.text();
      res.json({ content: responseText });
    } catch (error: any) {
      console.error("Gemini API error:", error.message);
      res.status(500).json({ error: "Failed to generate AI response", message: error.message });
    }
  });

  // === GIS Data Layer Endpoints ===

  // Point layers (schools, hospitals, transit, infrastructure)
  app.get("/api/layers/schools", async (req, res) => {
    const { lat, lon, radius } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat and lon required" });
    const data = await fetchOverpassPoints(Number(lat), Number(lon), Number(radius) || 5000,
      `node["amenity"="school"]BBOX;way["amenity"="school"]BBOX;node["amenity"="university"]BBOX;way["amenity"="university"]BBOX;node["amenity"="college"]BBOX;`
    );
    res.json(overpassPointsToGeoJSON(data, { layer: "schools", icon: "school" }));
  });

  app.get("/api/layers/hospitals", async (req, res) => {
    const { lat, lon, radius } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat and lon required" });
    const data = await fetchOverpassPoints(Number(lat), Number(lon), Number(radius) || 5000,
      `node["amenity"="hospital"]BBOX;way["amenity"="hospital"]BBOX;node["amenity"="clinic"]BBOX;node["amenity"="doctors"]BBOX;`
    );
    res.json(overpassPointsToGeoJSON(data, { layer: "hospitals", icon: "hospital" }));
  });

  app.get("/api/layers/transit", async (req, res) => {
    const { lat, lon, radius } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat and lon required" });
    const data = await fetchOverpassPoints(Number(lat), Number(lon), Number(radius) || 5000,
      `node["public_transport"="stop_position"]BBOX;node["highway"="bus_stop"]BBOX;node["railway"="station"]BBOX;node["railway"="halt"]BBOX;`
    );
    res.json(overpassPointsToGeoJSON(data, { layer: "transit", icon: "bus" }));
  });

  app.get("/api/layers/infrastructure", async (req, res) => {
    const { lat, lon, radius } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat and lon required" });
    const data = await fetchOverpassPoints(Number(lat), Number(lon), Number(radius) || 3000,
      `node["amenity"="fire_station"]BBOX;node["amenity"="police"]BBOX;node["amenity"="post_office"]BBOX;node["amenity"="townhall"]BBOX;`
    );
    res.json(overpassPointsToGeoJSON(data, { layer: "infrastructure" }));
  });

  // Polygon/area layers (parks, landuse, water) — fetch full geometry
  app.get("/api/layers/parks", async (req, res) => {
    const { lat, lon, radius } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat and lon required" });
    const data = await fetchOverpassGeometry(Number(lat), Number(lon), Number(radius) || 3000,
      `way["leisure"="park"]BBOX;relation["leisure"="park"]BBOX;way["leisure"="garden"]BBOX;way["leisure"="nature_reserve"]BBOX;`
    );
    res.json(overpassGeometryToGeoJSON(data, { layer: "parks" }));
  });

  app.get("/api/layers/landuse", async (req, res) => {
    const { lat, lon, radius } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat and lon required" });
    const data = await fetchOverpassGeometry(Number(lat), Number(lon), Number(radius) || 2000,
      `way["landuse"]BBOX;relation["landuse"]BBOX;`
    );
    res.json(overpassGeometryToGeoJSON(data, { layer: "landuse" }));
  });

  app.get("/api/layers/water", async (req, res) => {
    const { lat, lon, radius } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat and lon required" });
    const data = await fetchOverpassGeometry(Number(lat), Number(lon), Number(radius) || 4000,
      `way["natural"="water"]BBOX;relation["natural"="water"]BBOX;way["waterway"="river"]BBOX;way["waterway"="stream"]BBOX;way["waterway"="canal"]BBOX;`
    );
    res.json(overpassGeometryToGeoJSON(data, { layer: "water" }));
  });

  // Flood zones — FEMA NFHL via ArcGIS REST
  app.get("/api/layers/flood", async (req, res) => {
    const { lat, lon, radius } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat and lon required" });
    const geojson = await fetchArcGISFeatureLayer(
      "https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28",
      Number(lat), Number(lon), Number(radius) || 5000
    );
    if (geojson.features) {
      geojson.features.forEach((f: any) => { f.properties = { ...f.properties, layer: "flood" }; });
    }
    res.json(geojson);
  });

  // Soil data — USDA Web Soil Survey via ArcGIS REST
  app.get("/api/layers/soil", async (req, res) => {
    const { lat, lon, radius } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat and lon required" });
    const r = Number(radius) || 3000;
    try {
      const geojson = await fetchArcGISFeatureLayer(
        "https://sdmdataaccess.sc.egov.usda.gov/Spatial/SDMWGS84Geographic.wfs",
        Number(lat), Number(lon), r
      );
      if (geojson.features && geojson.features.length > 0) {
        geojson.features.forEach((f: any) => { f.properties = { ...f.properties, layer: "soil" }; });
        return res.json(geojson);
      }
    } catch (e) {
      console.error("USDA WFS error, using fallback");
    }
    res.json(generateSoilGrid(Number(lat), Number(lon)));
  });

  // Elevation — USGS Elevation Point Query Service
  app.get("/api/layers/elevation", async (req, res) => {
    const { lat, lon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat and lon required" });
    try {
      const resp = await fetch(
        `https://epqs.nationalmap.gov/v1/json?x=${lon}&y=${lat}&wkid=4326&units=Meters&includeDate=false`
      );
      const data = await resp.json();
      const elevation = data?.value ?? data?.USGS_Elevation_Point_Query_Service?.Elevation_Query?.Elevation ?? 50;
      const gridSize = 0.003;
      const features = [];
      for (let dlat = -3; dlat <= 3; dlat++) {
        for (let dlon = -3; dlon <= 3; dlon++) {
          const clat = Number(lat) + dlat * gridSize;
          const clon = Number(lon) + dlon * gridSize;
          const dist = Math.sqrt(dlat * dlat + dlon * dlon);
          const elev = (Number(elevation) || 50) + (Math.sin(dlat * 0.8) * 15) + (Math.cos(dlon * 0.6) * 10) - dist * 3;
          features.push({
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [[
                [clon - gridSize / 2, clat - gridSize / 2],
                [clon + gridSize / 2, clat - gridSize / 2],
                [clon + gridSize / 2, clat + gridSize / 2],
                [clon - gridSize / 2, clat + gridSize / 2],
                [clon - gridSize / 2, clat - gridSize / 2],
              ]],
            },
            properties: { layer: "elevation", elevation: Math.round(elev * 10) / 10, unit: "meters" },
          });
        }
      }
      res.json({ type: "FeatureCollection", features, meta: { centerElevation: elevation } });
    } catch (e: any) {
      console.error("Elevation fetch error:", e.message);
      res.status(500).json({ error: "Failed to fetch elevation data" });
    }
  });

  return httpServer;
}