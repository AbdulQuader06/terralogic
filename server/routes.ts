import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { chatRequestSchema, analyzeRequestSchema } from "@shared/schema";
import type { SiteAnalysis } from "@shared/schema";
import { GoogleGenerativeAI } from "@google/generative-ai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const ARCGIS_API_KEY = process.env.ARCGIS_API_KEY || "";
const MAX_CHAT_HISTORY = 20;

async function generateSiteAnalysis(lat: number, lon: number, name: string): Promise<SiteAnalysis> {
  const radius = 3000;

  const [schoolsData, hospitalsData, transitData, parksData, infraData, landuseData, floodData, soilData, elevData] = await Promise.allSettled([
    fetchOverpassPoints(lat, lon, radius, `node["amenity"="school"]BBOX;way["amenity"="school"]BBOX;node["amenity"="university"]BBOX;`),
    fetchOverpassPoints(lat, lon, radius, `node["amenity"="hospital"]BBOX;way["amenity"="hospital"]BBOX;node["amenity"="clinic"]BBOX;`),
    fetchOverpassPoints(lat, lon, radius, `node["public_transport"="stop_position"]BBOX;node["highway"="bus_stop"]BBOX;node["railway"="station"]BBOX;`),
    fetchOverpassGeometry(lat, lon, radius, `way["leisure"="park"]BBOX;relation["leisure"="park"]BBOX;`),
    fetchOverpassPoints(lat, lon, radius, `node["amenity"="fire_station"]BBOX;node["amenity"="police"]BBOX;node["amenity"="post_office"]BBOX;`),
    fetchOverpassGeometry(lat, lon, 2000, `way["landuse"]BBOX;relation["landuse"]BBOX;`),
    fetchArcGISFeatureLayer("https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28", lat, lon, radius),
    (async () => {
      try {
        const resp = await fetch(
          `https://rest.isric.org/soilgrids/v2.0/classification/query?lon=${lon.toFixed(5)}&lat=${lat.toFixed(5)}&number_classes=3`,
          { signal: AbortSignal.timeout(10000) }
        );
        if (resp.ok) {
          const data = await resp.json();
          return {
            soilClass: data.wrb_class_name || "Unknown",
            probability: data.wrb_class_probability || [],
            source: "soilgrids",
          };
        }
      } catch {}
      return { soilClass: "Unknown", probability: [], source: "fallback" };
    })(),
    (async () => {
      try {
        const numPoints = 11;
        const degSpan = 0.02;
        const lats: number[] = [];
        const lons: number[] = [];
        for (let i = 0; i < numPoints; i++) {
          const t = i / (numPoints - 1);
          lats.push(lat);
          lons.push(lon - degSpan / 2 + t * degSpan);
        }
        const resp = await fetch(
          `https://api.open-meteo.com/v1/elevation?latitude=${lats.join(",")}&longitude=${lons.join(",")}`,
          { signal: AbortSignal.timeout(10000) }
        );
        if (resp.ok) {
          const data = await resp.json();
          return { elevations: data.elevation || [], source: "open-meteo" };
        }
      } catch {}
      try {
        const resp = await fetch(`https://epqs.nationalmap.gov/v1/json?x=${lon}&y=${lat}&wkid=4326&units=Meters&includeDate=false`);
        const d = await resp.json();
        const elev = d?.value ?? d?.USGS_Elevation_Point_Query_Service?.Elevation_Query?.Elevation ?? null;
        return { elevations: [elev], source: "usgs" };
      } catch { return { elevations: [null], source: "none" }; }
    })(),
  ]);

  const getVal = (r: PromiseSettledResult<any>) => r.status === "fulfilled" ? r.value : { elements: [] };

  const schoolCount = overpassPointsToGeoJSON(getVal(schoolsData), {}).features?.length || 0;
  const hospitalCount = overpassPointsToGeoJSON(getVal(hospitalsData), {}).features?.length || 0;
  const transitCount = overpassPointsToGeoJSON(getVal(transitData), {}).features?.length || 0;
  const parkGeo = overpassGeometryToGeoJSON(getVal(parksData), {});
  const parkCount = parkGeo.features?.length || 0;
  const infraCount = overpassPointsToGeoJSON(getVal(infraData), {}).features?.length || 0;
  const landuseGeo = overpassGeometryToGeoJSON(getVal(landuseData), {});
  const landuseCount = landuseGeo.features?.length || 0;

  const floodGeo = floodData.status === "fulfilled" ? floodData.value : { features: [] };
  const floodFeatures = floodGeo?.features || [];
  const highRiskZones = floodFeatures.filter((f: any) => {
    const zone = f.properties?.FLD_ZONE || "";
    return zone.startsWith("A") || zone.startsWith("V");
  });
  const hasHighFloodRisk = highRiskZones.length > 0;
  const floodZoneCount = floodFeatures.length;

  const soilResult = soilData.status === "fulfilled" ? soilData.value : { soilClass: "Unknown", probability: [], source: "fallback" };
  const soilClassName = soilResult.soilClass || "Unknown";
  const soilBearingMap: Record<string, number> = {
    Cambisols: 65, Luvisols: 60, Ferralsols: 55, Acrisols: 45, Leptosols: 35, Arenosols: 40,
    Vertisols: 30, Fluvisols: 50, Gleysols: 25, Histosols: 15, Regosols: 45, Andosols: 55,
    Chernozems: 70, Phaeozems: 65, Nitisols: 60, Calcisols: 55, Podzols: 40, Planosols: 35,
  };
  const soilDrainageMap: Record<string, string> = {
    Cambisols: "Well Drained", Luvisols: "Moderately Well Drained", Ferralsols: "Well Drained",
    Acrisols: "Moderately Drained", Leptosols: "Rapidly Drained", Arenosols: "Excessively Drained",
    Vertisols: "Poorly Drained", Fluvisols: "Variable", Gleysols: "Poorly Drained",
    Histosols: "Poorly Drained", Regosols: "Well Drained", Andosols: "Well Drained",
    Chernozems: "Well Drained", Phaeozems: "Well Drained", Nitisols: "Well Drained",
    Calcisols: "Moderately Well Drained", Podzols: "Moderately Drained", Planosols: "Poorly Drained",
  };
  const avgBearing = soilBearingMap[soilClassName] || 50;
  const avgPermeability = avgBearing * 0.7 + 10;
  const soilDrainageLabel = soilDrainageMap[soilClassName] || "Moderately Drained";
  const soilDrainageRatio = soilDrainageLabel.includes("Well") ? 0.8 : soilDrainageLabel.includes("Poorly") ? 0.2 : 0.5;

  const elevResult = elevData.status === "fulfilled" ? elevData.value : { elevations: [50], source: "none" };
  const elevArr: number[] = (elevResult?.elevations || [50]).map((v: any) => (v != null && !isNaN(Number(v)) ? Number(v) : 50));
  const centerElev = elevArr[Math.floor(elevArr.length / 2)] ?? 50;

  const zoningTypes = landuseGeo.features?.map((f: any) => f.properties?.landuse || f.properties?.type || "").filter(Boolean) || [];
  const zoningCounts: Record<string, number> = {};
  zoningTypes.forEach((z: string) => { zoningCounts[z] = (zoningCounts[z] || 0) + 1; });
  const dominantZoning = Object.entries(zoningCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "Mixed Use";
  const zoningLabel = dominantZoning.charAt(0).toUpperCase() + dominantZoning.slice(1).replace(/_/g, " ");

  const schoolScore = Math.min(100, Math.floor((schoolCount / 10) * 100));
  const infraScore = Math.min(100, Math.floor(((infraCount + transitCount) / 15) * 100));
  const floodRiskScore = hasHighFloodRisk ? Math.min(90, 40 + highRiskZones.length * 10) : Math.max(10, floodZoneCount * 5);
  const soilScore = Math.min(100, Math.floor(avgBearing * 0.8 + soilDrainageRatio * 40));
  const urbanDensity = Math.min(100, Math.floor((landuseCount / 20) * 100));
  const elevSuitability = centerElev < 5 ? 20 : centerElev < 20 ? 40 : centerElev < 100 ? 80 : centerElev < 300 ? 70 : centerElev < 500 ? 55 : 35;
  const climateStress = Math.min(80, Math.max(15, Math.floor(urbanDensity * 0.3 + (centerElev < 10 ? 30 : 0) + (hasHighFloodRisk ? 15 : 0))));

  const benefitAvg = (soilScore + schoolScore + infraScore + elevSuitability) / 4;
  const riskAvg = (floodRiskScore + climateStress) / 2;
  const overallScore = Math.min(95, Math.max(15, Math.floor(benefitAvg - riskAvg * 0.4 + 30)));
  const rating = overallScore >= 75 ? "Highly Suitable" : overallScore >= 55 ? "Moderate Potential" : "High Risk Area";

  const alerts: SiteAnalysis["alerts"] = [];
  if (floodRiskScore > 50) alerts.push({ type: "warning", title: "Elevated Flood Risk", description: `${highRiskZones.length} high-risk FEMA flood zone(s) detected within 3km. Consider drainage infrastructure and flood barriers.` });
  if (climateStress > 45) alerts.push({ type: "warning", title: "Climate Stress Factor", description: `Region shows ${climateStress}% climate stress index. Urban heat island effects may be significant.` });
  if (overallScore >= 75) alerts.push({ type: "success", title: "Favorable Site Conditions", description: `Strong balance of ${schoolCount} nearby schools, ${infraCount} infrastructure facilities, and manageable environmental risks.` });
  if (urbanDensity > 70) alerts.push({ type: "info", title: "High Urban Density", description: `${landuseCount} land use zones detected. Dense surroundings may increase logistics complexity.` });
  if (centerElev < 10) alerts.push({ type: "warning", title: "Low Elevation Warning", description: `Site elevation is ${centerElev.toFixed(1)}m ASL. Coastal flooding and drainage issues possible.` });
  if (soilClassName !== "Unknown") alerts.push({ type: "info", title: `Soil Classification: ${soilClassName}`, description: `WRB soil type: ${soilClassName}. ${soilDrainageLabel}. Bearing capacity est: ${avgBearing} kPa.` });

  const sunExposure = centerElev > 100 ? Math.min(95, 70 + Math.floor((centerElev - 100) / 20)) : Math.min(85, 55 + Math.floor(centerElev / 5));
  const windExposure = centerElev > 200 ? Math.min(90, 60 + Math.floor((centerElev - 200) / 15)) : Math.max(25, 30 + Math.floor(centerElev / 8));
  const soilQualityPct = Math.min(100, Math.floor(avgBearing * 0.6 + soilDrainageRatio * 50 + avgPermeability * 0.2));
  const floodRiskLabel = hasHighFloodRisk ? "High" : floodZoneCount > 0 ? "Moderate" : "Low";

  const elevationProfile: { distance: number; elevation: number }[] = [];
  const degSpan = 0.02;
  const totalDistMeters = degSpan * 111000;
  for (let i = 0; i < elevArr.length; i++) {
    const dist = Math.round((i / (elevArr.length - 1)) * totalDistMeters);
    elevationProfile.push({ distance: dist, elevation: Math.round(elevArr[i] * 10) / 10 });
  }

  const waterScore = floodZoneCount > 0 ? Math.max(20, 80 - floodRiskScore) : 85;

  const recommendations: SiteAnalysis["recommendations"] = [];
  if (sunExposure >= 70) recommendations.push({ type: "success", title: "Excellent Solar Potential", description: `${sunExposure}% sun exposure. Consider south-facing solar panels. Expected ROI: 6-8 years.` });
  else recommendations.push({ type: "info", title: "Moderate Solar Potential", description: `${sunExposure}% sun exposure. Solar may still be viable with optimized panel placement.` });

  if (windExposure > 60) recommendations.push({ type: "warning", title: "Wind Exposure Considerations", description: `${windExposure}% wind exposure at ${centerElev.toFixed(0)}m elevation. Recommend wind barriers for outdoor spaces.` });

  if (floodRiskLabel === "Low") recommendations.push({ type: "success", title: "Low Flood Risk", description: `Site elevation at ${centerElev.toFixed(1)}m provides natural protection. Standard drainage sufficient.` });
  else if (floodRiskLabel === "Moderate") recommendations.push({ type: "warning", title: "Moderate Flood Risk", description: `${floodZoneCount} FEMA flood zone(s) nearby. Enhanced drainage and flood barriers recommended.` });
  else recommendations.push({ type: "warning", title: "High Flood Risk", description: `${highRiskZones.length} high-risk FEMA zone(s) detected. Flood insurance required. Elevated construction recommended.` });

  if (soilQualityPct >= 70) recommendations.push({ type: "success", title: "Good Soil Conditions", description: `${soilClassName} soil with ${soilQualityPct}% quality rating. ${soilDrainageLabel}. Bearing capacity: ${avgBearing} kPa.` });
  else recommendations.push({ type: "warning", title: "Soil Quality Concerns", description: `${soilClassName} soil rated ${soilQualityPct}%. ${soilDrainageLabel}. Foundation reinforcement may be needed. Bearing: ${avgBearing} kPa.` });

  const buildingFootprint = Math.min(95, Math.floor(urbanDensity * 0.7 + infraScore * 0.2));
  const infraCoverage = Math.min(99, Math.floor(infraScore * 0.6 + transitCount * 3 + hospitalCount * 8));
  const densityIndex = Math.min(99, Math.floor(urbanDensity * 0.5 + buildingFootprint * 0.3 + infraCoverage * 0.2));
  const densityLabel = densityIndex >= 75 ? "High Density" : densityIndex >= 40 ? "Medium Density" : "Low Density";

  return {
    overallScore, rating,
    factors: [
      { name: "Flood Risk", value: floodRiskScore, category: "risk" },
      { name: "Soil Stability", value: soilScore, category: "benefit" },
      { name: "Urban Density", value: urbanDensity, category: "benefit" },
      { name: "School Proximity", value: schoolScore, category: "benefit" },
      { name: "Climate Stress", value: climateStress, category: "risk" },
      { name: "Infrastructure Access", value: infraScore, category: "benefit" },
      { name: "Elevation Suitability", value: elevSuitability, category: "benefit" },
    ],
    amenities: { schools: schoolCount, transitStops: transitCount, hospitals: hospitalCount, parks: parkCount },
    alerts,
    siteInfo: {
      coordinates: { lat, lon },
      elevation: Math.round(centerElev * 10) / 10,
      elevationUnit: "m ASL",
      zoning: zoningLabel,
    },
    environmentalMetrics: {
      sunExposure,
      soilQuality: soilQualityPct,
      windExposure,
      floodRisk: floodRiskLabel,
    },
    elevationProfile,
    radarData: {
      solar: sunExposure,
      soil: soilQualityPct,
      wind: Math.max(0, 100 - windExposure),
      water: waterScore,
      access: infraScore,
    },
    recommendations,
    developmentDensity: {
      densityIndex,
      densityLabel,
      buildingFootprint,
      infrastructureCoverage: infraCoverage,
    },
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
    if (!analysis || !analysis.siteInfo) {
      analysis = await generateSiteAnalysis(lat, lon, name);
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

  // Geocode endpoint using Nominatim (OSM)
  app.get("/api/geocode", async (req, res) => {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: "q parameter required" });
    try {
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(String(q))}&format=json&limit=6&addressdetails=1`,
        { headers: { "User-Agent": "TerraLogicAI/1.0 (GIS Analysis Platform)" } }
      );
      if (!resp.ok) throw new Error(`Nominatim error: ${resp.status}`);
      const data = await resp.json();
      const results = data.map((r: any) => ({
        address: r.display_name,
        location: { x: parseFloat(r.lon), y: parseFloat(r.lat) },
        type: r.type,
        importance: r.importance,
      }));
      res.json(results);
    } catch (e: any) {
      console.error("Geocode error:", e.message);
      if (ARCGIS_API_KEY) {
        try {
          const resp = await fetch(
            `https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&singleLine=${encodeURIComponent(String(q))}&maxLocations=5&token=${ARCGIS_API_KEY}`
          );
          const data = await resp.json();
          res.json((data.candidates || []).map((c: any) => ({
            address: c.address,
            location: c.location,
          })));
        } catch { res.json([]); }
      } else {
        res.json([]);
      }
    }
  });

  // Soil data — SoilGrids (ISRIC) real classification + colored polygons
  app.get("/api/layers/soil", async (req, res) => {
    const { lat, lon, radius } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat and lon required" });
    const clat = Number(lat), clon = Number(lon);
    const r = Number(radius) || 3000;
    const degOffset = r / 111000;

    try {
      const gridSize = 5;
      const latStep = (degOffset * 2) / gridSize;
      const lonStep = (degOffset * 2) / gridSize;
      const points: { lat: number; lon: number; row: number; col: number }[] = [];
      for (let row = 0; row <= gridSize; row++) {
        for (let col = 0; col <= gridSize; col++) {
          points.push({
            lat: clat - degOffset + row * latStep,
            lon: clon - degOffset + col * lonStep,
            row, col,
          });
        }
      }

      const batchSize = 6;
      const soilResults: { row: number; col: number; soilClass: string; probability: number }[] = [];
      for (let i = 0; i < points.length; i += batchSize) {
        const batch = points.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map(async (p) => {
            const resp = await fetch(
              `https://rest.isric.org/soilgrids/v2.0/classification/query?lon=${p.lon.toFixed(5)}&lat=${p.lat.toFixed(5)}&number_classes=1`,
              { signal: AbortSignal.timeout(8000) }
            );
            if (!resp.ok) throw new Error(`SoilGrids error: ${resp.status}`);
            const data = await resp.json();
            return {
              row: p.row, col: p.col,
              soilClass: data.wrb_class_name || "Unknown",
              probability: data.wrb_class_probability?.[0]?.[1] || 0,
            };
          })
        );
        for (const r of results) {
          if (r.status === "fulfilled") soilResults.push(r.value);
        }
      }

      if (soilResults.length >= 4) {
        const features: any[] = [];
        for (const sr of soilResults) {
          const cellLat = clat - degOffset + sr.row * latStep;
          const cellLon = clon - degOffset + sr.col * lonStep;
          const halfLat = latStep / 2;
          const halfLon = lonStep / 2;
          features.push({
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [[
                [cellLon - halfLon, cellLat - halfLat],
                [cellLon + halfLon, cellLat - halfLat],
                [cellLon + halfLon, cellLat + halfLat],
                [cellLon - halfLon, cellLat + halfLat],
                [cellLon - halfLon, cellLat - halfLat],
              ]],
            },
            properties: {
              layer: "soil",
              soilType: sr.soilClass,
              probability: sr.probability,
              drainage: getSoilDrainage(sr.soilClass),
              permeability: getSoilPermeability(sr.soilClass),
              bearing_capacity: getSoilBearing(sr.soilClass),
              description: getSoilDescription(sr.soilClass),
            },
          });
        }
        return res.json({ type: "FeatureCollection", features });
      }
    } catch (e: any) {
      console.error("SoilGrids error, using fallback:", e.message);
    }
    res.json(generateSoilGrid(Number(lat), Number(lon)));
  });

  // Elevation contour lines — real DEM from Open-Meteo + marching squares
  app.get("/api/layers/elevation", async (req, res) => {
    const { lat, lon, radius } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat and lon required" });
    const clat = Number(lat), clon = Number(lon);
    const r = Number(radius) || 3000;
    const degOffset = r / 111000;

    try {
      const gridRes = 20;
      const latMin = clat - degOffset;
      const latMax = clat + degOffset;
      const lonMin = clon - degOffset;
      const lonMax = clon + degOffset;
      const latStep = (latMax - latMin) / (gridRes - 1);
      const lonStep = (lonMax - lonMin) / (gridRes - 1);

      const lats: number[] = [];
      const lons: number[] = [];
      for (let r = 0; r < gridRes; r++) {
        for (let c = 0; c < gridRes; c++) {
          lats.push(latMin + r * latStep);
          lons.push(lonMin + c * lonStep);
        }
      }

      const batchSize = 100;
      const allElevations: number[] = [];
      for (let i = 0; i < lats.length; i += batchSize) {
        const batchLats = lats.slice(i, i + batchSize);
        const batchLons = lons.slice(i, i + batchSize);
        const resp = await fetch(
          `https://api.open-meteo.com/v1/elevation?latitude=${batchLats.join(",")}&longitude=${batchLons.join(",")}`,
          { signal: AbortSignal.timeout(15000) }
        );
        if (!resp.ok) throw new Error(`Open-Meteo error: ${resp.status}`);
        const data = await resp.json();
        allElevations.push(...(data.elevation || []));
      }

      const grid: number[][] = [];
      for (let r = 0; r < gridRes; r++) {
        grid[r] = [];
        for (let c = 0; c < gridRes; c++) {
          grid[r][c] = allElevations[r * gridRes + c] ?? 0;
        }
      }

      const minElev = Math.min(...allElevations.filter(e => e !== undefined));
      const maxElev = Math.max(...allElevations.filter(e => e !== undefined));
      const range = maxElev - minElev;

      let interval: number;
      if (range < 10) interval = 2;
      else if (range < 50) interval = 5;
      else if (range < 200) interval = 10;
      else if (range < 500) interval = 25;
      else if (range < 1000) interval = 50;
      else interval = 100;

      const startLevel = Math.ceil(minElev / interval) * interval;
      const levels: number[] = [];
      for (let l = startLevel; l <= maxElev; l += interval) {
        levels.push(l);
      }

      const contourFeatures = generateContourLines(grid, latMin, latMax, lonMin, lonMax, levels);
      res.json(contourFeatures);
    } catch (e: any) {
      console.error("Elevation contour error:", e.message);
      res.status(500).json({ error: "Failed to generate elevation contours" });
    }
  });

  return httpServer;
}

