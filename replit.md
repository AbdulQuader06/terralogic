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

## External Dependencies

-   **Mapping Services**: Esri ArcGIS (basemaps, geocoding, FEMA flood data), OpenStreetMap Overpass API (various spatial features).
-   **Weather & Elevation**: Open-Meteo Elevation API (real DEM data), Open-Meteo Weather API (sunshine duration, wind speed).
-   **Soil Data**: SoilGrids ISRIC API (WRB soil classification).
-   **AI Integration**: Google Gemini API, OpenAI API.
-   **Indian Data**: OpenCity India CKAN API (data.opencity.in).
-   **Routing**: wouter (frontend), Express (backend).
-   **Geocoding**: Nominatim.