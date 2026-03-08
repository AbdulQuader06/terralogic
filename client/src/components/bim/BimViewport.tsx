import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import type { SiteData } from "./SiteSelector";

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
}

export type { MassingBox, BimMetrics };

const VIEWPORT_SIZE = 600;
const MASSING_TYPES = [
  { value: "residential", label: "Residential", color: 0x00bcd4 },
  { value: "commercial", label: "Commercial", color: 0xff9800 },
  { value: "office", label: "Office", color: 0x2196f3 },
  { value: "mixed_use", label: "Mixed Use", color: 0x9c27b0 },
  { value: "hotel", label: "Hotel", color: 0xe91e63 },
  { value: "industrial", label: "Industrial", color: 0x795548 },
];

export default function BimViewport({ siteData, onMetricsUpdate, onMassingChange, sunHour }: BimViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const frameRef = useRef(0);
  const mouseRef = useRef({ isDown: false, button: 0, prevX: 0, prevY: 0, hasDragged: false });
  const camState = useRef({ theta: Math.PI / 4, phi: Math.PI / 3.5, distance: 400, tx: 0, ty: 0, tz: 0 });
  const sunRef = useRef<THREE.DirectionalLight | null>(null);
  const massingsRef = useRef<MassingBox[]>([]);
  const selectedRef = useRef<string | null>(null);
  const terrainRef = useRef<THREE.Mesh | null>(null);
  const siteOutlineRef = useRef<THREE.LineLoop | null>(null);
  const contextMeshesRef = useRef<THREE.Mesh[]>([]);

  const [tool, setTool] = useState<"navigate" | "place" | "select" | "height">("navigate");
  const [massingType, setMassingType] = useState("residential");
  const [placeWidth, setPlaceWidth] = useState(25);
  const [placeDepth, setPlaceDepth] = useState(20);
  const [placeFloors, setPlaceFloors] = useState(6);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [webglOk, setWebglOk] = useState(true);
  const [massings, setMassings] = useState<MassingBox[]>([]);

  const raycaster = useRef(new THREE.Raycaster());
  const mouse2D = useRef(new THREE.Vector2());
  const ghostRef = useRef<THREE.Mesh | null>(null);

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
    scene.background = new THREE.Color(0x0d1117);
    scene.fog = new THREE.FogExp2(0x0d1117, 0.001);
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
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0x223344, 0.6));
    scene.add(new THREE.HemisphereLight(0x1a2a3a, 0x0a1520, 0.3));

    const sun = new THREE.DirectionalLight(0xffe0b0, 1.4);
    sun.position.set(300, 400, 150);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 1500;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -500;
    sun.shadow.camera.right = sun.shadow.camera.top = 500;
    scene.add(sun);
    sunRef.current = sun;

    const fill = new THREE.DirectionalLight(0x334466, 0.4);
    fill.position.set(-200, 200, -100);
    scene.add(fill);

    const ground = new THREE.PlaneGeometry(VIEWPORT_SIZE * 2, VIEWPORT_SIZE * 2);
    ground.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x151b23, roughness: 1, metalness: 0 });
    const groundMesh = new THREE.Mesh(ground, groundMat);
    groundMesh.receiveShadow = true;
    groundMesh.position.y = -0.1;
    scene.add(groundMesh);
    terrainRef.current = groundMesh;

    const grid = new THREE.GridHelper(VIEWPORT_SIZE, 30, 0x1a2a3a, 0x111a22);
    grid.position.y = 0;
    (grid.material as THREE.Material).opacity = 0.4;
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

    const { bounds, center } = siteData;
    const mLat = 111320;
    const mLon = 111320 * Math.cos(center.lat * Math.PI / 180);
    const scale = VIEWPORT_SIZE / (Math.max(
      (bounds.east - bounds.west) * mLon,
      (bounds.north - bounds.south) * mLat
    ) * 1.5);

    const hw = ((bounds.east - bounds.west) * mLon * scale) / 2;
    const hh = ((bounds.north - bounds.south) * mLat * scale) / 2;
    const outlineGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-hw, 0.2, -hh),
      new THREE.Vector3(hw, 0.2, -hh),
      new THREE.Vector3(hw, 0.2, hh),
      new THREE.Vector3(-hw, 0.2, hh),
    ]);
    const outline = new THREE.LineLoop(outlineGeom, new THREE.LineBasicMaterial({ color: 0x00ff88, linewidth: 2 }));
    scene.add(outline);
    siteOutlineRef.current = outline;

    const siteFill = new THREE.PlaneGeometry(hw * 2, hh * 2);
    siteFill.rotateX(-Math.PI / 2);
    const fillMesh = new THREE.Mesh(siteFill, new THREE.MeshStandardMaterial({
      color: 0x00ff88, transparent: true, opacity: 0.05, side: THREE.DoubleSide,
    }));
    fillMesh.position.y = 0.1;
    scene.add(fillMesh);
    contextMeshesRef.current.push(fillMesh);

    for (const bld of siteData.buildingFootprints) {
      if (!bld.polygon || bld.polygon.length < 3) continue;
      try {
        const pts = bld.polygon.map(p => new THREE.Vector2(
          (p[1] - center.lon) * mLon * scale,
          -(p[0] - center.lat) * mLat * scale
        ));
        const shape = new THREE.Shape(pts);
        const floors = bld.floors || (1 + Math.floor(Math.random() * 3));
        const h = floors * 3 * scale * 0.15;
        const geom = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
        geom.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshStandardMaterial({
          color: 0x2a3a4a, transparent: true, opacity: 0.4, roughness: 0.8,
        });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.y = 0;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        contextMeshesRef.current.push(mesh);
      } catch { /* skip */ }
    }

    camState.current = { ...camState.current, distance: Math.max(hw, hh) * 3, tx: 0, ty: 0, tz: 0 };
    updateCamera();
  }, [siteData, updateCamera]);

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

    const sw = placeWidth * sceneScale * 0.15;
    const sd = placeDepth * sceneScale * 0.15;
    const sh = height * sceneScale * 0.15;

    const geom = new THREE.BoxGeometry(sw, sh, sd);
    const mat = new THREE.MeshStandardMaterial({
      color: typeInfo.color,
      roughness: 0.4,
      metalness: 0.2,
      emissive: new THREE.Color(typeInfo.color),
      emissiveIntensity: 0.08,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(x, sh / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const edges = new THREE.EdgesGeometry(geom);
    const wire = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 }));
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
    const sw = m.width * sceneScale * 0.15;
    const sd = m.depth * sceneScale * 0.15;
    const sh = height * sceneScale * 0.15;

    const typeInfo = MASSING_TYPES.find(t => t.value === m.type) || MASSING_TYPES[0];
    const geom = new THREE.BoxGeometry(sw, sh, sd);
    const mat = new THREE.MeshStandardMaterial({
      color: typeInfo.color, roughness: 0.4, metalness: 0.2,
      emissive: new THREE.Color(typeInfo.color), emissiveIntensity: 0.08,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(m.x, sh / 2, m.z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData = { massId: id };
    scene.add(mesh);

    const edges = new THREE.EdgesGeometry(geom);
    const wire = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 }));
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
      mouseRef.current = { isDown: true, button: e.button, prevX: e.clientX, prevY: e.clientY, hasDragged: false };
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
    };

    const onUp = (e: MouseEvent) => {
      const dragged = mouseRef.current.hasDragged;
      mouseRef.current.isDown = false;
      if (dragged || e.button !== 0 || !cameraRef.current) return;

      const rect = container.getBoundingClientRect();
      mouse2D.current.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.current.setFromCamera(mouse2D.current, cameraRef.current);

      if (tool === "place" && terrainRef.current) {
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
    const onLeave = () => { mouseRef.current.isDown = false; };

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
  }, [tool, addMassing, updateCamera]);

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
    const sw = placeWidth * sc * 0.15;
    const sd = placeDepth * sc * 0.15;
    const sh = placeFloors * 3 * sc * 0.15;

    const typeInfo = MASSING_TYPES.find(t => t.value === massingType) || MASSING_TYPES[0];
    const g = new THREE.BoxGeometry(sw, sh, sd);
    const m = new THREE.MeshStandardMaterial({ color: typeInfo.color, transparent: true, opacity: 0.35 });
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
      <div className="flex items-center justify-center h-full bg-gray-900 text-gray-400 text-sm">
        WebGL not available. Use a modern browser.
      </div>
    );
  }

  return (
    <div className="relative h-full bg-[#0d1117]" data-testid="bim-viewport">
      <div ref={containerRef} className="absolute inset-0" style={{ cursor: tool === "place" ? "crosshair" : tool === "select" ? "pointer" : "grab" }} />

      <div className="absolute top-2 left-2 z-10 flex items-center gap-1 bg-black/80 border border-cyan-900/40 rounded-lg p-1 backdrop-blur-sm" data-testid="bim-toolbar">
        {([
          { key: "navigate" as const, icon: "⊕", label: "Navigate" },
          { key: "place" as const, icon: "+", label: "Place Massing" },
          { key: "select" as const, icon: "◎", label: "Select" },
        ]).map(t => (
          <button key={t.key} onClick={() => setTool(t.key)}
            className={`px-2.5 py-1.5 rounded text-[11px] font-medium transition-all ${tool === t.key ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/40" : "text-gray-500 hover:text-gray-300 border border-transparent"}`}
            data-testid={`bim-tool-${t.key}`}>
            <span className="mr-1">{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {tool === "place" && (
        <div className="absolute top-12 left-2 z-10 bg-black/90 border border-cyan-900/40 rounded-lg p-3 backdrop-blur-sm w-[200px] space-y-2" data-testid="bim-place-panel">
          <div className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider">Massing Parameters</div>
          <div>
            <label className="text-[10px] text-gray-500">Type</label>
            <select value={massingType} onChange={e => setMassingType(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200" data-testid="bim-massing-type">
              {MASSING_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <div>
              <label className="text-[10px] text-gray-500">W(m)</label>
              <input type="number" min={5} max={200} value={placeWidth} onChange={e => setPlaceWidth(+e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs text-gray-200" />
            </div>
            <div>
              <label className="text-[10px] text-gray-500">D(m)</label>
              <input type="number" min={5} max={200} value={placeDepth} onChange={e => setPlaceDepth(+e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs text-gray-200" />
            </div>
            <div>
              <label className="text-[10px] text-gray-500">Floors</label>
              <input type="number" min={1} max={80} value={placeFloors} onChange={e => setPlaceFloors(+e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs text-gray-200" />
            </div>
          </div>
          <div className="text-[10px] text-gray-500">
            Height: {placeFloors * 3}m | Area: {placeWidth * placeDepth} sqm | Built-up: {placeWidth * placeDepth * placeFloors} sqm
          </div>
          <div className="text-[10px] text-cyan-400/70">Click on site to place</div>
        </div>
      )}

      {selectedId && selectedMassing && (
        <div className="absolute top-12 left-2 z-10 bg-black/90 border border-cyan-900/40 rounded-lg p-3 backdrop-blur-sm w-[200px] space-y-2" data-testid="bim-edit-panel">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider">Edit Massing</div>
            <button onClick={() => { setSelectedId(null); selectedRef.current = null; }} className="text-gray-500 hover:text-white text-sm">&times;</button>
          </div>
          <div className="text-[10px] text-gray-400">
            Type: {selectedMassing.type} | {selectedMassing.width}m × {selectedMassing.depth}m
          </div>
          <div>
            <label className="text-[10px] text-gray-500">Height (Floors)</label>
            <input type="range" min={1} max={80} value={selectedMassing.floors}
              onChange={e => updateMassingHeight(selectedMassing.id, +e.target.value)}
              className="w-full accent-cyan-500" data-testid="bim-height-slider" />
            <div className="flex justify-between text-[10px] text-gray-500">
              <span>{selectedMassing.floors}F</span>
              <span>{selectedMassing.height}m</span>
              <span>{selectedMassing.totalFloorArea.toLocaleString()} sqm</span>
            </div>
          </div>
          <button onClick={() => removeMassing(selectedMassing.id)}
            className="w-full py-1.5 rounded text-[11px] font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 transition-colors" data-testid="bim-delete-massing">
            Remove Massing
          </button>
        </div>
      )}

      {!siteData && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="text-center space-y-2 text-gray-600">
            <div className="text-2xl">⬚</div>
            <div className="text-sm">Select a site to begin</div>
            <div className="text-xs">Use the Site Selection panel on the left</div>
          </div>
        </div>
      )}

      <div className="absolute bottom-2 left-2 z-10 text-[10px] text-gray-600 bg-black/60 rounded px-2 py-1 backdrop-blur-sm">
        Left: Orbit | Right: Pan | Scroll: Zoom | Click: {tool === "place" ? "Place" : tool === "select" ? "Select" : "—"}
      </div>
    </div>
  );
}
