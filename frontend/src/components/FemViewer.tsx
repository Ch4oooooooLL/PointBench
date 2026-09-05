import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FemGroupingData, Point, PointElementBinding } from '../types';

// Keep the mesh deliberately quiet so the selected solver element stays the
// visual focus of the preview.
const BASE_COLOR = new THREE.Color('#6f899a');
const SELECTED_COLOR = new THREE.Color('#d9544d');
const GRID_LINE_COLOR = new THREE.Color('#4b6b7d');
const BOUNDARY_LINE_COLOR = new THREE.Color('#1f2937');
type ViewPreset = 'front' | 'iso';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 聚焦单元时的候选视线偏角（度）：先取当前方向，再按小角度扰动避遮挡。 */
const VIEW_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [25, 0],
  [-25, 0],
  [0, 25],
  [0, -25],
  [25, 25],
  [25, -25],
  [-25, 25],
  [-25, -25],
  [45, 0],
  [-45, 0],
  [0, 45],
  [0, -45],
];

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
  /** 项目点位列表（气泡悬浮展开时展示点位基本情况）。 */
  points: Point[];
  /** 仅展示该点位的气泡；null 表示展示全部已绑定点位的气泡。 */
  focusedPointDbId: number | null;
  /** focusNonce 变化时，把镜头聚焦到当前聚焦点位绑定的单元。 */
  focusNonce: number;
  /** 右侧点位列表开启时为 true：顶部状态条为列表让位。 */
  sideListOpen: boolean;
}

interface ViewerRuntime {
  applyColors: (elementId: number | null) => void;
  buildMeshLines: () => void;
  buildBoundaryLines: () => void;
  applyMaterialMode: () => void;
  fitView: (preset: ViewPreset) => void;
  back: () => void;
  rebuildPointBubbles: () => void;
  /** 把镜头移到指定单元附近（尽量无遮挡）。 */
  focusElement: (elementId: number) => boolean;
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
  points,
  focusedPointDbId,
  focusNonce,
  sideListOpen,
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
    points,
    focusedPointDbId,
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
    points,
    focusedPointDbId,
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
    // 逐单元尺寸/朝向信息，聚焦单元时选取拍摄方向用。
    let elementMeta: Map<number, { radius: number; normal: THREE.Vector3 | null }> | null = null;
    let modelCenter = new THREE.Vector3();
    let modelRadius = 1;
    let disposed = false;
    const rayDirection = new THREE.Vector3();

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

    /** 数值格式化：按量级取小数位，避免长浮点串。 */
    const formatMetric = (value: number): string => {
      const abs = Math.abs(value);
      if (abs >= 1000) return value.toFixed(0);
      if (abs >= 1) return value.toFixed(1);
      return value.toFixed(2);
    };

    /** 状态值着色：明确完成 → ok；未完成 → warn；其他 → 中性。 */
    const statusTone = (value: string, done: string): 'ok' | 'warn' | undefined => {
      if (value === done) return 'ok';
      if (value.startsWith('未')) return 'warn';
      return undefined;
    };

