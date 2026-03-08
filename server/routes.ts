import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { chatRequestSchema, analyzeRequestSchema } from "@shared/schema";
import type { SiteAnalysis } from "@shared/schema";
import { GoogleGenAI, Type } from "@google/genai";
import OpenAI from "openai";

const geminiAI = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: { apiVersion: "", baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL },
});

const openaiClient = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const GEMINI_AVAILABLE = !!(process.env.AI_INTEGRATIONS_GEMINI_API_KEY && process.env.AI_INTEGRATIONS_GEMINI_BASE_URL);
const OPENAI_AVAILABLE = !!(process.env.AI_INTEGRATIONS_OPENAI_API_KEY && process.env.AI_INTEGRATIONS_OPENAI_BASE_URL);
const ARCGIS_API_KEY = process.env.ARCGIS_API_KEY || "";
const MAX_CHAT_HISTORY = 20;
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

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
  const solarNoonMinUTC = 720 - 4 * lon - eqOfTime;
  const tzOffsetHours = Math.round(lon / 15);
  const tzOffsetMin = tzOffsetHours * 60;
  const solarNoonLocal = solarNoonMinUTC + tzOffsetMin;
  const sunriseLocal = solarNoonLocal - dayLengthHours * 30;
  const sunsetLocal = solarNoonLocal + dayLengthHours * 30;
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
    sunrise: formatTime(sunriseLocal),
    sunset: formatTime(sunsetLocal),
    dayLength: Math.round(dayLengthHours * 10) / 10,
    solarNoon: formatTime(solarNoonLocal),
    maxAltitude: Math.round(maxAlt * 10) / 10,
    azimuthRange: { min: Math.round(sunriseAz * 10) / 10, max: Math.round((360 - sunriseAz) * 10) / 10 },
  };
}

