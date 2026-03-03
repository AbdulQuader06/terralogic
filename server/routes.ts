import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { chatRequestSchema, analyzeRequestSchema } from "@shared/schema";
import type { SiteAnalysis } from "@shared/schema";
import { GoogleGenerativeAI } from "@google/generative-ai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const ARCGIS_API_KEY = process.env.ARCGIS_API_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const MAX_CHAT_HISTORY = 20;

function calculateSunPath(lat: number, lon: number, date: Date = new Date()) {
  const dayOfYear = Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86400000);
  const declination = 23.45 * Math.sin((2 * Math.PI / 365) * (dayOfYear - 81));
  const decRad = declination * Math.PI / 180;
  const latRad = lat * Math.PI / 180;
  const cosHA = -Math.tan(latRad) * Math.tan(decRad);
  const clampedCosHA = Math.max(-1, Math.min(1, cosHA));
  const hourAngle = Math.acos(clampedCosHA) * 180 / Math.PI;
  const dayLengthHours = (2 * hourAngle) / 15;
  const eqOfTime = 229.18 * (0.000075 + 0.001868 * Math.cos(2 * Math.PI * dayOfYear / 365) - 0.032077 * Math.sin(2 * Math.PI * dayOfYear / 365) - 0.014615 * Math.cos(4 * Math.PI * dayOfYear / 365) - 0.04089 * Math.sin(4 * Math.PI * dayOfYear / 365));
  const solarNoonMin = 720 - 4 * lon - eqOfTime;
  const sunriseMin = solarNoonMin - dayLengthHours * 30;
  const sunsetMin = solarNoonMin + dayLengthHours * 30;
  const formatTime = (min: number) => {
    const h = Math.floor(((min % 1440) + 1440) % 1440 / 60);
    const m = Math.round(((min % 1440) + 1440) % 1440 % 60);
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
  };
  const maxAlt = Math.asin(Math.sin(latRad) * Math.sin(decRad) + Math.cos(latRad) * Math.cos(decRad)) * 180 / Math.PI;
  let sunriseAz = 90;
  const cosLat = Math.cos(latRad);
  if (Math.abs(cosLat) > 0.001) {
    const azArg = Math.max(-1, Math.min(1, Math.sin(decRad) / cosLat));
    sunriseAz = Math.acos(azArg) * 180 / Math.PI;
  }
  return {
    sunrise: formatTime(sunriseMin),
    sunset: formatTime(sunsetMin),
    dayLength: Math.round(dayLengthHours * 10) / 10,
    solarNoon: formatTime(solarNoonMin),
    maxAltitude: Math.round(maxAlt * 10) / 10,
    azimuthRange: { min: Math.round(sunriseAz * 10) / 10, max: Math.round((360 - sunriseAz) * 10) / 10 },
  };
}

async function callGemini(systemPrompt: string, message: string, history?: { role: string; content: string }[]): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error("Gemini API key not configured");
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  const chatHistory = (history || []).map(msg => ({
    role: msg.role === "user" ? "user" as const : "model" as const,
    parts: [{ text: msg.content }],
  }));
  const chat = model.startChat({
    history: [
      { role: "user", parts: [{ text: "System instruction: " + systemPrompt }] },
      { role: "model", parts: [{ text: "Understood. I will follow these instructions." }] },
      ...chatHistory,
    ],
  });
  const result = await chat.sendMessage(message);
  return result.response.text();
}

