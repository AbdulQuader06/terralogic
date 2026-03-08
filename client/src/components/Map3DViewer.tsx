import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { useTheme } from "@/lib/theme";

interface Map3DViewerProps {
  location: { lat: number; lon: number; name: string };
  onClose: () => void;
}

const TERRAIN_SIZE = 800;
const TERRAIN_SEGMENTS = 63;

const BUILDING_TYPE_OPTIONS = [
  { value: "residential", label: "Residential", floors: 4, color: 0x8ecae6 },
  { value: "apartments", label: "Apartments", floors: 10, color: 0x6db3c9 },
  { value: "commercial", label: "Commercial", floors: 6, color: 0xfca311 },
  { value: "office", label: "Office Tower", floors: 15, color: 0xf4a261 },
  { value: "retail", label: "Retail", floors: 2, color: 0xe9c46a },
  { value: "industrial", label: "Industrial", floors: 2, color: 0xd4a373 },
  { value: "hotel", label: "Hotel", floors: 12, color: 0xe9c46a },
  { value: "hospital", label: "Hospital", floors: 5, color: 0xe63946 },
  { value: "school", label: "School", floors: 3, color: 0xb5838d },
  { value: "mixed_use", label: "Mixed Use", floors: 8, color: 0x9b59b6 },
  { value: "parking", label: "Parking Structure", floors: 4, color: 0x95a5a6 },
  { value: "park", label: "Park/Open Space", floors: 0, color: 0x27ae60 },
];

const BUILDING_COLORS: Record<string, number> = {};
BUILDING_TYPE_OPTIONS.forEach(t => { BUILDING_COLORS[t.value] = t.color; });
Object.assign(BUILDING_COLORS, {
  house: 0xa8dadc, warehouse: 0xc8a882, university: 0x9f6b99,
  church: 0xdda0dd, mosque: 0xbcead5, temple: 0xf3d5b5, yes: 0xc8d6e5,
});

type ToolMode = "navigate" | "select" | "add" | "delete" | "measure";

interface DigitalTwinBuilding {
  id: string;
  type: string;
  name: string;
  height: number;
  floors: number;
  footprintArea: number;
  x: number;
  z: number;
  sizeX: number;
  sizeZ: number;
  mesh: THREE.Mesh | null;
  isUserPlaced: boolean;
  setbackFront: number;
  setbackSide: number;
}

interface Scenario {
  id: string;
  name: string;
  buildings: Omit<DigitalTwinBuilding, "mesh">[];
  timestamp: number;
}

interface SiteMetrics {
  totalSiteArea: number;
  totalBuiltUpArea: number;
  totalGroundCoverage: number;
  fsi: number;
  groundCoverageRatio: number;
  openSpaceRatio: number;
  totalBuildings: number;
  userBuildings: number;
  existingBuildings: number;
  avgHeight: number;
  maxHeight: number;
  totalFloors: number;
  residentialArea: number;
  commercialArea: number;
  typeMix: Record<string, number>;
}

function computeMetrics(buildings: DigitalTwinBuilding[], siteAreaSqm: number): SiteMetrics {
  let totalBuiltUp = 0, totalGround = 0, maxH = 0, sumH = 0, totalFloors = 0;
  let userCount = 0, existCount = 0, resArea = 0, comArea = 0;
  const typeMix: Record<string, number> = {};

  for (const b of buildings) {
    const ground = b.footprintArea;
    const builtUp = ground * b.floors;
    totalGround += ground;
    totalBuiltUp += builtUp;
    totalFloors += b.floors;
    sumH += b.height;
    if (b.height > maxH) maxH = b.height;
    if (b.isUserPlaced) userCount++; else existCount++;
    typeMix[b.type] = (typeMix[b.type] || 0) + 1;
    if (["residential", "apartments", "house"].includes(b.type)) resArea += builtUp;
    if (["commercial", "office", "retail"].includes(b.type)) comArea += builtUp;
  }

  const n = buildings.length || 1;
  return {
    totalSiteArea: siteAreaSqm,
    totalBuiltUpArea: Math.round(totalBuiltUp),
    totalGroundCoverage: Math.round(totalGround),
    fsi: siteAreaSqm > 0 ? Math.round((totalBuiltUp / siteAreaSqm) * 100) / 100 : 0,
    groundCoverageRatio: siteAreaSqm > 0 ? Math.round((totalGround / siteAreaSqm) * 10000) / 100 : 0,
    openSpaceRatio: siteAreaSqm > 0 ? Math.round(((siteAreaSqm - totalGround) / siteAreaSqm) * 10000) / 100 : 100,
    totalBuildings: buildings.length,
    userBuildings: userCount,
    existingBuildings: existCount,
    avgHeight: Math.round((sumH / n) * 10) / 10,
    maxHeight: Math.round(maxH * 10) / 10,
    totalFloors,
    residentialArea: Math.round(resArea),
    commercialArea: Math.round(comArea),
    typeMix,
  };
}

