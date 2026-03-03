# TerraLogic AI

AI-powered GIS spatial analysis platform with dark Figma-matched UI. Evaluates construction site suitability using real spatial data layers (OSM, FEMA, SoilGrids ISRIC, Open-Meteo) and Gemini AI chatbot. Includes QuickOSM interactive query builder and OpenCity India data integration.

## Architecture

- **Frontend**: React + Vite + Tailwind CSS v4 + shadcn/ui + recharts
- **Backend**: Express.js with API routes for GIS data proxying and AI chat
- **Map**: Leaflet + react-leaflet with CartoDB dark_all basemap, server-side geocoding (Nominatim/ArcGIS)
- **AI**: Google Gemini 2.0 Flash (server-side) for conversational spatial analysis
- **GIS Data Sources**:
  - OpenStreetMap Overpass API (schools, hospitals, transit, parks, landuse, water, infrastructure)
  - FEMA NFHL (flood zones via ArcGIS feature layer)
  - Open-Meteo Elevation API (real DEM elevation, multi-point profiles, marching squares contours)
  - Open-Meteo Weather API (real sunshine_duration, windspeed_10m_max for sun/wind exposure)
  - SoilGrids ISRIC API (WRB soil classification: Cambisols, Luvisols, etc.)
  - USDA Soil (fallback grid generation)
  - Nominatim/ArcGIS (geocoding)
  - OpenCity India CKAN API (data.opencity.in) for Indian city datasets (water bodies, bus stops, ward boundaries, etc.)
- **Routing**: wouter (frontend), Express (backend API)
- **Storage**: In-memory (MemStorage) for analysis caching

## UI Layout

Three-panel dark theme layout:
- **Header**: TerraLogic AI logo, project location selector, Hyderabad Case Study button, Export Report button
- **Left Panel** (300px): Project Overview heading, geocoder search input, three tabs (Layers | QuickOSM | AI):
  - **Layers tab**: Dark-themed layer toggle cards with icons for 10 data layers
  - **QuickOSM tab**: Interactive OSM query builder with tag key/value inputs, radius control, 16 preset queries (buildings, roads, restaurants, ATMs, fuel, shops, hotels, etc.) + OpenCity India sub-tab for CKAN data search with quick categories
  - **AI tab**: Gemini chatbot with site context
  - **Custom Overlays section**: Lists loaded QuickOSM/OpenCity overlays with remove buttons
  - Footer: Active layer count and analysis status
- **Center**: Leaflet dark map with CartoDB basemap, custom zoom/coordinate/fullscreen controls, GeoJSON layer rendering for 10 data layers + custom overlays (contour lines for elevation, WRB colored regions for soil)
- **Right Panel** (320px): Scrollable InsightsPanel with circular SVG score gauge, development density analysis, site information (real elevation), 2x2 environmental metrics grid, elevation profile AreaChart (real multi-point data), radar chart, AI recommendation cards

## Key Files

- `client/src/pages/Home.tsx` - Main three-panel layout with header, search, 3 tabs, custom overlay management
- `client/src/components/MapViewer.tsx` - Leaflet dark map with custom controls, GeoJSON layers, custom overlay rendering
- `client/src/components/InsightsPanel.tsx` - Full analysis dashboard with recharts
- `client/src/components/ChatPanel.tsx` - AI chatbot in left panel tab
- `client/src/components/LayerControls.tsx` - Dark-themed layer toggle cards with icons
- `client/src/components/QuickOSM.tsx` - QuickOSM query builder + OpenCity India data browser
- `server/routes.ts` - Real GIS data analysis + 10 layer proxy endpoints + QuickOSM + OpenCity + Gemini chat + geocoding
- `server/storage.ts` - In-memory storage for site analyses
- `shared/schema.ts` - Zod schemas and TypeScript types (SiteAnalysis interface)
- `client/src/index.css` - Dark theme CSS variables, Leaflet dark styling, contour label styles

## API Endpoints

