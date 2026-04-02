import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import type { SiteData, BuildingFootprint } from "./SiteSelector";

interface MassingBox {
  id: string;
  mesh: THREE.Mesh;
  wireframe: THREE.LineSegments;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  floors: number;
  rotation: number;
  type: string;
  footprintArea: number;
  totalFloorArea: number;
}

interface BimMetrics {
  far: number;
  groundCoverage: number;
  openSpace: number;
  totalBuiltUp: number;
  totalFootprint: number;
  maxHeight: number;
  avgHeight: number;
  massingCount: number;
  estimatedUnits: number;
}

interface BimViewportProps {
  siteData: SiteData | null;
  onMetricsUpdate: (metrics: BimMetrics) => void;
  onMassingChange: (massings: Omit<MassingBox, "mesh" | "wireframe">[]) => void;
  sunHour: number;
  onBuildingHover?: (bld: BuildingFootprint | null) => void;
}

export type { MassingBox, BimMetrics };

const VIEWPORT_SIZE = 600;
const MASSING_TYPES = [
  { value: "residential", label: "Residential", color: 0x2C5282 },
  { value: "commercial", label: "Commercial", color: 0xE76F00 },
  { value: "office", label: "Office", color: 0x2A9D8F },
  { value: "mixed_use", label: "Mixed Use", color: 0x7C3AED },
  { value: "hotel", label: "Hotel", color: 0xDB2777 },
  { value: "industrial", label: "Industrial", color: 0x92400E },
];

const BUILDING_TYPE_COLORS: Record<string, number> = {
  residential: 0x8BAFD4,
  apartments: 0x8BAFD4,
  house: 0xA4C4DB,
  commercial: 0xE8A87C,
  retail: 0xE8A87C,
  office: 0x7ECEC1,
  industrial: 0xC4A882,
  warehouse: 0xC4A882,
  school: 0xF0D27C,
  university: 0xF0D27C,
  hospital: 0xF28B82,
  church: 0xDDB8E0,
  yes: 0xB0BEC5,
};

function getBuildingColor(type: string): number {
  return BUILDING_TYPE_COLORS[type] || BUILDING_TYPE_COLORS.yes;
}