export default function Map3DViewer({ location, onClose }: Map3DViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const frameRef = useRef<number>(0);
  const mouseRef = useRef({ isDown: false, button: 0, x: 0, y: 0, prevX: 0, prevY: 0, hasDragged: false });
  const cameraStateRef = useRef({ theta: Math.PI / 4, phi: Math.PI / 3, distance: 500, targetX: 0, targetY: 0, targetZ: 0 });
  const elevationsRef = useRef<number[][]>([]);
  const scaleRef = useRef(1);
  const sunLightRef = useRef<THREE.DirectionalLight | null>(null);
  const terrainMeshRef = useRef<THREE.Mesh | null>(null);
  const ghostMeshRef = useRef<THREE.Mesh | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState("Initializing...");
  const [toolMode, setToolMode] = useState<ToolMode>("navigate");
  const [buildings, setBuildings] = useState<DigitalTwinBuilding[]>([]);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const [hoveredInfo, setHoveredInfo] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<SiteMetrics | null>(null);
  const [showMetrics, setShowMetrics] = useState(true);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [sunAngle, setSunAngle] = useState(45);
  const [showEditor, setShowEditor] = useState(false);

  const [addType, setAddType] = useState("residential");
  const [addFloors, setAddFloors] = useState(4);
  const [addSizeX, setAddSizeX] = useState(20);
  const [addSizeZ, setAddSizeZ] = useState(15);
  const [webglError, setWebglError] = useState(false);

  const { isDark } = useTheme();
  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseVec = useRef(new THREE.Vector2());
  const buildingMeshesRef = useRef<THREE.Mesh[]>([]);
  const buildingsRef = useRef<DigitalTwinBuilding[]>([]);
  const selectionBoxRef = useRef<THREE.LineSegments | null>(null);

  const siteAreaSqm = 1500 * 1500;

  const updateCamera = useCallback(() => {
    if (!cameraRef.current) return;
    const { theta, phi, distance, targetX, targetY, targetZ } = cameraStateRef.current;
    cameraRef.current.position.set(
      targetX + distance * Math.sin(phi) * Math.cos(theta),
      targetY + distance * Math.cos(phi),
      targetZ + distance * Math.sin(phi) * Math.sin(theta),
    );
    cameraRef.current.lookAt(targetX, targetY, targetZ);
  }, []);

  const recalcMetrics = useCallback((blds: DigitalTwinBuilding[]) => {
    setMetrics(computeMetrics(blds, siteAreaSqm));
  }, [siteAreaSqm]);

  useEffect(() => {
    buildingsRef.current = buildings;
    recalcMetrics(buildings);
  }, [buildings, recalcMetrics]);

  useEffect(() => {
    if (sunLightRef.current) {
      const rad = (sunAngle * Math.PI) / 180;
      sunLightRef.current.position.set(
        300 * Math.cos(rad), 400 * Math.sin(rad), 200
      );
    }
  }, [sunAngle]);

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

    let renderer: THREE.WebGLRenderer;
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      if (!gl) throw new Error("WebGL not supported");
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      setWebglError(true);
      setLoading(false);
      return;
    }
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(isDark ? 0x334466 : 0x9db8d2, isDark ? 0.6 : 0.5));

    const sunLight = new THREE.DirectionalLight(isDark ? 0x6688aa : 0xfff4e0, isDark ? 1.0 : 1.5);
    const rad = (sunAngle * Math.PI) / 180;
    sunLight.position.set(300 * Math.cos(rad), 400 * Math.sin(rad), 200);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 1500;
    sunLight.shadow.camera.left = sunLight.shadow.camera.bottom = -600;
    sunLight.shadow.camera.right = sunLight.shadow.camera.top = 600;
    scene.add(sunLight);
    sunLightRef.current = sunLight;

    const fill = new THREE.DirectionalLight(isDark ? 0x223355 : 0xb0c4de, 0.3);
    fill.position.set(-200, 200, -100);
    scene.add(fill);
    scene.add(new THREE.HemisphereLight(isDark ? 0x1a2a3a : 0x87ceeb, isDark ? 0x0a1520 : 0x556b2f, 0.4));

    loadData(scene, location.lat, location.lon);

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
          else obj.material?.dispose();
        }
      });
    };
  }, [location.lat, location.lon, isDark]);

  const addBuildingToScene = useCallback((
    scene: THREE.Scene, id: string, type: string, name: string,
    floors: number, x: number, z: number, sizeX: number, sizeZ: number,
    isUserPlaced: boolean
  ): DigitalTwinBuilding | null => {
    const height = floors * 3;
    const scale = scaleRef.current;
    const scaledH = height * scale * 0.5;
    const scaledSX = sizeX * scale * 0.3;
    const scaledSZ = sizeZ * scale * 0.3;

    if (type === "park") {
      const geom = new THREE.PlaneGeometry(scaledSX, scaledSZ);
      geom.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({ color: 0x27ae60, roughness: 0.95, metalness: 0 });
      const mesh = new THREE.Mesh(geom, mat);
      const ty = getTerrainHeight(x, z, elevationsRef.current, TERRAIN_SIZE, TERRAIN_SEGMENTS);
      mesh.position.set(x, ty + 0.2, z);
      mesh.receiveShadow = true;
      mesh.userData = { dtId: id };
      scene.add(mesh);
      buildingMeshesRef.current.push(mesh);
      return {
        id, type, name: name || "Park", height: 0, floors: 0,
        footprintArea: sizeX * sizeZ, x, z, sizeX, sizeZ, mesh, isUserPlaced,
        setbackFront: 0, setbackSide: 0,
      };
    }

    const color = BUILDING_COLORS[type] || 0xc8d6e5;
    const geom = new THREE.BoxGeometry(scaledSX, scaledH, scaledSZ);
    const mat = new THREE.MeshStandardMaterial({
      color: isUserPlaced ? color : color,
      roughness: 0.55, metalness: 0.12,
      ...(isUserPlaced ? { emissive: new THREE.Color(color), emissiveIntensity: 0.05 } : {}),
    });
    const mesh = new THREE.Mesh(geom, mat);
    const ty = getTerrainHeight(x, z, elevationsRef.current, TERRAIN_SIZE, TERRAIN_SEGMENTS);
    mesh.position.set(x, ty + scaledH / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { dtId: id };
    scene.add(mesh);
    buildingMeshesRef.current.push(mesh);

    return {
      id, type, name: name || type, height, floors,
      footprintArea: sizeX * sizeZ, x, z, sizeX, sizeZ, mesh, isUserPlaced,
      setbackFront: 3, setbackSide: 1.5,
    };
  }, []);

  const removeBuildingFromScene = useCallback((id: string) => {
    const scene = sceneRef.current;
    if (!scene) return;
    setBuildings(prev => {
      const b = prev.find(b => b.id === id);
      if (b?.mesh) {
        scene.remove(b.mesh);
        b.mesh.geometry?.dispose();
        (b.mesh.material as THREE.Material)?.dispose();
        buildingMeshesRef.current = buildingMeshesRef.current.filter(m => m !== b.mesh);
      }
      return prev.filter(b => b.id !== id);
    });
    if (selectedBuildingId === id) {
      setSelectedBuildingId(null);
      setShowEditor(false);
      clearSelection();
    }
  }, [selectedBuildingId]);

  const updateBuildingInScene = useCallback((id: string, updates: Partial<Pick<DigitalTwinBuilding, "type" | "name" | "floors" | "sizeX" | "sizeZ">>) => {
    const scene = sceneRef.current;
    if (!scene) return;
    setBuildings(prev => prev.map(b => {
      if (b.id !== id) return b;
      const newB = { ...b, ...updates };
      if (updates.floors !== undefined) newB.height = updates.floors * 3;
      if (updates.sizeX !== undefined || updates.sizeZ !== undefined) newB.footprintArea = newB.sizeX * newB.sizeZ;

      if (!b.isUserPlaced) {
        if (updates.type && b.mesh) {
          const color = BUILDING_COLORS[updates.type] || 0xc8d6e5;
          (b.mesh.material as THREE.MeshStandardMaterial).color.setHex(color);
        }
        return newB;
      }

      if (b.mesh) {
        scene.remove(b.mesh);
        b.mesh.geometry?.dispose();
        (b.mesh.material as THREE.Material)?.dispose();
        buildingMeshesRef.current = buildingMeshesRef.current.filter(m => m !== b.mesh);
      }
      const rebuilt = addBuildingToScene(scene, id, newB.type, newB.name, newB.floors, b.x, b.z, newB.sizeX, newB.sizeZ, b.isUserPlaced);
      if (rebuilt) {
        newB.mesh = rebuilt.mesh;
        newB.height = rebuilt.height;
        newB.footprintArea = rebuilt.footprintArea;
      }
      return newB;
    }));
  }, [addBuildingToScene]);

  const highlightBuilding = useCallback((mesh: THREE.Mesh | null) => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (selectionBoxRef.current) {
      scene.remove(selectionBoxRef.current);
      selectionBoxRef.current.geometry?.dispose();
      (selectionBoxRef.current.material as THREE.Material)?.dispose();
      selectionBoxRef.current = null;
    }
    if (!mesh) return;
    const box = new THREE.Box3().setFromObject(mesh);
    const boxGeom = new THREE.BoxGeometry(
      box.max.x - box.min.x + 1,
      box.max.y - box.min.y + 1,
      box.max.z - box.min.z + 1
    );
    const edges = new THREE.EdgesGeometry(boxGeom);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x00ff88, linewidth: 2 }));
    line.position.copy(new THREE.Vector3().addVectors(box.min, box.max).multiplyScalar(0.5));
    scene.add(line);
    selectionBoxRef.current = line;
  }, []);

  const clearSelection = useCallback(() => {
    highlightBuilding(null);
  }, [highlightBuilding]);

  const saveScenario = useCallback((name: string) => {
    const snapshot = buildings
      .filter(b => b.isUserPlaced)
      .map(({ mesh, ...rest }) => rest);
    setScenarios(prev => [...prev, {
      id: `scenario-${Date.now()}`,
      name,
      buildings: snapshot,
      timestamp: Date.now(),
    }]);
  }, [buildings]);

  const loadScenario = useCallback((scenario: Scenario) => {
    const scene = sceneRef.current;
    if (!scene) return;

    const userIds = buildingsRef.current.filter(b => b.isUserPlaced).map(b => b.id);
    for (const uid of userIds) {
      const b = buildingsRef.current.find(b => b.id === uid);
      if (b?.mesh) {
        scene.remove(b.mesh);
        b.mesh.geometry?.dispose();
        (b.mesh.material as THREE.Material)?.dispose();
        buildingMeshesRef.current = buildingMeshesRef.current.filter(m => m !== b.mesh);
      }
    }

    const existing = buildingsRef.current.filter(b => !b.isUserPlaced);
    const restored: DigitalTwinBuilding[] = [];
    for (const snap of scenario.buildings) {
      const built = addBuildingToScene(scene, snap.id, snap.type, snap.name, snap.floors, snap.x, snap.z, snap.sizeX, snap.sizeZ, true);
      if (built) restored.push(built);
    }
    setBuildings([...existing, ...restored]);
  }, [addBuildingToScene]);

  const loadData = async (scene: THREE.Scene, lat: number, lon: number) => {
    setLoading(true);
    setLoadingStatus("Fetching elevation data...");

    const degSpan = 0.015;
    let elevations: number[][] = [];
    try {
      const lats: number[] = [], lons: number[] = [];
      for (let i = 0; i <= TERRAIN_SEGMENTS; i++) {
        lats.push((lat + degSpan) - (i / TERRAIN_SEGMENTS) * 2 * degSpan);
        lons.push((lon - degSpan) + (i / TERRAIN_SEGMENTS) * 2 * degSpan);
      }
      const resp = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lats.join(",")}&longitude=${lons.join(",")}`);
      const data = await resp.json();
      const elArr: number[] = data.elevation || [];
      const minElev = Math.min(...elArr);
      for (let i = 0; i <= TERRAIN_SEGMENTS; i++) {
        const row: number[] = [];
        for (let j = 0; j <= TERRAIN_SEGMENTS; j++) {
          row.push(((elArr[i] || minElev) - minElev) * 0.6);
        }
        elevations.push(row);
      }
    } catch {
      for (let i = 0; i <= TERRAIN_SEGMENTS; i++) elevations.push(new Array(TERRAIN_SEGMENTS + 1).fill(0));
    }
    elevationsRef.current = elevations;

    setLoadingStatus("Building terrain mesh...");
    const terrainGeom = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
    terrainGeom.rotateX(-Math.PI / 2);
    const posAttr = terrainGeom.attributes.position;
    for (let i = 0; i <= TERRAIN_SEGMENTS; i++) {
      for (let j = 0; j <= TERRAIN_SEGMENTS; j++) {
        posAttr.setY(i * (TERRAIN_SEGMENTS + 1) + j, elevations[i][j]);
      }
    }
    terrainGeom.computeVertexNormals();

    const terrainColors = new Float32Array((TERRAIN_SEGMENTS + 1) * (TERRAIN_SEGMENTS + 1) * 3);
    const gl = new THREE.Color(isDark ? 0x1a3d2e : 0x6b8f5e);
    const gh = new THREE.Color(isDark ? 0x2d5a3f : 0x8faf7c);
    const rk = new THREE.Color(isDark ? 0x3a3a4a : 0x999988);
    for (let i = 0; i <= TERRAIN_SEGMENTS; i++) {
      for (let j = 0; j <= TERRAIN_SEGMENTS; j++) {
        const idx = i * (TERRAIN_SEGMENTS + 1) + j;
        const h = elevations[i][j];
        const c = h > 15 ? rk.clone() : gl.clone().lerp(gh, Math.min(h / 10, 1));
        c.multiplyScalar(0.95 + Math.random() * 0.1);
        terrainColors[idx * 3] = c.r;
        terrainColors[idx * 3 + 1] = c.g;
        terrainColors[idx * 3 + 2] = c.b;
      }
    }
    terrainGeom.setAttribute("color", new THREE.BufferAttribute(terrainColors, 3));

    const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    const terrainMesh = new THREE.Mesh(terrainGeom, terrainMat);
    terrainMesh.receiveShadow = true;
    terrainMesh.userData = { isTerrain: true };
    scene.add(terrainMesh);
    terrainMeshRef.current = terrainMesh;

    const grid = new THREE.GridHelper(TERRAIN_SIZE, 40, isDark ? 0x1a2a3a : 0xcccccc, isDark ? 0x111a22 : 0xe0e0e0);
    grid.position.y = 0.05;
    (grid.material as THREE.Material).opacity = 0.3;
    (grid.material as THREE.Material).transparent = true;
    scene.add(grid);

    setLoadingStatus("Fetching building footprints...");

    buildingMeshesRef.current = [];

    const meterPerDegLat = 111320;
    const meterPerDegLon = 111320 * Math.cos(lat * Math.PI / 180);
    const scale = TERRAIN_SIZE / (degSpan * 2 * meterPerDegLat);
    scaleRef.current = scale;

    try {
      const resp = await fetch(`/api/3d/buildings?lat=${lat}&lon=${lon}&radius=800`);
      const data = await resp.json();
      const rawBuildings = data.buildings || [];
      setLoadingStatus(`Processing ${rawBuildings.length} buildings...`);

      const dtBuildings: DigitalTwinBuilding[] = [];

      for (const bld of rawBuildings) {
        const bType = bld.type || "yes";
        const levels = bld.levels || (bType === "apartments" ? 5 + Math.floor(Math.random() * 7) : bType === "commercial" || bType === "office" ? 4 + Math.floor(Math.random() * 8) : 1 + Math.floor(Math.random() * 3));
        const height = levels * 3;
        const scaledH = height * scale * 0.5;

        if (bld.geometry === "point") {
          const x = (bld.lon - lon) * meterPerDegLon * scale;
          const z = -(bld.lat - lat) * meterPerDegLat * scale;
          const sz = (bld.size || 12) * scale * 0.3;
          const geom = new THREE.BoxGeometry(sz, scaledH, sz);
          const mat = new THREE.MeshStandardMaterial({ color: BUILDING_COLORS[bType] || 0xc8d6e5, roughness: 0.6, metalness: 0.15 });
          const mesh = new THREE.Mesh(geom, mat);
          const ty = getTerrainHeight(x, z, elevations, TERRAIN_SIZE, TERRAIN_SEGMENTS);
          mesh.position.set(x, ty + scaledH / 2, z);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          const id = `osm-${bld.type}-${dtBuildings.length}`;
          mesh.userData = { dtId: id };
          scene.add(mesh);
          buildingMeshesRef.current.push(mesh);
          dtBuildings.push({
            id, type: bType, name: bld.name || bType, height, floors: levels,
            footprintArea: (bld.size || 12) * (bld.size || 12), x, z,
            sizeX: bld.size || 12, sizeZ: bld.size || 12, mesh, isUserPlaced: false,
            setbackFront: 3, setbackSide: 1.5,
          });
        } else if (bld.polygon && bld.polygon.length >= 3) {
          const pts2D: THREE.Vector2[] = bld.polygon.map((p: [number, number]) =>
            new THREE.Vector2((p[1] - lon) * meterPerDegLon * scale, -(p[0] - lat) * meterPerDegLat * scale)
          );
          try {
            const shape = new THREE.Shape(pts2D);
            const geom = new THREE.ExtrudeGeometry(shape, { depth: scaledH, bevelEnabled: false });
            geom.rotateX(-Math.PI / 2);
            const mat = new THREE.MeshStandardMaterial({ color: BUILDING_COLORS[bType] || 0xc8d6e5, roughness: 0.55, metalness: 0.12 });
            const mesh = new THREE.Mesh(geom, mat);
            const cx = pts2D.reduce((s, p) => s + p.x, 0) / pts2D.length;
            const cz = pts2D.reduce((s, p) => s + p.y, 0) / pts2D.length;
            const ty = getTerrainHeight(cx, cz, elevations, TERRAIN_SIZE, TERRAIN_SEGMENTS);
            mesh.position.y = ty;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            const id = `osm-${bType}-${dtBuildings.length}`;
            mesh.userData = { dtId: id };
            scene.add(mesh);
            buildingMeshesRef.current.push(mesh);

            const area = Math.abs(shoelaceArea(pts2D)) / (scale * scale * 0.09);
            dtBuildings.push({
              id, type: bType, name: bld.name || bType, height, floors: levels,
              footprintArea: Math.max(area, 20), x: cx, z: cz,
              sizeX: Math.sqrt(area), sizeZ: Math.sqrt(area), mesh, isUserPlaced: false,
              setbackFront: 3, setbackSide: 1.5,
            });
          } catch { /* skip invalid polygons */ }
        }
      }

      setBuildings(dtBuildings);

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
      const roadWidths: Record<string, number> = { motorway: 4, trunk: 3.5, primary: 3, secondary: 2.5, tertiary: 2, residential: 1.5, unclassified: 1.2 };
      const roadColor = isDark ? 0x2a2a3a : 0x555555;

      for (const element of (data.elements || [])) {
        if (element.type !== "way" || !element.geometry) continue;
        const hw = element.tags?.highway || "residential";
        const width = (roadWidths[hw] || 1.5) * scale * 0.15;
        const pts: THREE.Vector3[] = element.geometry.map((g: any) => {
          const x = (g.lon - lon) * meterPerDegLon * scale;
          const z = -(g.lat - lat) * meterPerDegLat * scale;
          return new THREE.Vector3(x, getTerrainHeight(x, z, elevations, TERRAIN_SIZE, TERRAIN_SEGMENTS) + 0.15, z);
        });
        if (pts.length < 2) continue;
        const verts: number[] = [];
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i], b = pts[i + 1];
          const dir = new THREE.Vector3().subVectors(b, a).normalize();
          const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(width / 2);
          const p1 = a.clone().add(side), p2 = a.clone().sub(side), p3 = b.clone().add(side), p4 = b.clone().sub(side);
          verts.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z);
          verts.push(p2.x, p2.y, p2.z, p4.x, p4.y, p4.z, p3.x, p3.y, p3.z);
        }
        const rGeom = new THREE.BufferGeometry();
        rGeom.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
        rGeom.computeVertexNormals();
        const rMesh = new THREE.Mesh(rGeom, new THREE.MeshStandardMaterial({ color: roadColor, roughness: 0.85, metalness: 0.05 }));
        rMesh.receiveShadow = true;
        scene.add(rMesh);
      }
    } catch (e) { console.error("Road data error:", e); }
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onMouseDown = (e: MouseEvent) => {
      mouseRef.current = { isDown: true, button: e.button, x: e.clientX, y: e.clientY, prevX: e.clientX, prevY: e.clientY, hasDragged: false };
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      mouseVec.current.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);

      if (mouseRef.current.isDown) {
        const dx = e.clientX - mouseRef.current.prevX;
        const dy = e.clientY - mouseRef.current.prevY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) mouseRef.current.hasDragged = true;
        mouseRef.current.prevX = e.clientX;
        mouseRef.current.prevY = e.clientY;

        if (toolMode === "navigate" || mouseRef.current.button === 2 || (mouseRef.current.button === 0 && toolMode !== "add")) {
          const cs = cameraStateRef.current;
          if (mouseRef.current.button === 0 && toolMode === "navigate") {
            cs.theta -= dx * 0.005;
            cs.phi = Math.max(0.1, Math.min(Math.PI / 2 - 0.05, cs.phi - dy * 0.005));
          } else if (mouseRef.current.button === 2) {
            const speed = cs.distance * 0.002;
            const fwd = new THREE.Vector3(-Math.sin(cs.theta), 0, -Math.cos(cs.theta));
            const rt = new THREE.Vector3(Math.cos(cs.theta), 0, -Math.sin(cs.theta));
            cs.targetX += rt.x * dx * speed + fwd.x * dy * speed;
            cs.targetZ += rt.z * dx * speed + fwd.z * dy * speed;
          }
          updateCamera();
        }
        return;
      }

      if (!loading && cameraRef.current && sceneRef.current) {
        raycasterRef.current.setFromCamera(mouseVec.current, cameraRef.current);

        if (toolMode === "add" && terrainMeshRef.current) {
          const tIntersects = raycasterRef.current.intersectObject(terrainMeshRef.current);
          if (tIntersects.length > 0) {
            const pt = tIntersects[0].point;
            updateGhostMesh(pt.x, pt.z);
          }
        }

        const bIntersects = raycasterRef.current.intersectObjects(buildingMeshesRef.current);
        if (bIntersects.length > 0) {
          const ud = bIntersects[0].object.userData;
          const b = buildingsRef.current.find(b => b.id === ud.dtId);
          if (b) {
            setHoveredInfo(`${b.name} | ${b.type} | ${b.height}m (${b.floors}F) | ${b.footprintArea.toFixed(0)} sqm`);
          }
          containerRef.current.style.cursor = toolMode === "delete" ? "not-allowed" : toolMode === "select" ? "pointer" : "crosshair";
        } else {
          setHoveredInfo(null);
          containerRef.current.style.cursor = toolMode === "add" ? "crosshair" : toolMode === "navigate" ? "grab" : "default";
        }
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      const didDrag = mouseRef.current.hasDragged;
      mouseRef.current.isDown = false;
      mouseRef.current.hasDragged = false;

      if (didDrag || e.button !== 0) return;
      if (loading || !cameraRef.current || !sceneRef.current) return;

      const rect = containerRef.current!.getBoundingClientRect();
      mouseVec.current.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycasterRef.current.setFromCamera(mouseVec.current, cameraRef.current);

      if (toolMode === "add" && terrainMeshRef.current) {
        const tIntersects = raycasterRef.current.intersectObject(terrainMeshRef.current);
        if (tIntersects.length > 0) {
          const pt = tIntersects[0].point;
          const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const built = addBuildingToScene(sceneRef.current, id, addType, "", addFloors, pt.x, pt.z, addSizeX, addSizeZ, true);
          if (built) {
            setBuildings(prev => [...prev, built]);
          }
        }
        return;
      }

      const bIntersects = raycasterRef.current.intersectObjects(buildingMeshesRef.current);
      if (bIntersects.length > 0) {
        const dtId = bIntersects[0].object.userData.dtId;
        if (toolMode === "select" || toolMode === "navigate") {
          setSelectedBuildingId(dtId);
          setShowEditor(true);
          highlightBuilding(bIntersects[0].object as THREE.Mesh);
        } else if (toolMode === "delete") {
          removeBuildingFromScene(dtId);
        }
      } else {
        if (toolMode === "select" || toolMode === "navigate") {
          setSelectedBuildingId(null);
          setShowEditor(false);
          clearSelection();
        }
      }
    };

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
    const onMouseLeave = () => { mouseRef.current.isDown = false; };
    container.addEventListener("mouseleave", onMouseLeave);
    container.addEventListener("wheel", onWheel, { passive: false });
    container.addEventListener("contextmenu", onContext);

    return () => {
      container.removeEventListener("mousedown", onMouseDown);
      container.removeEventListener("mousemove", onMouseMove);
      container.removeEventListener("mouseup", onMouseUp);
      container.removeEventListener("mouseleave", onMouseLeave);
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("contextmenu", onContext);
    };
  }, [loading, updateCamera, toolMode, addType, addFloors, addSizeX, addSizeZ, addBuildingToScene, removeBuildingFromScene, highlightBuilding, clearSelection]);

  const updateGhostMesh = (x: number, z: number) => {
    const scene = sceneRef.current;
    if (!scene) return;
    const scale = scaleRef.current;
    const h = addFloors * 3 * scale * 0.5;
    const sx = addSizeX * scale * 0.3;
    const sz = addSizeZ * scale * 0.3;

    if (ghostMeshRef.current) {
      scene.remove(ghostMeshRef.current);
      ghostMeshRef.current.geometry?.dispose();
      (ghostMeshRef.current.material as THREE.Material)?.dispose();
    }

    const geom = addType === "park"
      ? new THREE.PlaneGeometry(sx, sz).rotateX(-Math.PI / 2)
      : new THREE.BoxGeometry(sx, h, sz);
    const color = BUILDING_COLORS[addType] || 0xc8d6e5;
    const mat = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.5 });
    const mesh = new THREE.Mesh(geom, mat);
    const ty = getTerrainHeight(x, z, elevationsRef.current, TERRAIN_SIZE, TERRAIN_SEGMENTS);
    mesh.position.set(x, addType === "park" ? ty + 0.3 : ty + h / 2, z);
    scene.add(mesh);
    ghostMeshRef.current = mesh;
  };

  useEffect(() => {
    return () => {
      if (ghostMeshRef.current && sceneRef.current) {
        sceneRef.current.remove(ghostMeshRef.current);
        ghostMeshRef.current.geometry?.dispose();
        (ghostMeshRef.current.material as THREE.Material)?.dispose();
        ghostMeshRef.current = null;
      }
    };
  }, [toolMode]);

  const selectedBuilding = buildings.find(b => b.id === selectedBuildingId);

  const toolButtons: { mode: ToolMode; icon: string; label: string }[] = [
    { mode: "navigate", icon: "M", label: "Navigate" },
    { mode: "select", icon: "S", label: "Select" },
    { mode: "add", icon: "+", label: "Add Building" },
    { mode: "delete", icon: "X", label: "Delete" },
  ];

  return (
    <div className="absolute inset-0 z-[1000] bg-background" data-testid="map-3d-viewer">
      <div ref={containerRef} className="w-full h-full" style={{ cursor: toolMode === "add" ? "crosshair" : toolMode === "delete" ? "not-allowed" : "grab" }} />

      <div className="absolute top-3 left-3 flex flex-col gap-2 z-10">
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="px-3 py-1.5 rounded-md text-xs font-medium bg-card border border-border shadow-lg hover:bg-muted transition-colors text-foreground" data-testid="button-close-3d">
            &larr; Back to 2D Map
          </button>
          <div className="px-3 py-1.5 rounded-md text-xs bg-card/90 border border-border shadow-lg text-foreground backdrop-blur-sm">
            {location.name}
          </div>
          <div className="px-2 py-1.5 rounded-md text-[10px] bg-primary/15 border border-primary/30 text-primary font-medium">
            Digital Twin
          </div>
        </div>

        <div className="flex items-center gap-1 bg-card/95 border border-border rounded-lg shadow-lg p-1 backdrop-blur-sm" data-testid="toolbar-3d">
          {toolButtons.map(tb => (
            <button
              key={tb.mode}
              onClick={() => { setToolMode(tb.mode); if (tb.mode !== "select") { setShowEditor(false); clearSelection(); } }}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                toolMode === tb.mode
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              }`}
              title={tb.label}
              data-testid={`tool-${tb.mode}`}
            >
              <span className="font-mono text-[10px] mr-1">{tb.icon}</span>
              {tb.label}
            </button>
          ))}
        </div>

        {toolMode === "add" && (
          <div className="bg-card/95 border border-border rounded-lg shadow-lg p-3 backdrop-blur-sm w-[240px] space-y-2" data-testid="add-building-panel">
            <div className="text-xs font-semibold text-foreground">Place Building</div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Type</label>
              <select value={addType} onChange={e => { setAddType(e.target.value); const t = BUILDING_TYPE_OPTIONS.find(o => o.value === e.target.value); if (t) setAddFloors(t.floors); }}
                className="w-full mt-0.5 bg-input border border-border rounded px-2 py-1 text-xs text-foreground" data-testid="select-add-type">
                {BUILDING_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground">Floors</label>
                <input type="number" min={0} max={80} value={addFloors} onChange={e => setAddFloors(Number(e.target.value))}
                  className="w-full mt-0.5 bg-input border border-border rounded px-2 py-1 text-xs text-foreground" data-testid="input-add-floors" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">W (m)</label>
                <input type="number" min={5} max={200} value={addSizeX} onChange={e => setAddSizeX(Number(e.target.value))}
                  className="w-full mt-0.5 bg-input border border-border rounded px-2 py-1 text-xs text-foreground" data-testid="input-add-width" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">D (m)</label>
                <input type="number" min={5} max={200} value={addSizeZ} onChange={e => setAddSizeZ(Number(e.target.value))}
                  className="w-full mt-0.5 bg-input border border-border rounded px-2 py-1 text-xs text-foreground" data-testid="input-add-depth" />
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground">
              Height: {addFloors * 3}m | Area: {addSizeX * addSizeZ} sqm | Built-up: {addSizeX * addSizeZ * addFloors} sqm
            </div>
            <div className="text-[10px] text-primary">Click on terrain to place</div>
          </div>
        )}
      </div>

      {showEditor && selectedBuilding && (
        <div className="absolute top-3 left-[260px] z-10 bg-card/95 border border-border rounded-lg shadow-lg p-3 backdrop-blur-sm w-[240px] space-y-2" data-testid="building-editor">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-foreground">Building Properties</div>
            <button onClick={() => { setShowEditor(false); clearSelection(); setSelectedBuildingId(null); }} className="text-muted-foreground hover:text-foreground">
              <span className="text-sm">&times;</span>
            </button>
          </div>
          <div className="text-[10px] text-muted-foreground">{selectedBuilding.isUserPlaced ? "User-placed" : "Existing (OSM)"} | ID: {selectedBuilding.id.slice(0, 12)}</div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Name</label>
            <input type="text" value={selectedBuilding.name} onChange={e => updateBuildingInScene(selectedBuilding.id, { name: e.target.value })}
              className="w-full mt-0.5 bg-input border border-border rounded px-2 py-1 text-xs text-foreground" data-testid="input-edit-name" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Type</label>
            <select value={selectedBuilding.type} onChange={e => updateBuildingInScene(selectedBuilding.id, { type: e.target.value })}
              className="w-full mt-0.5 bg-input border border-border rounded px-2 py-1 text-xs text-foreground" data-testid="select-edit-type">
              {BUILDING_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              <option value="yes">Other</option>
            </select>
          </div>
          {selectedBuilding.isUserPlaced ? (
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground">Floors</label>
                <input type="number" min={0} max={80} value={selectedBuilding.floors}
                  onChange={e => updateBuildingInScene(selectedBuilding.id, { floors: Number(e.target.value) })}
                  className="w-full mt-0.5 bg-input border border-border rounded px-2 py-1 text-xs text-foreground" data-testid="input-edit-floors" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">W (m)</label>
                <input type="number" min={5} max={200} value={Math.round(selectedBuilding.sizeX)}
                  onChange={e => updateBuildingInScene(selectedBuilding.id, { sizeX: Number(e.target.value) })}
                  className="w-full mt-0.5 bg-input border border-border rounded px-2 py-1 text-xs text-foreground" data-testid="input-edit-width" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">D (m)</label>
                <input type="number" min={5} max={200} value={Math.round(selectedBuilding.sizeZ)}
                  onChange={e => updateBuildingInScene(selectedBuilding.id, { sizeZ: Number(e.target.value) })}
                  className="w-full mt-0.5 bg-input border border-border rounded px-2 py-1 text-xs text-foreground" data-testid="input-edit-depth" />
              </div>
            </div>
          ) : (
            <div className="text-[10px] text-muted-foreground/60 italic">Geometry locked (OSM source). Type and name editable.</div>
          )}
          <div className="text-[10px] text-muted-foreground space-y-0.5">
            <div>Height: {selectedBuilding.height}m | Footprint: {selectedBuilding.footprintArea.toFixed(0)} sqm</div>
            <div>Built-up: {(selectedBuilding.footprintArea * selectedBuilding.floors).toFixed(0)} sqm</div>
          </div>
          <button onClick={() => removeBuildingFromScene(selectedBuilding.id)}
            className="w-full py-1.5 rounded-md text-xs font-medium bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20 transition-colors" data-testid="button-delete-building">
            {selectedBuilding.isUserPlaced ? "Delete Building" : "Remove from Scene"}
          </button>
        </div>
      )}

      {showMetrics && metrics && (
        <div className="absolute top-3 right-3 z-10 bg-card/95 border border-border rounded-lg shadow-lg backdrop-blur-sm w-[220px]" data-testid="site-metrics-panel">
          <div className="px-3 py-2 border-b border-border flex items-center justify-between">
            <div className="text-xs font-semibold text-foreground">Site Metrics</div>
            <button onClick={() => setShowMetrics(false)} className="text-muted-foreground hover:text-foreground text-sm">&times;</button>
          </div>
          <div className="px-3 py-2 space-y-1.5">
            <MetricRow label="FSI / FAR" value={metrics.fsi.toFixed(2)} highlight={metrics.fsi > 2.5} />
            <MetricRow label="Ground Coverage" value={`${metrics.groundCoverageRatio}%`} highlight={metrics.groundCoverageRatio > 60} />
            <MetricRow label="Open Space" value={`${metrics.openSpaceRatio}%`} highlight={metrics.openSpaceRatio < 25} />
            <div className="border-t border-border/50 pt-1.5">
              <MetricRow label="Total Buildings" value={String(metrics.totalBuildings)} />
              <MetricRow label="User-Placed" value={String(metrics.userBuildings)} />
              <MetricRow label="Total Built-Up" value={`${(metrics.totalBuiltUpArea / 1000).toFixed(1)}k sqm`} />
              <MetricRow label="Ground Coverage" value={`${(metrics.totalGroundCoverage / 1000).toFixed(1)}k sqm`} />
            </div>
            <div className="border-t border-border/50 pt-1.5">
              <MetricRow label="Avg Height" value={`${metrics.avgHeight}m`} />
              <MetricRow label="Max Height" value={`${metrics.maxHeight}m`} />
              <MetricRow label="Residential" value={`${(metrics.residentialArea / 1000).toFixed(1)}k sqm`} />
              <MetricRow label="Commercial" value={`${(metrics.commercialArea / 1000).toFixed(1)}k sqm`} />
            </div>
          </div>
        </div>
      )}

      {!showMetrics && (
        <button onClick={() => setShowMetrics(true)}
          className="absolute top-3 right-3 z-10 px-3 py-1.5 rounded-md text-xs bg-card/90 border border-border shadow-lg text-foreground backdrop-blur-sm hover:bg-muted">
          Show Metrics
        </button>
      )}

      <div className="absolute bottom-3 left-3 z-10 flex items-end gap-2">
        <div className="px-3 py-2 rounded-md text-[10px] bg-card/90 border border-border shadow-lg backdrop-blur-sm text-muted-foreground space-y-0.5">
          <div><strong className="text-foreground">Left drag</strong>: {toolMode === "navigate" ? "Orbit" : "Interact"}</div>
          <div><strong className="text-foreground">Right drag</strong>: Pan</div>
          <div><strong className="text-foreground">Scroll</strong>: Zoom</div>
          <div><strong className="text-foreground">Click</strong>: {toolMode === "add" ? "Place building" : toolMode === "select" ? "Select" : toolMode === "delete" ? "Remove" : "Select"}</div>
        </div>

        <div className="px-3 py-2 rounded-md bg-card/90 border border-border shadow-lg backdrop-blur-sm space-y-1" data-testid="sun-control">
          <div className="text-[10px] text-muted-foreground font-medium">Sun Angle: {sunAngle}°</div>
          <input type="range" min={5} max={85} value={sunAngle} onChange={e => setSunAngle(Number(e.target.value))}
            className="w-[120px] h-1 accent-primary" data-testid="slider-sun-angle" />
          <div className="flex justify-between text-[9px] text-muted-foreground">
            <span>Morning</span><span>Noon</span><span>Evening</span>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <button onClick={() => { const name = `Scenario ${scenarios.length + 1}`; saveScenario(name); }}
            className="px-3 py-1.5 rounded-md text-xs bg-card/90 border border-border shadow-lg text-foreground hover:bg-muted backdrop-blur-sm" data-testid="button-save-scenario">
            Save Scenario ({scenarios.length})
          </button>
          {scenarios.length > 0 && (
            <div className="bg-card/90 border border-border rounded-md shadow-lg backdrop-blur-sm max-h-[100px] overflow-y-auto">
              {scenarios.map(s => (
                <button key={s.id} onClick={() => loadScenario(s)}
                  className="w-full text-left px-2 py-1 text-[10px] text-foreground hover:bg-primary/10 cursor-pointer border-b border-border/50 last:border-0 transition-colors"
                  title={`Restore: ${s.buildings.length} user buildings`}
                  data-testid={`scenario-${s.id}`}>
                  <span className="font-medium">{s.name}</span> <span className="text-muted-foreground">({s.buildings.length} buildings)</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {hoveredInfo && (
        <div className="absolute bottom-3 right-3 z-10 px-3 py-2 rounded-md text-xs bg-card border border-border shadow-lg text-foreground backdrop-blur-sm">
          {hoveredInfo}
        </div>
      )}

      {webglError && (
        <div className="absolute inset-0 flex items-center justify-center bg-background z-20" data-testid="webgl-error">
          <div className="text-center space-y-4 max-w-md px-6">
            <div className="text-4xl">🖥️</div>
            <div className="text-lg font-semibold text-foreground">3D View Requires WebGL</div>
            <div className="text-sm text-muted-foreground">
              Your browser does not support WebGL, which is needed for the 3D Digital Twin viewer.
              Please use a modern browser with hardware acceleration enabled (Chrome, Firefox, Edge, Safari).
            </div>
            <button onClick={onClose} className="px-4 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors" data-testid="button-webgl-back">
              Back to 2D Map
            </button>
          </div>
        </div>
      )}

      {loading && !webglError && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-20">
          <div className="text-center space-y-3">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
            <div className="text-sm font-medium text-foreground">Building Digital Twin</div>
            <div className="text-xs text-muted-foreground">{loadingStatus}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium ${highlight ? "text-amber-500" : "text-foreground"}`}>{value}</span>
    </div>
  );
}

function getTerrainHeight(x: number, z: number, elevations: number[][], terrainSize: number, segments: number): number {
  const hs = terrainSize / 2;
  const ix = Math.max(0, Math.min(segments - 1, Math.floor(((x + hs) / terrainSize) * segments)));
  const iz = Math.max(0, Math.min(segments - 1, Math.floor(((-z + hs) / terrainSize) * segments)));
  return elevations[iz]?.[ix] || 0;
}

function shoelaceArea(pts: THREE.Vector2[]): number {
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  }
  return area / 2;
}
