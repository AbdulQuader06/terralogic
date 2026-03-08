# TerraLogic AI

## Overview

TerraLogic AI is an AI-powered GIS spatial analysis platform designed to evaluate construction site suitability. It leverages real spatial data from various sources (OSM, FEMA, SoilGrids, Open-Meteo) and integrates AI-generated insights. The platform features a multi-model AI chatbot, an interactive QuickOSM query builder, OpenCity India data integration, and real sun path calculations. Its core purpose is to provide comprehensive, data-driven analysis for site assessment, offering capabilities for urban planning, environmental impact assessment, and infrastructure development. The project aims to democratize access to advanced GIS capabilities through an intuitive interface and intelligent automation.

## User Preferences

The user prefers an iterative development approach, with clear communication at each stage. They value detailed explanations for complex features and architectural decisions. The user also requests that the AI agent ask for confirmation before implementing any major changes to the codebase or design.

## System Architecture

TerraLogic AI employs a modern web application architecture:

-   **Frontend**: Built with React, Vite, Tailwind CSS v4, shadcn/ui, and recharts, providing a responsive and interactive user interface.
-   **Backend**: An Express.js server handles API routes for GIS data proxying, AI chat interactions, and spatial analysis.
-   **Mapping**: Leverages Leaflet and react-leaflet, integrated with Esri ArcGIS basemaps (Dark/Light/Satellite/Road/Terrain, theme-aware auto-switching). Features include server-side geocoding (Nominatim/ArcGIS) and browser geolocation.
-   **AI Core**: A multi-model AI system utilizing Replit AI Integrations with automatic fallback. It includes Google Gemini 2.5 Flash (primary for general GIS analysis), specialized personas like MapGPT and CompassAI (Gemini-backed for geospatial and terrain expertise), OpenAI GPT-4o mini for general purpose tasks, and a rule-based TerraLogic Local GIS for always-available fallback.
-   **CartoAI Chatbot**: A Gemini 2.5 Flash function-calling chatbot with a triple-expert persona (Licensed Urban Planner + Real Estate Investment Analyst + Registered Architect). Features tools for map navigation (`update_map_view`), overlays (`add_marker`, `add_geojson`), querying (`search_places`, `fetch_open_data`), buffer/catchment analysis (`create_buffer`), distance measurement (`measure_distance`), and site analysis (`analyze_site`). Applies professional analysis frameworks (FAR/FSI, TOD catchment, soil bearing capacity, highest-and-best-use) and references real standards (IBC, URDPFI, LEED-ND, NBCC). Site analysis narratives are 4-paragraph professional assessments covering buildability, development feasibility, risk, and infrastructure scoring.
-   **Data Management**: Supports file import of .geojson, .json, .kml, and .csv formats up to 50MB with server-side parsing. A 20-category GIS data catalog with over 200 items is integrated.
-   **UI Layout**: A three-panel layout with a light "research poster" theme (default) with a specified color palette. It includes a header, a left panel for layer controls, QuickOSM, and AI chat, a central map viewer, and a right InsightsPanel displaying AI narratives, scores, environmental metrics, sun path data, elevation profiles, and recommendations.
-   **Drawing Tools**: Allows users to draw polygons, circles, and rectangles on the map, which spatially confine all layer fetches and QuickOSM queries to the drawn boundaries.
-   **Theme System**: Features a dark/light mode toggle with localStorage persistence, applying theme classes to the `<html>` element and using CSS variables for styling.
-   **Location Lock**: A feature to prevent accidental map clicks from changing the analysis location, with a toggle for user control.
-   **Map Export**: Custom canvas-based export functionality for PNG, JPEG, GeoJSON, KML, and DXF, including programmatic legend drawing and compositing of map elements.
-   **3D Digital Twin**: Three.js-based 3D terrain and building visualization (CAD Mapper / BIM pre-design style). Features: real elevation data (Open-Meteo), OSM building footprints (~1800+), road geometry, orbit/pan/zoom controls, building hover tooltips, color-coded building types, shadow casting with adjustable sun angle for shadow studies, terrain vertex coloring. **Interactive tools**: Navigate, Select, Add Building (12 types with configurable floors/width/depth), Delete — click-to-place buildings on terrain with ghost preview. **Property editor**: Select any building to view/edit name, type, floors, dimensions; user-placed buildings fully editable, OSM buildings have locked geometry. **Real-time metrics dashboard**: FSI/FAR, ground coverage ratio, open space ratio, total built-up area, residential/commercial area breakdown, building counts, avg/max height. **Scenario system**: Save snapshots of user-placed buildings, restore any scenario to compare development options. **WebGL detection**: Graceful fallback message when WebGL unavailable. Component: `Map3DViewer.tsx`, endpoint: `/api/3d/buildings`.

-   **BIM-GIS Hybrid Designer**: Autonomous BIM design module at `/bim` route. Dark "Command Center" theme with three-panel layout: Left (Site Selection via Leaflet mini-map with Ctrl+Drag rectangle draw, amenity mix display, site summary), Center (Three.js 3D massing viewport with navigate/place/select tools, ghost preview, interactive height sliders, orbit/pan/zoom, sun shadow study), Right (AI NBC Compliance panel with Gemini 2.5 Flash analysis against NBC 2016/URDPFI guidelines, Recharts radar chart for Solar/Structure/NBC/Transit/Green/Density axes, key metrics cards with FAR/coverage/open-space/height vs limits, investment estimates in INR). Features: click-to-place massing boxes (6 types: residential/commercial/office/mixed-use/hotel/industrial), real-time FAR/ground-coverage/open-space computation, debounced AI compliance checking with red/green status indicators, PDF "Construction Brief" export via jsPDF + html2canvas (captures 3D viewport, metrics, compliance report, radar chart). Components: `client/src/pages/BimDesigner.tsx`, `client/src/components/bim/SiteSelector.tsx`, `client/src/components/bim/BimViewport.tsx`, `client/src/components/bim/CompliancePanel.tsx`, `client/src/components/bim/MetricsDashboard.tsx`. Backend: `POST /api/bim/compliance`.

## External Dependencies

-   **Mapping Services**: Esri ArcGIS (basemaps, geocoding, FEMA NFHL flood data, World Hillshade, Sentinel-2 Land Cover), OpenStreetMap Overpass API (various spatial features).
-   **Esri Living Atlas**: World Hillshade (terrain relief), Sentinel-2 10m Land Cover (global land classification), FEMA NFHL flood zones. These render as tile overlays directly.
-   **Demographics (Global)**: Esri World Administrative Divisions + World Urban Areas + World Cities — works globally including India. Shows state/province boundaries, urban area extents, and city points with population.
-   **Soil Detail (Global)**: ISRIC SoilGrids API — clay/sand/silt percentages, pH, organic carbon, nitrogen, texture class, drainage class, hydrologic group, buildability. Samples nearby points if urban center returns null.
-   **Weather & Elevation**: Open-Meteo Elevation API (real DEM data), Open-Meteo Weather API (sunshine duration, wind speed).
-   **AI Integration**: Google Gemini API, OpenAI API.
-   **Indian Data**: OpenCity India CKAN API (data.opencity.in).
-   **Routing**: wouter (frontend), Express (backend).
-   **Geocoding**: Nominatim, Esri ArcGIS Geocoder.