export default function BimViewport({ siteData, onMetricsUpdate, onMassingChange, sunHour, onBuildingHover }: BimViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const frameRef = useRef(0);
  const mouseRef = useRef({ isDown: false, button: 0, prevX: 0, prevY: 0, startX: 0, startY: 0, hasDragged: false });
  const camState = useRef({ theta: Math.PI / 4, phi: Math.PI / 3.5, distance: 400, tx: 0, ty: 0, tz: 0 });
  const sunRef = useRef<THREE.DirectionalLight | null>(null);
  const massingsRef = useRef<MassingBox[]>([]);
  const selectedRef = useRef<string | null>(null);
  const terrainRef = useRef<THREE.Mesh | null>(null);
  const siteOutlineRef = useRef<THREE.LineLoop | null>(null);
  const contextMeshesRef = useRef<THREE.Mesh[]>([]);
  const labelSpritesRef = useRef<THREE.Sprite[]>([]);
  const buildingDataRef = useRef<Map<THREE.Object3D, BuildingFootprint>>(new Map());

  const [tool, setTool] = useState<"navigate" | "place" | "select">("navigate");
  const [massingType, setMassingType] = useState("residential");
  const [placeWidth, setPlaceWidth] = useState(25);
  const [placeDepth, setPlaceDepth] = useState(20);
  const [placeFloors, setPlaceFloors] = useState(6);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [webglOk, setWebglOk] = useState(true);
  const [massings, setMassings] = useState<MassingBox[]>([]);
  const [hoveredBuilding, setHoveredBuilding] = useState<BuildingFootprint | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  const raycaster = useRef(new THREE.Raycaster());
  const mouse2D = useRef(new THREE.Vector2());
  const ghostRef = useRef<THREE.Mesh | null>(null);
  const toolRef = useRef<"navigate" | "place" | "select">("navigate");
  const removeMassingRef = useRef<(id: string) => void>(() => {});

  const updateCamera = useCallback(() => {
    if (!cameraRef.current) return;
    const { theta, phi, distance, tx, ty, tz } = camState.current;
    cameraRef.current.position.set(
      tx + distance * Math.sin(phi) * Math.cos(theta),
      ty + distance * Math.cos(phi),
      tz + distance * Math.sin(phi) * Math.sin(theta),
    );
    cameraRef.current.lookAt(tx, ty, tz);
  }, []);

  const computeMetrics = useCallback(() => {
    if (!siteData) return;
    const ms = massingsRef.current;
    let totalFP = 0, totalFA = 0, maxH = 0, sumH = 0, units = 0;
    for (const m of ms) {
      totalFP += m.footprintArea;
      totalFA += m.totalFloorArea;
      if (m.height > maxH) maxH = m.height;
      sumH += m.height;
      if (m.type === "residential" || m.type === "mixed_use") {
        units += Math.floor(m.totalFloorArea / 85);
      }
    }
    const metrics: BimMetrics = {
      far: siteData.area > 0 ? Math.round((totalFA / siteData.area) * 100) / 100 : 0,
      groundCoverage: siteData.area > 0 ? Math.round((totalFP / siteData.area) * 10000) / 100 : 0,
      openSpace: siteData.area > 0 ? Math.round(((siteData.area - totalFP) / siteData.area) * 10000) / 100 : 100,
      totalBuiltUp: Math.round(totalFA),
      totalFootprint: Math.round(totalFP),
      maxHeight: Math.round(maxH * 10) / 10,
      avgHeight: ms.length > 0 ? Math.round((sumH / ms.length) * 10) / 10 : 0,
      massingCount: ms.length,
      estimatedUnits: units,
    };
    onMetricsUpdate(metrics);
    onMassingChange(ms.map(({ mesh, wireframe, ...rest }) => rest));
  }, [siteData, onMetricsUpdate, onMassingChange]);

  useEffect(() => {
    if (sunRef.current) {
      const angle = ((sunHour - 6) / 12) * Math.PI;
      sunRef.current.position.set(300 * Math.cos(angle), 400 * Math.sin(Math.max(angle, 0.1)), 150);
    }
  }, [sunHour]);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) { setWebglOk(false); return; }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xEFF3F6);
    scene.fog = new THREE.FogExp2(0xEFF3F6, 0.0008);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 1, 5000);
    cameraRef.current = camera;
    updateCamera();

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    scene.add(new THREE.HemisphereLight(0x87CEEB, 0xE8E0D0, 0.4));

    const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
    sun.position.set(300, 400, 150);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 1500;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -500;
    sun.shadow.camera.right = sun.shadow.camera.top = 500;
    scene.add(sun);
    sunRef.current = sun;

    const fill = new THREE.DirectionalLight(0x8EBBDF, 0.3);
    fill.position.set(-200, 200, -100);
    scene.add(fill);

    const ground = new THREE.PlaneGeometry(VIEWPORT_SIZE * 2, VIEWPORT_SIZE * 2);
    ground.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0xD8DFE3, roughness: 1, metalness: 0 });
    const groundMesh = new THREE.Mesh(ground, groundMat);
    groundMesh.receiveShadow = true;
    groundMesh.position.y = -0.1;
    scene.add(groundMesh);
    terrainRef.current = groundMesh;

    const grid = new THREE.GridHelper(VIEWPORT_SIZE, 30, 0xC0C8CE, 0xD4DCE2);
    grid.position.y = 0;
    (grid.material as THREE.Material).opacity = 0.5;
    (grid.material as THREE.Material).transparent = true;
    scene.add(grid);

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    if (!siteData || !sceneRef.current) return;
    const scene = sceneRef.current;

    for (const m of massingsRef.current) {
      scene.remove(m.mesh); scene.remove(m.wireframe);
      m.mesh.geometry?.dispose(); (m.mesh.material as THREE.Material)?.dispose();
      m.wireframe.geometry?.dispose(); (m.wireframe.material as THREE.Material)?.dispose();
    }
    massingsRef.current = [];
    setMassings([]);
    selectedRef.current = null;
    setSelectedId(null);

    if (ghostRef.current) {
      scene.remove(ghostRef.current);
      ghostRef.current.geometry?.dispose();
      (ghostRef.current.material as THREE.Material)?.dispose();
      ghostRef.current = null;
    }

    if (siteOutlineRef.current) scene.remove(siteOutlineRef.current);
    contextMeshesRef.current.forEach(m => { scene.remove(m); m.geometry?.dispose(); (m.material as THREE.Material)?.dispose(); });
    contextMeshesRef.current = [];
    labelSpritesRef.current.forEach(s => { scene.remove(s); s.geometry?.dispose(); (s.material as THREE.SpriteMaterial)?.dispose(); });
    labelSpritesRef.current = [];
    buildingDataRef.current.clear();

    const { bounds, center, sitePolygon, contextBounds } = siteData;
    const mLat = 111320;
    const mLon = 111320 * Math.cos(center.lat * Math.PI / 180);
    const scale = VIEWPORT_SIZE / (Math.max(
      (bounds.east - bounds.west) * mLon,
      (bounds.north - bounds.south) * mLat
    ) * 1.5);

    // hw/hh computed from bounds always (used for camera distance)
    const hw = ((bounds.east - bounds.west) * mLon * scale) / 2;
    const hh = ((bounds.north - bounds.south) * mLat * scale) / 2;

    // ── SITE SHAPE: polygon or bounding box ──────────────────────────────
    if (sitePolygon && sitePolygon.length >= 3) {
      // Freestyle polygon → THREE.Shape for accurate geometry
      const pts3D = sitePolygon.map(([lat, lon]) => new THREE.Vector2(
        (lon - center.lon) * mLon * scale,
        -(lat - center.lat) * mLat * scale
      ));
      const shape = new THREE.Shape(pts3D);

      // Filled polygon (flat on ground)
      const shapeGeom = new THREE.ShapeGeometry(shape);
      const fillMat = new THREE.MeshStandardMaterial({ color: 0x2C5282, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false });
      const fillMesh = new THREE.Mesh(shapeGeom, fillMat);
      fillMesh.rotation.x = -Math.PI / 2;
      fillMesh.position.y = 0.15;
      scene.add(fillMesh);
      contextMeshesRef.current.push(fillMesh);

      // Polygon outline
      const outlinePts = [...sitePolygon, sitePolygon[0]].map(([lat, lon]) => new THREE.Vector3(
        (lon - center.lon) * mLon * scale, 0.3, -(lat - center.lat) * mLat * scale
      ));
      const outlineGeom = new THREE.BufferGeometry().setFromPoints(outlinePts);
      const outline = new THREE.LineLoop(outlineGeom, new THREE.LineBasicMaterial({ color: 0x2C5282 }));
      scene.add(outline);
      siteOutlineRef.current = outline;

      // Vertex dots on ground
      for (const [lat, lon] of sitePolygon) {
        const dotGeom = new THREE.SphereGeometry(1.5, 6, 6);
        const dotMat = new THREE.MeshStandardMaterial({ color: 0x2C5282 });
        const dot = new THREE.Mesh(dotGeom, dotMat);
        dot.position.set((lon - center.lon) * mLon * scale, 0.5, -(lat - center.lat) * mLat * scale);
        scene.add(dot);
        contextMeshesRef.current.push(dot);
      }
    } else {
      // Fallback: bounding box rectangle (hw/hh already computed above)
      const outlineGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-hw, 0.2, -hh), new THREE.Vector3(hw, 0.2, -hh),
        new THREE.Vector3(hw, 0.2, hh), new THREE.Vector3(-hw, 0.2, hh),
      ]);
      const outline = new THREE.LineLoop(outlineGeom, new THREE.LineBasicMaterial({ color: 0x2C5282 }));
      scene.add(outline);
      siteOutlineRef.current = outline;

      const siteFill = new THREE.PlaneGeometry(hw * 2, hh * 2);
      siteFill.rotateX(-Math.PI / 2);
      const fillMesh = new THREE.Mesh(siteFill, new THREE.MeshStandardMaterial({
        color: 0x2C5282, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false,
      }));
      fillMesh.position.y = 0.1;
      scene.add(fillMesh);
      contextMeshesRef.current.push(fillMesh);
    }

    // ── CONTEXT / NEIGHBOURHOOD BOUNDARY (dashed teal outline) ──────────
    if (contextBounds) {
      const chw = ((contextBounds.east - contextBounds.west) * mLon * scale) / 2;
      const chh = ((contextBounds.north - contextBounds.south) * mLat * scale) / 2;
      const cx = ((contextBounds.east + contextBounds.west) / 2 - center.lon) * mLon * scale;
      const cz = -((contextBounds.north + contextBounds.south) / 2 - center.lat) * mLat * scale;
      const ctxGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(cx - chw, 0.3, cz - chh), new THREE.Vector3(cx + chw, 0.3, cz - chh),
        new THREE.Vector3(cx + chw, 0.3, cz + chh), new THREE.Vector3(cx - chw, 0.3, cz + chh),
      ]);
      const ctxMesh = new THREE.LineLoop(ctxGeom, new THREE.LineDashedMaterial({ color: 0x2A9D8F, dashSize: 8, gapSize: 5 }));
      ctxMesh.computeLineDistances();
      scene.add(ctxMesh);
      contextMeshesRef.current.push(ctxMesh as unknown as THREE.Mesh);

      const ctxFill = new THREE.PlaneGeometry(chw * 2, chh * 2);
      ctxFill.rotateX(-Math.PI / 2);
      const ctxFillMesh = new THREE.Mesh(ctxFill, new THREE.MeshStandardMaterial({
        color: 0x2A9D8F, transparent: true, opacity: 0.03, side: THREE.DoubleSide, depthWrite: false,
      }));
      ctxFillMesh.position.set(cx, 0.05, cz);
      scene.add(ctxFillMesh);
      contextMeshesRef.current.push(ctxFillMesh);
    }

    for (const bld of siteData.buildingFootprints) {
      if (!bld.polygon || bld.polygon.length < 3) continue;
      try {
        const pts = bld.polygon.map(p => new THREE.Vector2(
          (p[1] - center.lon) * mLon * scale,
          -(p[0] - center.lat) * mLat * scale
        ));

        const minX = Math.min(...pts.map(p => p.x));
        const maxX = Math.max(...pts.map(p => p.x));
        const minY = Math.min(...pts.map(p => p.y));
        const maxY = Math.max(...pts.map(p => p.y));
        const footprintW = maxX - minX;
        const footprintD = maxY - minY;
        if (footprintW < 0.5 || footprintD < 0.5) continue;

        const floors = bld.floors || (1 + Math.floor(Math.random() * 3));
        const realHeight = bld.height || floors * 3;
        const h = realHeight * scale;

        const color = getBuildingColor(bld.type);
        const cx = (minX + maxX) / 2;
        const cz = (minY + maxY) / 2;

        let mesh: THREE.Mesh;
        try {
          const shape = new THREE.Shape(pts);
          const geom = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
          geom.rotateX(-Math.PI / 2);
          const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.1 });
          mesh = new THREE.Mesh(geom, mat);
          mesh.position.y = 0;
        } catch {
          const geom = new THREE.BoxGeometry(footprintW, h, footprintD);
          const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.1 });
          mesh = new THREE.Mesh(geom, mat);
          mesh.position.set(cx, h / 2, cz);
        }

        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        contextMeshesRef.current.push(mesh);
        buildingDataRef.current.set(mesh, bld);

        const edges = new THREE.EdgesGeometry(mesh.geometry);
        const edgeMat = new THREE.LineBasicMaterial({ color: 0x445566, transparent: true, opacity: 0.3 });
        const edgeMesh = new THREE.LineSegments(edges, edgeMat) as unknown as THREE.Mesh;
        edgeMesh.position.copy(mesh.position);
        scene.add(edgeMesh);
        contextMeshesRef.current.push(edgeMesh);

        if (realHeight >= 9 || bld.name) {
          const label = bld.name ? `${bld.name}\n${realHeight}m` : `${realHeight}m`;
          const sprite = makeLabel(label, realHeight >= 15 ? "#2C5282" : "#64748B");
          sprite.position.set(cx, h + 2, cz);
          sprite.scale.set(18, 9, 1);
          scene.add(sprite);
          labelSpritesRef.current.push(sprite);
        }
      } catch { /* skip degenerate geometry */ }
    }

    camState.current = { ...camState.current, distance: Math.max(hw, hh) * 3, tx: 0, ty: 0, tz: 0 };
    updateCamera();
    computeMetrics();
  }, [siteData, updateCamera]);

  function makeLabel(text: string, color: string): THREE.Sprite {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, 256, 128);
    ctx.font = "bold 24px sans-serif";
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      ctx.fillText(line, 128, 50 + i * 28);
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    return new THREE.Sprite(mat);
  }

  const addMassing = useCallback((x: number, z: number) => {
    const scene = sceneRef.current;
    if (!scene || !siteData) return;

    const typeInfo = MASSING_TYPES.find(t => t.value === massingType) || MASSING_TYPES[0];
    const height = placeFloors * 3;
    const { bounds, center } = siteData;
    const mLat = 111320;
    const mLon = 111320 * Math.cos(center.lat * Math.PI / 180);
    const sceneScale = VIEWPORT_SIZE / (Math.max(
      (bounds.east - bounds.west) * mLon,
      (bounds.north - bounds.south) * mLat
    ) * 1.5);

    const sw = placeWidth * sceneScale;
    const sd = placeDepth * sceneScale;
    const sh = height * sceneScale;

    const geom = new THREE.BoxGeometry(sw, sh, sd);
    const mat = new THREE.MeshStandardMaterial({
      color: typeInfo.color,
      roughness: 0.35,
      metalness: 0.15,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(x, sh / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const edges = new THREE.EdgesGeometry(geom);
    const wire = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x1F2933, transparent: true, opacity: 0.25 }));
    wire.position.copy(mesh.position);
    scene.add(wire);

    const id = `mass-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    mesh.userData = { massId: id };

    const fp = placeWidth * placeDepth;
    const massing: MassingBox = {
      id, mesh, wireframe: wire, x, z,
      width: placeWidth, depth: placeDepth,
      height, floors: placeFloors, rotation: 0,
      type: massingType, footprintArea: fp,
      totalFloorArea: fp * placeFloors,
    };
    massingsRef.current.push(massing);
    setMassings([...massingsRef.current]);
    computeMetrics();
  }, [massingType, placeWidth, placeDepth, placeFloors, siteData, computeMetrics]);

  const removeMassing = useCallback((id: string) => {
    const scene = sceneRef.current;
    if (!scene) return;
    const idx = massingsRef.current.findIndex(m => m.id === id);
    if (idx === -1) return;
    const m = massingsRef.current[idx];
    scene.remove(m.mesh); scene.remove(m.wireframe);
    m.mesh.geometry?.dispose(); (m.mesh.material as THREE.Material)?.dispose();
    m.wireframe.geometry?.dispose(); (m.wireframe.material as THREE.Material)?.dispose();
    massingsRef.current.splice(idx, 1);
    setMassings([...massingsRef.current]);
    if (selectedRef.current === id) { selectedRef.current = null; setSelectedId(null); }
    computeMetrics();
  }, [computeMetrics]);

  // Keep refs in sync so keyboard handler always has latest values
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { removeMassingRef.current = removeMassing; }, [removeMassing]);

  // Global keyboard shortcuts for the 3D viewport
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't intercept when typing in an input / textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === "Escape") {
        if (toolRef.current === "place") {
          setTool("navigate");
        } else if (selectedRef.current) {
          selectedRef.current = null;
          setSelectedId(null);
        }
      }

      if ((e.key === "Delete" || e.key === "Backspace") && selectedRef.current) {
        e.preventDefault();
        removeMassingRef.current(selectedRef.current);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const updateMassingHeight = useCallback((id: string, newFloors: number) => {
    const scene = sceneRef.current;
    if (!scene || !siteData) return;
    const m = massingsRef.current.find(m => m.id === id);
    if (!m) return;

    const { bounds, center } = siteData;
    const mLat = 111320;
    const mLon = 111320 * Math.cos(center.lat * Math.PI / 180);
    const sceneScale = VIEWPORT_SIZE / (Math.max(
      (bounds.east - bounds.west) * mLon,
      (bounds.north - bounds.south) * mLat
    ) * 1.5);

    scene.remove(m.mesh); scene.remove(m.wireframe);
    m.mesh.geometry?.dispose(); m.wireframe.geometry?.dispose();

    const height = newFloors * 3;
    const sw = m.width * sceneScale;
    const sd = m.depth * sceneScale;
    const sh = height * sceneScale;

    const typeInfo = MASSING_TYPES.find(t => t.value === m.type) || MASSING_TYPES[0];
    const geom = new THREE.BoxGeometry(sw, sh, sd);
    const mat = new THREE.MeshStandardMaterial({
      color: typeInfo.color, roughness: 0.35, metalness: 0.15,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(m.x, sh / 2, m.z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData = { massId: id };
    scene.add(mesh);

    const edges = new THREE.EdgesGeometry(geom);
    const wire = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x1F2933, transparent: true, opacity: 0.25 }));
    wire.position.copy(mesh.position);
    scene.add(wire);

    m.mesh = mesh; m.wireframe = wire;
    m.height = height; m.floors = newFloors;
    m.totalFloorArea = m.footprintArea * newFloors;
    setMassings([...massingsRef.current]);
    computeMetrics();
  }, [siteData, computeMetrics]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onDown = (e: MouseEvent) => {
      mouseRef.current = { isDown: true, button: e.button, prevX: e.clientX, prevY: e.clientY, startX: e.clientX, startY: e.clientY, hasDragged: false };
    };

    const onMove = (e: MouseEvent) => {
      if (!container) return;
      const rect = container.getBoundingClientRect();
      mouse2D.current.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);

      if (mouseRef.current.isDown) {
        const dx = e.clientX - mouseRef.current.prevX;
        const dy = e.clientY - mouseRef.current.prevY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) mouseRef.current.hasDragged = true;
        mouseRef.current.prevX = e.clientX;
        mouseRef.current.prevY = e.clientY;

        const cs = camState.current;
        if (mouseRef.current.button === 0 && (tool === "navigate" || tool === "select")) {
          cs.theta -= dx * 0.005;
          cs.phi = Math.max(0.1, Math.min(Math.PI / 2 - 0.05, cs.phi - dy * 0.005));
          updateCamera();
        } else if (mouseRef.current.button === 2) {
          const speed = cs.distance * 0.002;
          const fwd = new THREE.Vector3(-Math.sin(cs.theta), 0, -Math.cos(cs.theta));
          const rt = new THREE.Vector3(Math.cos(cs.theta), 0, -Math.sin(cs.theta));
          cs.tx += rt.x * dx * speed + fwd.x * dy * speed;
          cs.tz += rt.z * dx * speed + fwd.z * dy * speed;
          updateCamera();
        }
        return;
      }

      if (tool === "place" && cameraRef.current && terrainRef.current) {
        raycaster.current.setFromCamera(mouse2D.current, cameraRef.current);
        const hits = raycaster.current.intersectObject(terrainRef.current);
        if (hits.length > 0) {
          updateGhost(hits[0].point.x, hits[0].point.z);
        }
      }

      if (tool === "navigate" && cameraRef.current && !mouseRef.current.isDown) {
        raycaster.current.setFromCamera(mouse2D.current, cameraRef.current);
        const contextOnly = contextMeshesRef.current.filter(m => buildingDataRef.current.has(m));
        const hits = raycaster.current.intersectObjects(contextOnly);
        if (hits.length > 0) {
          const bld = buildingDataRef.current.get(hits[0].object);
          if (bld) {
            setHoveredBuilding(bld);
            setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
            onBuildingHover?.(bld);
          }
        } else {
          if (hoveredBuilding) {
            setHoveredBuilding(null);
            setTooltipPos(null);
            onBuildingHover?.(null);
          }
        }
      }
    };

    const onUp = (e: MouseEvent) => {
      // Use total displacement from mousedown position — more reliable than accumulated delta
      const totalDx = Math.abs(e.clientX - mouseRef.current.startX);
      const totalDy = Math.abs(e.clientY - mouseRef.current.startY);
      const wasDrag = totalDx > 6 || totalDy > 6;
      mouseRef.current.isDown = false;
      if (wasDrag || e.button !== 0 || !cameraRef.current) return;

      const rect = container.getBoundingClientRect();
      mouse2D.current.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.current.setFromCamera(mouse2D.current, cameraRef.current);

      if (tool === "place" && terrainRef.current) {
        // Check if clicking an existing massing — select it instead of adding another
        const massMeshes = massingsRef.current.map(m => m.mesh);
        const massHits = raycaster.current.intersectObjects(massMeshes);
        if (massHits.length > 0) {
          const id = massHits[0].object.userData.massId;
          selectedRef.current = id;
          setSelectedId(id);
          setTool("select");
          return;
        }
        // Otherwise place a new massing on terrain
        const hits = raycaster.current.intersectObject(terrainRef.current);
        if (hits.length > 0) addMassing(hits[0].point.x, hits[0].point.z);
        return;
      }

      if (tool === "select") {
        const massMeshes = massingsRef.current.map(m => m.mesh);
        const hits = raycaster.current.intersectObjects(massMeshes);
        if (hits.length > 0) {
          const id = hits[0].object.userData.massId;
          selectedRef.current = id;
          setSelectedId(id);
        } else {
          selectedRef.current = null;
          setSelectedId(null);
        }
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      camState.current.distance = Math.max(30, Math.min(2000, camState.current.distance * (1 + e.deltaY * 0.001)));
      updateCamera();
    };

    const onCtx = (e: MouseEvent) => e.preventDefault();
    const onLeave = () => {
      mouseRef.current.isDown = false;
      setHoveredBuilding(null);
      setTooltipPos(null);
    };

    container.addEventListener("mousedown", onDown);
    container.addEventListener("mousemove", onMove);
    container.addEventListener("mouseup", onUp);
    container.addEventListener("mouseleave", onLeave);
    container.addEventListener("wheel", onWheel, { passive: false });
    container.addEventListener("contextmenu", onCtx);

    return () => {
      container.removeEventListener("mousedown", onDown);
      container.removeEventListener("mousemove", onMove);
      container.removeEventListener("mouseup", onUp);
      container.removeEventListener("mouseleave", onLeave);
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("contextmenu", onCtx);
    };
  }, [tool, addMassing, updateCamera, hoveredBuilding, onBuildingHover]);

  const updateGhost = (x: number, z: number) => {
    const scene = sceneRef.current;
    if (!scene || !siteData) return;
    if (ghostRef.current) {
      scene.remove(ghostRef.current);
      ghostRef.current.geometry?.dispose();
      (ghostRef.current.material as THREE.Material)?.dispose();
    }
    const { bounds, center } = siteData;
    const mLat = 111320;
    const mLon = 111320 * Math.cos(center.lat * Math.PI / 180);
    const sc = VIEWPORT_SIZE / (Math.max((bounds.east - bounds.west) * mLon, (bounds.north - bounds.south) * mLat) * 1.5);
    const sw = placeWidth * sc;
    const sd = placeDepth * sc;
    const sh = placeFloors * 3 * sc;

    const typeInfo = MASSING_TYPES.find(t => t.value === massingType) || MASSING_TYPES[0];
    const g = new THREE.BoxGeometry(sw, sh, sd);
    const m = new THREE.MeshStandardMaterial({ color: typeInfo.color, transparent: true, opacity: 0.4 });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, sh / 2, z);
    scene.add(mesh);
    ghostRef.current = mesh;
  };

  useEffect(() => {
    if (tool !== "place" && ghostRef.current && sceneRef.current) {
      sceneRef.current.remove(ghostRef.current);
      ghostRef.current.geometry?.dispose();
      (ghostRef.current.material as THREE.Material)?.dispose();
      ghostRef.current = null;
    }
    return () => {
      if (ghostRef.current && sceneRef.current) {
        sceneRef.current.remove(ghostRef.current);
        ghostRef.current.geometry?.dispose();
        (ghostRef.current.material as THREE.Material)?.dispose();
        ghostRef.current = null;
      }
    };
  }, [tool]);

  const selectedMassing = massings.find(m => m.id === selectedId);

  if (!webglOk) {
    return (
      <div className="flex items-center justify-center h-full bg-muted text-muted-foreground text-sm">
        WebGL not available. Use a modern browser.
      </div>
    );
  }

  return (
    <div className="relative h-full bg-[#EFF3F6]" data-testid="bim-viewport">
      <div ref={containerRef} className="absolute inset-0" style={{ cursor: tool === "place" ? "crosshair" : tool === "select" ? "pointer" : "grab" }} />

      <div className="absolute top-2 left-2 z-10 flex items-center gap-1 bg-white/90 border border-border rounded-lg p-1 backdrop-blur-sm shadow-sm" data-testid="bim-toolbar">
        {([
          { key: "navigate" as const, icon: "⊕", label: "Navigate", requiresSite: false },
          { key: "place" as const, icon: "+", label: "Place Massing", requiresSite: true },
          { key: "select" as const, icon: "◎", label: "Select", requiresSite: true },
        ]).map(t => {
          const locked = t.requiresSite && !siteData;
          return (
            <button key={t.key}
              onClick={() => { if (!locked) setTool(t.key); }}
              title={locked ? "Select a site first (Step 1)" : t.label}
              className={`px-2.5 py-1.5 rounded text-[11px] font-medium transition-all ${
                locked
                  ? "text-muted-foreground/40 border border-transparent cursor-not-allowed"
                  : tool === t.key
                    ? "bg-primary/10 text-primary border border-primary/30"
                    : "text-muted-foreground hover:text-foreground border border-transparent"
              }`}
              data-testid={`bim-tool-${t.key}`}>
              <span className="mr-1">{t.icon}</span>{t.label}
              {locked && <span className="ml-1 text-[9px] text-muted-foreground/50">🔒</span>}
            </button>
          );
        })}
        {siteData && (
          <div className="ml-1 pl-1 border-l border-border text-[10px] text-green-600 font-medium">
            Site: {Math.round(siteData.area).toLocaleString()} sqm
          </div>
        )}
      </div>

      {tool === "place" && (
        <div className="absolute top-12 left-2 z-10 bg-white/95 border border-border rounded-lg p-3 backdrop-blur-sm shadow-md w-[200px] space-y-2" data-testid="bim-place-panel">
          <div className="text-[10px] font-bold text-primary uppercase tracking-wider">Massing Parameters</div>
          <div>
            <label className="text-[10px] text-muted-foreground">Type</label>
            <select value={massingType} onChange={e => setMassingType(e.target.value)}
              className="w-full bg-muted border border-border rounded px-2 py-1 text-xs text-foreground" data-testid="bim-massing-type">
              {MASSING_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <div>
              <label className="text-[10px] text-muted-foreground">W(m)</label>
              <input type="number" min={5} max={200} value={placeWidth} onChange={e => setPlaceWidth(+e.target.value)}
                className="w-full bg-muted border border-border rounded px-1.5 py-1 text-xs text-foreground" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">D(m)</label>
              <input type="number" min={5} max={200} value={placeDepth} onChange={e => setPlaceDepth(+e.target.value)}
                className="w-full bg-muted border border-border rounded px-1.5 py-1 text-xs text-foreground" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Floors</label>
              <input type="number" min={1} max={80} value={placeFloors} onChange={e => setPlaceFloors(+e.target.value)}
                className="w-full bg-muted border border-border rounded px-1.5 py-1 text-xs text-foreground" />
            </div>
          </div>
          <div className="text-[10px] text-muted-foreground">
            Height: {placeFloors * 3}m | Area: {placeWidth * placeDepth} sqm | Built-up: {placeWidth * placeDepth * placeFloors} sqm
          </div>
          <div className="text-[10px] text-primary/70">Click on site to place</div>
        </div>
      )}

      {tool === "place" && siteData && (
        <div className="absolute top-12 right-2 z-10 bg-white/90 border border-primary/20 rounded-lg px-2.5 py-1.5 shadow-sm backdrop-blur-sm flex items-center gap-1.5 pointer-events-none" data-testid="bim-place-hint">
          <kbd className="text-[9px] bg-primary/10 text-primary border border-primary/20 rounded px-1 py-0.5 font-mono">ESC</kbd>
          <span className="text-[10px] text-muted-foreground">Stop placing</span>
          <span className="text-muted-foreground/40 text-[10px]">·</span>
          <span className="text-[10px] text-muted-foreground">Click block to select</span>
        </div>
      )}

      {selectedId && selectedMassing && (
        <div className="absolute top-12 left-2 z-10 bg-white/95 border border-border rounded-lg p-3 backdrop-blur-sm shadow-md w-[210px] space-y-2" data-testid="bim-edit-panel">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-bold text-primary uppercase tracking-wider">Edit Massing</div>
            <button onClick={() => { setSelectedId(null); selectedRef.current = null; }} className="text-muted-foreground hover:text-foreground text-sm">&times;</button>
          </div>
          <div className="text-[10px] text-muted-foreground">
            Type: {selectedMassing.type} | {selectedMassing.width}m × {selectedMassing.depth}m
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Height (Floors)</label>
            <input type="range" min={1} max={80} value={selectedMassing.floors}
              onChange={e => updateMassingHeight(selectedMassing.id, +e.target.value)}
              className="w-full accent-primary" data-testid="bim-height-slider" />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>{selectedMassing.floors}F</span>
              <span>{selectedMassing.height}m</span>
              <span>{selectedMassing.totalFloorArea.toLocaleString()} sqm</span>
            </div>
          </div>
          <button onClick={() => removeMassing(selectedMassing.id)}
            className="w-full py-1.5 rounded text-[11px] font-medium bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 transition-colors flex items-center justify-center gap-1.5" data-testid="bim-delete-massing">
            <span>Remove Massing</span>
            <kbd className="text-[9px] bg-red-100 border border-red-200 rounded px-1 font-mono">Del</kbd>
          </button>
          <button onClick={() => { setSelectedId(null); selectedRef.current = null; setTool("place"); }}
            className="w-full py-1 rounded text-[11px] text-primary bg-primary/5 hover:bg-primary/10 border border-primary/15 transition-colors" data-testid="bim-resume-place">
            ＋ Place Another
          </button>
        </div>
      )}

      {hoveredBuilding && tooltipPos && (
        <div className="absolute z-20 bg-white/95 border border-border rounded-lg p-2 shadow-lg pointer-events-none" style={{ left: tooltipPos.x + 12, top: tooltipPos.y - 10 }}>
          <div className="text-[11px] font-semibold text-foreground">{hoveredBuilding.name || "Building"}</div>
          <div className="text-[10px] text-muted-foreground">Type: {hoveredBuilding.type}</div>
          <div className="text-[10px] text-muted-foreground">
            Height: {hoveredBuilding.height || (hoveredBuilding.floors || 1) * 3}m
            {hoveredBuilding.floors > 0 && ` (${hoveredBuilding.floors}F)`}
          </div>
        </div>
      )}

      {!siteData && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="text-center space-y-4 bg-white/80 backdrop-blur-sm border border-border rounded-2xl px-8 py-6 shadow-lg max-w-[280px]">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center flex-shrink-0">1</div>
                <div className="text-left">
                  <div className="text-xs font-semibold text-primary">Select Site</div>
                  <div className="text-[10px] text-muted-foreground">Click "Draw Site" → drag on the map</div>
                </div>
              </div>
              <div className="w-px h-4 bg-border mx-auto" />
              <div className="flex items-center gap-3 opacity-40">
                <div className="w-7 h-7 rounded-full bg-muted border border-border text-xs font-bold flex items-center justify-center flex-shrink-0 text-muted-foreground">2</div>
                <div className="text-left">
                  <div className="text-xs font-semibold text-muted-foreground">Place Massings</div>
                  <div className="text-[10px] text-muted-foreground">Add building blocks to site</div>
                </div>
              </div>
              <div className="w-px h-4 bg-border mx-auto" />
              <div className="flex items-center gap-3 opacity-40">
                <div className="w-7 h-7 rounded-full bg-muted border border-border text-xs font-bold flex items-center justify-center flex-shrink-0 text-muted-foreground">3</div>
                <div className="text-left">
                  <div className="text-xs font-semibold text-muted-foreground">NBC Compliance</div>
                  <div className="text-[10px] text-muted-foreground">View violations & score</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {siteData && massings.length === 0 && (
        <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
          <div className="bg-primary text-white text-[11px] font-medium px-4 py-2 rounded-full shadow-lg flex items-center gap-2 animate-bounce">
            <span className="w-5 h-5 bg-white/20 rounded-full text-center text-xs leading-5 font-bold">2</span>
            Select "Place Massing" and click on the blue site to add blocks
          </div>
        </div>
      )}

      <div className="absolute bottom-2 left-2 z-10 text-[10px] text-muted-foreground bg-white/80 rounded px-2 py-1 backdrop-blur-sm border border-border shadow-sm">
        Left: Orbit | Right: Pan | Scroll: Zoom | Click: {tool === "place" ? "Place" : tool === "select" ? "Select" : "Hover buildings"}
      </div>
    </div>
  );
}
