# TerraLogic AI

AI-powered GIS spatial analysis platform with dark Figma-matched UI. Evaluates construction site suitability using real spatial data layers (OSM, FEMA, SoilGrids ISRIC, Open-Meteo) combined with AI-generated insights. Includes multi-model AI chatbot (Gemini, MapGPT, CompassAI, ChatGPT), QuickOSM interactive query builder, OpenCity India data integration, and real sun path calculations.

## Architecture

- **Frontend**: React + Vite + Tailwind CSS v4 + shadcn/ui + recharts
- **Backend**: Express.js with API routes for GIS data proxying, AI chat, and analysis
- **Map**: Leaflet + react-leaflet with Esri ArcGIS basemaps (Dark/Light/Satellite/Road/Terrain switcher, theme-aware auto-switch), server-side geocoding (Nominatim/ArcGIS)
- **AI Models**: Multi-model system with automatic fallback:
  - Google Gemini 2.0 Flash (primary) — general GIS analysis
  - MapGPT persona (Gemini-backed) — geospatial specialist
  - CompassAI persona (Gemini-backed) — navigation & terrain specialist
  - OpenAI GPT-4o mini (optional fallback) — general purpose
  - TerraLogic Local GIS (always-available fallback) — rule-based responses from real GIS data
- **GIS Data Sources**:
  - OpenStreetMap Overpass API (schools, hospitals, transit, parks, landuse, water, infrastructure)
  - FEMA NFHL (flood zones via ArcGIS feature layer)
  - Open-Meteo Elevation API (real DEM elevation, multi-point profiles, marching squares contours)
  - Open-Meteo Weather API (real sunshine_duration, windspeed_10m_max for sun/wind exposure)
  - SoilGrids ISRIC API (WRB soil classification: Cambisols, Luvisols, etc.)
  - Astronomical sun path calculations (sunrise, sunset, solar noon, altitude, azimuth)
  - OpenCity India CKAN API (data.opencity.in) for Indian city datasets
- **Routing**: wouter (frontend), Express (backend API)
- **Storage**: In-memory (MemStorage) for analysis caching

## UI Layout

Three-panel dark theme layout:
- **Header**: TerraLogic AI logo, project location selector, Case Study button (Hyderabad demo), dark/light theme toggle, Export Map (PNG) button, Export Report button
- **Left Panel** (300px): Project Overview heading, geocoder search input, three tabs (Layers | QuickOSM | AI):
  - **Layers tab**: Dark-themed layer toggle cards with icons for 10 data layers
  - **QuickOSM tab**: Interactive OSM query builder + OpenCity India CKAN data browser
  - **AI tab**: Multi-model chatbot with model selector dropdown (Gemini/MapGPT/CompassAI/ChatGPT/Auto)
  - **Custom Overlays section**: Lists loaded QuickOSM/OpenCity overlays with remove buttons
  - Footer: Active layer count and analysis status
- **Center**: Leaflet map with Esri ArcGIS basemaps (Dark/Light/Satellite/Road/Terrain with label overlays, auto-switches with theme), custom zoom/coordinate/fullscreen controls, basemap picker UI, Esri identify popup on click (reverse geocode + layer info), drawing tools (polygon/circle/rectangle) for region-based filtering, GeoJSON layer rendering for 10 data layers + custom overlays
- **Right Panel** (320px): Scrollable InsightsPanel with:
  - AI narrative (Gemini-generated or fallback data summary)
  - Circular SVG score gauge
  - Development density analysis
  - Site information (real elevation)
  - 2x2 environmental metrics grid
  - Sun Path Data section (sunrise, sunset, day length, solar noon, max altitude, azimuth range)
  - Elevation profile AreaChart (real multi-point data)
  - Radar chart (Solar, Soil, Wind, Water, Access)
  - AI recommendation cards

## Key Files

- `client/src/pages/Home.tsx` - Main three-panel layout with header, search, 3 tabs, custom overlay management
- `client/src/components/MapViewer.tsx` - Leaflet dark map with custom controls, GeoJSON layers, custom overlay rendering
- `client/src/components/InsightsPanel.tsx` - Full analysis dashboard with AI narrative, sun path, recharts
- `client/src/components/ChatPanel.tsx` - Multi-model AI chatbot with model selector dropdown
- `client/src/components/LayerControls.tsx` - Dark-themed layer toggle cards with icons
- `client/src/components/QuickOSM.tsx` - QuickOSM query builder + OpenCity India data browser
- `server/routes.ts` - Real GIS data analysis + multi-model AI + layer endpoints + QuickOSM + OpenCity + geocoding
- `server/storage.ts` - In-memory storage for site analyses
- `shared/schema.ts` - Zod schemas and TypeScript types (SiteAnalysis with aiNarrative, sunPathData)
- `client/src/lib/theme.tsx` - ThemeProvider context + useTheme hook, localStorage persistence
- `client/src/index.css` - Dark/light theme CSS variables, Leaflet theming, map control CSS custom properties

