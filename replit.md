# TerraLogic AI

AI-powered GIS site analysis platform that evaluates construction site suitability using real spatial data layers and conversational AI insights.

## Architecture

- **Frontend**: React + Vite + Tailwind CSS v4 + shadcn/ui components
- **Backend**: Express.js with API routes for GIS data proxying and AI chat
- **Map**: Leaflet + react-leaflet with ArcGIS basemap tiles and geocoding
- **AI**: Google Gemini API (server-side) for conversational spatial analysis
- **GIS Data Sources**: OpenStreetMap (Overpass API), FEMA NFHL, USGS Elevation, USDA Soil
- **Routing**: wouter (frontend), Express (backend API)

## Key Files

- `client/src/pages/Home.tsx` - Main dashboard layout with resizable panels
- `client/src/components/MapViewer.tsx` - Leaflet map with GeoJSON layer rendering
- `client/src/components/ChatPanel.tsx` - AI chatbot panel (calls /api/chat)
- `client/src/components/InsightsPanel.tsx` - Site analysis scores (calls /api/analyze)
- `client/src/components/LayerControls.tsx` - Data layer toggle controls with source badges
- `server/routes.ts` - API routes including 10 GIS layer proxy endpoints
- `server/storage.ts` - In-memory storage for site analyses
- `shared/schema.ts` - Zod schemas and TypeScript types

## API Endpoints

- `GET /api/config` - Returns ArcGIS API key
- `POST /api/analyze` - Generate site suitability analysis
- `POST /api/chat` - AI chat via Gemini
- `GET /api/layers/schools` - Schools from OSM
- `GET /api/layers/hospitals` - Healthcare from OSM
- `GET /api/layers/transit` - Transit stops from OSM
- `GET /api/layers/parks` - Parks from OSM
- `GET /api/layers/landuse` - Land use from OSM
- `GET /api/layers/water` - Water bodies from OSM
- `GET /api/layers/flood` - Flood zones from FEMA
- `GET /api/layers/soil` - Soil data from USDA (with fallback)
- `GET /api/layers/elevation` - Elevation from USGS
- `GET /api/layers/infrastructure` - Roads/services from OSM

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

- leaflet, react-leaflet, @types/leaflet (map rendering with GeoJSON)
- @google/generative-ai (Gemini API, server-side only)
- framer-motion, lucide-react, recharts (UI)