function getSoilDrainage(soilClass: string): string {
  const map: Record<string, string> = {
    Acrisols: "Moderately Well Drained", Alisols: "Moderately Drained", Andosols: "Well Drained",
    Arenosols: "Excessively Drained", Calcisols: "Well Drained", Cambisols: "Well Drained",
    Chernozems: "Well Drained", Cryosols: "Poorly Drained", Durisols: "Well Drained",
    Ferralsols: "Well Drained", Fluvisols: "Moderately Well Drained", Gleysols: "Poorly Drained",
    Gypsisols: "Well Drained", Histosols: "Very Poorly Drained", Kastanozems: "Well Drained",
    Leptosols: "Somewhat Excessively Drained", Lixisols: "Well Drained", Luvisols: "Well Drained",
    Nitisols: "Well Drained", Phaeozems: "Well Drained", Planosols: "Poorly Drained",
    Plinthosols: "Moderately Well Drained", Podzols: "Well Drained", Regosols: "Well Drained",
    Retisols: "Moderately Well Drained", Solonchaks: "Poorly Drained", Solonetz: "Moderately Drained",
    Stagnosols: "Poorly Drained", Technosols: "Variable", Umbrisols: "Well Drained",
    Vertisols: "Poorly Drained",
  };
  return map[soilClass] || "Moderately Well Drained";
}