## API Endpoints

- `GET /api/config` - Returns ArcGIS API key
- `GET /api/esri/identify?lat=&lon=` - Esri reverse geocode + World Topo Map + World Imagery identify for clicked location
- `GET /api/geocode?q=` - Server-side geocoding (Nominatim primary, ArcGIS fallback)
- `POST /api/analyze` - Real GIS data aggregation + AI narrative + sun path → suitability score, environmental metrics, elevation profile, radar data, recommendations
- `GET /api/chat/models` - Returns available AI models and their status
- `POST /api/chat` - Multi-model AI chat with auto-analysis generation if not cached; model field: "gemini", "mapgpt", "compass", "chatgpt", "auto"
- `GET /api/layers/{schools,hospitals,transit,parks,landuse,water,flood,soil,elevation,infrastructure}` - GIS layer data endpoints
- `POST /api/quickosm` - Interactive Overpass query (sanitized, max 25km radius)
- `GET /api/opencity/search?q=&city=&rows=` - Search OpenCity India CKAN datasets
- `GET /api/opencity/resource/:id` - Fetch and convert OpenCity resource

## Data Pipeline (generateSiteAnalysis)

Uses 2 combined Overpass queries + 3 parallel API calls + sun path + AI narrative:
1. `fetchOverpassCombined()` - Single query for all point data (schools, hospitals, transit, infrastructure)
2. `fetchOverpassGeoCombined()` - Single query for all polygon data (parks, landuse, flood, water)
3. SoilGrids ISRIC API - WRB soil classification
4. Open-Meteo Elevation API - 11-point transect for elevation profile
5. Open-Meteo Weather API - 30-day sunshine_duration & windspeed_10m_max
6. `calculateSunPath()` - Astronomical sunrise/sunset/altitude/azimuth
7. Gemini AI narrative generation (with data-driven fallback)

## AI Chatbot System

- **Multi-model architecture**: Gemini, MapGPT, CompassAI, ChatGPT with automatic fallback chain
- **Natural language intent classification**: Uses topic scoring across 15 categories (transit, flood, soil, solar, wind, elevation, infrastructure, density, recommendations, overview, landuse, water, parks, schools, hospitals) instead of rigid keyword matching
- **Conversation history awareness**: Follow-up questions with pronouns ("show them on the map", "tell me more") resolve to previous conversation topic
- **Map layer actions**: Chat can return `action: {type: "toggleLayer", layer: "transit"}` which the frontend processes to enable/disable map layers automatically
- **Model personas**: MapGPT ("From a geospatial perspective...") and CompassAI ("Looking at the terrain and navigation data...") have distinct voices even in local fallback mode
- **Always-available models**: MapGPT, CompassAI, and Auto are always available — they use Gemini when API is available, otherwise fall back to persona-flavored local GIS engine
- **Auto-analysis**: Chat endpoint auto-generates site analysis if not cached
- **Overpass mirror fallback**: All Overpass API calls try 3 mirror endpoints (overpass-api.de, kumi.systems, maps.mail.ru) for reliability
- **Draw-to-filter**: Users can draw polygon/circle/rectangle on the map; all layer fetches and QuickOSM queries use Overpass `poly:` filter to constrain results to the drawn area. Without drawing, default `around:radius` is used.

## Environment Variables

- `ARCGIS_API_KEY` - ArcGIS API key for geocoding fallback and FEMA flood data
- `GEMINI_API_KEY` - Google Gemini API key for AI chat and narrative generation
- `OPENAI_API_KEY` - (Optional) OpenAI API key for ChatGPT fallback

## Theme System

Dark/Light mode toggle with localStorage persistence (`terralogic-theme` key). ThemeProvider at `client/src/lib/theme.tsx` wraps App with `useTheme()` hook exposing `{ theme, toggleTheme, isDark }`.

- Theme class (`.dark` / `.light`) set on `<html>` element
- All CSS variables defined per-theme in `client/src/index.css`
- Map controls, legend, popups, tooltips use CSS custom properties (`--map-ctrl-bg`, `--map-ctrl-text`, etc.)
- Recharts use theme-derived colors via `useTheme()` in InsightsPanel
- Header has sun/moon toggle button + "Case Study" button (loads Hyderabad, India)

### Dark Theme Colors
- Primary: #00C853 (emerald green)
- Background: ~#0B1010 (very dark green-black)
- Card/Panel: ~#111916
- Foreground: ~#E8EDEB (light gray)
- Muted: ~#7A8A82
- Border: ~#1C2A23
- Warning: #F59E0B (amber)

### Light Theme Colors
- Primary: hsl(145 80% 36%)
- Background: ~#F9FBF9 (near white with green tint)
- Card: white
- Foreground: ~#1A2E1F (dark green)
- Muted text: hsl(150 8% 45%)
- Border: hsl(150 12% 88%)
