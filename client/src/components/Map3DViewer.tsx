import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { useTheme } from "@/lib/theme";

interface Map3DViewerProps {
  location: { lat: number; lon: number; name: string };
  onClose: () => void;
}

const TERRAIN_SIZE = 800;
const TERRAIN_SEGMENTS = 63;
const BUILDING_COLORS: Record<string, number> = {
  residential: 0x8ecae6,
  apartments: 0x6db3c9,
  house: 0xa8dadc,
  commercial: 0xfca311,
  retail: 0xe9c46a,
  office: 0xf4a261,
  industrial: 0xd4a373,
  warehouse: 0xc8a882,
  school: 0xb5838d,
  university: 0x9f6b99,
  hospital: 0xe63946,
  church: 0xdda0dd,
  mosque: 0xbcead5,
  temple: 0xf3d5b5,
  hotel: 0xe9c46a,
  yes: 0xc8d6e5,
};

function getDefaultHeight(type: string, levels?: number): number {
  if (levels && levels > 0) return levels * 3;
  switch (type) {
    case "apartments": return 15 + Math.random() * 20;
    case "commercial": case "office": return 12 + Math.random() * 25;
    case "industrial": case "warehouse": return 8 + Math.random() * 4;
    case "hospital": return 12 + Math.random() * 8;
    case "hotel": return 18 + Math.random() * 15;
    case "school": case "university": return 8 + Math.random() * 6;
    case "church": case "mosque": case "temple": return 10 + Math.random() * 8;
    case "house": return 4 + Math.random() * 4;
    case "residential": return 6 + Math.random() * 10;
    default: return 5 + Math.random() * 8;
  }
}

