import { z } from "zod";

export const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

export const chatRequestSchema = z.object({
  message: z.string().min(1),
  locationName: z.string().optional(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  history: z.array(chatMessageSchema).optional(),
  model: z.enum(["gemini", "mapgpt", "compass", "chatgpt", "auto"]).optional(),
});

export const analyzeRequestSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  name: z.string(),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;

export interface SiteAnalysis {
  overallScore: number;
  rating: string;
  factors: {
    name: string;
    value: number;
    category: "risk" | "benefit";
  }[];
  amenities: {
    schools: number;
    transitStops: number;
    hospitals: number;
    parks: number;
  };
  alerts: {
    type: "warning" | "success" | "info";
    title: string;
    description: string;
  }[];
  siteInfo: {
    coordinates: { lat: number; lon: number };
    elevation: number;
    elevationUnit: string;
    zoning: string;
  };
  environmentalMetrics: {
    sunExposure: number;
    soilQuality: number;
    windExposure: number;
    floodRisk: string;
  };
  elevationProfile: { distance: number; elevation: number }[];
  radarData: {
    solar: number;
    soil: number;
    wind: number;
    water: number;
    access: number;
  };
  recommendations: {
    type: "success" | "warning" | "info";
    title: string;
    description: string;
  }[];
  developmentDensity: {
    densityIndex: number;
    densityLabel: string;
    buildingFootprint: number;
    infrastructureCoverage: number;
  };
  landUseMix?: { label: string; value: number; color: string }[];
  amenityMix?: { label: string; value: number; color: string }[];
  aiNarrative?: string;
  sunPathData?: {
    sunrise: string;
    sunset: string;
    dayLength: number;
    solarNoon: string;
    maxAltitude: number;
    azimuthRange: { min: number; max: number };
  };
}

export type Role = "admin" | "user";

export interface PublicUser {
  id: string;
  email: string;
  role: Role;
  createdAt: number;
  lastLoginAt: number | null;
}

