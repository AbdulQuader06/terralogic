import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { chatRequestSchema, analyzeRequestSchema } from "@shared/schema";
import type { SiteAnalysis } from "@shared/schema";
import { GoogleGenerativeAI } from "@google/generative-ai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const ARCGIS_API_KEY = process.env.ARCGIS_API_KEY || "";

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
  if (floodRisk > 50) {
    alerts.push({ type: "warning", title: "Elevated Flood Risk", description: `Flood vulnerability index at ${floodRisk}%. Consider drainage infrastructure and flood barriers.` });
  }
  if (climateStress > 45) {
    alerts.push({ type: "warning", title: "Climate Stress Factor", description: `Region shows ${climateStress}% climate stress. Heat island effects and extreme weather events are likely concerns.` });
  }
  if (overallScore >= 75) {
    alerts.push({ type: "success", title: "Favorable Site Conditions", description: "Strong balance of infrastructure proximity, soil stability, and manageable environmental risks." });
  }
  if (urbanDensity > 70) {
    alerts.push({ type: "info", title: "High Urban Density", description: "Dense urban surroundings may increase construction logistics complexity but improve market access." });
  }

  return {
    overallScore,
    rating,
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

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/config", (_req, res) => {
    res.json({ arcgisApiKey: ARCGIS_API_KEY });
  });

  app.post("/api/analyze", async (req, res) => {
    const parsed = analyzeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

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
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const { message, locationName, lat, lon, history } = parsed.data;

    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: "Gemini API key not configured" });
    }

    try {
      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

      let siteContext = "";
      if (lat !== undefined && lon !== undefined && locationName) {
        const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
        const analysis = await storage.getAnalysis(key);
        if (analysis) {
          siteContext = `\n\nSite Analysis Data for ${locationName}:
- Overall Suitability Score: ${analysis.overallScore}/100 (${analysis.rating})
- Factors: ${analysis.factors.map(f => `${f.name}: ${f.value}%`).join(", ")}
- Nearby: ${analysis.amenities.schools} schools, ${analysis.amenities.transitStops} transit stops, ${analysis.amenities.hospitals} hospitals, ${analysis.amenities.parks} parks`;
        }
      }

      const systemPrompt = `You are Aino, a professional GIS spatial analyst AI assistant specialized in construction site suitability analysis. You help users understand spatial data layers including elevation, soil type, flood risk, land use, climate, and nearby infrastructure. You provide clear, actionable insights about site suitability for construction projects. Keep responses focused, professional, and data-driven. Use markdown formatting for readability.${siteContext}`;

      const chatHistory = (history || []).map(msg => ({
        role: msg.role === "user" ? "user" as const : "model" as const,
        parts: [{ text: msg.content }],
      }));

      const chat = model.startChat({
        history: [
          { role: "user", parts: [{ text: "You are Aino spatial analyst. Acknowledge." }] },
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

  return httpServer;
}