async function callOpenAI(systemPrompt: string, message: string, history?: { role: string; content: string }[]): Promise<string> {
  if (!OPENAI_API_KEY) throw new Error("OpenAI API key not configured");
  const messages = [
    { role: "system", content: systemPrompt },
    ...(history || []).map(m => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "gpt-4o-mini", messages, max_tokens: 1024 }),
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) throw new Error(`OpenAI error: ${resp.status}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || "No response generated.";
}

function generateLocalGISResponse(message: string, analysis: SiteAnalysis | null, locationName?: string): string {
  const msg = message.toLowerCase();
  if (!analysis) {
    return "I don't have analysis data for this location yet. Please click on the map or use the search bar to select a location, then the right panel will load the GIS analysis. Once loaded, I can answer questions about the site.";
  }
  const lines: string[] = [];
  if (msg.includes("score") || msg.includes("suitab") || msg.includes("overall") || msg.includes("summary") || msg.includes("report")) {
    lines.push(`## Site Analysis: ${locationName || "Selected Location"}`);
    lines.push(`**Overall Suitability Score: ${analysis.overallScore}/100** (${analysis.rating})`);
    lines.push(`\nThis score is derived from real GIS data:`);
    for (const f of analysis.factors) lines.push(`- **${f.name}**: ${f.value}% (${f.category})`);
    lines.push(`\n**Nearby Infrastructure**: ${analysis.amenities.schools} schools, ${analysis.amenities.hospitals} hospitals, ${analysis.amenities.transitStops} transit stops, ${analysis.amenities.parks} parks`);
  } else if (msg.includes("flood") || msg.includes("water") || msg.includes("risk")) {
    lines.push(`## Flood Risk Assessment`);
    lines.push(`**Flood Risk Level: ${analysis.environmentalMetrics.floodRisk}**`);
    lines.push(`- Site elevation: ${analysis.siteInfo.elevation} ${analysis.siteInfo.elevationUnit}`);
    const floodFactor = analysis.factors.find(f => f.name === "Flood Risk");
    if (floodFactor) lines.push(`- Flood Risk Score: ${floodFactor.value}%`);
    const floodRec = analysis.recommendations.find(r => r.title.toLowerCase().includes("flood"));
    if (floodRec) lines.push(`\n**${floodRec.title}**: ${floodRec.description}`);
  } else if (msg.includes("soil") || msg.includes("foundation") || msg.includes("bearing")) {
    lines.push(`## Soil Analysis`);
    lines.push(`**Soil Quality: ${analysis.environmentalMetrics.soilQuality}%**`);
    lines.push(`- Zoning: ${analysis.siteInfo.zoning}`);
    const soilRec = analysis.recommendations.find(r => r.title.toLowerCase().includes("soil"));
    if (soilRec) lines.push(`\n**${soilRec.title}**: ${soilRec.description}`);
  } else if (msg.includes("sun") || msg.includes("solar") || msg.includes("sunrise") || msg.includes("sunset")) {
    lines.push(`## Solar & Sun Path Analysis`);
    lines.push(`**Sun Exposure: ${analysis.environmentalMetrics.sunExposure}%**`);
    if (analysis.sunPathData) {
      lines.push(`- Sunrise: ${analysis.sunPathData.sunrise}`);
      lines.push(`- Sunset: ${analysis.sunPathData.sunset}`);
      lines.push(`- Day Length: ${analysis.sunPathData.dayLength} hours`);
      lines.push(`- Solar Noon: ${analysis.sunPathData.solarNoon}`);
      lines.push(`- Max Solar Altitude: ${analysis.sunPathData.maxAltitude}°`);
    }
    const sunRec = analysis.recommendations.find(r => r.title.toLowerCase().includes("solar"));
    if (sunRec) lines.push(`\n**${sunRec.title}**: ${sunRec.description}`);
  } else if (msg.includes("wind")) {
    lines.push(`## Wind Exposure Analysis`);
    lines.push(`**Wind Exposure: ${analysis.environmentalMetrics.windExposure}%**`);
    lines.push(`- Elevation: ${analysis.siteInfo.elevation} ${analysis.siteInfo.elevationUnit}`);
    const windRec = analysis.recommendations.find(r => r.title.toLowerCase().includes("wind"));
    if (windRec) lines.push(`\n**${windRec.title}**: ${windRec.description}`);
  } else if (msg.includes("elevation") || msg.includes("height") || msg.includes("terrain")) {
    lines.push(`## Elevation & Terrain`);
    lines.push(`**Site Elevation: ${analysis.siteInfo.elevation} ${analysis.siteInfo.elevationUnit}**`);
    if (analysis.elevationProfile?.length) {
      const min = Math.min(...analysis.elevationProfile.map(p => p.elevation));
      const max = Math.max(...analysis.elevationProfile.map(p => p.elevation));
      lines.push(`- Terrain range: ${min}m — ${max}m (${(max - min).toFixed(1)}m variation over ${analysis.elevationProfile[analysis.elevationProfile.length-1]?.distance || 0}m)`);
    }
    const elevFactor = analysis.factors.find(f => f.name === "Elevation Suitability");
    if (elevFactor) lines.push(`- Elevation Suitability: ${elevFactor.value}%`);
  } else if (msg.includes("school") || msg.includes("hospital") || msg.includes("transit") || msg.includes("infrastructure") || msg.includes("amen")) {
    lines.push(`## Infrastructure & Amenities`);
    lines.push(`Within 3km radius:`);
    lines.push(`- **Schools**: ${analysis.amenities.schools}`);
    lines.push(`- **Hospitals**: ${analysis.amenities.hospitals}`);
    lines.push(`- **Transit Stops**: ${analysis.amenities.transitStops}`);
    lines.push(`- **Parks**: ${analysis.amenities.parks}`);
    lines.push(`- **Infrastructure Score**: ${analysis.factors.find(f => f.name === "Infrastructure Access")?.value || "N/A"}%`);
  } else if (msg.includes("density") || msg.includes("urban") || msg.includes("building")) {
    lines.push(`## Development Density`);
    lines.push(`**${analysis.developmentDensity.densityLabel}** (Index: ${analysis.developmentDensity.densityIndex}%)`);
    lines.push(`- Building Footprint: ${analysis.developmentDensity.buildingFootprint}%`);
    lines.push(`- Infrastructure Coverage: ${analysis.developmentDensity.infrastructureCoverage}%`);
  } else if (msg.includes("recommend") || msg.includes("suggest") || msg.includes("advice") || msg.includes("what should")) {
    lines.push(`## AI Recommendations for ${locationName || "this site"}`);
    for (const rec of analysis.recommendations) {
      const emoji = rec.type === "success" ? "✅" : rec.type === "warning" ? "⚠️" : "ℹ️";
      lines.push(`${emoji} **${rec.title}**: ${rec.description}`);
    }
  } else {
    lines.push(`## Site Overview: ${locationName || "Selected Location"}`);
    lines.push(`**Score: ${analysis.overallScore}/100** (${analysis.rating})`);
    lines.push(`- Elevation: ${analysis.siteInfo.elevation} ${analysis.siteInfo.elevationUnit}`);
    lines.push(`- Zoning: ${analysis.siteInfo.zoning}`);
    lines.push(`- Sun: ${analysis.environmentalMetrics.sunExposure}% | Wind: ${analysis.environmentalMetrics.windExposure}% | Soil: ${analysis.environmentalMetrics.soilQuality}%`);
    lines.push(`- Flood Risk: ${analysis.environmentalMetrics.floodRisk}`);
    lines.push(`- ${analysis.amenities.schools} schools, ${analysis.amenities.hospitals} hospitals, ${analysis.amenities.transitStops} transit nearby`);
    lines.push(`\n*Ask me about specific topics: flood risk, soil, solar, wind, elevation, infrastructure, or recommendations.*`);
  }
  return lines.join("\n");
}

async function callAI(modelPreference: string, systemPrompt: string, message: string, history?: { role: string; content: string }[], siteAnalysis?: SiteAnalysis | null, locationName?: string): Promise<{ content: string; model: string }> {
  const models = modelPreference === "auto"
    ? ["gemini", "openai"]
    : [modelPreference, "gemini", "openai"];

  const uniqueModels = [...new Set(models)];
  const errors: string[] = [];

  for (const m of uniqueModels) {
    try {
      if (m === "gemini" || m === "mapgpt") {
        const gisPrompt = m === "mapgpt"
          ? systemPrompt + "\n\nYou are MapGPT, specialized in geospatial queries, map data interpretation, and spatial analysis. Focus on geographic data, coordinate systems, projections, and spatial relationships."
          : systemPrompt;
        const content = await callGemini(gisPrompt, message, history);
        return { content, model: m === "mapgpt" ? "MapGPT (Gemini)" : "Gemini" };
      } else if (m === "compass") {
        const compassPrompt = systemPrompt + "\n\nYou are CompassAI, specialized in navigation, routing, terrain analysis, and geographic orientation. Focus on directional guidance, path optimization, and terrain-aware analysis.";
        const content = await callGemini(compassPrompt, message, history);
        return { content, model: "CompassAI (Gemini)" };
      } else if (m === "openai" || m === "chatgpt") {
        const content = await callOpenAI(systemPrompt, message, history);
        return { content, model: "ChatGPT" };
      }
    } catch (e: any) {
      errors.push(`${m}: ${e.message}`);
      continue;
    }
  }

  const localResponse = generateLocalGISResponse(message, siteAnalysis || null, locationName);
  return { content: localResponse, model: "TerraLogic (Local GIS)" };
}

