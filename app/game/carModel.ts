import * as THREE from "three";
import type { QualityLevel } from "./settings";

export interface WheelInfo {
  node: THREE.Object3D | null;
  front: boolean;
  /** Wheel centre in car space (the node's local position) */
  x: number;
  y: number;
  z: number;
  radius: number;
}

const WHEEL_NAME = /wheel|tyre|tire/i;
const DEFAULT_RADIUS = 0.3;

/**
 * Locate the four wheels (order: front-left, front-right, back-left, back-right). Works from node names, then sorts
 * them into corners by position (so any naming scheme works). If a model has no usable wheel nodes, virtual wheels are
 * placed at the corners of its bounding box (no visual wheel is animated then).
 */
export function findWheels(root: THREE.Object3D): WheelInfo[] {
  root.updateMatrixWorld(true);
  const found: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o === root || !WHEEL_NAME.test(o.name)) return;
    // only the outermost matching node (a wheel's own children are not separate wheels)
    let p = o.parent;
    while (p && p !== root) {
      if (WHEEL_NAME.test(p.name)) return;
      p = p.parent;
    }
    found.push(o);
  });

  if (found.length === 4) {
    const zs = found.map((n) => n.position.z).sort((a, b) => a - b);
    const midZ = (zs[1] + zs[2]) / 2;
    const infos = found.map((node) => {
      const size = new THREE.Box3().setFromObject(node).getSize(new THREE.Vector3());
      return {
        node,
        front: node.position.z > midZ,
        x: node.position.x,
        y: node.position.y,
        z: node.position.z,
        radius: Math.max(0.12, size.y / 2) || DEFAULT_RADIUS,
      };
    });
    const side = (w: WheelInfo) => (w.x >= 0 ? 1 : 0);
    // FL, FR, BL, BR: left (+x) first within each axle
    const pick = (front: boolean, left: boolean) => infos.filter((w) => w.front === front && (side(w) === 1) === left);
    const ordered = [pick(true, true), pick(true, false), pick(false, true), pick(false, false)];
    if (ordered.every((g) => g.length === 1)) return ordered.map((g) => g[0]);
  }

  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  const hx = (size.x / 2) * 0.8;
  const hz = (size.z / 2) * 0.62;
  return [
    { node: null, front: true, x: hx, y: DEFAULT_RADIUS, z: hz, radius: DEFAULT_RADIUS },
    { node: null, front: true, x: -hx, y: DEFAULT_RADIUS, z: hz, radius: DEFAULT_RADIUS },
    { node: null, front: false, x: hx, y: DEFAULT_RADIUS, z: -hz, radius: DEFAULT_RADIUS },
    { node: null, front: false, x: -hx, y: DEFAULT_RADIUS, z: -hz, radius: DEFAULT_RADIUS },
  ];
}

export interface CarInstance {
  root: THREE.Object3D;
  /** Materials that take the player's paint colour (owned by this instance). */
  paint: THREE.Material[];
}

/**
 * Clone a loaded car so each instance owns its paint material: tinting one car never recolours another. Only the
 * material named "paint" is tinted (never glass, tyres or lights); models without one tint the mesh named "body".
 * Paint gets a glossy clear-coat finish (cheaper standard material on low quality) so it picks up the environment.
 */
export function cloneCar(scene: THREE.Object3D, quality: QualityLevel): CarInstance {
  const root = scene.clone(true);
  const paint: THREE.Material[] = [];
  const made = new Map<THREE.Material, THREE.Material>();
  const makePaint = (src: THREE.Material): THREE.Material => {
    let m = made.get(src);
    if (!m) {
      const s = src as THREE.MeshStandardMaterial;
      m =
        quality === "low"
          ? new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.2, envMapIntensity: 0.9, map: s.map ?? null })
          : new THREE.MeshPhysicalMaterial({
              roughness: 0.42,
              metalness: 0.22,
              clearcoat: 0.9,
              clearcoatRoughness: 0.07,
              envMapIntensity: 1.0,
              map: s.map ?? null,
            });
      made.set(src, m);
      paint.push(m);
    }
    return m;
  };
  let hasPaint = false;
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.castShadow = true;
    if (Array.isArray(o.material)) {
      o.material = o.material.map((m) => {
        if (m.name === "paint") {
          hasPaint = true;
          return makePaint(m);
        }
        return m;
      });
    } else if (o.material.name === "paint") {
      hasPaint = true;
      o.material = makePaint(o.material);
    }
  });
  if (!hasPaint) {
    const body = root.getObjectByName("body");
    if (body instanceof THREE.Mesh && !Array.isArray(body.material)) {
      const m = (body.material as THREE.MeshStandardMaterial).clone();
      m.roughness = 0.35;
      m.metalness = 0.3;
      body.material = m;
      paint.push(m);
    }
  }
  return { root, paint };
}

const tmp = new THREE.Color();
export function tintPaint(paint: THREE.Material[], color: string) {
  tmp.set(color);
  for (const m of paint) (m as THREE.MeshStandardMaterial).color.copy(tmp);
}

/** Car-space hull dimensions from the model's bounding box. */
export function carSize(root: THREE.Object3D): THREE.Vector3 {
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
}
