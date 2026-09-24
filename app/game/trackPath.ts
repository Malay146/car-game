import * as THREE from "three";
import { DEFAULT_MAP_ID, getMap } from "./maps";

export const TRACK = {
  roadWidth: 10,
  kerbWidth: 0.9,
  wallOffset: 8.5, // centerline to inner face of the barrier
  spacing: 1.5, // distance between centerline samples
};

export interface PathPoint {
  x: number;
  z: number;
  /** Road surface elevation. */
  y: number;
  heading: number; // radians, 0 = +Z, pi/2 = +X (travel direction)
  curvature: number; // signed, 1/radius; positive = turning right (clockwise seen from above)
}

let activeMapId = DEFAULT_MAP_ID;
const cache = new Map<string, { path: PathPoint[]; length: number }>();

export function setActiveMap(id: string) {
  activeMapId = getMap(id).id;
}

export function getActiveMapId(): string {
  return activeMapId;
}

function build(id: string) {
  const cached = cache.get(id);
  if (cached) return cached;
  const map = getMap(id);
  const curve = new THREE.CatmullRomCurve3(
    map.points.map(([x, z, y]) => new THREE.Vector3(x, y, z)),
    true,
    "centripetal"
  );
  const total = curve.getLength();
  const count = Math.round(total / TRACK.spacing);
  const raw = curve.getSpacedPoints(count).slice(0, count);

  // Rotate so index 0 sits nearest the map's start line.
  let startIdx = 0;
  let best = Infinity;
  raw.forEach((p, i) => {
    const d = Math.hypot(p.x - map.start[0], p.z - map.start[1]);
    if (d < best) {
      best = d;
      startIdx = i;
    }
  });
  const pts = raw.map((_, i) => raw[(i + startIdx) % count]);

  const path: PathPoint[] = pts.map((p, i) => {
    const prev = pts[(i - 1 + count) % count];
    const next = pts[(i + 1) % count];
    return { x: p.x, z: p.z, y: p.y, heading: Math.atan2(next.x - prev.x, next.z - prev.z), curvature: 0 };
  });
  path.forEach((p, i) => {
    const a = path[(i - 2 + count) % count].heading;
    const b = path[(i + 2) % count].heading;
    const dh = Math.atan2(Math.sin(b - a), Math.cos(b - a));
    p.curvature = -dh / (4 * TRACK.spacing);
  });
  const entry = { path, length: total };
  cache.set(id, entry);
  return entry;
}

/** Uniformly spaced, closed centerline loop for a map (defaults to the active one). */
export function generateCenterline(id: string = activeMapId): PathPoint[] {
  return build(id).path;
}

export function getTrackLength(id: string = activeMapId): number {
  return build(id).length;
}

/** Centerline sample at a fraction (0..1) of the lap. */
export function pointAtFraction(f: number, id: string = activeMapId): PathPoint & { index: number } {
  const path = generateCenterline(id);
  const index = ((Math.floor(f * path.length) % path.length) + path.length) % path.length;
  return { ...path[index], index };
}

/** Start line pose (index 0 of the centerline). */
export function getStartTransform(): { x: number; z: number; y: number; heading: number } {
  const p = generateCenterline()[0];
  return { x: p.x, z: p.z, y: p.y, heading: p.heading };
}

/** Staggered grid behind the start line: each slot 5 units further back, alternating sides. */
export function getGridSlot(slot: number): { x: number; z: number; y: number; heading: number } {
  const path = generateCenterline();
  const back = Math.round((4 + slot * 5) / TRACK.spacing);
  const p = path[(path.length - back) % path.length];
  const lateral = slot % 2 === 0 ? -1.8 : 1.8;
  return {
    x: p.x + Math.cos(p.heading) * lateral,
    z: p.z - Math.sin(p.heading) * lateral,
    y: p.y,
    heading: p.heading,
  };
}

/** Finds the nearest centerline index, searching a window around `hintIndex` when given. */
export function nearestIndex(
  path: PathPoint[],
  x: number,
  z: number,
  hintIndex?: number,
  window = 40
): number {
  let searchStart = 0;
  let searchEnd = path.length;
  if (hintIndex !== undefined) {
    searchStart = hintIndex - window;
    searchEnd = hintIndex + window;
  }
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = searchStart; i < searchEnd; i++) {
    const idx = ((i % path.length) + path.length) % path.length;
    const p = path[idx];
    const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = idx;
    }
  }
  return bestIdx;
}

const cpCache = new Map<string, number[]>();

/** Centerline indices of the checkpoints (index 0 is the start line), kept clear of ramps. */
export function getCheckpoints(id: string = activeMapId): number[] {
  const hit = cpCache.get(id);
  if (hit) return hit;
  const path = generateCenterline(id);
  const n = path.length;
  const map = getMap(id);
  const count = Math.max(6, Math.round(getTrackLength(id) / 170));
  const out: number[] = [0];
  for (let k = 1; k < count; k++) {
    let idx = Math.floor((k * n) / count);
    for (let tries = 0; tries < 40; tries++) {
      const p = path[idx % n];
      if (!map.ramps.some((r) => Math.hypot(p.x - r.at[0], p.z - r.at[1]) < 45)) break;
      idx += 12;
    }
    out.push(idx % n);
  }
  out.sort((a, b) => a - b);
  cpCache.set(id, out);
  return out;
}