function getSoilPermeability(soilClass: string): number {
  const map: Record<string, number> = {
    Arenosols: 85, Andosols: 75, Cambisols: 60, Ferralsols: 55, Fluvisols: 50,
    Leptosols: 70, Luvisols: 45, Nitisols: 50, Podzols: 65, Regosols: 70,
    Acrisols: 40, Gleysols: 20, Histosols: 30, Vertisols: 15, Planosols: 25,
    Stagnosols: 20, Solonchaks: 30, Chernozems: 55, Phaeozems: 55, Kastanozems: 50,
  };
  return map[soilClass] || 45;
}

function getSoilBearing(soilClass: string): number {
  const map: Record<string, number> = {
    Cambisols: 65, Luvisols: 60, Ferralsols: 55, Nitisols: 70, Andosols: 40,
    Arenosols: 50, Leptosols: 75, Regosols: 55, Fluvisols: 45, Gleysols: 30,
    Histosols: 15, Vertisols: 35, Chernozems: 60, Phaeozems: 60, Podzols: 50,
    Acrisols: 45, Calcisols: 70, Kastanozems: 60, Solonchaks: 40, Planosols: 35,
  };
  return map[soilClass] || 50;
}

function getSoilDescription(soilClass: string): string {
  const map: Record<string, string> = {
    Acrisols: "Acidic, weathered soils with clay accumulation",
    Andosols: "Volcanic ash soils, high water retention",
    Arenosols: "Sandy soils, low fertility, high drainage",
    Cambisols: "Young, moderately developed soils",
    Chernozems: "Dark, fertile prairie soils",
    Ferralsols: "Deeply weathered tropical soils",
    Fluvisols: "Alluvial floodplain deposits",
    Gleysols: "Waterlogged soils with reducing conditions",
    Histosols: "Organic peat/bog soils",
    Kastanozems: "Chestnut steppe soils",
    Leptosols: "Thin soils over hard rock",
    Luvisols: "Clay-enriched subsurface soils",
    Nitisols: "Deep, red tropical soils",
    Phaeozems: "Dark, humus-rich prairie soils",
    Planosols: "Soils with abrupt textural change",
    Podzols: "Acidic soils with bleached subsurface",
    Regosols: "Weakly developed mineral soils",
    Solonchaks: "Salt-affected soils",
    Solonetz: "Sodium-rich soils",
    Stagnosols: "Periodically waterlogged soils",
    Vertisols: "Swelling clay soils with deep cracks",
    Umbrisols: "Acidic, humus-rich mountain soils",
  };
  return map[soilClass] || "Classified soil unit (WRB)";
}