export default function Map3DViewer({ location, onClose }: Map3DViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const frameRef = useRef<number>(0);
  const mouseRef = useRef({ isDown: false, button: 0, x: 0, y: 0, prevX: 0, prevY: 0 });
  const cameraStateRef = useRef({ theta: Math.PI / 4, phi: Math.PI / 3, distance: 500, targetX: 0, targetY: 0, targetZ: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState("Initializing...");
  const [buildingCount, setBuildingCount] = useState(0);
  const [hoveredBuilding, setHoveredBuilding] = useState<string | null>(null);
  const { isDark } = useTheme();
  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseVec = useRef(new THREE.Vector2());
  const buildingMeshesRef = useRef<THREE.Mesh[]>([]);

  const updateCamera = useCallback(() => {
    if (!cameraRef.current) return;
    const { theta, phi, distance, targetX, targetY, targetZ } = cameraStateRef.current;
    const x = targetX + distance * Math.sin(phi) * Math.cos(theta);
    const y = targetY + distance * Math.cos(phi);
    const z = targetZ + distance * Math.sin(phi) * Math.sin(theta);
    cameraRef.current.position.set(x, y, z);
    cameraRef.current.lookAt(targetX, targetY, targetZ);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const w = container.clientWidth;
    const h = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(isDark ? 0x0a0a1a : 0xe8eef4);
    scene.fog = new THREE.FogExp2(isDark ? 0x0a0a1a : 0xe8eef4, 0.0008);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(50, w / h, 1, 5000);
    cameraRef.current = camera;
    updateCamera();

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const ambientLight = new THREE.AmbientLight(isDark ? 0x334466 : 0x9db8d2, isDark ? 0.6 : 0.5);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(isDark ? 0x6688aa : 0xfff4e0, isDark ? 1.0 : 1.5);
    sunLight.position.set(300, 400, 200);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 1500;
    sunLight.shadow.camera.left = -600;
    sunLight.shadow.camera.right = 600;
    sunLight.shadow.camera.top = 600;
    sunLight.shadow.camera.bottom = -600;
    scene.add(sunLight);

    const fillLight = new THREE.DirectionalLight(isDark ? 0x223355 : 0xb0c4de, 0.3);
    fillLight.position.set(-200, 200, -100);
    scene.add(fillLight);

    const hemisphereLight = new THREE.HemisphereLight(
      isDark ? 0x1a2a3a : 0x87ceeb,
      isDark ? 0x0a1520 : 0x556b2f,
      0.4
    );
    scene.add(hemisphereLight);

    loadData(scene, location.lat, location.lon);

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      const w2 = container.clientWidth;
      const h2 = container.clientHeight;
      camera.aspect = w2 / h2;
      camera.updateProjectionMatrix();
      renderer.setSize(w2, h2);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
          else obj.material?.dispose();
        }
      });
    };
  }, [location.lat, location.lon, isDark]);

  const loadData = async (scene: THREE.Scene, lat: number, lon: number) => {
    setLoading(true);
    setLoadingStatus("Fetching elevation data...");

    const degSpan = 0.015;
    const latMin = lat - degSpan;
    const latMax = lat + degSpan;
    const lonMin = lon - degSpan;
    const lonMax = lon + degSpan;

    let elevations: number[][] = [];
    try {
      const lats: number[] = [];
      const lons: number[] = [];
      for (let i = 0; i <= TERRAIN_SEGMENTS; i++) {
        lats.push(latMax - (i / TERRAIN_SEGMENTS) * (latMax - latMin));
        lons.push(lonMin + (i / TERRAIN_SEGMENTS) * (lonMax - lonMin));
      }
      const resp = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lats.join(",")}&longitude=${lons.join(",")}`);
      const data = await resp.json();
      const elArr: number[] = data.elevation || [];
      const minElev = Math.min(...elArr);
      for (let i = 0; i <= TERRAIN_SEGMENTS; i++) {
        const row: number[] = [];
        for (let j = 0; j <= TERRAIN_SEGMENTS; j++) {
          const idx = i;
          const e = (elArr[idx] || minElev) - minElev;
          row.push(e * 0.6);
        }
        elevations.push(row);
      }
    } catch {
      for (let i = 0; i <= TERRAIN_SEGMENTS; i++) {
        elevations.push(new Array(TERRAIN_SEGMENTS + 1).fill(0));
      }
    }

    setLoadingStatus("Building terrain mesh...");
    const terrainGeom = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
    terrainGeom.rotateX(-Math.PI / 2);

    const posAttr = terrainGeom.attributes.position;
    for (let i = 0; i <= TERRAIN_SEGMENTS; i++) {
      for (let j = 0; j <= TERRAIN_SEGMENTS; j++) {
        const idx = i * (TERRAIN_SEGMENTS + 1) + j;
        posAttr.setY(idx, elevations[i][j]);
      }
    }
    terrainGeom.computeVertexNormals();

    const terrainColors = new Float32Array((TERRAIN_SEGMENTS + 1) * (TERRAIN_SEGMENTS + 1) * 3);
    const grassLow = new THREE.Color(isDark ? 0x1a3d2e : 0x6b8f5e);
    const grassHigh = new THREE.Color(isDark ? 0x2d5a3f : 0x8faf7c);
    const rock = new THREE.Color(isDark ? 0x3a3a4a : 0x999988);

    for (let i = 0; i <= TERRAIN_SEGMENTS; i++) {
      for (let j = 0; j <= TERRAIN_SEGMENTS; j++) {
        const idx = i * (TERRAIN_SEGMENTS + 1) + j;
        const h = elevations[i][j];
        let c: THREE.Color;
        if (h > 15) c = rock.clone();
        else c = grassLow.clone().lerp(grassHigh, Math.min(h / 10, 1));
        const variation = 0.95 + Math.random() * 0.1;
        c.multiplyScalar(variation);
        terrainColors[idx * 3] = c.r;
        terrainColors[idx * 3 + 1] = c.g;
        terrainColors[idx * 3 + 2] = c.b;
      }
    }
    terrainGeom.setAttribute("color", new THREE.BufferAttribute(terrainColors, 3));

    const terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.0,
      flatShading: false,
    });
    const terrainMesh = new THREE.Mesh(terrainGeom, terrainMat);
    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);

    const gridHelper = new THREE.GridHelper(TERRAIN_SIZE, 40, isDark ? 0x1a2a3a : 0xcccccc, isDark ? 0x111a22 : 0xe0e0e0);
    gridHelper.position.y = 0.05;
    gridHelper.material.opacity = 0.3;
    gridHelper.material.transparent = true;
    scene.add(gridHelper);

    setLoadingStatus("Fetching building footprints...");

    try {
      const resp = await fetch(`/api/3d/buildings?lat=${lat}&lon=${lon}&radius=800`);
      const data = await resp.json();
      const buildings = data.buildings || [];

      setLoadingStatus(`Rendering ${buildings.length} buildings...`);
      setBuildingCount(buildings.length);

      const buildingMeshes: THREE.Mesh[] = [];

      const meterPerDegLat = 111320;
      const meterPerDegLon = 111320 * Math.cos(lat * Math.PI / 180);
      const scale = TERRAIN_SIZE / (degSpan * 2 * meterPerDegLat);

      for (const bld of buildings) {
        const bType = bld.type || "yes";
        const height = getDefaultHeight(bType, bld.levels);
        const scaledHeight = height * scale * 0.5;

        if (bld.geometry === "point") {
          const x = (bld.lon - lon) * meterPerDegLon * scale;
          const z = -(bld.lat - lat) * meterPerDegLat * scale;
          const size = (bld.size || 12) * scale * 0.3;

          const geom = new THREE.BoxGeometry(size, scaledHeight, size);
          const color = BUILDING_COLORS[bType] || 0xc8d6e5;
          const mat = new THREE.MeshStandardMaterial({
            color,
            roughness: 0.6,
            metalness: 0.15,
          });
          const mesh = new THREE.Mesh(geom, mat);

          const terrainY = getTerrainHeight(x, z, elevations, TERRAIN_SIZE, TERRAIN_SEGMENTS);
          mesh.position.set(x, terrainY + scaledHeight / 2, z);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.userData = { name: bld.name || bType, type: bType, height: Math.round(height), levels: bld.levels || Math.round(height / 3) };
          scene.add(mesh);
          buildingMeshes.push(mesh);
        } else if (bld.polygon && bld.polygon.length >= 3) {
          const points2D: THREE.Vector2[] = bld.polygon.map((p: [number, number]) => {
            const px = (p[1] - lon) * meterPerDegLon * scale;
            const pz = -(p[0] - lat) * meterPerDegLat * scale;
            return new THREE.Vector2(px, pz);
          });

          const shape = new THREE.Shape(points2D);
          const extrudeSettings = { depth: scaledHeight, bevelEnabled: false };
          const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
          geom.rotateX(-Math.PI / 2);

          const color = BUILDING_COLORS[bType] || 0xc8d6e5;
          const mat = new THREE.MeshStandardMaterial({
            color,
            roughness: 0.55,
            metalness: 0.12,
          });
          const mesh = new THREE.Mesh(geom, mat);

          const cx = points2D.reduce((s, p) => s + p.x, 0) / points2D.length;
          const cz = points2D.reduce((s, p) => s + p.y, 0) / points2D.length;
          const terrainY = getTerrainHeight(cx, cz, elevations, TERRAIN_SIZE, TERRAIN_SEGMENTS);

          mesh.position.y = terrainY;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.userData = { name: bld.name || bType, type: bType, height: Math.round(height), levels: bld.levels || Math.round(height / 3) };
          scene.add(mesh);
          buildingMeshes.push(mesh);
        }
      }

      buildingMeshesRef.current = buildingMeshes;

      addRoads(scene, lat, lon, degSpan, meterPerDegLat, meterPerDegLon, scale, elevations);
    } catch (e) {
      console.error("Building data error:", e);
    }

    setLoading(false);
  };

  const addRoads = async (
    scene: THREE.Scene, lat: number, lon: number, degSpan: number,
    meterPerDegLat: number, meterPerDegLon: number, scale: number,
    elevations: number[][]
  ) => {
    try {
      const bbox = `${lat - degSpan},${lon - degSpan},${lat + degSpan},${lon + degSpan}`;
      const query = `[out:json][timeout:10];(way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified)$"](${bbox}););out geom;`;
      const resp = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        body: `data=${encodeURIComponent(query)}`,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      const data = await resp.json();

      const roadWidths: Record<string, number> = {
        motorway: 4, trunk: 3.5, primary: 3, secondary: 2.5,
        tertiary: 2, residential: 1.5, unclassified: 1.2,
      };
      const roadColor = isDark ? 0x2a2a3a : 0x555555;

      for (const element of (data.elements || [])) {
        if (element.type !== "way" || !element.geometry) continue;
        const hw = element.tags?.highway || "residential";
        const width = (roadWidths[hw] || 1.5) * scale * 0.15;

        const pts: THREE.Vector3[] = element.geometry.map((g: any) => {
          const x = (g.lon - lon) * meterPerDegLon * scale;
          const z = -(g.lat - lat) * meterPerDegLat * scale;
          const y = getTerrainHeight(x, z, elevations, TERRAIN_SIZE, TERRAIN_SEGMENTS) + 0.15;
          return new THREE.Vector3(x, y, z);
        });

        if (pts.length < 2) continue;

        const roadGeom = new THREE.BufferGeometry();
        const vertices: number[] = [];
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i], b = pts[i + 1];
          const dir = new THREE.Vector3().subVectors(b, a).normalize();
          const up = new THREE.Vector3(0, 1, 0);
          const side = new THREE.Vector3().crossVectors(dir, up).normalize().multiplyScalar(width / 2);

          const p1 = a.clone().add(side);
          const p2 = a.clone().sub(side);
          const p3 = b.clone().add(side);
          const p4 = b.clone().sub(side);

          vertices.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z);
          vertices.push(p2.x, p2.y, p2.z, p4.x, p4.y, p4.z, p3.x, p3.y, p3.z);
        }

        roadGeom.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
        roadGeom.computeVertexNormals();

        const roadMat = new THREE.MeshStandardMaterial({
          color: roadColor,
          roughness: 0.85,
          metalness: 0.05,
        });
        const roadMesh = new THREE.Mesh(roadGeom, roadMat);
        roadMesh.receiveShadow = true;
        scene.add(roadMesh);
      }
    } catch (e) {
      console.error("Road data error:", e);
    }
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onMouseDown = (e: MouseEvent) => {
      mouseRef.current.isDown = true;
      mouseRef.current.button = e.button;
      mouseRef.current.x = e.clientX;
      mouseRef.current.y = e.clientY;
      mouseRef.current.prevX = e.clientX;
      mouseRef.current.prevY = e.clientY;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      mouseVec.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseVec.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      if (!loading && cameraRef.current && sceneRef.current) {
        raycasterRef.current.setFromCamera(mouseVec.current, cameraRef.current);
        const intersects = raycasterRef.current.intersectObjects(buildingMeshesRef.current);
        if (intersects.length > 0) {
          const ud = intersects[0].object.userData;
          setHoveredBuilding(`${ud.name} | ${ud.type} | ${ud.height}m (${ud.levels}F)`);
          containerRef.current.style.cursor = "pointer";
        } else {
          setHoveredBuilding(null);
          containerRef.current.style.cursor = mouseRef.current.isDown ? "grabbing" : "grab";
        }
      }

      if (!mouseRef.current.isDown) return;
      const dx = e.clientX - mouseRef.current.prevX;
      const dy = e.clientY - mouseRef.current.prevY;
      mouseRef.current.prevX = e.clientX;
      mouseRef.current.prevY = e.clientY;

      const cs = cameraStateRef.current;
      if (mouseRef.current.button === 0) {
        cs.theta -= dx * 0.005;
        cs.phi = Math.max(0.1, Math.min(Math.PI / 2 - 0.05, cs.phi - dy * 0.005));
      } else if (mouseRef.current.button === 2) {
        const speed = cs.distance * 0.002;
        const forward = new THREE.Vector3(
          -Math.sin(cs.theta), 0, -Math.cos(cs.theta)
        );
        const right = new THREE.Vector3(
          Math.cos(cs.theta), 0, -Math.sin(cs.theta)
        );
        cs.targetX += right.x * dx * speed + forward.x * dy * speed;
        cs.targetZ += right.z * dx * speed + forward.z * dy * speed;
      }
      updateCamera();
    };

    const onMouseUp = () => { mouseRef.current.isDown = false; };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cs = cameraStateRef.current;
      cs.distance = Math.max(50, Math.min(2000, cs.distance * (1 + e.deltaY * 0.001)));
      updateCamera();
    };

    const onContext = (e: MouseEvent) => { e.preventDefault(); };

    container.addEventListener("mousedown", onMouseDown);
    container.addEventListener("mousemove", onMouseMove);
    container.addEventListener("mouseup", onMouseUp);
    container.addEventListener("mouseleave", onMouseUp);
    container.addEventListener("wheel", onWheel, { passive: false });
    container.addEventListener("contextmenu", onContext);

    return () => {
      container.removeEventListener("mousedown", onMouseDown);
      container.removeEventListener("mousemove", onMouseMove);
      container.removeEventListener("mouseup", onMouseUp);
      container.removeEventListener("mouseleave", onMouseUp);
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("contextmenu", onContext);
    };
  }, [loading, updateCamera]);

  return (
    <div className="absolute inset-0 z-[1000] bg-background" data-testid="map-3d-viewer">
      <div ref={containerRef} className="w-full h-full" style={{ cursor: "grab" }} />

      <div className="absolute top-3 left-3 flex items-center gap-2 z-10">
        <button
          onClick={onClose}
          className="px-3 py-1.5 rounded-md text-xs font-medium bg-card border border-border shadow-lg hover:bg-muted transition-colors text-foreground"
          data-testid="button-close-3d"
        >
          &larr; Back to 2D Map
        </button>
        <div className="px-3 py-1.5 rounded-md text-xs bg-card/90 border border-border shadow-lg text-foreground backdrop-blur-sm">
          {location.name}
        </div>
        {buildingCount > 0 && (
          <div className="px-2 py-1.5 rounded-md text-[10px] bg-primary/15 border border-primary/30 text-primary font-medium">
            {buildingCount} buildings
          </div>
        )}
      </div>

      <div className="absolute bottom-3 left-3 z-10 px-3 py-2 rounded-md text-[10px] bg-card/90 border border-border shadow-lg backdrop-blur-sm text-muted-foreground space-y-0.5">
        <div><strong className="text-foreground">Left drag</strong>: Orbit</div>
        <div><strong className="text-foreground">Right drag</strong>: Pan</div>
        <div><strong className="text-foreground">Scroll</strong>: Zoom</div>
      </div>

      {hoveredBuilding && (
        <div className="absolute bottom-3 right-3 z-10 px-3 py-2 rounded-md text-xs bg-card border border-border shadow-lg text-foreground backdrop-blur-sm">
          {hoveredBuilding}
        </div>
      )}

      <div className="absolute top-3 right-3 z-10 flex flex-col gap-1">
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 px-3 py-2 rounded-md text-[10px] bg-card/90 border border-border shadow-lg backdrop-blur-sm">
          {Object.entries({
            "Residential": 0x8ecae6,
            "Commercial": 0xfca311,
            "Industrial": 0xd4a373,
            "Civic": 0xb5838d,
            "Other": 0xc8d6e5,
          }).map(([label, color]) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ background: `#${color.toString(16).padStart(6, "0")}` }} />
              <span className="text-foreground">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-20">
          <div className="text-center space-y-3">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
            <div className="text-sm font-medium text-foreground">Building 3D Scene</div>
            <div className="text-xs text-muted-foreground">{loadingStatus}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function getTerrainHeight(
  x: number, z: number,
  elevations: number[][],
  terrainSize: number,
  segments: number
): number {
  const halfSize = terrainSize / 2;
  const gx = ((x + halfSize) / terrainSize) * segments;
  const gz = ((-z + halfSize) / terrainSize) * segments;
  const ix = Math.max(0, Math.min(segments - 1, Math.floor(gx)));
  const iz = Math.max(0, Math.min(segments - 1, Math.floor(gz)));
  if (ix >= 0 && ix < segments && iz >= 0 && iz < segments && elevations[iz]) {
    return elevations[iz][ix] || 0;
  }
  return 0;
}
