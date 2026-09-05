import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FemGroupingData, PointElementBinding } from '../types';

// Keep the mesh deliberately quiet so the selected solver element stays the
// visual focus of the preview.
const BASE_COLOR = new THREE.Color('#6f899a');
const SELECTED_COLOR = new THREE.Color('#d9544d');
const GRID_LINE_COLOR = new THREE.Color('#4b6b7d');
const BOUNDARY_LINE_COLOR = new THREE.Color('#1f2937');
type ViewPreset = 'front' | 'iso';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 一条点位绑定的气泡运行时数据：世界坐标锚点 + 每帧更新的 DOM 节点。 */
interface BubbleRuntime {
  /** 绑定单元的质心（世界坐标），连线起点。 */
  anchor: THREE.Vector3;
  /** 气泡悬挂点（世界坐标，从质心向外/向上偏移），连线终点。 */
  tip: THREE.Vector3;
  line: SVGLineElement;
  dot: SVGCircleElement;
  bubble: HTMLDivElement;
}

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
  /** 点位-单元绑定列表（点位气泡预览的数据源）。 */
  bindings: PointElementBinding[];
  /** 点位气泡预览开关：开启后各点位名称以气泡悬浮，并用直线连到对应单元。 */
  pointPreview: boolean;
  /** 点位绑定编辑模式：左键点击模型拾取单元并回调给父级。 */
  pickingMode: boolean;
  /** 拾取回调（仅 pickingMode 下触发；null 表示点击了空白处）。 */
  onPickElement?: (elementId: number | null) => void;
}

interface ViewerRuntime {
  applyColors: (elementId: number | null) => void;
  buildMeshLines: () => void;
  buildBoundaryLines: () => void;
  applyMaterialMode: () => void;
  fitView: (preset: ViewPreset) => void;
  back: () => void;
  rebuildPointBubbles: () => void;
}