    /** 气泡悬浮展开的点位详情卡片（纯 DOM + textContent，避免注入）。 */
    const buildBubbleDetail = (binding: PointElementBinding, info: Point | undefined): HTMLDivElement => {
      const card = document.createElement('div');
      card.className = 'point-bubble-detail';

      const chip = (text: string, tone?: 'danger' | 'element') => {
        const el = document.createElement('span');
        el.className = `pbd-chip${tone ? ` ${tone}` : ''}`;
        el.textContent = text;
        return el;
      };

      // 头部：点位名称 + 编号/类型/异常徽标
      const head = document.createElement('div');
      head.className = 'pbd-head';
      const title = document.createElement('div');
      title.className = 'pbd-title';
      title.textContent = binding.point_name || binding.point_id;
      head.appendChild(title);
      const badges = document.createElement('div');
      badges.className = 'pbd-badges';
      badges.appendChild(chip(info ? info.point_id : binding.point_id));
      if (info?.point_type) badges.appendChild(chip(info.point_type));
      if (info?.latest_measurement?.is_abnormal) badges.appendChild(chip('异常', 'danger'));
      head.appendChild(badges);
      card.appendChild(head);

      // 最新测量：应变幅 / 应力幅两个数值块，无数据显示 --
      const latest = info?.latest_measurement;
      const stats = document.createElement('div');
      stats.className = 'pbd-stats';
      const addStat = (value: number | null | undefined, label: string) => {
        const box = document.createElement('div');
        box.className = 'pbd-stat';
        const num = document.createElement('em');
        num.textContent = value != null ? formatMetric(value) : '--';
        const cap = document.createElement('span');
        cap.textContent = label;
        box.append(num, cap);
        stats.appendChild(box);
      };
      addStat(latest?.amplitude_strain_ue ?? null, '应变幅 με');
      addStat(latest?.stress_amplitude_mpa ?? null, '应力幅 MPa');
      card.appendChild(stats);

      // 基础信息行（仅展示有值的字段）
      const rows = document.createElement('div');
      rows.className = 'pbd-rows';
      const addRow = (label: string, value?: string | null, tone?: 'ok' | 'warn') => {
        if (!value) return;
        const row = document.createElement('div');
        row.className = 'pbd-row';
        const labelSpan = document.createElement('span');
        labelSpan.className = 'pbd-row-label';
        labelSpan.textContent = label;
        const valueSpan = document.createElement('span');
        valueSpan.className = `pbd-row-value${tone ? ` ${tone}` : ''}`;
        valueSpan.textContent = value;
        row.append(labelSpan, valueSpan);
        rows.appendChild(row);
      };
      addRow('部件', [info?.component, info?.side].filter(Boolean).join(' · ') || null);
      addRow('位置', info?.position_description);
      addRow('方向', info?.direction);
      addRow('通道', info?.channels?.[0]?.channel_name ?? null);
      addRow('安装', info?.install_status, info?.install_status ? statusTone(info.install_status, '已安装') : undefined);
      addRow('检查', info?.check_status, info?.check_status ? statusTone(info.check_status, '已核查') : undefined);
      if (rows.childElementCount) card.appendChild(rows);

      // 底部：绑定的单元
      const foot = document.createElement('div');
      foot.className = 'pbd-foot';
      foot.appendChild(chip(`绑定单元 ${binding.element_id}`, 'element'));
      card.appendChild(foot);

      return card;
    };

