import { useEffect, useRef, useState } from "react";
import esriConfig from "@arcgis/core/config";
import Map from "@arcgis/core/Map";
import MapView from "@arcgis/core/views/MapView";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol";
import Search from "@arcgis/core/widgets/Search";
import BasemapGallery from "@arcgis/core/widgets/BasemapGallery";
import Expand from "@arcgis/core/widgets/Expand";

interface MapViewerProps {
  onLocationSelect: (lat: number, lon: number, name: string) => void;
}

export default function MapViewer({ onLocationSelect }: MapViewerProps) {
  const mapDiv = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<MapView | null>(null);

  useEffect(() => {
    if (!mapDiv.current) return;

    // Set ArcGIS API Key
    esriConfig.apiKey = "AAPTaT5D4ShH-if4MVkg4fQhEcw..21IiXJnI-CEAADItwzqO3_ZHKQqyX1eEj3kwNhD80XwI4EdhHtRIK-bVKHQGk4OaXIJJYFMmBNqElSAmVUYCSr8ISmZd6Axz9-ESEKM3tmT4HynR9KoW2dVscYjf666DvKacCanP-oCTRa62Gk6yiurw_WWz4-qHOcPfFD1sxafLFQe4QCWmqvs44Ol5-kmQ-ekdtBhDSDgoDiKaanksHRv7p6a8gEpjC6InSYphgTst9m3JqjTenNKoAT1_0aQX2Yzb";

    const graphicsLayer = new GraphicsLayer();

    const map = new Map({
      basemap: "arcgis-light-gray", // Clean, professional basemap
      layers: [graphicsLayer]
    });

    const viewInstance = new MapView({
      container: mapDiv.current,
      map: map,
      center: [-122.4194, 37.7749], // San Francisco by default
      zoom: 12,
      ui: {
        components: ["zoom", "compass", "attribution"] // minimal UI
      }
    });

    // Initial marker
    const point = new Point({
      longitude: -122.4194,
      latitude: 37.7749
    });

    const markerSymbol = new SimpleMarkerSymbol({
      color: [44, 62, 80], // Primary #2C3E50
      outline: {
        color: [255, 255, 255],
        width: 2
      },
      size: "14px"
    });

    const pointGraphic = new Graphic({
      geometry: point,
      symbol: markerSymbol
    });

    graphicsLayer.add(pointGraphic);

    // Search widget
    const searchWidget = new Search({
      view: viewInstance,
      popupEnabled: false
    });

    viewInstance.ui.add(searchWidget, {
      position: "top-right"
    });

    searchWidget.on("select-result", (event) => {
      const geometry = event.result.feature.geometry as Point;
      const name = event.result.name;
      
      graphicsLayer.removeAll();
      
      const newGraphic = new Graphic({
        geometry: geometry,
        symbol: markerSymbol
      });
      graphicsLayer.add(newGraphic);
      
      onLocationSelect(geometry.latitude, geometry.longitude, name);
    });

    // Basemap Gallery
    const basemapGallery = new BasemapGallery({
      view: viewInstance
    });
    
    const bgExpand = new Expand({
      view: viewInstance,
      content: basemapGallery,
      expandIcon: "basemap"
    });

    viewInstance.ui.add(bgExpand, "bottom-right");

    // Click to select location
    viewInstance.on("click", (event) => {
      const lat = event.mapPoint.latitude;
      const lon = event.mapPoint.longitude;
      
      graphicsLayer.removeAll();
      
      const newGraphic = new Graphic({
        geometry: event.mapPoint,
        symbol: markerSymbol
      });
      graphicsLayer.add(newGraphic);
      
      // Simple reverse geocode mockup using view's coordinates
      onLocationSelect(lat, lon, `Selected Location (${lat.toFixed(2)}, ${lon.toFixed(2)})`);
    });

    setView(viewInstance);

    return () => {
      if (viewInstance) {
        viewInstance.destroy();
      }
    };
  }, []);

  return <div className="w-full h-full bg-[#f8f9fa]" ref={mapDiv}></div>;
}