async function fetchSunTimes(lat: number, lon: number): Promise<{ sunrise: string; sunset: string } | null> {
  try {
    const resp = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=sunrise,sunset&timezone=auto&forecast_days=1`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (resp.ok) {
      const data = await resp.json();
      if (data.daily?.sunrise?.[0] && data.daily?.sunset?.[0]) {
        const sr = data.daily.sunrise[0];
        const ss = data.daily.sunset[0];
        return {
          sunrise: sr.includes("T") ? sr.split("T")[1].slice(0, 5) : sr,
          sunset: ss.includes("T") ? ss.split("T")[1].slice(0, 5) : ss,
        };
      }
    }
  } catch {}
  return null;
}

async function callGemini(systemPrompt: string, message: string, history?: { role: string; content: string }[]): Promise<string> {
  if (!GEMINI_AVAILABLE) throw new Error("Gemini AI Integration not configured");
  const chatHistory = (history || []).map(msg => ({
    role: msg.role === "user" ? "user" as const : "model" as const,
    parts: [{ text: msg.content }],
  }));
  const contents = [
    { role: "user" as const, parts: [{ text: "System instruction: " + systemPrompt }] },
    { role: "model" as const, parts: [{ text: "Understood. I will follow these instructions." }] },
    ...chatHistory,
    { role: "user" as const, parts: [{ text: message }] },
  ];
  const result = await geminiAI.models.generateContent({
    model: "gemini-2.5-flash",
    contents,
    config: { maxOutputTokens: 2048 },
  });
  return result.text || "No response generated.";
}

async function callOpenAI(systemPrompt: string, message: string, history?: { role: string; content: string }[]): Promise<string> {
  if (!OPENAI_AVAILABLE) throw new Error("OpenAI AI Integration not configured");
  const messages: any[] = [
    { role: "system", content: systemPrompt },
    ...(history || []).map(m => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];
  const result = await openaiClient.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    max_tokens: 1024,
  });
  return result.choices?.[0]?.message?.content || "No response generated.";
}

interface LocalGISResult {
  content: string;
  action?: { type: string; layer?: string; layers?: string[] };
  detectedTopic?: string;
}

function detectIntent(msg: string, history?: { role: string; content: string }[]): { topic: string; isMapRequest: boolean; isComparison: boolean; isFollowUp: boolean; refersToPrevious: boolean } {
  const m = msg.toLowerCase().trim();
  const recentHistory = (history || []).slice(-6);
  const lastAssistant = [...recentHistory].reverse().find(h => h.role === "assistant")?.content?.toLowerCase() || "";
  const lastUser = [...recentHistory].reverse().find(h => h.role === "user")?.content?.toLowerCase() || "";

  const refersToPrevious = /\b(them|those|these|it|that|the above|show .*(on|in) ?(the )?map|display|visuali[sz]e|overlay|plot|mark|highlight|where are|locate)\b/.test(m) && m.split(/\s+/).length < 12;
  const isMapRequest = /\b(show|display|map|visuali[sz]e|overlay|plot|mark|highlight|locate|where|pin|layer)\b.*\b(map|layer|on map|on the map)\b/.test(m) ||
    /\b(show|display|put|add|turn on|enable|toggle)\b.*\b(them|those|these|it|layer|on map)\b/.test(m) ||
    /\bon ?(the )?map\b/.test(m);
  const isComparison = /\b(compare|versus|vs|better|worse|differ|between)\b/.test(m);
  const isFollowUp = refersToPrevious || m.split(/\s+/).length <= 4;

  const topicScores: Record<string, number> = {
    transit: 0, flood: 0, soil: 0, solar: 0, wind: 0,
    elevation: 0, infrastructure: 0, density: 0, recommendations: 0, overview: 0,
    landuse: 0, water: 0, parks: 0, schools: 0, hospitals: 0
  };

  const patterns: Record<string, RegExp[]> = {
    transit: [/bus\b/i, /metro/i, /station/i, /transport/i, /transit/i, /railway/i, /train/i, /commut/i, /route/i, /subway/i, /tram/i, /auto/i, /rickshaw/i, /cab/i, /taxi/i],
    flood: [/flood/i, /drainage/i, /inundat/i, /waterlog/i, /submerg/i, /storm/i, /rain/i, /monsoon/i],
    soil: [/soil/i, /foundation/i, /bearing/i, /ground/i, /geolog/i, /clay/i, /sand/i, /rock/i, /earth/i, /dig/i, /excavat/i, /terrain type/i],
    solar: [/sun/i, /solar/i, /sunrise/i, /sunset/i, /daylight/i, /shade/i, /shadow/i, /panel/i, /photovoltaic/i, /irradiance/i],
    wind: [/wind/i, /breeze/i, /gust/i, /ventilat/i, /airflow/i, /turbine/i],
    elevation: [/elevation/i, /height/i, /terrain/i, /altitude/i, /topograph/i, /slope/i, /hill/i, /contour/i, /profile/i, /steep/i, /flat/i],
    infrastructure: [/infrastr/i, /facilit/i, /amenit/i, /nearby/i, /access/i, /connect/i, /road/i, /highway/i, /bridge/i, /utility/i, /power/i, /electric/i, /sewage/i, /pipe/i],
    density: [/densit/i, /urban/i, /building/i, /construct/i, /develop/i, /built/i, /footprint/i, /coverage/i, /population/i, /crowd/i, /congesti/i],
    recommendations: [/recommend/i, /suggest/i, /advice/i, /should/i, /what.*do/i, /can.*build/i, /safe.*to/i, /feasib/i, /suitable/i, /plan/i, /proposal/i, /best/i, /worst/i, /pros/i, /cons/i],
    overview: [/overview/i, /summary/i, /overall/i, /score/i, /suitab/i, /tell.*about/i, /analys[ie]/i, /report/i, /assess/i, /evaluat/i],
    landuse: [/land\s*use/i, /zoning/i, /zone/i, /residential/i, /commercial/i, /industrial/i, /agricultural/i, /mixed/i],
    water: [/water\s*bod/i, /river/i, /lake/i, /pond/i, /canal/i, /reservoir/i, /wetland/i],
    parks: [/park/i, /garden/i, /green/i, /recreation/i, /open\s*space/i, /playground/i, /nature/i],
    schools: [/school/i, /college/i, /universit/i, /education/i, /academ/i, /institut/i, /learn/i],
    hospitals: [/hospital/i, /clinic/i, /health/i, /medic/i, /pharma/i, /doctor/i, /healthcare/i, /emergency/i]
  };

  for (const [topic, regexes] of Object.entries(patterns)) {
    for (const re of regexes) {
      if (re.test(m)) topicScores[topic] += 2;
    }
  }

  if (isFollowUp && refersToPrevious) {
    for (const [topic, regexes] of Object.entries(patterns)) {
      for (const re of regexes) {
        if (re.test(lastAssistant) || re.test(lastUser)) topicScores[topic] += 1;
      }
    }
  }

  let bestTopic = "overview";
  let bestScore = 0;
  for (const [topic, score] of Object.entries(topicScores)) {
    if (score > bestScore) { bestScore = score; bestTopic = topic; }
  }
  if (bestScore === 0) bestTopic = "overview";

  return { topic: bestTopic, isMapRequest, isComparison, isFollowUp, refersToPrevious };
}

function getLayerForTopic(topic: string): string | null {
  const map: Record<string, string> = {
    transit: "transit", flood: "flood", soil: "soil", solar: "elevation",
    elevation: "elevation", landuse: "landuse", water: "water", parks: "parks",
    schools: "schools", hospitals: "hospitals", infrastructure: "infrastructure"
  };
  return map[topic] || null;
}

function generateLocalGISResponse(message: string, analysis: SiteAnalysis | null, locationName?: string, history?: { role: string; content: string }[], modelPersona?: string): LocalGISResult {
  if (!analysis) {
    return { content: "I don't have analysis data for this location yet. Click on the map or search for a location to run a site analysis first. Once it's loaded, I can answer detailed questions about the area." };
  }

  const intent = detectIntent(message, history);
  const { topic, isMapRequest, refersToPrevious } = intent;
  const loc = locationName || "this location";
  const lines: string[] = [];
  let action: LocalGISResult["action"] | undefined;

  if (isMapRequest) {
    const layer = getLayerForTopic(topic);
    if (layer) {
      action = { type: "toggleLayer", layer };
      lines.push(`I've enabled the **${topic}** layer on the map for ${loc}. You should now see the data overlaid on the map.`);
    } else if (refersToPrevious) {
      const prevTopic = detectIntent(([...(history || [])].reverse().find(h => h.role === "user")?.content || ""), []).topic;
      const prevLayer = getLayerForTopic(prevTopic);
      if (prevLayer) {
        action = { type: "toggleLayer", layer: prevLayer };
        lines.push(`Done! I've turned on the **${prevTopic}** layer on the map so you can see them visually.`);
      } else {
        lines.push(`To visualize data on the map, try enabling specific layers from the **Layers** tab on the left panel. Available layers include transit stops, schools, hospitals, land use, flood zones, and more.`);
      }
    } else {
      lines.push(`You can enable map layers from the **Layers** tab on the left panel. Available layers include transit, schools, hospitals, flood zones, land use, water bodies, elevation contours, soil types, and infrastructure.`);
    }

    if (lines.length) {
      return { content: lines.join("\n"), action, detectedTopic: topic };
    }
  }

  const persona = modelPersona || "default";
  const introStyle = (text: string) => {
    if (persona === "mapgpt") return `From a geospatial perspective, ${text}`;
    if (persona === "compass") return `Looking at the terrain and navigation data, ${text}`;
    return text;
  };

  if (topic === "transit" || topic === "infrastructure" || topic === "schools" || topic === "hospitals") {
    if (topic === "transit") {
      lines.push(introStyle(`there are **${analysis.amenities.transitStops} transit stops** within the 3km analysis radius of ${loc}.`));
      lines.push(`\nThis includes bus stops, metro/subway stations, railway stations, tram stops, and other public transport nodes identified from OpenStreetMap data.`);
      lines.push(`\nThe area has an **Infrastructure Access score of ${analysis.factors.find(f => f.name === "Infrastructure Access")?.value || "N/A"}%**, indicating ${(analysis.factors.find(f => f.name === "Infrastructure Access")?.value || 0) >= 70 ? "excellent" : "moderate"} connectivity.`);
    } else if (topic === "schools") {
      lines.push(introStyle(`there are **${analysis.amenities.schools} educational institutions** within 3km of ${loc}.`));
      lines.push(`This includes schools, colleges, universities, kindergartens, and libraries found in OpenStreetMap data.`);
    } else if (topic === "hospitals") {
      lines.push(introStyle(`there are **${analysis.amenities.hospitals} healthcare facilities** within 3km of ${loc}.`));
      lines.push(`This includes hospitals, clinics, doctors' offices, pharmacies, and other healthcare providers from OpenStreetMap data.`);
    } else {
      lines.push(introStyle(`${loc} has solid infrastructure coverage:`));
    }
    lines.push(`\n**Nearby Amenities Summary:**`);
    lines.push(`- Schools & Education: ${analysis.amenities.schools}`);
    lines.push(`- Healthcare: ${analysis.amenities.hospitals}`);
    lines.push(`- Transit Stops: ${analysis.amenities.transitStops}`);
    lines.push(`- Parks & Green Spaces: ${analysis.amenities.parks}`);
  } else if (topic === "flood") {
    lines.push(introStyle(`the flood risk at ${loc} is rated **${analysis.environmentalMetrics.floodRisk}**.`));
    lines.push(`\nThe site sits at **${analysis.siteInfo.elevation} ${analysis.siteInfo.elevationUnit}** elevation, which ${analysis.siteInfo.elevation > 100 ? "provides good natural protection against flooding" : analysis.siteInfo.elevation > 30 ? "offers moderate flood protection" : "means the area could be vulnerable to flooding events"}.`);
    const floodFactor = analysis.factors.find(f => f.name === "Flood Risk");
    if (floodFactor) lines.push(`\nFlood Risk Factor: **${floodFactor.value}%** ${floodFactor.value > 60 ? "(elevated — consider flood mitigation measures)" : "(manageable with standard precautions)"}`);
    const floodRec = analysis.recommendations.find(r => r.title.toLowerCase().includes("flood"));
    if (floodRec) lines.push(`\n> ${floodRec.description}`);
  } else if (topic === "soil") {
    lines.push(introStyle(`the soil quality at ${loc} scores **${analysis.environmentalMetrics.soilQuality}%**.`));
    lines.push(`\nThe land is classified as **${analysis.siteInfo.zoning}** zoning. ${analysis.environmentalMetrics.soilQuality >= 70 ? "The soil conditions are favorable for construction with standard foundation techniques." : "You may need specialized foundation engineering depending on the structure type."}`);
    const soilRec = analysis.recommendations.find(r => r.title.toLowerCase().includes("soil"));
    if (soilRec) lines.push(`\n> ${soilRec.description}`);
  } else if (topic === "solar") {
    lines.push(introStyle(`sun exposure at ${loc} is **${analysis.environmentalMetrics.sunExposure}%**.`));
    if (analysis.sunPathData) {
      lines.push(`\n**Sun Path Data (today):**`);
      lines.push(`- Sunrise: ${analysis.sunPathData.sunrise} UTC / Sunset: ${analysis.sunPathData.sunset} UTC`);
      lines.push(`- Day length: ${analysis.sunPathData.dayLength} hours`);
      lines.push(`- Solar noon: ${analysis.sunPathData.solarNoon} UTC`);
      lines.push(`- Peak solar altitude: ${analysis.sunPathData.maxAltitude}°`);
      lines.push(`- Azimuth range: ${analysis.sunPathData.azimuthRange.min}° to ${analysis.sunPathData.azimuthRange.max}°`);
    }
    lines.push(`\n${analysis.environmentalMetrics.sunExposure >= 60 ? "Good solar potential — the site receives adequate sunlight for solar panel installation or passive solar design." : "Limited sun exposure — consider shade analysis and optimized panel placement if solar energy is planned."}`);
  } else if (topic === "wind") {
    lines.push(introStyle(`wind exposure at ${loc} is **${analysis.environmentalMetrics.windExposure}%**.`));
    lines.push(`\nAt **${analysis.siteInfo.elevation} ${analysis.siteInfo.elevationUnit}** elevation, ${analysis.environmentalMetrics.windExposure > 50 ? "the site experiences significant wind exposure. Wind-resistant building design and landscaping windbreaks are recommended." : "wind conditions are moderate. Standard construction practices should be adequate."}`);
  } else if (topic === "elevation") {
    lines.push(introStyle(`${loc} sits at **${analysis.siteInfo.elevation} ${analysis.siteInfo.elevationUnit}** elevation.`));
    if (analysis.elevationProfile?.length) {
      const elMin = Math.min(...analysis.elevationProfile.map(p => p.elevation));
      const elMax = Math.max(...analysis.elevationProfile.map(p => p.elevation));
      const dist = analysis.elevationProfile[analysis.elevationProfile.length - 1]?.distance || 0;
      lines.push(`\nThe elevation profile across ${dist}m shows a range from **${elMin}m to ${elMax}m** (${(elMax - elMin).toFixed(1)}m variation). ${(elMax - elMin) > 50 ? "The terrain is quite varied — earthwork and grading will be significant considerations." : "The terrain is relatively flat, which is favorable for construction."}`);
    }
    const elevFactor = analysis.factors.find(f => f.name === "Elevation Suitability");
    if (elevFactor) lines.push(`\nElevation suitability score: **${elevFactor.value}%**`);
  } else if (topic === "density" || topic === "landuse") {
    lines.push(introStyle(`${loc} is classified as **${analysis.developmentDensity.densityLabel}** with a density index of ${analysis.developmentDensity.densityIndex}%.`));
    lines.push(`\n- Building footprint coverage: **${analysis.developmentDensity.buildingFootprint}%**`);
    lines.push(`- Infrastructure coverage: **${analysis.developmentDensity.infrastructureCoverage}%**`);
    lines.push(`- Zoning: **${analysis.siteInfo.zoning}**`);
    lines.push(`\n${analysis.developmentDensity.densityIndex > 70 ? "This is a heavily developed area. New construction may face space constraints and higher costs, but benefits from existing infrastructure." : "There is room for development. The lower density means more flexibility for site planning."}`);
  } else if (topic === "recommendations") {
    lines.push(`Here are the key recommendations for ${loc}:\n`);
    for (const rec of analysis.recommendations) {
      const icon = rec.type === "success" ? "✅" : rec.type === "warning" ? "⚠️" : "ℹ️";
      lines.push(`${icon} **${rec.title}**`);
      lines.push(`   ${rec.description}\n`);
    }
  } else if (topic === "parks" || topic === "water") {
    if (topic === "parks") {
      lines.push(introStyle(`there are **${analysis.amenities.parks} parks and green spaces** within 3km of ${loc}.`));
      lines.push(`\nThis includes public parks, gardens, nature reserves, playgrounds, and forested areas identified from OpenStreetMap data.`);
    } else {
      lines.push(introStyle(`the area around ${loc} has water features nearby.`));
      lines.push(`\nFlood risk is rated **${analysis.environmentalMetrics.floodRisk}**. Check the water layer on the map for rivers, lakes, canals, and other water bodies.`);
    }
  } else {
    lines.push(`Here's a quick overview of **${loc}**:\n`);
    lines.push(`**Suitability Score: ${analysis.overallScore}/100** (${analysis.rating})`);
    lines.push(`\n**Location Details:**`);
    lines.push(`- Coordinates: ${analysis.siteInfo.coordinates.lat.toFixed(4)}°, ${analysis.siteInfo.coordinates.lon.toFixed(4)}°`);
    lines.push(`- Elevation: ${analysis.siteInfo.elevation} ${analysis.siteInfo.elevationUnit}`);
    lines.push(`- Zoning: ${analysis.siteInfo.zoning}`);
    lines.push(`\n**Environmental:**`);
    lines.push(`- Sun exposure: ${analysis.environmentalMetrics.sunExposure}% | Wind: ${analysis.environmentalMetrics.windExposure}%`);
    lines.push(`- Soil quality: ${analysis.environmentalMetrics.soilQuality}% | Flood risk: ${analysis.environmentalMetrics.floodRisk}`);
    lines.push(`\n**Nearby (within 3km):** ${analysis.amenities.schools} schools, ${analysis.amenities.hospitals} healthcare, ${analysis.amenities.transitStops} transit stops, ${analysis.amenities.parks} parks`);
    lines.push(`\nFeel free to ask me anything specific — like "is this area prone to flooding?", "show transit stops on the map", or "what are the soil conditions?"`);
  }

  return { content: lines.join("\n"), detectedTopic: topic };
}