    /**
     * 依据当前绑定与「点位预览」开关重建气泡层。
     *
     * 每个绑定生成一条 SVG 连线（单元质心 → 悬挂点）与一个 HTML 气泡，
     * 世界坐标锚点存入 bubblesRef，由 animate 循环逐帧投影到屏幕更新位置。
     * 连线终点从质心沿「远离模型中心」的水平方向 + 竖直向上偏移，偏移固定
     * 于模型坐标系，因此旋转视角时气泡跟随模型移动而不会跳动。
     * 指定 focusedPointDbId 时只渲染该点位的气泡（右侧点位列表点选后的单点展示）。
     */
    const rebuildPointBubbles = () => {
      bubblesRef.current.clear();
      const layer = bubbleLayerRef.current;
      if (layer) layer.replaceChildren();
      if (!layer || !modelMesh || !elementCentroids) return;
      const options = optionsRef.current;
      if (!options.pointPreview) return;
      scene.updateMatrixWorld(true);
      const visibleBindings =
        options.focusedPointDbId == null
          ? options.bindings
          : options.bindings.filter((binding) => binding.point_db_id === options.focusedPointDbId);
      if (!visibleBindings.length) return;
      const pointsById = new Map(options.points.map((point) => [point.id, point]));
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', 'point-bubble-svg');
      layer.appendChild(svg);
      for (const binding of visibleBindings) {
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
        const name = document.createElement('span');
        name.className = 'point-bubble-name';
        name.textContent = binding.point_name || binding.point_id;
        bubble.appendChild(name);
        bubble.appendChild(buildBubbleDetail(binding, pointsById.get(binding.point_db_id)));
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

    /**
     * 相机平滑过渡：聚焦单元时在 ~0.4s 内缓动到目标机位，观感是"取景
     * 微调"而不是视角跳变。用户按下鼠标/滚轮即中断，交还控制权。
     */
    let cameraAnim = 0;
    const cancelCameraAnim = () => {
      if (cameraAnim) {
        cancelAnimationFrame(cameraAnim);
        cameraAnim = 0;
      }
    };
    const animateCameraTo = (position: THREE.Vector3, target: THREE.Vector3) => {
      cancelCameraAnim();
      const startPos = camera.position.clone();
      const startTarget = controls.target.clone();
      const startTime = performance.now();
      const duration = 420;
      const step = () => {
        const t = Math.min((performance.now() - startTime) / duration, 1);
        const k = t * t * (3 - 2 * t);
        camera.position.lerpVectors(startPos, position, k);
        controls.target.lerpVectors(startTarget, target, k);
        camera.lookAt(controls.target);
        cameraAnim = t < 1 ? requestAnimationFrame(step) : 0;
      };
      cameraAnim = requestAnimationFrame(step);
    };
    const onAnimInterrupt = () => cancelCameraAnim();
    renderer.domElement.addEventListener('pointerdown', onAnimInterrupt);
    renderer.domElement.addEventListener('wheel', onAnimInterrupt, { passive: true });

    /**
     * 把镜头移到指定单元附近：以当前视线方向为基准（等轴视角下就是
     * 等轴视角的微调），只重新取景不翻转朝向；若该方向上单元被遮挡，
     * 则在当前方向附近做小角度扰动（水平/竖直 ±25°→±45°），取第一个
     * 能看清目标单元的方向，尽量无遮挡。全程平滑过渡。
     * 返回是否成功定位（单元不存在时返回 false）。
     */
    const focusElement = (elementId: number): boolean => {
      if (!modelMesh || !elementCentroids || !elementMeta) return false;
      const center = elementCentroids.get(elementId);
      const meta = elementMeta.get(elementId);
      if (!center) return false;

      const radius = meta?.radius ?? modelRadius * 0.02;
      const distance = Math.max(radius * 6, modelRadius * 0.35);

      // 基准方向 = 当前视线方向（从观察目标指向相机）。
      const base = new THREE.Vector3().subVectors(camera.position, controls.target);
      if (base.lengthSq() < 1e-12) base.set(1, 0.82, 1);
      base.normalize();
      // 扰动轴：以世界竖直方向构造一对与视线正交的水平/竖直轴。
      const worldUp = new THREE.Vector3(0, 1, 0);
      if (Math.abs(base.dot(worldUp)) > 0.95) worldUp.set(0, 0, 1);
      const axisH = new THREE.Vector3().crossVectors(worldUp, base).normalize();
      const axisV = new THREE.Vector3().crossVectors(base, axisH).normalize();
      const rotateDir = (azimuthDeg: number, polarDeg: number) =>
        base
          .clone()
          .applyAxisAngle(axisV, THREE.MathUtils.degToRad(azimuthDeg))
          .applyAxisAngle(axisH, THREE.MathUtils.degToRad(polarDeg))
          .normalize();

      let chosen = base.clone();
      const previousFar = raycaster.far;
      for (const [azimuth, polar] of VIEW_OFFSETS) {
        const dir = rotateDir(azimuth, polar);
        const eye = center.clone().addScaledVector(dir, distance);
        rayDirection.subVectors(center, eye).normalize();
        raycaster.set(eye, rayDirection);
        raycaster.far = distance + radius * 2;
        const hits = raycaster.intersectObject(modelMesh, false);
        if (!hits.length || (hits[0].faceIndex != null && mapping[hits[0].faceIndex] === elementId)) {
          chosen = dir;
          break;
        }
      }
      // 恢复 far，避免影响画布点击拾取（其依赖默认 Infinity）。
      raycaster.far = previousFar;

      viewHistory.push(captureView());
      if (viewHistory.length > 32) viewHistory.shift();
      animateCameraTo(center.clone().addScaledVector(chosen, distance), center.clone());
      return true;
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

        // 逐单元质心/朝向/尺寸：气泡连线起点与聚焦单元视角的数据源
        // （GLB 已三角化，mapping 把三角形映射回求解器单元 ID）。
        const centroidSums = new Map<
          number,
          {
            sum: THREE.Vector3;
            vertexCount: number;
            normalSum: THREE.Vector3;
            min: THREE.Vector3;
            max: THREE.Vector3;
          }
        >();
        const positionArray = geometry?.getAttribute('position').array as ArrayLike<number> | undefined;
        if (positionArray) {
          for (let triangle = 0; triangle < mapping.length; triangle += 1) {
            const elementId = mapping[triangle];
            let entry = centroidSums.get(elementId);
            if (!entry) {
              entry = {
                sum: new THREE.Vector3(),
                vertexCount: 0,
                normalSum: new THREE.Vector3(),
                min: new THREE.Vector3(Infinity, Infinity, Infinity),
                max: new THREE.Vector3(-Infinity, -Infinity, -Infinity),
              };
              centroidSums.set(elementId, entry);
            }
            const base = triangle * 9;
            const ax = positionArray[base];
            const ay = positionArray[base + 1];
            const az = positionArray[base + 2];
            const bx = positionArray[base + 3];
            const by = positionArray[base + 4];
            const bz = positionArray[base + 5];
            const cx = positionArray[base + 6];
            const cy = positionArray[base + 7];
            const cz = positionArray[base + 8];
            entry.sum.x += ax + bx + cx;
            entry.sum.y += ay + by + cy;
            entry.sum.z += az + bz + cz;
            entry.vertexCount += 3;
            // 面积加权法线：(b-a)×(c-a)
            const e1x = bx - ax;
            const e1y = by - ay;
            const e1z = bz - az;
            const e2x = cx - ax;
            const e2y = cy - ay;
            const e2z = cz - az;
            entry.normalSum.x += e1y * e2z - e1z * e2y;
            entry.normalSum.y += e1z * e2x - e1x * e2z;
            entry.normalSum.z += e1x * e2y - e1y * e2x;
            entry.min.x = Math.min(entry.min.x, ax, bx, cx);
            entry.min.y = Math.min(entry.min.y, ay, by, cy);
            entry.min.z = Math.min(entry.min.z, az, bz, cz);
            entry.max.x = Math.max(entry.max.x, ax, bx, cx);
            entry.max.y = Math.max(entry.max.y, ay, by, cy);
            entry.max.z = Math.max(entry.max.z, az, bz, cz);
          }
          elementCentroids = new Map();
          elementMeta = new Map();
          for (const [elementId, entry] of centroidSums) {
            const centroid = entry.sum.divideScalar(entry.vertexCount);
            elementCentroids.set(elementId, centroid);
            const size = new THREE.Vector3().subVectors(entry.max, entry.min);
            const normal = entry.normalSum;
            elementMeta.set(elementId, {
              radius: Math.max(size.length() / 2, 1e-6),
              normal: normal.lengthSq() > 1e-12 ? normal.normalize() : null,
            });
          }
        }

        runtimeRef.current = {
          applyColors,
          buildMeshLines,
          buildBoundaryLines,
          applyMaterialMode,
          fitView,
          back,
          rebuildPointBubbles,
          focusElement,
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

    // 视图快捷键监听在 window 上：不依赖画布聚焦，进入页面即生效。
    // 用 event.code（物理键位）判断，不受输入法（中英文）、大小写锁定
    // 或键盘布局影响；输入法组合中（isComposing）与焦点在可编辑控件
    // （输入框/下拉/文本域）时不抢占。
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
      ) {
        return;
      }
      switch (event.code) {
        case 'Digit1':
          goView('front');
          break;
        case 'Digit2':
        case 'KeyF':
          goView('iso');
          break;
        case 'KeyB':
          back();
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute(
      'aria-label',
      '有限元三维视图；中键拖动旋转，右键拖动平移，滚轮缩放，点击选择单元，1 正视，F/2 等轴视图（自动适应窗口），B 返回上一视图',
    );
    window.addEventListener('keydown', onKeyDown);

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
      cancelCameraAnim();
      bubblesRef.current.clear();
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointerdown', onAnimInterrupt);
      renderer.domElement.removeEventListener('wheel', onAnimInterrupt);
      window.removeEventListener('keydown', onKeyDown);
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

  // 绑定/气泡开关/聚焦点位/点位详情变化：重建气泡层（模型未就绪时为空
  // 操作，加载完成后会自动重建）。
  useEffect(() => {
    runtimeRef.current?.rebuildPointBubbles();
  }, [bindings, pointPreview, focusedPointDbId, points]);

  // focusNonce 变化：把镜头聚焦到当前聚焦点位绑定的单元（右侧列表点选）。
  useEffect(() => {
    if (!focusNonce) return;
    const options = optionsRef.current;
    const binding = options.bindings.find((item) => item.point_db_id === options.focusedPointDbId);
    if (binding) runtimeRef.current?.focusElement(binding.element_id);
  }, [focusNonce]);

  const setView = (preset: ViewPreset) => {
    runtimeRef.current?.fitView(preset);
  };

  return (
    <div className={`viewer-host${sideListOpen ? ' has-side-list' : ''}`} aria-label="有限元模型三维视图" aria-busy={viewBusy}>
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