export function FemViewer({
  glbUrl,
  mappingUrl,
  grouping,
  showMesh,
  showBoundary,
  transparent,
  colorByGroup,
  bindings,
  pointPreview,
  pickingMode,
  onPickElement,
}: FemViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const bubbleLayerRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedElement, setSelectedElement] = useState<number | null>(null);
  const [activePreset, setActivePreset] = useState<ViewPreset>('front');
  // 显示选项切换会触发全量重算（网格线 / 边界线 / 逐单元着色），期间显示
  // 遮罩并阻止画布输入，避免连续点击堆积。
  const [viewBusy, setViewBusy] = useState(false);
  const selectedRef = useRef(selectedElement);
  const optionsRef = useRef({
    showMesh,
    showBoundary,
    transparent,
    colorByGroup,
    grouping,
    bindings,
    pointPreview,
    pickingMode,
    onPickElement,
  });
  const runtimeRef = useRef<ViewerRuntime | null>(null);
  const bubblesRef = useRef<Map<number, BubbleRuntime>>(new Map());

  selectedRef.current = selectedElement;
  optionsRef.current = {
    showMesh,
    showBoundary,
    transparent,
    colorByGroup,
    grouping,
    bindings,
    pointPreview,
    pickingMode,
    onPickElement,
  };

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
    // 点位气泡锚点依赖的世界坐标参考与逐单元质心（模型加载后计算）。
    let elementCentroids: Map<number, THREE.Vector3> | null = null;
    let modelCenter = new THREE.Vector3();
    let modelRadius = 1;
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

    const selectElement = (elementId: number | null) => {
      setSelectedElement(elementId);
      applyColors(elementId);
      const options = optionsRef.current;
      if (options.pickingMode) options.onPickElement?.(elementId);
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

    /**
     * 依据当前绑定与「点位预览」开关重建气泡层。
     *
     * 每个绑定生成一条 SVG 连线（单元质心 → 悬挂点）与一个 HTML 气泡，
     * 世界坐标锚点存入 bubblesRef，由 animate 循环逐帧投影到屏幕更新位置。
     * 连线终点从质心沿「远离模型中心」的水平方向 + 竖直向上偏移，偏移固定
     * 于模型坐标系，因此旋转视角时气泡跟随模型移动而不会跳动。
     */
    const rebuildPointBubbles = () => {
      bubblesRef.current.clear();
      const layer = bubbleLayerRef.current;
      if (layer) layer.replaceChildren();
      if (!layer || !modelMesh || !elementCentroids) return;
      const options = optionsRef.current;
      if (!options.pointPreview) return;
      scene.updateMatrixWorld(true);
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', 'point-bubble-svg');
      layer.appendChild(svg);
      for (const binding of options.bindings) {
        const centroid = elementCentroids.get(binding.element_id);
        // 模型整体替换后旧绑定可能指向已不存在的单元：跳过即可。
        if (!centroid) continue;
        const anchor = centroid.clone();
        modelMesh.localToWorld(anchor);
        const outward = new THREE.Vector3(anchor.x - modelCenter.x, 0, anchor.z - modelCenter.z);
        if (outward.lengthSq() < 1e-12) outward.set(0, 0, 1);
        outward.normalize();
        const tip = anchor
          .clone()
          .addScaledVector(outward, modelRadius * 0.08)
          .add(new THREE.Vector3(0, modelRadius * 0.14, 0));
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('class', 'point-bubble-line');
        svg.appendChild(line);
        const dot = document.createElementNS(SVG_NS, 'circle');
        dot.setAttribute('class', 'point-bubble-dot');
        dot.setAttribute('r', '5');
        svg.appendChild(dot);
        const bubble = document.createElement('div');
        bubble.className = 'point-bubble';
        bubble.textContent = binding.point_name || binding.point_id;
        bubble.title = `${binding.point_id} ${binding.point_name} · 单元 ${binding.element_id}`;
        bubble.addEventListener('click', (event) => {
          event.stopPropagation();
          selectElement(binding.element_id);
        });
        layer.appendChild(bubble);
        bubblesRef.current.set(binding.point_db_id, { anchor, tip, line, dot, bubble });
      }
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
        modelCenter = modelBounds.getCenter(new THREE.Vector3());
        const maxDimension = Math.max(modelSize.x, modelSize.y, modelSize.z, 1);
        modelRadius = modelSize.length() / 2;
        scene.fog = new THREE.Fog('#f3f6f8', maxDimension * 2.4, maxDimension * 8);
        const grid = new THREE.GridHelper(maxDimension * 3, 24, '#b9cbd6', '#dce6ec');
        grid.position.set(modelCenter.x, modelBounds.min.y - maxDimension * 0.06, modelCenter.z);
        scene.add(grid);

        // 逐单元质心：点位气泡连线起点（GLB 已三角化，mapping 把三角形
        // 映射回求解器单元 ID，同一单元所有三角形顶点取平均即为质心）。
        const centroidSums = new Map<number, { sum: THREE.Vector3; vertexCount: number }>();
        const positionArray = geometry?.getAttribute('position').array as ArrayLike<number> | undefined;
        if (positionArray) {
          for (let triangle = 0; triangle < mapping.length; triangle += 1) {
            const elementId = mapping[triangle];
            let entry = centroidSums.get(elementId);
            if (!entry) {
              entry = { sum: new THREE.Vector3(), vertexCount: 0 };
              centroidSums.set(elementId, entry);
            }
            for (let corner = 0; corner < 3; corner += 1) {
              const base = (triangle * 3 + corner) * 3;
              entry.sum.x += positionArray[base];
              entry.sum.y += positionArray[base + 1];
              entry.sum.z += positionArray[base + 2];
            }
            entry.vertexCount += 3;
          }
          elementCentroids = new Map(
            [...centroidSums.entries()].map(([elementId, entry]) => [
              elementId,
              entry.sum.divideScalar(entry.vertexCount),
            ]),
          );
        }

        runtimeRef.current = {
          applyColors,
          buildMeshLines,
          buildBoundaryLines,
          applyMaterialMode,
          fitView,
          back,
          rebuildPointBubbles,
        };
        applyColors(selectedRef.current);
        buildMeshLines();
        buildBoundaryLines();
        applyMaterialMode();
        fitView('front');
        rebuildPointBubbles();
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
        selectElement(null);
        return;
      }
      const faceIndex = hits[0].faceIndex;
      if (faceIndex != null && mapping[faceIndex] !== undefined) {
        selectElement(mapping[faceIndex]);
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

    // 点位气泡逐帧投影：把世界坐标锚点/悬挂点换算为屏幕坐标并写到 DOM。
    // 必须以 canvas 自身的显示框为投影基准而不是宿主容器：canvas 的 CSS
    // 尺寸由样式表决定，可能与宿主尺寸（=缓冲区/DPR）不一致，用错基准
    // 会让气泡与单元整体错位。
    const bubbleAnchor = new THREE.Vector3();
    const bubbleTip = new THREE.Vector3();
    const updateBubbles = () => {
      if (!bubblesRef.current.size) return;
      const canvasRect = renderer.domElement.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      if (canvasRect.width < 2 || canvasRect.height < 2) return;
      const baseX = canvasRect.left - hostRect.left;
      const baseY = canvasRect.top - hostRect.top;
      for (const item of bubblesRef.current.values()) {
        bubbleAnchor.copy(item.anchor).project(camera);
        bubbleTip.copy(item.tip).project(camera);
        const anchorX = baseX + (bubbleAnchor.x * 0.5 + 0.5) * canvasRect.width;
        const anchorY = baseY + (-bubbleAnchor.y * 0.5 + 0.5) * canvasRect.height;
        const tipX = baseX + (bubbleTip.x * 0.5 + 0.5) * canvasRect.width;
        const tipY = baseY + (-bubbleTip.y * 0.5 + 0.5) * canvasRect.height;
        // 投影 z 超出 [-1, 1] 表示点在相机背后或裁剪面之外，连同出界的一并隐藏。
        const visible =
          bubbleAnchor.z > -1 &&
          bubbleAnchor.z < 1 &&
          bubbleTip.z > -1 &&
          bubbleTip.z < 1 &&
          tipX > baseX - 80 &&
          tipX < baseX + canvasRect.width + 80 &&
          tipY > baseY - 80 &&
          tipY < baseY + canvasRect.height + 80;
        const display = visible ? '' : 'none';
        item.bubble.style.display = display;
        item.line.style.display = display;
        item.dot.style.display = display;
        if (!visible) continue;
        item.bubble.style.left = `${tipX}px`;
        item.bubble.style.top = `${tipY}px`;
        item.line.setAttribute('x1', anchorX.toFixed(1));
        item.line.setAttribute('y1', anchorY.toFixed(1));
        item.line.setAttribute('x2', tipX.toFixed(1));
        item.line.setAttribute('y2', tipY.toFixed(1));
        item.dot.setAttribute('cx', anchorX.toFixed(1));
        item.dot.setAttribute('cy', anchorY.toFixed(1));
      }
    };

    let frame = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      updateBubbles();
      frame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      bubblesRef.current.clear();
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

  // 绑定或气泡开关变化：重建气泡层（模型未就绪时为空操作，加载完成后会自动重建）。
  useEffect(() => {
    runtimeRef.current?.rebuildPointBubbles();
  }, [bindings, pointPreview]);

  const setView = (preset: ViewPreset) => {
    runtimeRef.current?.fitView(preset);
  };

  return (
    <div className="viewer-host" aria-label="有限元模型三维视图" aria-busy={viewBusy}>
      <div className="viewer-canvas" ref={hostRef} />
      {pointPreview && <div className="point-bubble-layer" ref={bubbleLayerRef} />}
      <div className="viewer-actions" aria-label="三维视图控制">
        <button aria-pressed={activePreset === 'front'} className={activePreset === 'front' ? 'active' : ''} onClick={() => setView('front')} title="快捷键 1">
          正视
        </button>
        <button aria-pressed={activePreset === 'iso'} className={activePreset === 'iso' ? 'active' : ''} onClick={() => setView('iso')} title="快捷键 F / 2">
          等轴（适应窗口）
        </button>
      </div>
      <div className="viewer-status">
        {pickingMode
          ? '绑定编辑：左键点击模型选择单元'
          : selectedElement != null
            ? `已选择单元 ${selectedElement}，点击空白处取消选择`
            : '点击网格选择单元'}
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
