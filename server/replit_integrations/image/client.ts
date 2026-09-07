import { GoogleGenAI, Modality } from "@google/genai";

const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

function envOr(first: string, second: string, fallback = ""): string {
  const a = process.env[first];
  const b = process.env[second];
  if (a && a.trim().length > 0) return a.trim();
  if (b && b.trim().length > 0) return b.trim();
  return fallback;
}

const IMG_GEMINI_KEY = envOr("AI_INTEGRATIONS_GEMINI_API_KEY", "GEMINI_API_KEY");
const IMG_GEMINI_BASE = envOr("AI_INTEGRATIONS_GEMINI_BASE_URL", "GEMINI_BASE_URL", DEFAULT_GEMINI_BASE_URL);
const usingReplitProxy = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL && process.env.AI_INTEGRATIONS_GEMINI_BASE_URL !== DEFAULT_GEMINI_BASE_URL;

let ai: GoogleGenAI | null = null;
if (IMG_GEMINI_KEY) {
  try {
    const opts: any = { apiKey: IMG_GEMINI_KEY };
    if (usingReplitProxy) {
      opts.httpOptions = { apiVersion: "", baseUrl: IMG_GEMINI_BASE };
    } else if (IMG_GEMINI_BASE) {
      opts.httpOptions = { baseUrl: IMG_GEMINI_BASE };
    }
    ai = new GoogleGenAI(opts);
  } catch (e) {
    console.warn("[image/client] Gemini client init failed:", (e as Error).message);
  }
}

/**
 * Generate an image and return as base64 data URL.
 * Uses gemini-2.5-flash-image model via Replit AI Integrations.
 */
export async function generateImage(prompt: string): Promise<string> {
  if (!ai) {
    throw new Error("Gemini AI Integration not configured — check API key settings.");
  }
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseModalities: [Modality.TEXT, Modality.IMAGE],
    },
  });

  const candidate = response.candidates?.[0];
  const imagePart = candidate?.content?.parts?.find(
    (part: { inlineData?: { data?: string; mimeType?: string } }) => part.inlineData
  );

  if (!imagePart?.inlineData?.data) {
    throw new Error("No image data in response");
  }

  const mimeType = imagePart.inlineData.mimeType || "image/png";
  return `data:${mimeType};base64,${imagePart.inlineData.data}`;
}

