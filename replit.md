# Aino Spatial Analysis

AI-powered GIS site analysis platform that evaluates construction site suitability using spatial data layers and conversational AI insights.

## Architecture

- **Frontend**: React + Vite + Tailwind CSS v4 + shadcn/ui components
- **Backend**: Express.js with API routes
- **Map**: Leaflet + react-leaflet with ArcGIS basemap tiles and geocoding
- **AI**: Google Gemini API (server-side) for conversational spatial analysis
- **Routing**: wouter (frontend), Express (backend API)

## Key Files

- `client/src/pages/Home.tsx` - Main dashboard layout with resizable panels
- `client/src/components/MapViewer.tsx` - Leaflet map with ArcGIS tiles + search
- `client/src/components/ChatPanel.tsx` - AI chatbot panel (calls /api/chat)
- `client/src/components/InsightsPanel.tsx` - Site analysis scores (calls /api/analyze)
- `client/src/components/LayerControls.tsx` - Data layer toggle controls
- `server/routes.ts` - API routes: /api/config, /api/analyze, /api/chat
- `server/storage.ts` - In-memory storage for site analyses
- `shared/schema.ts` - Zod schemas for chat/analyze requests, SiteAnalysis type

## Environment Variables

- `ARCGIS_API_KEY` - ArcGIS API key for basemaps and geocoding
- `GEMINI_API_KEY` - Google Gemini API key for AI chat

## Color Palette

- Primary: #2C3E50 (slate blue)
- Secondary: #3498DB (bright blue)
- Accent: #27AE60 (success green)
- Destructive: #E74C3C (alert red)
- Background: #FFFFFF, Panel: #F8F9FA

## Dependencies

- leaflet, react-leaflet, @types/leaflet (map rendering)
- @google/generative-ai (Gemini API, server-side only)
- framer-motion, lucide-react, recharts (UI)