- `GET /api/config` - Returns ArcGIS API key
- `GET /api/geocode?q=` - Server-side geocoding (Nominatim primary, ArcGIS fallback)
- `POST /api/analyze` - Real GIS data aggregation: Combined Overpass queries (2 requests instead of 8+) + Open-Meteo elevation + Open-Meteo weather + SoilGrids WRB → suitability score, environmental metrics, real elevation profile, radar data, recommendations
- `POST /api/chat` - AI chat via Gemini with site context injection
- `GET /api/layers/{schools,hospitals,transit,parks,landuse,water,flood,soil,elevation,infrastructure}` - GIS layer data endpoints
- `POST /api/quickosm` - Interactive Overpass query with key/value/radius, returns GeoJSON (sanitized inputs, max 25km radius)
- `GET /api/opencity/search?q=&city=&rows=` - Search OpenCity India CKAN datasets
- `GET /api/opencity/resource/:id` - Fetch and convert OpenCity resource (GeoJSON passthrough, CSV→GeoJSON with lat/lon detection)

## Data Pipeline (generateSiteAnalysis)

Uses 2 combined Overpass queries + 3 parallel API calls (total 5 requests instead of 11+):
1. `fetchOverpassCombined()` - Single query for all point data (schools, hospitals, transit, infrastructure)
2. `fetchOverpassGeoCombined()` - Single query for all polygon data (parks, landuse, flood, water)
3. SoilGrids ISRIC API - WRB soil classification
4. Open-Meteo Elevation API - 11-point transect for elevation profile
5. Open-Meteo Weather API - 30-day sunshine_duration & windspeed_10m_max

Results are filtered by tag locally to extract amenity counts, flood/water features, parks, and landuse data.

## QuickOSM Feature

- Interactive Overpass query builder with custom key/value tag inputs
- 16 presets: Buildings, Roads, Restaurants, ATMs, Petrol Pumps, Places of Worship, Shops, Hotels, Railway Lines, Power Lines, Pipelines, Bridges, Boundary Walls, Temples, Drinking Water, Toilets
- Radius control (100m-25km, default 5km)
- Results render as colored GeoJSON overlays on the map with tooltips
- Input sanitization: strips special chars, max 64 char length, prevents Overpass injection

## OpenCity India Integration

- CKAN API at data.opencity.in for Indian city open data
- 10 quick categories: Water Bodies, Microwatersheds, Bus Stops, Police Stations, Schools, Ward Info, Fire Stations, Slums, Air Quality, Rainfall Data
- Supports GeoJSON (direct map overlay), CSV (auto-converts to GeoJSON if lat/lon columns found), KML (info message)
- Expandable dataset cards showing resources with format badges and load buttons

## Environment Variables

- `ARCGIS_API_KEY` - ArcGIS API key for geocoding fallback and FEMA flood data
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

- leaflet, react-leaflet, @types/leaflet (map with GeoJSON contour/soil rendering)
- recharts (AreaChart, RadarChart for analysis dashboard)
- @google/generative-ai (Gemini API, server-side only)
- lucide-react (icons)
- @tanstack/react-query (data fetching)
- wouter (client routing)

## Layer System

- Layer toggle uses `e.stopPropagation()` on Switch to prevent double-toggle
- `layerDataRef` tracks fetched cache keys to prevent stale closure re-fetches
- Elevation layer: contour LineStrings with major/minor styling (Open-Meteo → marching squares)
- Soil layer: WRB soil type colored polygons (SoilGrids ISRIC API for classification data)
- Flood layer: OSM floodplains + elevation-based risk model + FEMA NFHL fallback (works globally)
- Custom overlays: QuickOSM/OpenCity GeoJSON rendered via CustomOverlayRenderer with XSS-safe tooltips
- All scores capped at 0-100 range

## Security

- QuickOSM inputs sanitized (special chars stripped, 64 char max, radius capped at 25km)
- Tooltip HTML content escaped to prevent XSS from external API data
- Overpass queries use 25s timeout to prevent resource exhaustion