async function fetchOverpassCombined(lat: number, lon: number, radius: number): Promise<any> {
  const bbox = `(around:${radius},${lat},${lon})`;
  const query = `[out:json][timeout:30];(
    node["amenity"="school"]${bbox};way["amenity"="school"]${bbox};
    node["amenity"="university"]${bbox};way["amenity"="university"]${bbox};
    node["amenity"="college"]${bbox};way["amenity"="college"]${bbox};
    node["amenity"="kindergarten"]${bbox};node["amenity"="library"]${bbox};
    node["building"="school"]${bbox};way["building"="school"]${bbox};
    node["amenity"="hospital"]${bbox};way["amenity"="hospital"]${bbox};
    node["amenity"="clinic"]${bbox};way["amenity"="clinic"]${bbox};
    node["amenity"="doctors"]${bbox};node["amenity"="pharmacy"]${bbox};
    node["healthcare"]${bbox};way["healthcare"]${bbox};
    node["building"="hospital"]${bbox};way["building"="hospital"]${bbox};
    node["public_transport"="stop_position"]${bbox};node["public_transport"="platform"]${bbox};
    node["highway"="bus_stop"]${bbox};node["railway"="station"]${bbox};
    way["railway"="station"]${bbox};node["railway"="halt"]${bbox};
    node["amenity"="bus_station"]${bbox};way["amenity"="bus_station"]${bbox};
    node["amenity"="taxi"]${bbox};
    node["amenity"="fire_station"]${bbox};way["amenity"="fire_station"]${bbox};
    node["amenity"="police"]${bbox};way["amenity"="police"]${bbox};
    node["amenity"="post_office"]${bbox};node["amenity"="townhall"]${bbox};
    way["amenity"="townhall"]${bbox};node["amenity"="bank"]${bbox};
    node["amenity"="fuel"]${bbox};node["amenity"="marketplace"]${bbox};
    way["amenity"="marketplace"]${bbox};node["office"="government"]${bbox};
    way["office"="government"]${bbox};node["power"="substation"]${bbox};
  );out body center;`;
  try {
    const resp = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) throw new Error(`Overpass error: ${resp.status}`);
    return await resp.json();
  } catch (e: any) {
    console.error("Overpass combined fetch error:", e.message);
    return { elements: [] };
  }
}

async function fetchOverpassGeoCombined(lat: number, lon: number, radius: number): Promise<any> {
  const bbox = `(around:${radius},${lat},${lon})`;
  const query = `[out:json][timeout:30];(
    way["leisure"="park"]${bbox};relation["leisure"="park"]${bbox};
    way["leisure"="garden"]${bbox};way["leisure"="nature_reserve"]${bbox};
    way["leisure"="playground"]${bbox};way["landuse"="forest"]${bbox};
    relation["landuse"="forest"]${bbox};
    way["landuse"]${bbox};relation["landuse"]${bbox};
    way["natural"="floodplain"]${bbox};way["flood_prone"="yes"]${bbox};
    way["natural"="wetland"]${bbox};relation["natural"="wetland"]${bbox};
    way["water"="intermittent"]${bbox};way["intermittent"="yes"]${bbox};
    way["natural"="water"]${bbox};relation["natural"="water"]${bbox};
    way["waterway"="river"]${bbox};way["waterway"="stream"]${bbox};
    way["waterway"="canal"]${bbox};way["waterway"="riverbank"]${bbox};
    relation["waterway"="riverbank"]${bbox};
  );out body geom;`;
  try {
    const resp = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) throw new Error(`Overpass error: ${resp.status}`);
    return await resp.json();
  } catch (e: any) {
    console.error("Overpass geo combined fetch error:", e.message);
    return { elements: [] };
  }
}