interface AIResult {
  content: string;
  model: string;
  action?: { type: string; layer?: string; layers?: string[] };
}

async function callAI(modelPreference: string, systemPrompt: string, message: string, history?: { role: string; content: string }[], siteAnalysis?: SiteAnalysis | null, locationName?: string): Promise<AIResult> {
  const models = modelPreference === "auto"
    ? ["gemini", "openai"]
    : [modelPreference, "gemini", "openai"];

  const uniqueModels = [...new Set(models)];
  const errors: string[] = [];

  for (const m of uniqueModels) {
    try {
      if (m === "gemini" || m === "mapgpt") {
        const gisPrompt = m === "mapgpt"
          ? systemPrompt + "\n\nYou are MapGPT, a geospatial analysis specialist. Focus on geographic data interpretation, coordinate systems, spatial relationships, and map-based analysis. Speak with authority about GIS concepts. When users ask to show things on the map, mention they can enable the relevant layer from the Layers tab."
          : systemPrompt;
        const content = await callGemini(gisPrompt, message, history);
        return { content, model: m === "mapgpt" ? "MapGPT" : "Gemini" };
      } else if (m === "compass") {
        const compassPrompt = systemPrompt + "\n\nYou are CompassAI, a navigation and terrain analysis specialist. Focus on terrain, elevation profiles, routing, slope analysis, and geographic orientation. Think about how terrain affects construction access, drainage, and site planning.";
        const content = await callGemini(compassPrompt, message, history);
        return { content, model: "CompassAI" };
      } else if (m === "openai" || m === "chatgpt") {
        const content = await callOpenAI(systemPrompt, message, history);
        return { content, model: "ChatGPT" };
      }
    } catch (e: any) {
      errors.push(`${m}: ${e.message}`);
      continue;
    }
  }

  const persona = modelPreference === "mapgpt" ? "mapgpt" : modelPreference === "compass" ? "compass" : "default";
  const localResult = generateLocalGISResponse(message, siteAnalysis || null, locationName, history, persona);
  const modelName = persona === "mapgpt" ? "MapGPT (Local)" : persona === "compass" ? "CompassAI (Local)" : "TerraLogic AI";
  return { content: localResult.content, model: modelName, action: localResult.action };
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
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(30000),
      });
      if (!resp.ok) continue;
      return await resp.json();
    } catch (e: any) {
      continue;
    }
  }
  console.error("Overpass combined fetch failed all endpoints");
  return { elements: [] };
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
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(30000),
      });
      if (!resp.ok) continue;
      return await resp.json();
    } catch (e: any) {
      continue;
    }
  }
  console.error("Overpass geo combined fetch failed all endpoints");
  return { elements: [] };
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
  const realSunTimes = await fetchSunTimes(lat, lon);
  if (realSunTimes) {
    sunPathData.sunrise = realSunTimes.sunrise;
    sunPathData.sunset = realSunTimes.sunset;
    const [srH, srM] = realSunTimes.sunrise.split(":").map(Number);
    const [ssH, ssM] = realSunTimes.sunset.split(":").map(Number);
    const realDayLen = ((ssH * 60 + ssM) - (srH * 60 + srM)) / 60;
    if (realDayLen > 0) sunPathData.dayLength = Math.round(realDayLen * 10) / 10;
  }

  let aiNarrative = "";
  try {
    if (GEMINI_AVAILABLE) {
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

  const landUseCategories: Record<string, string> = {
    residential: "Residential", commercial: "Commercial", industrial: "Industrial",
    retail: "Retail", grass: "Green/Leisure", forest: "Green/Leisure",
    farmland: "Agricultural", meadow: "Green/Leisure", recreation_ground: "Green/Leisure",
    construction: "Construction", military: "Institutional", railway: "Transport",
    cemetery: "Institutional", orchard: "Agricultural", vineyard: "Agricultural",
    quarry: "Industrial", allotments: "Agricultural", basin: "Water",
    reservoir: "Water",
  };
  const luCategoryCounts: Record<string, number> = {};
  zoningTypes.forEach((z: string) => {
    const cat = landUseCategories[z] || "Other";
    luCategoryCounts[cat] = (luCategoryCounts[cat] || 0) + 1;
  });
  const luTotal = Object.values(luCategoryCounts).reduce((a, b) => a + b, 0) || 1;
  const luCatColors: Record<string, string> = {
    "Residential": "#EF4444", "Commercial": "#F59E0B", "Industrial": "#6366F1",
    "Green/Leisure": "#22C55E", "Agricultural": "#84CC16", "Institutional": "#64748B",
    "Transport": "#78716C", "Construction": "#F97316", "Retail": "#EC4899",
    "Water": "#3B82F6", "Other": "#9CA3AF",
  };
  const landUseMix = Object.entries(luCategoryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, count]) => ({
      label,
      value: Math.round((count / luTotal) * 100),
      color: luCatColors[label] || "#9CA3AF",
    }));

  const amenityTotal = schoolCount + hospitalCount + transitCount + parkCount + infraCount || 1;
  const amenityMix = [
    { label: "Transit", value: Math.round((transitCount / amenityTotal) * 100), color: "#3B82F6" },
    { label: "Schools", value: Math.round((schoolCount / amenityTotal) * 100), color: "#F59E0B" },
    { label: "Healthcare", value: Math.round((hospitalCount / amenityTotal) * 100), color: "#EF4444" },
    { label: "Parks", value: Math.round((parkCount / amenityTotal) * 100), color: "#22C55E" },
    { label: "Infrastructure", value: Math.round((infraCount / amenityTotal) * 100), color: "#8B5CF6" },
  ].filter(a => a.value > 0).sort((a, b) => b.value - a.value);

  return {
    overallScore, rating, aiNarrative, sunPathData, landUseMix, amenityMix,
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

function buildOverpassBbox(lat: number, lon: number, radius: number, polygonParam?: string): string {
  if (polygonParam) {
    try {
      const coords: [number, number][] = JSON.parse(polygonParam);
      if (Array.isArray(coords) && coords.length >= 3) {
        const polyStr = coords.map(([la, lo]) => `${la} ${lo}`).join(" ");
        return `(poly:"${polyStr}")`;
      }
    } catch {}
  }
  return `(around:${radius},${lat},${lon})`;
}

async function fetchOverpassPoints(lat: number, lon: number, radius: number, query: string, polygonParam?: string): Promise<any> {
  const bbox = buildOverpassBbox(lat, lon, radius, polygonParam);
  const overpassQuery = `[out:json][timeout:25];(${query.replace(/BBOX/g, bbox)});out center;`;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(overpassQuery)}`,
        signal: AbortSignal.timeout(25000),
      });
      if (!resp.ok) { continue; }
      return await resp.json();
    } catch (e: any) {
      continue;
    }
  }
  console.error("Overpass points fetch failed all endpoints");
  return { elements: [] };
}

async function fetchOverpassGeometry(lat: number, lon: number, radius: number, query: string, polygonParam?: string): Promise<any> {
  const bbox = buildOverpassBbox(lat, lon, radius, polygonParam);
  const overpassQuery = `[out:json][timeout:25];(${query.replace(/BBOX/g, bbox)});out body geom;`;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(overpassQuery)}`,
        signal: AbortSignal.timeout(25000),
      });
      if (!resp.ok) { continue; }
      return await resp.json();
    } catch (e: any) {
      continue;
    }
  }
  console.error("Overpass geometry fetch failed all endpoints for query");
  return { elements: [] };
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

  app.get("/api/esri/identify", async (req, res) => {
    const { lat, lon, basemap } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat and lon required" });
    const clat = Number(lat), clon = Number(lon);

    const results: any = { lat: clat, lon: clon, layers: [] };

    try {
      const reverseUrl = `https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?f=json&location=${clon},${clat}&langCode=en&token=${ARCGIS_API_KEY}`;
      const geoResp = await fetch(reverseUrl, { signal: AbortSignal.timeout(8000) });
      if (geoResp.ok) {
        const geoData = await geoResp.json();
        if (geoData.address) {
          results.address = geoData.address;
          results.location = geoData.location;
        }
      }
    } catch {}

    try {
      const topoUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/identify?f=json&geometry=${clon},${clat}&geometryType=esriGeometryPoint&sr=4326&tolerance=5&mapExtent=${clon-0.01},${clat-0.01},${clon+0.01},${clat+0.01}&imageDisplay=800,600,96&returnGeometry=false&layers=visible`;
      const topoResp = await fetch(topoUrl, { signal: AbortSignal.timeout(8000) });
      if (topoResp.ok) {
        const topoData = await topoResp.json();
        if (topoData.results) {
          results.layers.push(...topoData.results.map((r: any) => ({
            layerName: r.layerName,
            value: r.value,
            attributes: r.attributes,
          })));
        }
      }
    } catch {}

    try {
      const imageryUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/identify?f=json&geometry=${clon},${clat}&geometryType=esriGeometryPoint&sr=4326&tolerance=5&mapExtent=${clon-0.01},${clat-0.01},${clon+0.01},${clat+0.01}&imageDisplay=800,600,96&returnGeometry=false&layers=visible`;
      const imgResp = await fetch(imageryUrl, { signal: AbortSignal.timeout(8000) });
      if (imgResp.ok) {
        const imgData = await imgResp.json();
        if (imgData.results) {
          results.layers.push(...imgData.results.map((r: any) => ({
            layerName: r.layerName,
            value: r.value,
            attributes: r.attributes,
            source: "imagery",
          })));
        }
      }
    } catch {}

    res.json(results);
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
      { id: "gemini", name: "Gemini", description: "Google Gemini 2.5 Flash — general GIS analysis", available: GEMINI_AVAILABLE, icon: "sparkles" },
      { id: "mapgpt", name: "MapGPT", description: "Geospatial specialist — map data & spatial analysis", available: true, icon: "map" },
      { id: "compass", name: "CompassAI", description: "Terrain & navigation specialist — elevation & routing", available: true, icon: "compass" },
      { id: "chatgpt", name: "ChatGPT", description: "OpenAI GPT-4o mini — general purpose analysis", available: OPENAI_AVAILABLE, icon: "bot" },
      { id: "auto", name: "Auto", description: "Best available model with automatic fallback", available: true, icon: "zap" },
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
      const response: any = { content: aiResult.content, model: aiResult.model };
      if (aiResult.action) response.action = aiResult.action;
      res.json(response);
    } catch (error: any) {
      console.error("AI chat error:", error.message);
      res.status(500).json({ error: "Failed to generate AI response", message: error.message });
    }
  });

  // === CartoAI Function-Calling Chatbot ===

  const cartoAITools = [
    {
      name: "update_map_view",
      description: "Update the map view to a new location with optional zoom level. Use this when the user asks to go to, show, or navigate to a specific place.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          lat: { type: Type.NUMBER, description: "Latitude of the center point" },
          lon: { type: Type.NUMBER, description: "Longitude of the center point" },
          zoom: { type: Type.NUMBER, description: "Zoom level (1-18), default 13" },
          name: { type: Type.STRING, description: "Name of the location" },
        },
        required: ["lat", "lon"],
      },
    },
    {
      name: "add_marker",
      description: "Add a marker to the map at a specific location. Use when the user asks to mark, pin, or highlight a specific point.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          lat: { type: Type.NUMBER, description: "Latitude" },
          lon: { type: Type.NUMBER, description: "Longitude" },
          label: { type: Type.STRING, description: "Label for the marker popup" },
          color: { type: Type.STRING, description: "Marker color (hex or name), default blue" },
        },
        required: ["lat", "lon", "label"],
      },
    },
    {
      name: "add_geojson",
      description: "Add GeoJSON data to the map as an overlay. Use when the user asks to draw boundaries, areas, routes, or shapes. When generating data, constrain features to the drawn region or visible viewport bounds.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          geojson: { type: Type.STRING, description: "GeoJSON FeatureCollection as a JSON string" },
          label: { type: Type.STRING, description: "Label for this overlay" },
          color: { type: Type.STRING, description: "Color for the overlay, default #3B82F6" },
        },
        required: ["geojson", "label"],
      },
    },
    {
      name: "clear_map",
      description: "Clear all markers and overlays from the map. Use when the user asks to clear, reset, or remove map markers/overlays.",
      parameters: {
        type: Type.OBJECT,
        properties: {},
      },
    },
    {
      name: "search_places",
      description: "Search for places/locations by name or category near a given point. Use when the user asks to find restaurants, parks, hospitals, schools, etc. If a drawn region exists, use its center coordinates. If no drawn region, use the selected location.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          query: { type: Type.STRING, description: "Search query (e.g., 'restaurants', 'hospitals', 'parks')" },
          lat: { type: Type.NUMBER, description: "Latitude of search center" },
          lon: { type: Type.NUMBER, description: "Longitude of search center" },
          radius: { type: Type.NUMBER, description: "Search radius in meters, default 2000" },
        },
        required: ["query", "lat", "lon"],
      },
    },
    {
      name: "analyze_site",
      description: "Run a full GIS suitability analysis on a location. Use when the user asks to analyze a site, check suitability, or get environmental data for a place.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          lat: { type: Type.NUMBER, description: "Latitude" },
          lon: { type: Type.NUMBER, description: "Longitude" },
          name: { type: Type.STRING, description: "Location name" },
        },
        required: ["lat", "lon", "name"],
      },
    },
    {
      name: "search_web",
      description: "Search for open GIS data sources, datasets, APIs, and download links using AI knowledge. Returns curated recommendations from known open data portals (data.gov.in, OpenCity.in, SEDAC, Natural Earth, USGS, Copernicus, HDX, etc.). Use when the user asks for data downloads, open data sources, or datasets not available through built-in search_places.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          query: { type: Type.STRING, description: "Search query for finding GIS data sources or spatial datasets" },
        },
        required: ["query"],
      },
    },
    {
      name: "fetch_open_data",
      description: "Fetch GeoJSON or CSV data from a public URL (open data portals, APIs). Use to load real open data from sources like data.gov.in, OpenCity.in, Natural Earth, Overpass, etc. Only use with known, trusted open data URLs.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          url: { type: Type.STRING, description: "Direct URL to a GeoJSON, CSV, or JSON file from an open data portal" },
          label: { type: Type.STRING, description: "Label for this data layer" },
          format: { type: Type.STRING, description: "Expected format: geojson, csv, or json" },
        },
        required: ["url", "label"],
      },
    },
    {
      name: "query_knowledge_base",
      description: "Query the advanced GIS/ML knowledge base for specific topics. Returns detailed information about data sources, ML methodologies, data formats, and sample data structures for any GIS category. Use when users ask about data from the Data Catalog or want to learn about GIS analysis techniques.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          topic: { type: Type.STRING, description: "The GIS topic or data category to query (e.g., 'flood risk zones', 'urban heat islands', 'soil classification')" },
        },
        required: ["topic"],
      },
    },
  ];

  async function executeCartoAITool(name: string, args: any): Promise<any> {
    switch (name) {
      case "update_map_view":
        return { action: "update_map_view", lat: args.lat, lon: args.lon, zoom: args.zoom || 13, name: args.name || "" };

      case "add_marker":
        return { action: "add_marker", lat: args.lat, lon: args.lon, label: args.label, color: args.color || "#3B82F6" };

      case "add_geojson": {
        let geojson;
        try {
          geojson = typeof args.geojson === "string" ? JSON.parse(args.geojson) : args.geojson;
          if (!geojson || !geojson.type) throw new Error("Invalid GeoJSON");
        } catch (e) {
          return { action: "add_geojson", geojson: { type: "FeatureCollection", features: [] }, label: args.label, color: args.color || "#3B82F6", error: "Failed to parse GeoJSON" };
        }
        return { action: "add_geojson", geojson, label: args.label, color: args.color || "#3B82F6" };
      }

      case "clear_map":
        return { action: "clear_map" };

      case "search_places": {
        const amenityMap: Record<string, string> = {
          restaurant: "amenity=restaurant", restaurants: "amenity=restaurant",
          hospital: "amenity=hospital", hospitals: "amenity=hospital",
          school: "amenity=school", schools: "amenity=school",
          park: "leisure=park", parks: "leisure=park",
          pharmacy: "amenity=pharmacy", pharmacies: "amenity=pharmacy",
          bank: "amenity=bank", banks: "amenity=bank",
          hotel: "tourism=hotel", hotels: "tourism=hotel",
          cafe: "amenity=cafe", cafes: "amenity=cafe",
          supermarket: "shop=supermarket", supermarkets: "shop=supermarket",
          gas: "amenity=fuel", fuel: "amenity=fuel",
          bus: "highway=bus_stop", "bus stop": "highway=bus_stop",
          station: "railway=station", "train station": "railway=station",
          mosque: "amenity=place_of_worship", church: "amenity=place_of_worship",
          temple: "amenity=place_of_worship", "place of worship": "amenity=place_of_worship",
          atm: "amenity=atm",
          parking: "amenity=parking",
          library: "amenity=library", libraries: "amenity=library",
          police: "amenity=police", "police station": "amenity=police",
          "fire station": "amenity=fire_station",
        };
        const q = (args.query || "").toLowerCase().trim();
        const tag = amenityMap[q] || `amenity=${q}`;
        const [key, value] = tag.split("=");
        const radius = Math.min(args.radius || 2000, 10000);
        const bbox = `(around:${radius},${args.lat},${args.lon})`;
        const overpassQ = `[out:json][timeout:15];(node["${key}"="${value}"]${bbox};way["${key}"="${value}"]${bbox};);out body center 50;`;
        for (const url of OVERPASS_ENDPOINTS) {
          try {
            const resp = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: `data=${encodeURIComponent(overpassQ)}`,
              signal: AbortSignal.timeout(15000),
            });
            if (!resp.ok) continue;
            const data = await resp.json();
            const places = (data.elements || []).slice(0, 30).map((el: any) => ({
              name: el.tags?.name || el.tags?.amenity || q,
              lat: el.lat || el.center?.lat,
              lon: el.lon || el.center?.lon,
              tags: el.tags || {},
            })).filter((p: any) => p.lat && p.lon);
            return { action: "search_results", query: args.query, places, count: places.length };
          } catch { continue; }
        }
        return { action: "search_results", query: args.query, places: [], count: 0, error: "Search failed" };
      }

      case "analyze_site": {
        const key = `${args.lat.toFixed(4)},${args.lon.toFixed(4)}`;
        let analysis = await storage.getAnalysis(key);
        if (!analysis) {
          analysis = await generateSiteAnalysis(args.lat, args.lon, args.name);
          await storage.saveAnalysis(key, analysis);
        }
        return {
          action: "analyze_site",
          analysis: {
            score: analysis.overallScore,
            rating: analysis.rating,
            elevation: analysis.siteInfo?.elevation,
            zoning: analysis.siteInfo?.zoning,
            floodRisk: analysis.environmentalMetrics?.floodRisk,
            soilQuality: analysis.environmentalMetrics?.soilQuality,
            sunExposure: analysis.environmentalMetrics?.sunExposure,
            windExposure: analysis.environmentalMetrics?.windExposure,
            amenities: analysis.amenities,
            narrative: analysis.aiNarrative,
          },
        };
      }

      case "search_web": {
        const query = args.query || "";
        try {
          const searchResult = await geminiAI.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [{ role: "user", parts: [{ text: `Search for open GIS data sources for: "${query}". Return a structured list of the best available open data sources with:
- Source name
- URL (direct download or portal link)
- Data format (GeoJSON, Shapefile, CSV, KML, WMS, WFS, API)
- Coverage (Global, India, USA, Europe, etc.)
- Description (1 line)
- License (Open, CC-BY, Public Domain, etc.)

Focus on actually downloadable datasets, not just documentation pages. Prioritize: data.gov.in, OpenCity.in, Natural Earth, SEDAC, USGS, Copernicus, data.gov, OpenStreetMap Overpass, WHO, World Bank, UNEP, GADM, HDX, etc.` }] }],
            config: { maxOutputTokens: 2048 },
          });
          return { action: "search_web", query, results: searchResult.text || "No results found" };
        } catch (e: any) {
          return { action: "search_web", query, results: "Web search failed: " + e.message, error: true };
        }
      }

      case "fetch_open_data": {
        const url = args.url || "";
        const label = args.label || "Open Data";
        const format = (args.format || "geojson").toLowerCase();
        try {
          let parsedUrl: URL;
          try {
            parsedUrl = new URL(url);
          } catch {
            return { action: "fetch_open_data", error: "Invalid URL", label };
          }
          if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
            return { action: "fetch_open_data", error: "Only HTTP/HTTPS URLs are allowed", label };
          }
          const trustedHostnames = [
            "data.gov.in", "visualize.data.gov.in",
            "data.opencity.in",
            "raw.githubusercontent.com", "github.com",
            "naciscdn.org", "www.naturalearthdata.com",
            "sedac.ciesin.columbia.edu",
            "overpass-api.de", "overpass.kumi.systems", "maps.mail.ru",
            "nominatim.openstreetmap.org",
            "api.worldbank.org", "data.worldbank.org",
            "data.humdata.org",
            "gadm.org", "geodata.ucdavis.edu",
            "data.un.org",
            "earthquake.usgs.gov", "waterservices.usgs.gov",
            "firms.modaps.eosdis.nasa.gov", "neo.gsfc.nasa.gov",
            "api.census.gov", "tigerweb.geo.census.gov",
            "geojson.io",
            "datameet.github.io",
            "geo.datav.aliyun.com",
            "d2ad6b4ur7yvpq.cloudfront.net",
            "opendata.arcgis.com",
            "services.arcgis.com",
          ];
          const hostname = parsedUrl.hostname.toLowerCase();
          const isTrusted = trustedHostnames.some(d => hostname === d || hostname.endsWith("." + d));
          if (!isTrusted) {
            return { action: "fetch_open_data", error: "URL not from a trusted open data source", label };
          }

          const resp = await fetch(url, {
            signal: AbortSignal.timeout(15000),
            headers: { "Accept": "application/json, application/geo+json, text/csv, */*" },
          });
          if (!resp.ok) return { action: "fetch_open_data", error: `HTTP ${resp.status}`, label };

          const contentLength = parseInt(resp.headers.get("content-length") || "0", 10);
          if (contentLength > 10 * 1024 * 1024) {
            return { action: "fetch_open_data", error: "File too large (>10MB)", label };
          }

          const contentType = resp.headers.get("content-type") || "";
          const text = await resp.text();
          if (text.length > 10 * 1024 * 1024) {
            return { action: "fetch_open_data", error: "Response too large (>10MB)", label };
          }

          if (format === "geojson" || contentType.includes("geo+json") || contentType.includes("json")) {
            try {
              const data = JSON.parse(text);
              if (data.type === "FeatureCollection" || data.type === "Feature") {
                const features = data.type === "FeatureCollection" ? data.features : [data];
                return { action: "add_geojson", geojson: { type: "FeatureCollection", features: features.slice(0, 500) }, label, color: "#3B82F6" };
              }
              return { action: "fetch_open_data", data: "JSON loaded but not GeoJSON format", label, recordCount: Array.isArray(data) ? data.length : 1 };
            } catch {
              return { action: "fetch_open_data", error: "Failed to parse JSON", label };
            }
          } else if (format === "csv" || contentType.includes("csv")) {
            const lines = text.split("\n").filter(l => l.trim());
            const headers = lines[0]?.split(",").map(h => h.trim().replace(/"/g, ""));
            const latIdx = headers?.findIndex(h => /^(lat|latitude)$/i.test(h));
            const lonIdx = headers?.findIndex(h => /^(lon|lng|longitude|long)$/i.test(h));
            if (latIdx !== undefined && latIdx >= 0 && lonIdx !== undefined && lonIdx >= 0) {
              const features = lines.slice(1, 501).map((line) => {
                const cols = line.split(",").map(c => c.trim().replace(/"/g, ""));
                const lat = parseFloat(cols[latIdx]);
                const lon = parseFloat(cols[lonIdx]);
                if (isNaN(lat) || isNaN(lon)) return null;
                const props: Record<string, string> = {};
                headers?.forEach((h, j) => { if (j !== latIdx && j !== lonIdx) props[h] = cols[j] || ""; });
                return { type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: props };
              }).filter(Boolean);
              return { action: "add_geojson", geojson: { type: "FeatureCollection", features }, label, color: "#F59E0B" };
            }
            return { action: "fetch_open_data", data: `CSV with ${lines.length} rows, ${headers?.length} columns`, label, headers: headers?.slice(0, 20) };
          }
          return { action: "fetch_open_data", data: `Fetched ${text.length} bytes`, label, format: contentType };
        } catch (e: any) {
          return { action: "fetch_open_data", error: e.message, label };
        }
      }

      case "query_knowledge_base": {
        const topic = args.topic || "";
        try {
          const kbResult = await geminiAI.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [{ role: "user", parts: [{ text: `You are an advanced GIS Machine Learning Knowledge Base. Provide a highly detailed, technical response about the topic: "${topic}".
Include:
1. Best open data sources globally and for India (with URLs where possible).
2. Standard data formats used (GeoJSON, TIFF, NetCDF, Shapefile, etc.).
3. Advanced Machine Learning / Spatial AI methodologies used to analyze this data (e.g., CNNs for feature extraction, Random Forest for land classification, Spatial Autocorrelation with Moran's I, Kriging for interpolation, LSTM for temporal prediction, U-Net for semantic segmentation).
4. A sample GeoJSON Feature structure representing this data type.
5. Key agencies and organizations that produce this data.
6. Resolution and accuracy considerations.` }] }],
            config: { maxOutputTokens: 3072 },
          });
          return { action: "query_knowledge_base", topic, knowledge: kbResult.text || "No information found." };
        } catch (e: any) {
          return { action: "query_knowledge_base", topic, knowledge: "Knowledge base query failed: " + e.message, error: true };
        }
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  app.post("/api/cartoai/chat", async (req, res) => {
    const { message, history, location, mapContext } = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message is required" });
    }
    if (!GEMINI_AVAILABLE) {
      return res.status(503).json({ error: "Gemini AI Integration not available" });
    }

    try {
      let mapStateContext = "";
      if (location) {
        mapStateContext += `\n**Selected Location**: ${location.name} (${location.lat.toFixed(4)}°N, ${location.lon.toFixed(4)}°E). Use this as the center for relative queries like "nearby", "around here", "in this area".`;
      } else {
        mapStateContext += "\n**Selected Location**: None selected.";
      }

      if (mapContext?.viewport) {
        const v = mapContext.viewport;
        mapStateContext += `\n**Map Viewport**: Viewing area from (${v.south.toFixed(4)}°N, ${v.west.toFixed(4)}°E) to (${v.north.toFixed(4)}°N, ${v.east.toFixed(4)}°E) at zoom level ${v.zoom}. Use these bounds to constrain searches and data to what the user can see.`;
      }

      if (mapContext?.drawnRegion) {
        const dr = mapContext.drawnRegion;
        if (dr.type === "polygon") {
          mapStateContext += `\n**Drawn Region**: User has drawn a polygon with ${dr.coords.length} vertices. Coordinates: ${JSON.stringify(dr.coords.slice(0, 6))}${dr.coords.length > 6 ? "..." : ""}. Focus searches and analysis WITHIN this drawn area.`;
        } else if (dr.type === "circle") {
          mapStateContext += `\n**Drawn Region**: User has drawn a circle centered at (${dr.center[0].toFixed(4)}°N, ${dr.center[1].toFixed(4)}°E) with radius ${Math.round(dr.radius)}m. Focus searches and analysis WITHIN this circular area.`;
        } else if (dr.type === "rectangle") {
          mapStateContext += `\n**Drawn Region**: User has drawn a rectangle from (${dr.bounds[0][0].toFixed(4)}°N, ${dr.bounds[0][1].toFixed(4)}°E) to (${dr.bounds[1][0].toFixed(4)}°N, ${dr.bounds[1][1].toFixed(4)}°E). Focus searches and analysis WITHIN this rectangular area.`;
        }
      }

      if (mapContext?.activeLayers && mapContext.activeLayers.length > 0) {
        mapStateContext += `\n**Active Data Layers**: ${mapContext.activeLayers.join(", ")}. The user can already see this data on the map.`;
      }

      if (mapContext?.customOverlays && mapContext.customOverlays.length > 0) {
        mapStateContext += `\n**Custom Overlays on Map**: ${mapContext.customOverlays.map((o: any) => o.label).join(", ")}. These layers are already loaded on the map.`;
      }

      const systemInstruction = `You are CartoAI, the world's most knowledgeable geospatial AI assistant, built into TerraLogic AI. You are an expert in GIS, spatial analysis, remote sensing, urban planning, environmental science, and open geospatial data. You can interact with the map directly through function calls.

## CURRENT MAP STATE
${mapStateContext}

## CORE CAPABILITIES
- Navigate to any location, add markers, draw GeoJSON boundaries/routes/areas
- Search for places/amenities via OpenStreetMap Overpass API
- Run full site suitability analysis (elevation, soil, flood, sun path, infrastructure)
- Search the web for open GIS datasets and provide download links
- Fetch and display open data directly from trusted portals (GeoJSON, CSV)
- Generate representative GeoJSON data for visualization when real data isn't directly available

## BEHAVIOR RULES
1. When users ask about a place, navigate the map there
2. When users ask to find things nearby, use search_places with the selected location coordinates
3. When a drawn region exists, ALWAYS use the drawn region's center/bounds for searches instead of the selected location. This is critical — the user drew a specific area and expects results WITHIN it.
4. When users ask about data from the Data Catalog, ALWAYS:
   a. First use search_web to find real open data sources for that topic
   b. Try to use fetch_open_data to load real datasets onto the map
   c. If direct fetch fails, generate representative GeoJSON using add_geojson with realistic coordinates constrained to the visible area or drawn region
   d. Always provide download links to the actual data sources
5. When users ask about site suitability, run analyze_site
6. Be a comprehensive GIS knowledge hub — answer questions about spatial concepts, data formats, coordinate systems, projections, and analysis methods
7. When generating GeoJSON data, ALWAYS constrain points/polygons to the drawn region or visible viewport. Never generate data outside what the user can see.
8. Reference the active layers and custom overlays in your analysis — acknowledge what data is already visible on the map

## COMPREHENSIVE OPEN GIS DATA SOURCE KNOWLEDGE

### Global Data Portals
- **Natural Earth** (naturalearthdata.com): Global cultural & physical vector/raster data. Admin boundaries, rivers, lakes, cities, roads, airports. Formats: Shapefile, GeoJSON, GeoPackage. License: Public Domain.
  - Countries: https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson
  - Cities: https://raw.githubusercontent.com/datasets/world-cities/master/data/world-cities.csv
- **OpenStreetMap** (openstreetmap.org): Crowd-sourced global map data. Use Overpass API for queries. All POIs, roads, buildings, boundaries, landuse, waterways.
  - Overpass API: https://overpass-api.de/api/interpreter
  - Overpass Turbo: https://overpass-turbo.eu/
- **GADM** (gadm.org): Global administrative boundaries at all levels (country, state, district, taluk). Formats: Shapefile, GeoJSON, GeoPackage, KMZ.
  - Download: https://gadm.org/download_country.html
- **SEDAC** (sedac.ciesin.columbia.edu): NASA's Socioeconomic Data and Applications Center. Population density, gridded population (GPW), urban land extent, hazard exposure.
  - GPW v4: https://sedac.ciesin.columbia.edu/data/collection/gpw-v4
- **HDX** (data.humdata.org): Humanitarian Data Exchange by UN OCHA. Crisis data, admin boundaries, health facilities, population, displacement, food security.
- **World Bank Open Data** (data.worldbank.org): Development indicators by country. GDP, poverty, urbanization, infrastructure, health, education.
  - API: https://api.worldbank.org/v2/
- **WHO** (who.int/data): Global health data. Disease outbreaks, health facilities, immunization, air quality, water/sanitation.
- **UNEP** (unep.org): Environmental data. Biodiversity, climate, land cover, deforestation, pollution.
- **FAO** (fao.org/faostat): Agriculture data. Crop production, land use, food security, irrigation, livestock, fisheries.
- **USGS** (usgs.gov): US Geological Survey. Earthquake data (real-time GeoJSON), elevation (SRTM/ASTER), landsat imagery, water resources.
  - Earthquakes: https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson
  - Significant: https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson
- **Copernicus** (land.copernicus.eu): EU Earth observation. Land cover (CORINE, GLC), urban atlas, water bodies, forest, imperviousness.
- **NASA FIRMS** (firms.modaps.eosdis.nasa.gov): Real-time fire data (MODIS/VIIRS active fires). Near real-time CSV/GeoJSON.
  - Active fires: https://firms.modaps.eosdis.nasa.gov/api/area/csv/
- **NASA NEO** (neo.gsfc.nasa.gov): NASA Earth Observations. Temperature, rainfall, vegetation, aerosols, cloud cover.
- **WorldPop** (worldpop.org): High-resolution population density, demographics, urbanization, migration, poverty maps.
- **Global Forest Watch** (globalforestwatch.org): Forest cover, deforestation, fires, land use change.
- **GBIF** (gbif.org): Global Biodiversity Information Facility. Species occurrence data.

### India-Specific Data
- **Data.gov.in** (data.gov.in): India Open Government Data Platform. Census, infrastructure, agriculture, health, education, transport.
  - API: https://data.gov.in/resource/
  - Formats: CSV, JSON, XML, XLS
- **OpenCity.in** (data.opencity.in): Indian city open data. Municipal boundaries, wards, roads, water supply, sanitation, building data.
  - API: https://data.opencity.in/api/3/action/package_search
- **Bhuvan** (bhuvan.nrsc.gov.in): ISRO's geoportal. High-res satellite imagery, thematic maps, DEM, LULC for India.
- **SOI** (surveyofindia.gov.in): Survey of India. Official topographic maps, admin boundaries, geodetic data.
- **India WRIS** (indiawris.gov.in): Water Resources Information System. Rivers, basins, dams, groundwater, rainfall.
- **Census of India** (censusindia.gov.in): Population, demographics, housing, education, employment data by district.
- **NRSC** (nrsc.gov.in): National Remote Sensing Centre. Land use/land cover, wasteland mapping, urban sprawl.
- **DataMeet** (github.com/datameet): Community-curated Indian GIS data. State/district/constituency boundaries, pincode boundaries.
  - India states: https://raw.githubusercontent.com/datameet/maps/master/States/states.geojson
  - India districts: https://raw.githubusercontent.com/datameet/maps/master/Districts/districts.geojson
  - Parliamentary constituencies: https://raw.githubusercontent.com/datameet/maps/master/parliamentary-constituencies/india_pc_2019.geojson

### USA-Specific Data
- **Data.gov** (data.gov): US Federal open data. Environment, health, transportation, climate, energy.
- **Census Bureau** (census.gov): TIGER/Line boundaries, demographic data, economic data.
  - API: https://api.census.gov/data/
  - TIGER GeoJSON: https://tigerweb.geo.census.gov/arcgis/rest/services/
- **FEMA** (fema.gov): Flood zones (NFHL), disaster declarations, risk assessments.
- **EPA** (epa.gov): Environmental data. Air quality (AQI), water quality, toxic releases, brownfields.
- **NOAA** (noaa.gov): Weather, climate, ocean, coastal data. Storm events, sea level, tides.
- **USDA** (usda.gov): Agriculture, soil (SSURGO/gSSURGO), crop data, forest inventory.

### Europe-Specific Data
- **European Data Portal** (data.europa.eu): EU-wide open data.
- **Copernicus** (copernicus.eu): EU Earth observation satellite data.
- **EEA** (eea.europa.eu): European Environment Agency. Air quality, water, biodiversity, noise.
- **Eurostat** (ec.europa.eu/eurostat): EU statistical data with NUTS boundaries.

### DATA FORMAT EXPERTISE
- **GeoJSON**: JSON-based spatial data format. FeatureCollection → Feature → Geometry (Point, LineString, Polygon, MultiPolygon) + Properties
- **Shapefile**: ESRI legacy format (.shp, .dbf, .shx, .prj). Most widely used but old.
- **GeoPackage** (.gpkg): Modern SQLite-based format. Replaces Shapefile.
- **KML/KMZ**: Google Earth format. XML-based with styling.
- **CSV with coordinates**: Tabular data with lat/lon columns. Easy to convert to GeoJSON.
- **WMS**: Web Map Service. Serves rendered map tiles. Read-only visualization.
- **WFS**: Web Feature Service. Serves vector features as GeoJSON/GML. Queryable.
- **COG**: Cloud Optimized GeoTIFF. Raster data for remote sensing.
- **GeoTIFF**: Georeferenced raster images (elevation, satellite, land cover).
- **TopoJSON**: Compressed GeoJSON with topology.

### OVERPASS API QUERY PATTERNS (for search_places)
You can construct Overpass queries for ANY OpenStreetMap data:
- Amenities: amenity=hospital|school|restaurant|bank|fuel|pharmacy|police|fire_station|library|cinema|theatre|marketplace|parking|toilet
- Shops: shop=supermarket|convenience|bakery|butcher|clothes|electronics|hardware|furniture
- Tourism: tourism=hotel|guest_house|motel|hostel|camp_site|attraction|museum|viewpoint|zoo|theme_park
- Transport: highway=bus_stop|traffic_signals|crossing|motorway_junction; railway=station|halt; aeroway=aerodrome
- Natural: natural=water|wood|peak|cliff|beach|cave_entrance|wetland|tree|spring
- Landuse: landuse=residential|commercial|industrial|farmland|forest|meadow|cemetery|military
- Building: building=yes|residential|commercial|industrial|school|hospital|church|mosque|temple
- Leisure: leisure=park|playground|garden|sports_centre|swimming_pool|pitch|stadium
- Historic: historic=monument|castle|ruins|memorial|archaeological_site|fort
- Water: waterway=river|stream|canal|drain; natural=water|wetland
- Power: power=plant|substation|line|tower|generator
- Telecom: telecom=exchange|data_center; man_made=tower|mast

### SPATIAL ANALYSIS CONCEPTS
- **Suitability Analysis**: Multi-criteria evaluation combining factors (flood risk, soil, slope, access, infrastructure)
- **Buffer Analysis**: Creating proximity zones around features
- **Network Analysis**: Shortest path, service areas, accessibility
- **Density Analysis**: Kernel density, heat maps, clustering
- **Viewshed Analysis**: Visibility from a point considering terrain
- **Watershed Delineation**: Drainage basin boundaries from DEM
- **Spatial Autocorrelation**: Moran's I, LISA for clustering patterns
- **Change Detection**: Comparing temporal satellite imagery/land cover
- **Interpolation**: IDW, Kriging for creating continuous surfaces from point data

## GENERATIVE AI GIS CAPABILITY
If a user asks for data that is not readily available from open sources, or explicitly asks you to "generate", "estimate", or "simulate" spatial data, you MUST act as a Generative Spatial AI:
1. Use 'search_web' to research the location and topic for contextual understanding.
2. Use 'query_knowledge_base' to get ML methodologies and data formats for the topic.
3. Synthesize geographical context, historical data patterns, and spatial relationships.
4. GENERATE a realistic GeoJSON FeatureCollection representing the estimated data (e.g., approximate flood zones as polygons, estimated commercial corridors, predicted urban growth areas, simulated heat islands, estimated crime hotspots).
5. Plot this using the 'add_geojson' tool with an appropriate color.
6. CLEARLY explain to the user that this is an **"AI-Generated Spatial Estimate"** based on contextual data and ML modeling, NOT an official survey or authoritative data source.
7. Provide links to real data sources where authoritative versions of this data may be available.

## DATA CATALOG QUERY WORKFLOW
When a user asks for data from ANY of the Data Catalog categories, follow this sequence:
1. Use 'query_knowledge_base' to retrieve ML methodologies, data formats, and specific open data sources for that topic.
2. Use 'search_web' to find real-time downloadable datasets from open portals.
3. Try 'fetch_open_data' to load real datasets onto the map if direct URLs are known.
4. If real data cannot be fetched directly, use 'add_geojson' to generate representative GeoJSON with realistic coordinates for the area the user is viewing.
5. Always provide the user with download links to the original open data sources.
6. Explain which ML techniques (CNNs, Random Forest, Kriging, Moran's I, etc.) can be applied to this data.

Be concise but thorough. Use markdown for formatting. When you perform map actions, briefly explain what you did. Always provide relevant download links and data sources when discussing datasets.`;

      const chatHistory = (history || []).slice(-10).map((m: any) => ({
        role: m.role === "user" ? "user" as const : "model" as const,
        parts: [{ text: m.content }],
      }));

      const contents = [
        ...chatHistory,
        { role: "user" as const, parts: [{ text: message }] },
      ];

      const result = await geminiAI.models.generateContent({
        model: "gemini-2.5-flash",
        contents,
        config: {
          systemInstruction,
          maxOutputTokens: 4096,
          tools: [{ functionDeclarations: cartoAITools }],
        },
      });

      const mapActions: any[] = [];
      const visualActions = new Set(["update_map_view", "add_marker", "add_geojson", "clear_map", "search_results", "analyze_site"]);
      let textResponse = "";

      const parts = result.candidates?.[0]?.content?.parts || [];
      const functionCalls = parts.filter((p: any) => p.functionCall);
      const textParts = parts.filter((p: any) => p.text);
      textResponse = textParts.map((p: any) => p.text).join("");

      if (functionCalls.length > 0) {
        const toolResults: any[] = [];
        for (const part of functionCalls) {
          const fc = part.functionCall!;
          const toolResult = await executeCartoAITool(fc.name!, fc.args as any);
          if (toolResult && visualActions.has(toolResult.action) && !toolResult.error) {
            mapActions.push(toolResult);
          }
          toolResults.push({
            functionResponse: {
              name: fc.name,
              response: toolResult,
            },
          });
        }

        const followUp = await geminiAI.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [
            ...contents,
            { role: "model" as const, parts: functionCalls },
            { role: "user" as const, parts: toolResults },
          ],
          config: {
            systemInstruction,
            maxOutputTokens: 4096,
          },
        });
        const followUpText = followUp.text || "";
        if (followUpText) textResponse = followUpText;
      }

      if (!textResponse && mapActions.length > 0) {
        textResponse = "Done! I've updated the map for you.";
      }
      if (!textResponse) {
        textResponse = "I'm not sure how to help with that. Try asking me to find places, navigate to a location, or analyze a site.";
      }

      res.json({ content: textResponse, mapActions, model: "CartoAI" });
    } catch (error: any) {
      console.error("CartoAI error:", error.message);
      res.status(500).json({ error: "CartoAI failed", message: error.message });
    }
  });

  // === QuickOSM Query Endpoint ===

  app.post("/api/quickosm", async (req, res) => {
    const { key, value, lat, lon, radius, outputType, polygon } = req.body;
    if (!key || lat === undefined || lon === undefined) {
      return res.status(400).json({ error: "key, lat, lon required" });
    }
    const sanitize = (s: string) => s.replace(/[\[\]"'\\;(){}]/g, "").slice(0, 64);
    const safeKey = sanitize(String(key));
    const safeValue = value ? sanitize(String(value)) : "";
    if (!safeKey) return res.status(400).json({ error: "Invalid key" });
    const r = Math.min(Math.max(Number(radius) || 5000, 100), 25000);
    const bbox = buildOverpassBbox(lat, lon, r, polygon);
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
    const { lat, lon, radius, polygon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat and lon required" });
    const data = await fetchOverpassPoints(Number(lat), Number(lon), Number(radius) || 5000,
      `node["amenity"="school"]BBOX;way["amenity"="school"]BBOX;node["amenity"="university"]BBOX;way["amenity"="university"]BBOX;node["amenity"="college"]BBOX;way["amenity"="college"]BBOX;node["amenity"="kindergarten"]BBOX;node["amenity"="library"]BBOX;way["amenity"="library"]BBOX;node["building"="school"]BBOX;way["building"="school"]BBOX;node["building"="university"]BBOX;way["building"="university"]BBOX;node["building"="college"]BBOX;way["building"="college"]BBOX;`,
      polygon as string | undefined
    );
    res.json(overpassPointsToGeoJSON(data, { layer: "schools", icon: "school" }));
  });

  app.get("/api/layers/hospitals", async (req, res) => {
    const { lat, lon, radius, polygon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat and lon required" });
    const data = await fetchOverpassPoints(Number(lat), Number(lon), Number(radius) || 5000,
      `node["amenity"="hospital"]BBOX;way["amenity"="hospital"]BBOX;node["amenity"="clinic"]BBOX;way["amenity"="clinic"]BBOX;node["amenity"="doctors"]BBOX;node["amenity"="pharmacy"]BBOX;node["amenity"="dentist"]BBOX;node["amenity"="veterinary"]BBOX;node["healthcare"]BBOX;way["healthcare"]BBOX;node["healthcare"="centre"]BBOX;way["healthcare"="centre"]BBOX;node["healthcare"="hospital"]BBOX;way["healthcare"="hospital"]BBOX;node["building"="hospital"]BBOX;way["building"="hospital"]BBOX;`,
      polygon as string | undefined
    );
    res.json(overpassPointsToGeoJSON(data, { layer: "hospitals", icon: "hospital" }));
  });

  app.get("/api/layers/transit", async (req, res) => {
    const { lat, lon, radius, polygon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat and lon required" });
    const data = await fetchOverpassPoints(Number(lat), Number(lon), Number(radius) || 5000,
      `node["public_transport"="stop_position"]BBOX;node["public_transport"="platform"]BBOX;node["highway"="bus_stop"]BBOX;way["highway"="bus_stop"]BBOX;node["railway"="station"]BBOX;way["railway"="station"]BBOX;node["railway"="halt"]BBOX;node["railway"="tram_stop"]BBOX;node["amenity"="bus_station"]BBOX;way["amenity"="bus_station"]BBOX;node["amenity"="taxi"]BBOX;node["amenity"="ferry_terminal"]BBOX;node["aeroway"="aerodrome"]BBOX;way["aeroway"="aerodrome"]BBOX;node["station"="subway"]BBOX;way["railway"="subway_entrance"]BBOX;`,
      polygon as string | undefined
    );
    res.json(overpassPointsToGeoJSON(data, { layer: "transit", icon: "bus" }));
  });

  app.get("/api/layers/infrastructure", async (req, res) => {
    const { lat, lon, radius, polygon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat and lon required" });
    const data = await fetchOverpassPoints(Number(lat), Number(lon), Number(radius) || 4000,
      `node["amenity"="fire_station"]BBOX;way["amenity"="fire_station"]BBOX;node["amenity"="police"]BBOX;way["amenity"="police"]BBOX;node["amenity"="post_office"]BBOX;node["amenity"="townhall"]BBOX;way["amenity"="townhall"]BBOX;node["amenity"="courthouse"]BBOX;node["amenity"="community_centre"]BBOX;way["amenity"="community_centre"]BBOX;node["amenity"="social_facility"]BBOX;node["amenity"="bank"]BBOX;node["amenity"="atm"]BBOX;node["amenity"="fuel"]BBOX;node["amenity"="charging_station"]BBOX;node["amenity"="waste_disposal"]BBOX;node["amenity"="recycling"]BBOX;node["amenity"="marketplace"]BBOX;way["amenity"="marketplace"]BBOX;node["office"="government"]BBOX;way["office"="government"]BBOX;node["building"="government"]BBOX;way["building"="government"]BBOX;node["man_made"="water_tower"]BBOX;node["man_made"="reservoir_covered"]BBOX;node["power"="substation"]BBOX;way["power"="substation"]BBOX;node["power"="plant"]BBOX;way["power"="plant"]BBOX;node["telecom"="exchange"]BBOX;`,
      polygon as string | undefined
    );
    res.json(overpassPointsToGeoJSON(data, { layer: "infrastructure" }));
  });

  app.get("/api/layers/parks", async (req, res) => {
    const { lat, lon, radius, polygon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat and lon required" });
    const data = await fetchOverpassGeometry(Number(lat), Number(lon), Number(radius) || 4000,
      `way["leisure"="park"]BBOX;relation["leisure"="park"]BBOX;way["leisure"="garden"]BBOX;relation["leisure"="garden"]BBOX;way["leisure"="nature_reserve"]BBOX;relation["leisure"="nature_reserve"]BBOX;way["leisure"="playground"]BBOX;way["leisure"="sports_centre"]BBOX;way["leisure"="stadium"]BBOX;way["leisure"="recreation_ground"]BBOX;way["landuse"="recreation_ground"]BBOX;way["boundary"="national_park"]BBOX;relation["boundary"="national_park"]BBOX;way["leisure"="golf_course"]BBOX;way["landuse"="forest"]BBOX;relation["landuse"="forest"]BBOX;way["natural"="wood"]BBOX;relation["natural"="wood"]BBOX;`,
      polygon as string | undefined
    );
    res.json(overpassGeometryToGeoJSON(data, { layer: "parks" }));
  });

  app.get("/api/layers/landuse", async (req, res) => {
    const { lat, lon, radius, polygon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat and lon required" });
    const r = Math.min(Number(radius) || 2000, 3000);
    const bbox = buildOverpassBbox(Number(lat), Number(lon), r, polygon as string | undefined);
    const overpassQuery = `[out:json][timeout:25][maxsize:10485760];(way["landuse"]${bbox};relation["landuse"]${bbox};);out body geom 200;`;
    let lastError = "";
    for (const url of OVERPASS_ENDPOINTS) {
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(overpassQuery)}`,
          signal: AbortSignal.timeout(20000),
        });
        if (!resp.ok) { lastError = `${url}: ${resp.status}`; continue; }
        const data = await resp.json();
        const geo = overpassGeometryToGeoJSON(data, { layer: "landuse" });
        return res.json(geo);
      } catch (e: any) {
        lastError = `${url}: ${e.message}`;
        continue;
      }
    }
    console.error("Landuse layer fetch failed all endpoints:", lastError);
    res.json({ type: "FeatureCollection", features: [] });
  });

  app.get("/api/layers/water", async (req, res) => {
    const { lat, lon, radius, polygon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat and lon required" });
    const data = await fetchOverpassGeometry(Number(lat), Number(lon), Number(radius) || 5000,
      `way["natural"="water"]BBOX;relation["natural"="water"]BBOX;way["waterway"="river"]BBOX;way["waterway"="stream"]BBOX;way["waterway"="canal"]BBOX;way["waterway"="drain"]BBOX;way["waterway"="ditch"]BBOX;way["waterway"="riverbank"]BBOX;relation["waterway"="riverbank"]BBOX;way["water"="lake"]BBOX;relation["water"="lake"]BBOX;way["water"="pond"]BBOX;way["water"="reservoir"]BBOX;relation["water"="reservoir"]BBOX;way["landuse"="reservoir"]BBOX;relation["landuse"="reservoir"]BBOX;way["landuse"="basin"]BBOX;way["natural"="wetland"]BBOX;relation["natural"="wetland"]BBOX;way["natural"="spring"]BBOX;node["natural"="spring"]BBOX;node["man_made"="water_well"]BBOX;node["amenity"="drinking_water"]BBOX;node["man_made"="water_tap"]BBOX;way["water"="tank"]BBOX;node["man_made"="storage_tank"]["content"="water"]BBOX;`,
      polygon as string | undefined
    );
    res.json(overpassGeometryToGeoJSON(data, { layer: "water" }));
  });

  app.get("/api/layers/flood", async (req, res) => {
    const { lat, lon, radius, polygon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat and lon required" });
    const clat = Number(lat), clon = Number(lon), r = Number(radius) || 5000;
    const polyStr = polygon as string | undefined;

    const results = await Promise.allSettled([
      fetchOverpassGeometry(clat, clon, r,
        `way["natural"="floodplain"]BBOX;relation["natural"="floodplain"]BBOX;way["flood_prone"="yes"]BBOX;way["natural"="wetland"]BBOX;relation["natural"="wetland"]BBOX;way["wetland"="marsh"]BBOX;way["wetland"="swamp"]BBOX;way["water"="intermittent"]BBOX;way["intermittent"="yes"]BBOX;way["waterway"="drain"]BBOX;`,
        polyStr
      ),
      fetchOverpassGeometry(clat, clon, r,
        `way["natural"="water"]BBOX;relation["natural"="water"]BBOX;way["waterway"="river"]BBOX;way["waterway"="stream"]BBOX;way["waterway"="canal"]BBOX;way["waterway"="riverbank"]BBOX;relation["waterway"="riverbank"]BBOX;`,
        polyStr
      ),
      (async () => {
        try {
          const degOffset = r / 111000;
          const gridRes = 10;
          const floodPolyBbox = parseBboxFromPolygon(polyStr);
          const latMin = floodPolyBbox ? floodPolyBbox.latMin : clat - degOffset;
          const latMax = floodPolyBbox ? floodPolyBbox.latMax : clat + degOffset;
          const lonMin = floodPolyBbox ? floodPolyBbox.lonMin : clon - degOffset;
          const lonMax = floodPolyBbox ? floodPolyBbox.lonMax : clon + degOffset;
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

          const floodCellCorners: [number, number][] = [
            [cellLon, cellLat],
            [cellLon + lonStep, cellLat],
            [cellLon + lonStep, cellLat + latStep],
            [cellLon, cellLat + latStep],
          ];
          if (polyStr && !clipPolygonCellToPolygon(floodCellCorners, polyStr)) continue;
          features.push({
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [[...floodCellCorners, floodCellCorners[0]]],
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
    const { lat, lon, radius, polygon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat and lon required" });
    const clat = Number(lat), clon = Number(lon);
    const r = Number(radius) || 3000;
    const degOffset = r / 111000;
    const polyStr = polygon as string | undefined;
    const polyBbox = parseBboxFromPolygon(polyStr);

    try {
      const gridSize = 5;
      const bboxLatMin = polyBbox ? polyBbox.latMin : clat - degOffset;
      const bboxLatMax = polyBbox ? polyBbox.latMax : clat + degOffset;
      const bboxLonMin = polyBbox ? polyBbox.lonMin : clon - degOffset;
      const bboxLonMax = polyBbox ? polyBbox.lonMax : clon + degOffset;
      const latStep = (bboxLatMax - bboxLatMin) / gridSize;
      const lonStep = (bboxLonMax - bboxLonMin) / gridSize;
      const points: { lat: number; lon: number; row: number; col: number }[] = [];
      for (let row = 0; row <= gridSize; row++) {
        for (let col = 0; col <= gridSize; col++) {
          const ptLat = bboxLatMin + row * latStep;
          const ptLon = bboxLonMin + col * lonStep;
          if (polyStr && !pointInPolygon(ptLat, ptLon, polyStr)) continue;
          points.push({ lat: ptLat, lon: ptLon, row, col });
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
          const cellLat = bboxLatMin + sr.row * latStep;
          const cellLon = bboxLonMin + sr.col * lonStep;
          const halfLat = latStep / 2;
          const halfLon = lonStep / 2;
          const cellCorners: [number, number][] = [
            [cellLon - halfLon, cellLat - halfLat],
            [cellLon + halfLon, cellLat - halfLat],
            [cellLon + halfLon, cellLat + halfLat],
            [cellLon - halfLon, cellLat + halfLat],
          ];
          if (polyStr && !clipPolygonCellToPolygon(cellCorners, polyStr)) continue;
          features.push({
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [[...cellCorners, cellCorners[0]]],
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
    const { lat, lon, radius, polygon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat and lon required" });
    const clat = Number(lat), clon = Number(lon);
    const r = Number(radius) || 3000;
    const degOffset = r / 111000;
    const polyStr = polygon as string | undefined;
    const polyBbox = parseBboxFromPolygon(polyStr);

    try {
      const gridRes = 20;
      const latMin = polyBbox ? polyBbox.latMin : clat - degOffset;
      const latMax = polyBbox ? polyBbox.latMax : clat + degOffset;
      const lonMin = polyBbox ? polyBbox.lonMin : clon - degOffset;
      const lonMax = polyBbox ? polyBbox.lonMax : clon + degOffset;
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
      if (polyStr) {
        const clippedFeatures: any[] = [];
        for (const f of contourFeatures.features) {
          if (!f.geometry?.coordinates) continue;
          const clipped = clipLineToPolygon(f.geometry.coordinates as [number, number][], polyStr);
          for (const segment of clipped) {
            if (segment.length >= 2) {
              clippedFeatures.push({
                ...f,
                geometry: { type: "LineString", coordinates: segment },
              });
            }
          }
        }
        contourFeatures.features = clippedFeatures;
      }
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

function parseBboxFromPolygon(polygonParam?: string): { latMin: number; latMax: number; lonMin: number; lonMax: number } | null {
  if (!polygonParam) return null;
  try {
    const coords: [number, number][] = JSON.parse(polygonParam);
    if (!Array.isArray(coords) || coords.length < 3) return null;
    const lats = coords.map(c => c[0]);
    const lons = coords.map(c => c[1]);
    return {
      latMin: Math.min(...lats),
      latMax: Math.max(...lats),
      lonMin: Math.min(...lons),
      lonMax: Math.max(...lons),
    };
  } catch {
    return null;
  }
}

function pointInPolygon(lat: number, lon: number, polygonParam?: string): boolean {
  if (!polygonParam) return true;
  try {
    const coords: [number, number][] = JSON.parse(polygonParam);
    if (!Array.isArray(coords) || coords.length < 3) return true;
    let inside = false;
    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
      const [yi, xi] = coords[i];
      const [yj, xj] = coords[j];
      if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  } catch {
    return true;
  }
}

function clipLineToPolygon(line: [number, number][], polygonParam: string): [number, number][][] {
  let coords: [number, number][];
  try {
    coords = JSON.parse(polygonParam);
    if (!Array.isArray(coords) || coords.length < 3) return [line];
  } catch {
    return [line];
  }

  const isInside = (lon: number, lat: number) => {
    let inside = false;
    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
      const [yi, xi] = coords[i];
      const [yj, xj] = coords[j];
      if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  };

  const segments: [number, number][][] = [];
  let current: [number, number][] = [];
  for (const [lon, lat] of line) {
    if (isInside(lon, lat)) {
      current.push([lon, lat]);
    } else {
      if (current.length >= 2) segments.push(current);
      current = [];
    }
  }
  if (current.length >= 2) segments.push(current);
  return segments.length > 0 ? segments : [];
}

function clipPolygonCellToPolygon(cellCoords: [number, number][], polygonParam: string): boolean {
  let coords: [number, number][];
  try {
    coords = JSON.parse(polygonParam);
    if (!Array.isArray(coords) || coords.length < 3) return true;
  } catch {
    return true;
  }

  const isInside = (lon: number, lat: number) => {
    let inside = false;
    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
      const [yi, xi] = coords[i];
      const [yj, xj] = coords[j];
      if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  };

  return cellCoords.some(([lon, lat]) => isInside(lon, lat));
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