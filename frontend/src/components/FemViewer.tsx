import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// Keep the mesh deliberately quiet so the selected solver element stays the
// visual focus of the preview.
const BASE_COLOR = new THREE.Color('#6f899a');
const SELECTED_COLOR = new THREE.Color('#d9544d');
type ViewPreset = 'front' | 'iso' | 'fit';

interface FemViewerProps {
  glbUrl: string;
  mappingUrl: string;
}

export function FemViewer({ glbUrl, mappingUrl }: FemViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedElement, setSelectedElement] = useState<number | null>(null);
  const [activePreset, setActivePreset] = useState<ViewPreset>('front');
  const selectedRef = useRef(selectedElement);
  const runtimeRef = useRef<{
    geometry: THREE.BufferGeometry | null;
    mapping: number[];
    fitView: (preset: ViewPreset) => void;
    fit: () => void;
    back: () => void;
  } | null>(null);

  selectedRef.current = selectedElement;

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
    let geometry: THREE.BufferGeometry | null = null;
    let mapping: number[] = [];
    let modelBounds: THREE.Box3 | null = null;
    let disposed = false;

    const applySelectionColors = (elementId: number | null) => {
      if (!geometry) return;
      const position = geometry.getAttribute('position');
      let color = geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
      if (!color) {
        color = new THREE.BufferAttribute(new Float32Array(position.count * 3), 3);
        geometry.setAttribute('color', color);
      }
      for (let triangle = 0; triangle < mapping.length; triangle += 1) {
        const tint = mapping[triangle] === elementId ? SELECTED_COLOR : BASE_COLOR;
        for (let corner = 0; corner < 3; corner += 1) {
          color.setXYZ(triangle * 3 + corner, tint.r, tint.g, tint.b);
        }
      }
      color.needsUpdate = true;
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
    const fit = () => {
      if (!modelBounds) return;
      viewHistory.push(captureView());
      if (viewHistory.length > 32) viewHistory.shift();
      fitView('front');
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
          node.material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.72,
            metalness: 0.08,
            emissive: '#e3edf2',
            emissiveIntensity: 0.2,
            side: THREE.DoubleSide,
          });
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
        applySelectionColors(selectedRef.current);
        runtimeRef.current = { geometry, mapping, fitView, fit, back };
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
        applySelectionColors(null);
        return;
      }
      const faceIndex = hits[0].faceIndex;
      if (faceIndex != null && mapping[faceIndex] !== undefined) {
        const elementId = mapping[faceIndex];
        setSelectedElement(elementId);
        applySelectionColors(elementId);
      }
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'f') fit();
      if (event.key.toLowerCase() === 'b') back();
      if (event.key === '1') fitView('front');
      if (event.key === '2') fitView('iso');
    };
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute(
      'aria-label',
      '有限元三维视图；中键拖动旋转，右键拖动平移，滚轮缩放，点击选择单元，F 适应视图，B 返回上一视图，1 正视，2 等轴视图',
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

  // Selection changes re-tint triangles without reloading the model.
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime?.geometry) return;
    const color = runtime.geometry.getAttribute('color') as THREE.BufferAttribute;
    if (!color) return;
    for (let triangle = 0; triangle < runtime.mapping.length; triangle += 1) {
      const tint = runtime.mapping[triangle] === selectedElement ? SELECTED_COLOR : BASE_COLOR;
      for (let corner = 0; corner < 3; corner += 1) {
        color.setXYZ(triangle * 3 + corner, tint.r, tint.g, tint.b);
      }
    }
    color.needsUpdate = true;
  }, [selectedElement]);

  const setView = (preset: ViewPreset) => {
    if (preset === 'fit') runtimeRef.current?.fit();
    else runtimeRef.current?.fitView(preset);
  };

  return (
    <div className="viewer-host" aria-label="有限元模型三维视图">
      <div className="viewer-canvas" ref={hostRef} />
      <div className="viewer-actions" aria-label="三维视图控制">
        <button aria-pressed={activePreset === 'front'} className={activePreset === 'front' ? 'active' : ''} onClick={() => setView('front')} title="快捷键 1">
          正视
        </button>
        <button aria-pressed={activePreset === 'iso'} className={activePreset === 'iso' ? 'active' : ''} onClick={() => setView('iso')} title="快捷键 2">
          等轴
        </button>
        <button aria-pressed={activePreset === 'fit'} className={activePreset === 'fit' ? 'active' : ''} onClick={() => setView('fit')} title="快捷键 F">
          适应
        </button>
      </div>
      <div className="viewer-status">
        {selectedElement != null ? `已选择单元 ${selectedElement}，点击空白处取消选择` : '点击网格选择单元'}
      </div>
      <div className="viewer-help">中键拖动旋转 · 右键拖动平移 · 滚轮缩放 · 点击选择 · F 适应 · B 返回</div>
      {loadError && (
        <div className="viewer-error" role="alert">
          模型载入失败：{loadError}
        </div>
      )}
    </div>
  );
}