async function generateSiteAnalysis(lat: number, lon: number, name: string): Promise<SiteAnalysis> {
  const radius = 3000;

  const [pointsResult, geoResult, soilData, elevData, weatherData] = await Promise.allSettled([
    fetchOverpassCombined(lat, lon, radius),
    fetchOverpassGeoCombined(lat, lon, radius),
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
      return { elevations: [50], source: "none" };
    })(),
    (async () => {
      try {
        const resp = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max,sunshine_duration&timezone=auto&past_days=30&forecast_days=1`,
          { signal: AbortSignal.timeout(10000) }
        );
        if (resp.ok) {
          const data = await resp.json();
          return { daily: data.daily, source: "open-meteo" };
        }
      } catch {}
      return { daily: null, source: "none" };
    })(),
  ]);

  const pointsData = pointsResult.status === "fulfilled" ? pointsResult.value : { elements: [] };
  const geoData = geoResult.status === "fulfilled" ? geoResult.value : { elements: [] };

  const allElements = pointsData.elements || [];
  const schoolTags = new Set(["school", "university", "college", "kindergarten", "library"]);
  const hospitalTags = new Set(["hospital", "clinic", "doctors", "pharmacy", "dentist"]);
  const transitTags = new Set(["stop_position", "platform", "bus_stop", "station", "halt", "bus_station", "taxi"]);
  const infraTags = new Set(["fire_station", "police", "post_office", "townhall", "courthouse", "community_centre", "bank", "fuel", "marketplace"]);

  const schoolCount = allElements.filter((e: any) =>
    schoolTags.has(e.tags?.amenity) || schoolTags.has(e.tags?.building)
  ).length;
  const hospitalCount = allElements.filter((e: any) =>
    hospitalTags.has(e.tags?.amenity) || e.tags?.healthcare
  ).length;
  const transitCount = allElements.filter((e: any) =>
    transitTags.has(e.tags?.amenity) || transitTags.has(e.tags?.public_transport) || transitTags.has(e.tags?.highway) || transitTags.has(e.tags?.railway)
  ).length;
  const infraCount = allElements.filter((e: any) =>
    infraTags.has(e.tags?.amenity) || e.tags?.office === "government" || e.tags?.building === "government" || e.tags?.power === "substation"
  ).length;

  const geoElements = geoData.elements || [];
  const parkElements = geoElements.filter((e: any) =>
    e.tags?.leisure === "park" || e.tags?.leisure === "garden" || e.tags?.leisure === "nature_reserve" || e.tags?.leisure === "playground" || e.tags?.landuse === "forest" || e.tags?.natural === "wood"
  );
  const parkCount = parkElements.length;
  const landuseElements = geoElements.filter((e: any) => e.tags?.landuse);
  const landuseGeo = overpassGeometryToGeoJSON({ elements: landuseElements }, {});
  const landuseCount = landuseGeo.features?.length || 0;

  const elevResult = elevData.status === "fulfilled" ? elevData.value : { elevations: [50], source: "none" };
  const elevArr: number[] = (elevResult?.elevations || [50]).map((v: any) => (v != null && !isNaN(Number(v)) ? Number(v) : 50));
  const centerElev = elevArr[Math.floor(elevArr.length / 2)] ?? 50;

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

  const floodElements = geoElements.filter((e: any) =>
    e.tags?.natural === "floodplain" || e.tags?.flood_prone === "yes" || e.tags?.natural === "wetland" || e.tags?.water === "intermittent" || e.tags?.intermittent === "yes"
  );
  const waterElements = geoElements.filter((e: any) =>
    e.tags?.natural === "water" || e.tags?.waterway === "river" || e.tags?.waterway === "stream" || e.tags?.waterway === "canal" || e.tags?.waterway === "riverbank"
  );
  const floodOsmCount = floodElements.length;
  const waterBodyCount = waterElements.length;
  const hasFloodplains = floodElements.some((e: any) =>
    e.tags?.natural === "floodplain" || e.tags?.flood_prone === "yes"
  );
  const hasWetlands = floodElements.some((e: any) =>
    e.tags?.natural === "wetland"
  );
  const lowElevFloodRisk = centerElev < 10 && waterBodyCount > 0;
  const floodplainCount = floodElements.filter((e: any) => e.tags?.natural === "floodplain" || e.tags?.flood_prone === "yes").length;
  const wetlandCount = floodElements.filter((e: any) => e.tags?.natural === "wetland").length;
  const hasHighFloodRisk = hasFloodplains || lowElevFloodRisk;
  const floodZoneCount = floodOsmCount + waterBodyCount;
  const highRiskCount = floodplainCount + (lowElevFloodRisk ? 1 : 0);

  const zoningTypes = landuseGeo.features?.map((f: any) => f.properties?.landuse || f.properties?.type || "").filter(Boolean) || [];
  const zoningCounts: Record<string, number> = {};
  zoningTypes.forEach((z: string) => { zoningCounts[z] = (zoningCounts[z] || 0) + 1; });
  const dominantZoning = Object.entries(zoningCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "Mixed Use";
  const zoningLabel = dominantZoning.charAt(0).toUpperCase() + dominantZoning.slice(1).replace(/_/g, " ");

  const schoolScore = Math.min(100, Math.floor((schoolCount / 10) * 100));
  const infraScore = Math.min(100, Math.floor(((infraCount + transitCount) / 15) * 100));
  const floodRiskScore = Math.min(90, hasHighFloodRisk ? 40 + highRiskCount * 10 : Math.max(10, Math.min(floodZoneCount * 5, 80)));
  const soilScore = Math.min(100, Math.floor(avgBearing * 0.8 + soilDrainageRatio * 40));
  const urbanDensity = Math.min(100, Math.floor((landuseCount / 20) * 100));
  const elevSuitability = centerElev < 5 ? 20 : centerElev < 20 ? 40 : centerElev < 100 ? 80 : centerElev < 300 ? 70 : centerElev < 500 ? 55 : 35;
  const climateStress = Math.min(80, Math.max(15, Math.floor(urbanDensity * 0.3 + (centerElev < 10 ? 30 : 0) + (hasHighFloodRisk ? 15 : 0))));

  const benefitAvg = (soilScore + schoolScore + infraScore + elevSuitability) / 4;
  const riskAvg = (floodRiskScore + climateStress) / 2;
  const overallScore = Math.min(95, Math.max(15, Math.floor(benefitAvg - riskAvg * 0.4 + 30)));
  const rating = overallScore >= 75 ? "Highly Suitable" : overallScore >= 55 ? "Moderate Potential" : "High Risk Area";

  const alerts: SiteAnalysis["alerts"] = [];
  if (floodRiskScore > 50) alerts.push({ type: "warning", title: "Elevated Flood Risk", description: `${floodOsmCount} flood-prone areas and ${waterBodyCount} water bodies detected within 3km. Consider drainage infrastructure and flood barriers.` });
  if (climateStress > 45) alerts.push({ type: "warning", title: "Climate Stress Factor", description: `Region shows ${climateStress}% climate stress index. Urban heat island effects may be significant.` });
  if (overallScore >= 75) alerts.push({ type: "success", title: "Favorable Site Conditions", description: `Strong balance of ${schoolCount} nearby schools, ${infraCount} infrastructure facilities, and manageable environmental risks.` });
  if (urbanDensity > 70) alerts.push({ type: "info", title: "High Urban Density", description: `${landuseCount} land use zones detected. Dense surroundings may increase logistics complexity.` });
  if (centerElev < 10) alerts.push({ type: "warning", title: "Low Elevation Warning", description: `Site elevation is ${centerElev.toFixed(1)}m ASL. Coastal flooding and drainage issues possible.` });
  if (soilClassName !== "Unknown") alerts.push({ type: "info", title: `Soil Classification: ${soilClassName}`, description: `WRB soil type: ${soilClassName}. ${soilDrainageLabel}. Bearing capacity est: ${avgBearing} kPa.` });
  if (waterBodyCount > 3) alerts.push({ type: "info", title: "Water Bodies Nearby", description: `${waterBodyCount} water features (rivers, lakes, canals, ponds) detected within 3km.` });
  if (hasWetlands) alerts.push({ type: "warning", title: "Wetland Areas Present", description: "Wetland areas detected near site. Construction may be restricted. Environmental impact assessment recommended." });

  const weather = weatherData.status === "fulfilled" ? weatherData.value : { daily: null, source: "none" };
  let sunExposure: number, windExposure: number;

  if (weather.daily?.sunshine_duration) {
    const avgSunHrs = (weather.daily.sunshine_duration as number[]).reduce((a: number, b: number) => a + (b || 0), 0) / weather.daily.sunshine_duration.length / 3600;
    sunExposure = Math.min(98, Math.max(15, Math.round(avgSunHrs / 14 * 100)));
  } else {
    sunExposure = centerElev > 100 ? Math.min(95, 70 + Math.floor((centerElev - 100) / 20)) : Math.min(85, 55 + Math.floor(centerElev / 5));
  }

  if (weather.daily?.windspeed_10m_max) {
    const avgWind = (weather.daily.windspeed_10m_max as number[]).reduce((a: number, b: number) => a + (b || 0), 0) / weather.daily.windspeed_10m_max.length;
    windExposure = Math.min(98, Math.max(10, Math.round(avgWind / 60 * 100)));
  } else {
    windExposure = centerElev > 200 ? Math.min(90, 60 + Math.floor((centerElev - 200) / 15)) : Math.max(25, 30 + Math.floor(centerElev / 8));
  }
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
  else recommendations.push({ type: "warning", title: "High Flood Risk", description: `${highRiskCount} high-risk flood zone(s) detected. Flood insurance required. Elevated construction recommended.` });

  if (soilQualityPct >= 70) recommendations.push({ type: "success", title: "Good Soil Conditions", description: `${soilClassName} soil with ${soilQualityPct}% quality rating. ${soilDrainageLabel}. Bearing capacity: ${avgBearing} kPa.` });
  else recommendations.push({ type: "warning", title: "Soil Quality Concerns", description: `${soilClassName} soil rated ${soilQualityPct}%. ${soilDrainageLabel}. Foundation reinforcement may be needed. Bearing: ${avgBearing} kPa.` });

  const buildingFootprint = Math.min(95, Math.floor(urbanDensity * 0.7 + infraScore * 0.2));
  const infraCoverage = Math.min(99, Math.floor(infraScore * 0.6 + transitCount * 3 + hospitalCount * 8));
  const densityIndex = Math.min(99, Math.floor(urbanDensity * 0.5 + buildingFootprint * 0.3 + infraCoverage * 0.2));
  const densityLabel = densityIndex >= 75 ? "High Density" : densityIndex >= 40 ? "Medium Density" : "Low Density";

  const sunPathData = calculateSunPath(lat, lon);

  let aiNarrative = "";
  try {
    if (GEMINI_API_KEY) {
      const dataSummary = `Location: ${name} (${lat.toFixed(4)}°, ${lon.toFixed(4)}°). Elevation: ${centerElev.toFixed(1)}m ASL. Soil: ${soilClassName} (${soilDrainageLabel}, bearing ${avgBearing} kPa). Flood risk: ${floodRiskLabel} (${floodOsmCount} flood features, ${waterBodyCount} water bodies). Sun exposure: ${sunExposure}% (sunrise ${sunPathData.sunrise}, sunset ${sunPathData.sunset}, ${sunPathData.dayLength}h daylight, max altitude ${sunPathData.maxAltitude}°). Wind: ${windExposure}%. Infrastructure: ${schoolCount} schools, ${hospitalCount} hospitals, ${transitCount} transit stops, ${infraCount} facilities, ${parkCount} parks. Zoning: ${zoningLabel}. Urban density: ${urbanDensity}%. Score: ${overallScore}/100 (${rating}).`;
      aiNarrative = await callGemini(
        "You are a GIS site analysis expert. Write a concise 2-3 paragraph narrative assessment of the site based on the real data provided. Mention specific data points. Be professional and actionable. Do not use markdown headers.",
        dataSummary
      );
    }
  } catch (e: any) {
    console.error("AI narrative generation failed:", e.message);
    aiNarrative = `${name} sits at ${centerElev.toFixed(1)}m elevation on ${soilClassName} soil (${soilDrainageLabel}). The site scores ${overallScore}/100 for construction suitability with ${floodRiskLabel.toLowerCase()} flood risk. ${schoolCount} schools, ${hospitalCount} hospitals, and ${transitCount} transit stops serve the area within 3km. Sun exposure is ${sunExposure}% with ${sunPathData.dayLength} hours of daylight.`;
  }

  return {
    overallScore, rating, aiNarrative, sunPathData,
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

  app.get("/api/chat/models", (_req, res) => {
    const models = [
      { id: "gemini", name: "Gemini", description: "Google's Gemini 2.0 Flash — general GIS analysis", available: !!GEMINI_API_KEY, icon: "sparkles" },
      { id: "mapgpt", name: "MapGPT", description: "Geospatial specialist — map data & spatial queries", available: !!GEMINI_API_KEY, icon: "map" },
      { id: "compass", name: "CompassAI", description: "Navigation & terrain specialist — routing & orientation", available: !!GEMINI_API_KEY, icon: "compass" },
      { id: "chatgpt", name: "ChatGPT", description: "OpenAI GPT-4o mini — general purpose analysis", available: !!OPENAI_API_KEY, icon: "bot" },
      { id: "auto", name: "Auto", description: "Best available model with automatic fallback", available: !!(GEMINI_API_KEY || OPENAI_API_KEY), icon: "zap" },
    ];
    res.json({ models });
  });

  app.post("/api/chat", async (req, res) => {
    const parsed = chatRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    const { message, locationName, lat, lon, model: modelPref } = parsed.data;
    let { history } = parsed.data;

    if (history && history.length > MAX_CHAT_HISTORY) {
      history = history.slice(-MAX_CHAT_HISTORY);
    }

    try {
      let siteAnalysis: SiteAnalysis | null = null;
      if (lat !== undefined && lon !== undefined) {
        const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
        siteAnalysis = await storage.getAnalysis(key) || null;
        if (!siteAnalysis && locationName) {
          try {
            siteAnalysis = await generateSiteAnalysis(lat, lon, locationName);
            await storage.saveAnalysis(key, siteAnalysis);
          } catch (e: any) {
            console.error("Chat: auto-analysis failed:", e.message);
          }
        }
      }

      let siteContext = "";
      if (siteAnalysis && locationName) {
        const sunPath = siteAnalysis.sunPathData;
        siteContext = `\n\nReal GIS Site Analysis Data for ${locationName} (${lat?.toFixed(4)}°, ${lon?.toFixed(4)}°):\n- Overall Suitability Score: ${siteAnalysis.overallScore}/100 (${siteAnalysis.rating})\n- Elevation: ${siteAnalysis.siteInfo.elevation} ${siteAnalysis.siteInfo.elevationUnit}\n- Zoning: ${siteAnalysis.siteInfo.zoning}\n- Sun Exposure: ${siteAnalysis.environmentalMetrics.sunExposure}%\n- Soil Quality: ${siteAnalysis.environmentalMetrics.soilQuality}% (${siteAnalysis.recommendations.find(r => r.title.includes("Soil"))?.description || ""})\n- Wind Exposure: ${siteAnalysis.environmentalMetrics.windExposure}%\n- Flood Risk: ${siteAnalysis.environmentalMetrics.floodRisk}\n- Nearby: ${siteAnalysis.amenities.schools} schools, ${siteAnalysis.amenities.transitStops} transit stops, ${siteAnalysis.amenities.hospitals} hospitals, ${siteAnalysis.amenities.parks} parks\n- Factors: ${siteAnalysis.factors.map(f => `${f.name}: ${f.value}%`).join(", ")}${sunPath ? `\n- Sun Path: Sunrise ${sunPath.sunrise}, Sunset ${sunPath.sunset}, Day Length ${sunPath.dayLength}h, Max Solar Altitude ${sunPath.maxAltitude}°` : ""}\n- Density: ${siteAnalysis.developmentDensity.densityLabel} (index ${siteAnalysis.developmentDensity.densityIndex})\n- Recommendations: ${siteAnalysis.recommendations.map(r => `[${r.type}] ${r.title}`).join(", ")}`;
      }

      const systemPrompt = `You are TerraLogic AI, a professional GIS spatial analyst AI assistant specialized in construction site suitability analysis. You combine real geographic information system (GIS) data with expert analysis. You have access to real-time data including: elevation profiles, soil classification (WRB/SoilGrids), flood risk (FEMA/OSM), sun path calculations, wind exposure, land use mapping, and infrastructure proximity from OpenStreetMap. Provide clear, actionable, data-driven insights about site suitability for construction. Reference specific data points when available. Use markdown formatting for readability.${siteContext}`;
      const historyForAI = (history || []).map(m => ({ role: m.role, content: m.content }));
      const aiResult = await callAI(modelPref || "auto", systemPrompt, message, historyForAI, siteAnalysis, locationName);
      res.json({ content: aiResult.content, model: aiResult.model });
    } catch (error: any) {
      console.error("AI chat error:", error.message);
      res.status(500).json({ error: "Failed to generate AI response", message: error.message });
    }
  });

  // === QuickOSM Query Endpoint ===

  app.post("/api/quickosm", async (req, res) => {
    const { key, value, lat, lon, radius, outputType } = req.body;
    if (!key || lat === undefined || lon === undefined) {
      return res.status(400).json({ error: "key, lat, lon required" });
    }
    const sanitize = (s: string) => s.replace(/[\[\]"'\\;(){}]/g, "").slice(0, 64);
    const safeKey = sanitize(String(key));
    const safeValue = value ? sanitize(String(value)) : "";
    if (!safeKey) return res.status(400).json({ error: "Invalid key" });
    const r = Math.min(Math.max(Number(radius) || 5000, 100), 25000);
    const bbox = `(around:${r},${lat},${lon})`;
    const valueFilter = safeValue ? `="${safeValue}"` : "";
    const isAreaQuery = outputType === "polygon" || outputType === "all";
    const isPointQuery = outputType === "point" || outputType === "all" || !outputType;

    let query = `[out:json][timeout:25];(`;
    if (isPointQuery) {
      query += `node["${safeKey}"${valueFilter}]${bbox};`;
    }
    if (isAreaQuery || !outputType || outputType === "all") {
      query += `way["${safeKey}"${valueFilter}]${bbox};relation["${safeKey}"${valueFilter}]${bbox};`;
    }
    query += `);out body geom;`;

    try {
      const resp = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(30000),
      });
      if (!resp.ok) throw new Error(`Overpass error: ${resp.status}`);
      const data = await resp.json();
      const geo = overpassGeometryToGeoJSON(data, { layer: "quickosm", queryKey: safeKey, queryValue: safeValue || "*" });
      const points = overpassPointsToGeoJSON(data, { layer: "quickosm", queryKey: safeKey, queryValue: safeValue || "*" });
      const allFeatures = [...(geo.features || []), ...(points.features || [])];
      const seen = new Set<string>();
      const deduped = allFeatures.filter(f => {
        const id = JSON.stringify(f.geometry?.coordinates?.[0] || f.geometry?.coordinates);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      res.json({ type: "FeatureCollection", features: deduped, meta: { query: `${key}=${value || "*"}`, count: deduped.length, radius: r } });
    } catch (e: any) {
      console.error("QuickOSM error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // === OpenCity India Data Endpoint ===

  app.get("/api/opencity/search", async (req, res) => {
    const { q, city, rows } = req.query;
    const searchQ = [q, city].filter(Boolean).join(" ");
    try {
      const resp = await fetch(
        `https://data.opencity.in/api/3/action/package_search?q=${encodeURIComponent(searchQ || "")}&rows=${Number(rows) || 20}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!resp.ok) throw new Error(`OpenCity error: ${resp.status}`);
      const data = await resp.json();
      if (!data.success) throw new Error("OpenCity API returned unsuccessful");
      const datasets = data.result.results.map((r: any) => ({
        id: r.id,
        title: r.title,
        name: r.name,
        organization: r.organization?.title || "",
        city: r.groups?.map((g: any) => g.display_name).join(", ") || "",
        resources: (r.resources || []).map((res: any) => ({
          id: res.id,
          name: res.name || res.description || "",
          format: res.format || "",
          url: res.url || "",
        })),
      }));
      res.json({ datasets, count: data.result.count });
    } catch (e: any) {
      console.error("OpenCity search error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/opencity/resource/:id", async (req, res) => {
    const { id } = req.params;
    try {
      const metaResp = await fetch(
        `https://data.opencity.in/api/3/action/resource_show?id=${id}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!metaResp.ok) throw new Error(`OpenCity error: ${metaResp.status}`);
      const metaData = await metaResp.json();
      if (!metaData.success) throw new Error("Resource not found");
      const resource = metaData.result;
      const url = resource.url;
      const format = (resource.format || "").toLowerCase();

      if (format === "geojson" || url.endsWith(".geojson")) {
        const dataResp = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!dataResp.ok) throw new Error(`Failed to fetch resource: ${dataResp.status}`);
        const geoData = await dataResp.json();
        res.json({ format: "geojson", data: geoData, name: resource.name || resource.description || "" });
      } else if (format === "csv") {
        const dataResp = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!dataResp.ok) throw new Error(`Failed to fetch resource: ${dataResp.status}`);
        const csvText = await dataResp.text();
        const lines = csvText.split("\n").filter(l => l.trim());
        const headers = lines[0]?.split(",").map(h => h.trim().replace(/"/g, ""));
        const latIdx = headers?.findIndex(h => /^(lat|latitude)$/i.test(h));
        const lonIdx = headers?.findIndex(h => /^(lon|lng|longitude)$/i.test(h));
        if (latIdx !== undefined && latIdx >= 0 && lonIdx !== undefined && lonIdx >= 0) {
          const features = lines.slice(1).map((line, i) => {
            const cols = line.split(",").map(c => c.trim().replace(/"/g, ""));
            const lat = parseFloat(cols[latIdx]);
            const lon = parseFloat(cols[lonIdx]);
            if (isNaN(lat) || isNaN(lon)) return null;
            const props: Record<string, string> = {};
            headers?.forEach((h, j) => { if (j !== latIdx && j !== lonIdx) props[h] = cols[j] || ""; });
            return {
              type: "Feature",
              geometry: { type: "Point", coordinates: [lon, lat] },
              properties: { ...props, _source: "opencity" },
            };
          }).filter(Boolean);
          res.json({ format: "geojson", data: { type: "FeatureCollection", features }, name: resource.name || "" });
        } else {
          const rows = lines.slice(1, 101).map(line => {
            const cols = line.split(",").map(c => c.trim().replace(/"/g, ""));
            const row: Record<string, string> = {};
            headers?.forEach((h, j) => { row[h] = cols[j] || ""; });
            return row;
          });
          res.json({ format: "table", headers, rows, name: resource.name || "" });
        }
      } else if (format === "kml") {
        res.json({ format: "unsupported", message: "KML format not yet supported. Try GeoJSON or CSV resources.", name: resource.name || "" });
      } else {
        res.json({ format: "download", url, name: resource.name || "", resourceFormat: format });
      }
    } catch (e: any) {
      console.error("OpenCity resource error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // === GIS Data Layer Endpoints ===

  app.get("/api/layers/schools", async (req, res) => {
    const { lat, lon, radius } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat and lon required" });
    const data = await fetchOverpassPoints(Number(lat), Number(lon), Number(radius) || 5000,
      `node["amenity"="school"]BBOX;way["amenity"="school"]BBOX;node["amenity"="university"]BBOX;way["amenity"="university"]BBOX;node["amenity"="college"]BBOX;way["amenity"="college"]BBOX;node["amenity"="kindergarten"]BBOX;node["amenity"="library"]BBOX;way["amenity"="library"]BBOX;node["building"="school"]BBOX;way["building"="school"]BBOX;node["building"="university"]BBOX;way["building"="university"]BBOX;node["building"="college"]BBOX;way["building"="college"]BBOX;`
    );
    res.json(overpassPointsToGeoJSON(data, { layer: "schools", icon: "school" }));
  });

  app.get("/api/layers/hospitals", async (req, res) => {
    const { lat, lon, radius } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat and lon required" });
    const data = await fetchOverpassPoints(Number(lat), Number(lon), Number(radius) || 5000,
      `node["amenity"="hospital"]BBOX;way["amenity"="hospital"]BBOX;node["amenity"="clinic"]BBOX;way["amenity"="clinic"]BBOX;node["amenity"="doctors"]BBOX;node["amenity"="pharmacy"]BBOX;node["amenity"="dentist"]BBOX;node["amenity"="veterinary"]BBOX;node["healthcare"]BBOX;way["healthcare"]BBOX;node["healthcare"="centre"]BBOX;way["healthcare"="centre"]BBOX;node["healthcare"="hospital"]BBOX;way["healthcare"="hospital"]BBOX;node["building"="hospital"]BBOX;way["building"="hospital"]BBOX;`
    );
    res.json(overpassPointsToGeoJSON(data, { layer: "hospitals", icon: "hospital" }));
  });

  app.get("/api/layers/transit", async (req, res) => {
    const { lat, lon, radius } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat and lon required" });
    const data = await fetchOverpassPoints(Number(lat), Number(lon), Number(radius) || 5000,
      `node["public_transport"="stop_position"]BBOX;node["public_transport"="platform"]BBOX;node["highway"="bus_stop"]BBOX;way["highway"="bus_stop"]BBOX;node["railway"="station"]BBOX;way["railway"="station"]BBOX;node["railway"="halt"]BBOX;node["railway"="tram_stop"]BBOX;node["amenity"="bus_station"]BBOX;way["amenity"="bus_station"]BBOX;node["amenity"="taxi"]BBOX;node["amenity"="ferry_terminal"]BBOX;node["aeroway"="aerodrome"]BBOX;way["aeroway"="aerodrome"]BBOX;node["station"="subway"]BBOX;way["railway"="subway_entrance"]BBOX;`
    );
    res.json(overpassPointsToGeoJSON(data, { layer: "transit", icon: "bus" }));
  });

  app.get("/api/layers/infrastructure", async (req, res) => {
    const { lat, lon, radius } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat and lon required" });
    const data = await fetchOverpassPoints(Number(lat), Number(lon), Number(radius) || 4000,
      `node["amenity"="fire_station"]BBOX;way["amenity"="fire_station"]BBOX;node["amenity"="police"]BBOX;way["amenity"="police"]BBOX;node["amenity"="post_office"]BBOX;node["amenity"="townhall"]BBOX;way["amenity"="townhall"]BBOX;node["amenity"="courthouse"]BBOX;node["amenity"="community_centre"]BBOX;way["amenity"="community_centre"]BBOX;node["amenity"="social_facility"]BBOX;node["amenity"="bank"]BBOX;node["amenity"="atm"]BBOX;node["amenity"="fuel"]BBOX;node["amenity"="charging_station"]BBOX;node["amenity"="waste_disposal"]BBOX;node["amenity"="recycling"]BBOX;node["amenity"="marketplace"]BBOX;way["amenity"="marketplace"]BBOX;node["office"="government"]BBOX;way["office"="government"]BBOX;node["building"="government"]BBOX;way["building"="government"]BBOX;node["man_made"="water_tower"]BBOX;node["man_made"="reservoir_covered"]BBOX;node["power"="substation"]BBOX;way["power"="substation"]BBOX;node["power"="plant"]BBOX;way["power"="plant"]BBOX;node["telecom"="exchange"]BBOX;`
    );
    res.json(overpassPointsToGeoJSON(data, { layer: "infrastructure" }));
  });

  app.get("/api/layers/parks", async (req, res) => {
    const { lat, lon, radius } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat and lon required" });
    const data = await fetchOverpassGeometry(Number(lat), Number(lon), Number(radius) || 4000,
      `way["leisure"="park"]BBOX;relation["leisure"="park"]BBOX;way["leisure"="garden"]BBOX;relation["leisure"="garden"]BBOX;way["leisure"="nature_reserve"]BBOX;relation["leisure"="nature_reserve"]BBOX;way["leisure"="playground"]BBOX;way["leisure"="sports_centre"]BBOX;way["leisure"="stadium"]BBOX;way["leisure"="recreation_ground"]BBOX;way["landuse"="recreation_ground"]BBOX;way["boundary"="national_park"]BBOX;relation["boundary"="national_park"]BBOX;way["leisure"="golf_course"]BBOX;way["landuse"="forest"]BBOX;relation["landuse"="forest"]BBOX;way["natural"="wood"]BBOX;relation["natural"="wood"]BBOX;`
    );
    res.json(overpassGeometryToGeoJSON(data, { layer: "parks" }));
  });

  app.get("/api/layers/landuse", async (req, res) => {
    const { lat, lon, radius } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat and lon required" });
    const data = await fetchOverpassGeometry(Number(lat), Number(lon), Number(radius) || 3000,
      `way["landuse"]BBOX;relation["landuse"]BBOX;way["building"]BBOX;`
    );
    res.json(overpassGeometryToGeoJSON(data, { layer: "landuse" }));
  });

  app.get("/api/layers/water", async (req, res) => {
    const { lat, lon, radius } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat and lon required" });
    const data = await fetchOverpassGeometry(Number(lat), Number(lon), Number(radius) || 5000,
      `way["natural"="water"]BBOX;relation["natural"="water"]BBOX;way["waterway"="river"]BBOX;way["waterway"="stream"]BBOX;way["waterway"="canal"]BBOX;way["waterway"="drain"]BBOX;way["waterway"="ditch"]BBOX;way["waterway"="riverbank"]BBOX;relation["waterway"="riverbank"]BBOX;way["water"="lake"]BBOX;relation["water"="lake"]BBOX;way["water"="pond"]BBOX;way["water"="reservoir"]BBOX;relation["water"="reservoir"]BBOX;way["landuse"="reservoir"]BBOX;relation["landuse"="reservoir"]BBOX;way["landuse"="basin"]BBOX;way["natural"="wetland"]BBOX;relation["natural"="wetland"]BBOX;way["natural"="spring"]BBOX;node["natural"="spring"]BBOX;node["man_made"="water_well"]BBOX;node["amenity"="drinking_water"]BBOX;node["man_made"="water_tap"]BBOX;way["water"="tank"]BBOX;node["man_made"="storage_tank"]["content"="water"]BBOX;`
    );
    res.json(overpassGeometryToGeoJSON(data, { layer: "water" }));
  });

  app.get("/api/layers/flood", async (req, res) => {
    const { lat, lon, radius } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat and lon required" });
    const clat = Number(lat), clon = Number(lon), r = Number(radius) || 5000;

    const results = await Promise.allSettled([
      fetchOverpassGeometry(clat, clon, r,
        `way["natural"="floodplain"]BBOX;relation["natural"="floodplain"]BBOX;way["flood_prone"="yes"]BBOX;way["natural"="wetland"]BBOX;relation["natural"="wetland"]BBOX;way["wetland"="marsh"]BBOX;way["wetland"="swamp"]BBOX;way["water"="intermittent"]BBOX;way["intermittent"="yes"]BBOX;way["waterway"="drain"]BBOX;`
      ),
      fetchOverpassGeometry(clat, clon, r,
        `way["natural"="water"]BBOX;relation["natural"="water"]BBOX;way["waterway"="river"]BBOX;way["waterway"="stream"]BBOX;way["waterway"="canal"]BBOX;way["waterway"="riverbank"]BBOX;relation["waterway"="riverbank"]BBOX;`
      ),
      (async () => {
        try {
          const degOffset = r / 111000;
          const gridRes = 10;
          const latMin = clat - degOffset, latMax = clat + degOffset;
          const lonMin = clon - degOffset, lonMax = clon + degOffset;
          const latStep = (latMax - latMin) / (gridRes - 1);
          const lonStep = (lonMax - lonMin) / (gridRes - 1);
          const elevLats: number[] = [], elevLons: number[] = [];
          for (let row = 0; row < gridRes; row++) {
            for (let col = 0; col < gridRes; col++) {
              elevLats.push(latMin + row * latStep);
              elevLons.push(lonMin + col * lonStep);
            }
          }
          const resp = await fetch(
            `https://api.open-meteo.com/v1/elevation?latitude=${elevLats.join(",")}&longitude=${elevLons.join(",")}`,
            { signal: AbortSignal.timeout(10000) }
          );
          if (!resp.ok) return null;
          const data = await resp.json();
          const elevations: number[] = data.elevation || [];
          return { elevations, gridRes, latMin, lonMin, latStep, lonStep };
        } catch { return null; }
      })(),
      fetchArcGISFeatureLayer(
        "https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28",
        clat, clon, r
      ),
    ]);

    const floodOsm = results[0].status === "fulfilled" ? results[0].value : { elements: [] };
    const waterOsm = results[1].status === "fulfilled" ? results[1].value : { elements: [] };
    const elevGrid = results[2].status === "fulfilled" ? results[2].value : null;
    const femaData = results[3].status === "fulfilled" ? results[3].value : { features: [] };

    const features: any[] = [];

    const osmFloodGeo = overpassGeometryToGeoJSON(floodOsm, { layer: "flood" });
    for (const f of (osmFloodGeo.features || [])) {
      const tags = f.properties || {};
      const isWetland = tags.natural === "wetland" || tags.wetland;
      const isFloodplain = tags.natural === "floodplain" || tags.flood_prone === "yes";
      f.properties = {
        ...f.properties,
        layer: "flood",
        FLD_ZONE: isFloodplain ? "A" : isWetland ? "AE" : "X",
        riskLevel: isFloodplain ? "High" : isWetland ? "Moderate" : "Low",
        source: "osm",
      };
      features.push(f);
    }

    if (elevGrid) {
      const { elevations, gridRes, latMin, lonMin, latStep, lonStep } = elevGrid;
      const centerElev = elevations[Math.floor(elevations.length / 2)] ?? 100;
      const waterGeo = overpassGeometryToGeoJSON(waterOsm, {});
      const hasNearbyWater = (waterGeo.features || []).length > 0;

      for (let row = 0; row < gridRes - 1; row++) {
        for (let col = 0; col < gridRes - 1; col++) {
          const idx = row * gridRes + col;
          const elev = elevations[idx];
          if (elev === undefined) continue;

          const relativeElev = elev - Math.min(...elevations.filter((e: number) => e !== undefined));
          let riskLevel = "Minimal";
          let fldZone = "X";
          if (relativeElev < 2 && hasNearbyWater) { riskLevel = "High"; fldZone = "A"; }
          else if (relativeElev < 5 && hasNearbyWater) { riskLevel = "Moderate"; fldZone = "AE"; }
          else if (relativeElev < 3) { riskLevel = "Low-Moderate"; fldZone = "X500"; }
          else if (elev < centerElev - 10 && hasNearbyWater) { riskLevel = "Low-Moderate"; fldZone = "X500"; }

          if (riskLevel === "Minimal") continue;

          const cellLat = latMin + row * latStep;
          const cellLon = lonMin + col * lonStep;
          features.push({
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [[
                [cellLon, cellLat],
                [cellLon + lonStep, cellLat],
                [cellLon + lonStep, cellLat + latStep],
                [cellLon, cellLat + latStep],
                [cellLon, cellLat],
              ]],
            },
            properties: {
              layer: "flood",
              FLD_ZONE: fldZone,
              riskLevel,
              elevation: Math.round(elev * 10) / 10,
              source: "elevation-model",
            },
          });
        }
      }
    }

    for (const f of (femaData.features || [])) {
      f.properties = { ...f.properties, layer: "flood", source: "fema" };
      features.push(f);
    }

    res.json({ type: "FeatureCollection", features });
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