function generateContourLines(
  grid: number[][],
  latMin: number, latMax: number,
  lonMin: number, lonMax: number,
  levels: number[]
): any {
  const rows = grid.length;
  const cols = grid[0].length;
  const features: any[] = [];
  const latStep = (latMax - latMin) / (rows - 1);
  const lonStep = (lonMax - lonMin) / (cols - 1);

  const getLat = (r: number) => latMin + r * latStep;
  const getLon = (c: number) => lonMin + c * lonStep;

  for (const level of levels) {
    const segments: number[][][] = [];

    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const tl = grid[r][c];
        const tr = grid[r][c + 1];
        const br = grid[r + 1][c + 1];
        const bl = grid[r + 1][c];

        const code =
          (tl >= level ? 8 : 0) |
          (tr >= level ? 4 : 0) |
          (br >= level ? 2 : 0) |
          (bl >= level ? 1 : 0);

        if (code === 0 || code === 15) continue;

        const interp = (v1: number, v2: number) => {
          if (Math.abs(v2 - v1) < 0.0001) return 0.5;
          return Math.max(0, Math.min(1, (level - v1) / (v2 - v1)));
        };

        const topLat = getLat(r), botLat = getLat(r + 1);
        const leftLon = getLon(c), rightLon = getLon(c + 1);

        const top = (): [number, number] => {
          const t = interp(tl, tr);
          return [leftLon + t * (rightLon - leftLon), topLat];
        };
        const bottom = (): [number, number] => {
          const t = interp(bl, br);
          return [leftLon + t * (rightLon - leftLon), botLat];
        };
        const left = (): [number, number] => {
          const t = interp(tl, bl);
          return [leftLon, topLat + t * (botLat - topLat)];
        };
        const right = (): [number, number] => {
          const t = interp(tr, br);
          return [rightLon, topLat + t * (botLat - topLat)];
        };

        const addSeg = (p1: [number, number], p2: [number, number]) => {
          segments.push([p1, p2]);
        };

        switch (code) {
          case 1: case 14: addSeg(left(), bottom()); break;
          case 2: case 13: addSeg(bottom(), right()); break;
          case 3: case 12: addSeg(left(), right()); break;
          case 4: case 11: addSeg(top(), right()); break;
          case 5: addSeg(left(), top()); addSeg(bottom(), right()); break;
          case 6: case 9: addSeg(top(), bottom()); break;
          case 7: case 8: addSeg(left(), top()); break;
          case 10: addSeg(top(), right()); addSeg(left(), bottom()); break;
        }
      }
    }

    if (segments.length > 0) {
      const connected = connectSegments(segments);
      for (const line of connected) {
        if (line.length >= 2) {
          features.push({
            type: "Feature",
            geometry: { type: "LineString", coordinates: line },
            properties: {
              layer: "elevation",
              elevation: level,
              type: "contour",
              isMajor: level % (levels.length > 10 ? 50 : 10) === 0,
            },
          });
        }
      }
    }
  }

  return { type: "FeatureCollection", features };
}

function connectSegments(segments: number[][][]): number[][][] {
  const lines: number[][][] = [];
  const used = new Set<number>();
  const eps = 0.00001;

  const closeEnough = (a: number[], b: number[]) =>
    Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;

  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const line = [...segments[i]];

    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < segments.length; j++) {
        if (used.has(j)) continue;
        const seg = segments[j];
        if (closeEnough(line[line.length - 1], seg[0])) {
          line.push(seg[1]);
          used.add(j);
          changed = true;
        } else if (closeEnough(line[line.length - 1], seg[1])) {
          line.push(seg[0]);
          used.add(j);
          changed = true;
        } else if (closeEnough(line[0], seg[1])) {
          line.unshift(seg[0]);
          used.add(j);
          changed = true;
        } else if (closeEnough(line[0], seg[0])) {
          line.unshift(seg[1]);
          used.add(j);
          changed = true;
        }
      }
    }
    lines.push(line);
  }
  return lines;
}