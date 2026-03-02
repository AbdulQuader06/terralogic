# TerraLogic AI

AI-powered GIS spatial analysis platform with dark Figma-matched UI. Evaluates construction site suitability using real spatial data layers (OSM, FEMA, USGS, USDA) and Gemini AI chatbot.

## Architecture

- **Frontend**: React + Vite + Tailwind CSS v4 + shadcn/ui + recharts
- **Backend**: Express.js with API routes for GIS data proxying and AI chat
- **Map**: Leaflet + react-leaflet with CartoDB dark_all basemap, ArcGIS geocoding
- **AI**: Google Gemini 2.0 Flash (server-side) for conversational spatial analysis
- **GIS Data Sources**: OpenStreetMap (Overpass API), FEMA NFHL, USGS Elevation, USDA Soil
- **Routing**: wouter (frontend), Express (backend API)
- **Storage**: In-memory (MemStorage) for analysis caching

## UI Layout

Three-panel dark theme layout:
- **Header**: TerraLogic AI logo, project location selector, Hyderabad Case Study button, Export Report button
- **Left Panel** (280px): Project Overview heading, ArcGIS geocoder search input, tabbed Data Layers/AI Assistant, footer with active layer count and analysis status
- **Center**: Leaflet dark map with CartoDB basemap, custom zoom/coordinate/fullscreen controls, GeoJSON layer rendering for 10 data layers
- **Right Panel** (320px): Scrollable InsightsPanel with circular score gauge, development density analysis, site information, 2x2 environmental metrics grid, elevation profile AreaChart, radar chart, AI recommendation cards

## Key Files

- `client/src/pages/Home.tsx` - Main three-panel layout with header, search, tabs
- `client/src/components/MapViewer.tsx` - Leaflet dark map with custom controls and GeoJSON layers
- `client/src/components/InsightsPanel.tsx` - Full analysis dashboard with recharts
- `client/src/components/ChatPanel.tsx` - AI chatbot in left panel tab
- `client/src/components/LayerControls.tsx` - Dark-themed layer toggle cards with icons
- `server/routes.ts` - Real GIS data analysis + 10 layer proxy endpoints + Gemini chat
- `server/storage.ts` - In-memory storage for site analyses
- `shared/schema.ts` - Zod schemas and TypeScript types (SiteAnalysis interface)
- `client/src/index.css` - Dark theme CSS variables and Leaflet dark styling

## API Endpoints

- `GET /api/config` - Returns ArcGIS API key
- `POST /api/analyze` - Real GIS data aggregation: USGS elevation, FEMA flood, USDA soil, OSM amenities → suitability score, environmental metrics, radar data, recommendations
- `POST /api/chat` - AI chat via Gemini with site context injection
- `GET /api/layers/{schools,hospitals,transit,parks,landuse,water,flood,soil,elevation,infrastructure}` - GIS layer data endpoints

## Environment Variables

- `ARCGIS_API_KEY` - ArcGIS API key for geocoding search
- `GEMINI_API_KEY` - Google Gemini API key for AI chat

## Color Palette (Dark Theme)

- Primary: #00C853 (emerald green, hsl 145 100% 39%)
- Background: ~#0B1010 (hsl 160 14% 5%)
- Card/Panel: ~#111916 (hsl 150 19% 8%)
- Foreground: ~#E8EDEB (hsl 150 12% 92%)
- Muted: ~#7A8A82 (hsl 150 7% 51%)
- Border: ~#1C2A23 (hsl 150 20% 14%)
- Warning: #F59E0B (amber)

## Dependencies

- leaflet, react-leaflet, @types/leaflet (map with GeoJSON)
- recharts (AreaChart, RadarChart for analysis dashboard)
- @google/generative-ai (Gemini API, server-side only)
- lucide-react (icons)
- @tanstack/react-query (data fetching)
- wouter (client routing)
