import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FemGroupingData } from '../types';

// Keep the mesh deliberately quiet so the selected solver element stays the
// visual focus of the preview.
const BASE_COLOR = new THREE.Color('#6f899a');
const SELECTED_COLOR = new THREE.Color('#d9544d');
const GRID_LINE_COLOR = new THREE.Color('#4b6b7d');
const BOUNDARY_LINE_COLOR = new THREE.Color('#1f2937');
type ViewPreset = 'front' | 'iso';

interface FemViewerProps {
  glbUrl: string;
  mappingUrl: string;
  grouping: FemGroupingData | null;
  /** 显示完整单元网格线。 */
  showMesh: boolean;
  /** 显示模型自由边界线（仅被一个三角形使用的边）。 */
  showBoundary: boolean;
  transparent: boolean;
  colorByGroup: boolean;
}

interface ViewerRuntime {
  applyColors: (elementId: number | null) => void;
  buildMeshLines: () => void;
  buildBoundaryLines: () => void;
  applyMaterialMode: () => void;
  fitView: (preset: ViewPreset) => void;
  back: () => void;
}

export function FemViewer({
  glbUrl,
  mappingUrl,
  grouping,
  showMesh,
  showBoundary,
  transparent,
  colorByGroup,
}: FemViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedElement, setSelectedElement] = useState<number | null>(null);
  const [activePreset, setActivePreset] = useState<ViewPreset>('front');
  // 显示选项切换会触发全量重算（网格线 / 边界线 / 逐单元着色），期间显示
  // 遮罩并阻止画布输入，避免连续点击堆积。
  const [viewBusy, setViewBusy] = useState(false);
  const selectedRef = useRef(selectedElement);
  const optionsRef = useRef({ showMesh, showBoundary, transparent, colorByGroup, grouping });
  const runtimeRef = useRef<ViewerRuntime | null>(null);

  selectedRef.current = selectedElement;
  optionsRef.current = { showMesh, showBoundary, transparent, colorByGroup, grouping };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#f3f6f8');

    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 10000);
    camera.position.set(0, 0, 1);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.minDistance = 0.01;
    // Middle-drag rotates, right-drag pans, wheel zooms.  Left button stays
    // reserved for element picking below, so OrbitControls must not act on it.
    controls.mouseButtons = {
      LEFT: null,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.PAN,
    };
    controls.enableRotate = true;
    controls.enableZoom = true;
    controls.enablePan = true;

    // While the cursor is over the 3D canvas, prevent the browser's native
    // actions from hijacking gestures that OrbitControls owns: page scroll on
    // wheel, and the forward/back history navigation on middle-button drag /
    // middle-click (the "auto-scroll" cursor the user sees on Windows).
    // Without this, wheel zoom and middle-drag rotate would also scroll the
    // page (the model view then travels under the frozen cursor).
    const preventNativeScroll = (event: Event) => {
      if (event.cancelable) event.preventDefault();
    };
    renderer.domElement.addEventListener('wheel', preventNativeScroll, { passive: false });
    // Must be non-passive: a passive listener cannot prevent the default
    // action, so the middle-button "auto-scroll" (fast page scroll) would
    // still kick in while the user is rotating the model.
    renderer.domElement.addEventListener('mousedown', preventNativeScroll, { passive: false });
    renderer.domElement.addEventListener('auxclick', preventNativeScroll, { passive: false });

    scene.add(new THREE.HemisphereLight('#ffffff', '#d4e0e7', 2.1));
    scene.add(new THREE.AmbientLight('#ffffff', 0.45));
    const key = new THREE.DirectionalLight('#ffffff', 2.35);
    key.position.set(900, 1200, 1500);
    scene.add(key);
    const fill = new THREE.DirectionalLight('#d9eafa', 0.7);
    fill.position.set(-900, 500, -700);
    scene.add(fill);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let modelMesh: THREE.Mesh | null = null;
    let meshLines: THREE.LineSegments | null = null;
    let boundaryLines: THREE.LineSegments | null = null;
    let material: THREE.MeshStandardMaterial | null = null;
    let geometry: THREE.BufferGeometry | null = null;
    let mapping: number[] = [];
    let modelBounds: THREE.Box3 | null = null;
    let disposed = false;

    const colorForElement = (elementId: number): THREE.Color => {
      const options = optionsRef.current;
      if (!options.colorByGroup) return BASE_COLOR;
      const groupId = options.grouping?.element_group_ids[String(elementId)];
      if (groupId == null) return BASE_COLOR;
      const info = options.grouping?.groups.find((group) => group.id === groupId);
      return info ? new THREE.Color(info.color) : BASE_COLOR;
    };

    const applyColors = (elementId: number | null) => {
      if (!geometry) return;
      const position = geometry.getAttribute('position');
      let color = geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
      if (!color) {
        color = new THREE.BufferAttribute(new Float32Array(position.count * 3), 3);
        geometry.setAttribute('color', color);
      }
      for (let triangle = 0; triangle < mapping.length; triangle += 1) {
        const elementIdOfTriangle = mapping[triangle];
        const isSelected = elementId != null && elementIdOfTriangle === elementId;
        const tint = isSelected ? SELECTED_COLOR : colorForElement(elementIdOfTriangle);
        for (let corner = 0; corner < 3; corner += 1) {
          color.setXYZ(triangle * 3 + corner, tint.r, tint.g, tint.b);
        }
      }
      color.needsUpdate = true;
    };

    const removeLineSegments = (lines: THREE.LineSegments | null) => {
      if (!lines) return;
      lines.geometry.dispose();
      if (lines.material instanceof THREE.Material) lines.material.dispose();
      scene.remove(lines);
    };

    /**
     * Build the full solver-element mesh lines.
     *
     * The GLB geometry is triangulated, and `mapping` tells which element each
     * triangle belongs to.  Within one element, an edge shared by two of its
     * triangles is a triangulation diagonal (e.g. a CQUAD split into two
     * coplanar triangles) and must be hidden; every other edge is a real
     * element edge and is drawn.  A plain EdgesGeometry cannot do this because
     * it drops all coplanar edges, so flat-sheet models only showed the outer
     * silhouette instead of the full mesh.
     */
    const collectEdges = (countPerElement: boolean) => {
      if (!geometry) return null;
      const position = geometry.getAttribute('position');
      const array = position.array as Float32Array;
      // Only build element-local usage counts when requested; the boundary
      // pass needs model-wide counts instead.
      const usage = new Map<number, Map<string, number>>();
      const coordsText = new Map<number, string>();
      const coordText = (vertex: number) => {
        let text = coordsText.get(vertex);
        if (text === undefined) {
          const base = vertex * 3;
          text = `${array[base]},${array[base + 1]},${array[base + 2]}`;
          coordsText.set(vertex, text);
        }
        return text;
      };
      const edgeKey = (a: number, b: number) => {
        // Canonical ordering by coordinates so both triangle directions and
        // duplicated (non-indexed) vertices of the same geometric edge hash
        // to one key.
        const aBase = a * 3;
        const bBase = b * 3;
        const dx = array[aBase] - array[bBase];
        if (dx !== 0) return dx < 0 ? `${coordText(a)}|${coordText(b)}` : `${coordText(b)}|${coordText(a)}`;
        const dy = array[aBase + 1] - array[bBase + 1];
        if (dy !== 0) return dy < 0 ? `${coordText(a)}|${coordText(b)}` : `${coordText(b)}|${coordText(a)}`;
        return array[aBase + 2] <= array[bBase + 2]
          ? `${coordText(a)}|${coordText(b)}`
          : `${coordText(b)}|${coordText(a)}`;
      };
      const triangleCount = mapping.length;
      for (let triangle = 0; triangle < triangleCount; triangle += 1) {
        const elementId = countPerElement ? mapping[triangle] : 0;
        let elementEdges = usage.get(elementId);
        if (!elementEdges) {
          elementEdges = new Map<string, number>();
          usage.set(elementId, elementEdges);
        }
        const base = triangle * 3;
        for (let corner = 0; corner < 3; corner += 1) {
          const a = base + corner;
          const b = base + ((corner + 1) % 3);
          const key = edgeKey(a, b);
          elementEdges.set(key, (elementEdges.get(key) ?? 0) + 1);
        }
      }
      return { usage, coordText, edgeKey, triangleCount };
    };

    const buildMeshLines = () => {
      if (meshLines) {
        removeLineSegments(meshLines);
        meshLines = null;
      }
      if (!geometry || !modelMesh) return;
      const options = optionsRef.current;
      if (!options.showMesh) return;
      const collected = collectEdges(true);
      if (!collected) return;
      // Keep an edge only when it is used by a single triangle of its element
      // (a triangulation diagonal is used twice).
      const kept = new Set<string>();
      for (const elementEdges of collected.usage.values()) {
        for (const [edge, count] of elementEdges) {
          if (count === 1) kept.add(edge);
        }
      }
      const lineGeometry = edgeKeysToGeometry(kept);
      if (!lineGeometry) return;
      const lines = new THREE.LineSegments(
        lineGeometry,
        new THREE.LineBasicMaterial({ color: GRID_LINE_COLOR, transparent: true, opacity: 0.6 }),
      );
      lines.position.copy(modelMesh.position);
      lines.rotation.copy(modelMesh.rotation);
      lines.scale.copy(modelMesh.scale);
      scene.add(lines);
      meshLines = lines;
    };

    const buildBoundaryLines = () => {
      if (boundaryLines) {
        removeLineSegments(boundaryLines);
        boundaryLines = null;
      }
      if (!geometry || !modelMesh) return;
      const options = optionsRef.current;
      if (!options.showBoundary) return;
      const collected = collectEdges(false);
      if (!collected) return;
      // A free edge of the whole surface is used by exactly one triangle.
      const freeEdges = new Set<string>();
      for (const [edge, count] of collected.usage.get(0) ?? []) {
        if (count === 1) freeEdges.add(edge);
      }
      const lineGeometry = edgeKeysToGeometry(freeEdges);
      if (!lineGeometry) return;
      const lines = new THREE.LineSegments(
        lineGeometry,
        new THREE.LineBasicMaterial({ color: BOUNDARY_LINE_COLOR, transparent: true, opacity: 0.9 }),
      );
      lines.position.copy(modelMesh.position);
      lines.rotation.copy(modelMesh.rotation);
      lines.scale.copy(modelMesh.scale);
      scene.add(lines);
      boundaryLines = lines;
    };

    const edgeKeysToGeometry = (keys: Set<string>) => {
      const vertices: number[] = [];
      for (const edge of keys) {
        const separator = edge.indexOf('|');
        if (separator <= 0) continue;
        const first = edge.slice(0, separator).split(',').map(Number);
        const second = edge.slice(separator + 1).split(',').map(Number);
        if (first.length !== 3 || second.length !== 3) continue;
        vertices.push(...first, ...second);
      }
      if (vertices.length === 0) return null;
      const lineGeometry = new THREE.BufferGeometry();
      lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      return lineGeometry;
    };

    const applyMaterialMode = () => {
      if (!material) return;
      const semiTransparent = optionsRef.current.transparent;
      material.transparent = semiTransparent;
      material.opacity = semiTransparent ? 0.55 : 1;
      material.depthWrite = !semiTransparent;
      material.needsUpdate = true;
    };

    // View history for the "B" (go back to previous view) shortcut.
    interface ViewSnapshot {
      position: THREE.Vector3;
      quaternion: THREE.Quaternion;
      target: THREE.Vector3;
    }
    const viewHistory: ViewSnapshot[] = [];
    const captureView = (): ViewSnapshot => ({
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
      target: controls.target.clone(),
    });
    const applySnapshot = (snapshot: ViewSnapshot) => {
      camera.position.copy(snapshot.position);
      camera.quaternion.copy(snapshot.quaternion);
      controls.target.copy(snapshot.target);
      controls.update();
    };
    const back = () => {
      const previous = viewHistory.pop();
      if (previous) applySnapshot(previous);
    };

    const fitView = (preset: ViewPreset) => {
      if (!modelBounds) return;
      const center = modelBounds.getCenter(new THREE.Vector3());
      const size = modelBounds.getSize(new THREE.Vector3());
      const maxDimension = Math.max(size.x, size.y, size.z, 1);
      // The GLB is exported Y-up from FEM coordinates (x,y,z) -> (x,z,y), so
      // the Z axis is the FEM vertical axis.  The model is usually a flat
      // XY plane whose normal is Z; look along that thin axis, with a Z-only
      // camera up so the upright direction stays correct.
      const dimensions = [size.x, size.y, size.z];
      const thinAxis = dimensions.indexOf(Math.min(...dimensions));
      const direction =
        preset === 'iso'
          ? new THREE.Vector3(1, 0.82, 1).normalize()
          : [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)][thinAxis];
      const fov = THREE.MathUtils.degToRad(camera.fov);
      const distance = (maxDimension / (2 * Math.tan(fov / 2))) * 1.24;
      camera.near = Math.max(maxDimension / 10000, 0.01);
      camera.far = maxDimension * 100;
      camera.position.copy(center).addScaledVector(direction, distance);
      camera.up.set(0, 1, 0);
      if (Math.abs(direction.z) > 0.95) camera.up.set(0, 0, 1);
      camera.lookAt(center);
      camera.updateProjectionMatrix();
      controls.target.copy(center);
      controls.minDistance = maxDimension * 0.08;
      controls.maxDistance = maxDimension * 12;
      controls.update();
      setActivePreset(preset);
    };

    const goView = (preset: ViewPreset) => {
      if (!modelBounds) return;
      viewHistory.push(captureView());
      if (viewHistory.length > 32) viewHistory.shift();
      fitView(preset);
    };

    Promise.all([
      fetch(mappingUrl).then((response) => response.json()),
      new GLTFLoader().loadAsync(glbUrl),
    ])
      .then(([mappingData, gltf]) => {
        if (disposed) return;
        mapping = mappingData.triangle_element_ids as number[];
        gltf.scene.traverse((node) => {
          if (modelMesh || !(node instanceof THREE.Mesh)) return;
          modelMesh = node;
          const meshGeometry = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
          meshGeometry.computeVertexNormals();
          geometry = meshGeometry;
          node.geometry.dispose();
          node.geometry = meshGeometry;
          if (mapping.length * 3 !== meshGeometry.getAttribute('position').count) {
            throw new Error('triangle mapping does not match GLB geometry');
          }
          material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.72,
            metalness: 0.08,
            emissive: '#e3edf2',
            emissiveIntensity: 0.2,
            side: THREE.DoubleSide,
          });
          node.material = material;
        });
        scene.add(gltf.scene);
        modelBounds = new THREE.Box3().setFromObject(gltf.scene);
        const modelSize = modelBounds.getSize(new THREE.Vector3());
        const modelCenter = modelBounds.getCenter(new THREE.Vector3());
        const maxDimension = Math.max(modelSize.x, modelSize.y, modelSize.z, 1);
        scene.fog = new THREE.Fog('#f3f6f8', maxDimension * 2.4, maxDimension * 8);
        const grid = new THREE.GridHelper(maxDimension * 3, 24, '#b9cbd6', '#dce6ec');
        grid.position.set(modelCenter.x, modelBounds.min.y - maxDimension * 0.06, modelCenter.z);
        scene.add(grid);
        runtimeRef.current = { applyColors, buildMeshLines, buildBoundaryLines, applyMaterialMode, fitView, back };
        applyColors(selectedRef.current);
        buildMeshLines();
        buildBoundaryLines();
        applyMaterialMode();
        fitView('front');
      })
      .catch((error) => {
        if (disposed) return;
        setLoadError(error instanceof Error ? error.message : String(error));
      });

    let pointerOrigin: { x: number; y: number } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return; // OrbitControls owns middle/right drag
      pointerOrigin = { x: event.clientX, y: event.clientY };
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (pointerOrigin && Math.hypot(event.clientX - pointerOrigin.x, event.clientY - pointerOrigin.y) > 5) {
        pointerOrigin = null;
        return;
      }
      pointerOrigin = null;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(modelMesh ? [modelMesh] : [], false);
      if (!hits.length) {
        setSelectedElement(null);
        applyColors(null);
        return;
      }
      const faceIndex = hits[0].faceIndex;
      if (faceIndex != null && mapping[faceIndex] !== undefined) {
        const elementId = mapping[faceIndex];
        setSelectedElement(elementId);
        applyColors(elementId);
      }
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === '1') goView('front');
      if (event.key.toLowerCase() === 'f' || event.key === '2') goView('iso');
      if (event.key.toLowerCase() === 'b') back();
    };
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute(
      'aria-label',
      '有限元三维视图；中键拖动旋转，右键拖动平移，滚轮缩放，点击选择单元，1 正视，F/2 等轴视图（自动适应窗口），B 返回上一视图',
    );
    renderer.domElement.addEventListener('keydown', onKeyDown);

    const resize = () => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    let frame = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('keydown', onKeyDown);
      renderer.domElement.removeEventListener('wheel', preventNativeScroll);
      renderer.domElement.removeEventListener('mousedown', preventNativeScroll);
      renderer.domElement.removeEventListener('auxclick', preventNativeScroll);
      if (meshLines) {
        removeLineSegments(meshLines);
        meshLines = null;
      }
      if (boundaryLines) {
        removeLineSegments(boundaryLines);
        boundaryLines = null;
      }
      controls.dispose();
      renderer.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      runtimeRef.current = null;
      host.replaceChildren();
    };
  }, [glbUrl, mappingUrl]);

  // 拾取选中单元：即时响应，不遮罩。
  useEffect(() => {
    runtimeRef.current?.applyColors(selectedElement);
  }, [selectedElement]);

  // 显示选项切换：重建可能很重（网格线 / 边界线 / 全量着色）。先亮起
  // 「更新中」遮罩并让出主线程一帧，让遮罩真正绘制出来并拦截画布输入，
  // 再执行同步重算，完成后移除遮罩。快速连续切换时前一个重建被取消，
  // 只有最后一次生效。
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return undefined;
    setViewBusy(true);
    const raf = requestAnimationFrame(() => {
      runtime.applyColors(selectedRef.current);
      runtime.buildMeshLines();
      runtime.buildBoundaryLines();
      runtime.applyMaterialMode();
      setViewBusy(false);
    });
    return () => cancelAnimationFrame(raf);
  }, [showMesh, showBoundary, transparent, colorByGroup, grouping]);

  const setView = (preset: ViewPreset) => {
    runtimeRef.current?.fitView(preset);
  };

  return (
    <div className="viewer-host" aria-label="有限元模型三维视图" aria-busy={viewBusy}>
      <div className="viewer-canvas" ref={hostRef} />
      <div className="viewer-actions" aria-label="三维视图控制">
        <button aria-pressed={activePreset === 'front'} className={activePreset === 'front' ? 'active' : ''} onClick={() => setView('front')} title="快捷键 1">
          正视
        </button>
        <button aria-pressed={activePreset === 'iso'} className={activePreset === 'iso' ? 'active' : ''} onClick={() => setView('iso')} title="快捷键 F / 2">
          等轴（适应窗口）
        </button>
      </div>
      <div className="viewer-status">
        {selectedElement != null ? `已选择单元 ${selectedElement}，点击空白处取消选择` : '点击网格选择单元'}
      </div>
      <div className="viewer-help">中键拖动旋转 · 右键拖动平移 · 滚轮缩放 · 点击选择 · 1 正视 · F 等轴适应 · B 返回</div>
      {viewBusy && (
        <div className="viewer-busy" role="status" aria-live="polite">
          <div className="chart-loading-spinner" />
          <span>正在更新显示…</span>
        </div>
      )}
      {loadError && (
        <div className="viewer-error" role="alert">
          模型载入失败：{loadError}
        </div>
      )}
    </div>
  );
}
