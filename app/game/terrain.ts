import { generateCenterline } from "./trackPath";
import { getMap } from "./maps";

const CELL = 10; // terrain grid spacing
const BUCKET = 50; // spatial hash size for nearest-road queries
const BLEND_NEAR = 14; // flat shoulder on each side of the road
const BLEND_FAR = 100; // where the land is fully "mountain"
/** Terrain near the road sits well below it: the drivable surface is an exact ribbon (road + shoulders), so mesh interpolation error can never poke through. */
const SHOULDER_DROP = 1.6;

export interface Terrain {
  heightAt: (x: number, z: number) => number;
  vertices: Float32Array;
  indices: Uint32Array;
  uvs: Float32Array;
  colors: Float32Array;
}

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function hash(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, seed);
  const b = hash(ix + 1, iz, seed);
  const c = hash(ix, iz + 1, seed);
  const d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

function fbm(x: number, z: number, seed: number): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < 5; o++) {
    sum += amp * valueNoise(x * freq, z * freq, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2.05;
  }
  return sum / norm;
}

const cache = new Map<string, Terrain>();

/**
 * Heightfield that is flat under and beside the road (following its elevation),
 * then blends into rolling hills and a ring of mountains around the track.
 */
export function getTerrain(mapId: string): Terrain {
  const hit = cache.get(mapId);
  if (hit) return hit;

  const map = getMap(mapId);
  const path = generateCenterline(mapId);
  const seed = mapId.length * 131 + mapId.charCodeAt(0);

  const buckets = new Map<string, number[]>();
  let cx = 0;
  let cz = 0;
  path.forEach((p, i) => {
    const key = `${Math.floor(p.x / BUCKET)},${Math.floor(p.z / BUCKET)}`;
    const list = buckets.get(key);
    if (list) list.push(i);
    else buckets.set(key, [i]);
    cx += p.x;
    cz += p.z;
  });
  cx /= path.length;
  cz /= path.length;
  let rMax = 0;
  for (const p of path) rMax = Math.max(rMax, Math.hypot(p.x - cx, p.z - cz));

  const t = map.theme.terrain;
  const half = rMax + 340;

  const nearestRoad = (x: number, z: number): { d: number; e: number } => {
    const bx = Math.floor(x / BUCKET);
    const bz = Math.floor(z / BUCKET);
    let best = Infinity;
    let e = 0;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const list = buckets.get(`${bx + dx},${bz + dz}`);
        if (!list) continue;
        for (const i of list) {
          const p = path[i];
          const d2 = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
          if (d2 < best) {
            best = d2;
            e = p.y;
          }
        }
      }
    }
    return { d: Math.sqrt(best), e };
  };

  const mountain = (x: number, z: number) => {
    const n = fbm(x * 0.0045, z * 0.0045, seed);
    const detail = fbm(x * 0.02, z * 0.02, seed + 99);
    let h = t.base + t.amp * Math.pow(Math.min(1, n * 1.35), 1.5) + t.amp * 0.12 * detail;
    const r = Math.hypot(x - cx, z - cz);
    const ring = smooth(rMax + 70, rMax + 330, r);
    h += t.rim * Math.pow(ring, 1.2) * (0.75 + 0.5 * fbm(x * 0.008, z * 0.008, seed + 7));
    return h;
  };

  const heightAt = (x: number, z: number): number => {
    const { d, e } = nearestRoad(x, z);
    const blend = smooth(BLEND_NEAR, BLEND_FAR, d);
    if (blend <= 0) return e - SHOULDER_DROP;
    const m = mountain(x, z);
    return (e - SHOULDER_DROP) * (1 - blend) + m * blend;
  };

  const n = Math.ceil((half * 2) / CELL) + 1;
  const vertices = new Float32Array(n * n * 3);
  const uvs = new Float32Array(n * n * 2);
  const heights = new Float32Array(n * n);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const x = cx - half + ix * CELL;
      const z = cz - half + iz * CELL;
      const h = heightAt(x, z);
      const k = iz * n + ix;
      heights[k] = h;
      vertices.set([x, h, z], k * 3);
      uvs.set([x / 7.5, z / 7.5], k * 2);
    }
  }

  const colors = new Float32Array(n * n * 3);
  const rock = [
    parseInt(t.rock.slice(1, 3), 16) / 255,
    parseInt(t.rock.slice(3, 5), 16) / 255,
    parseInt(t.rock.slice(5, 7), 16) / 255,
  ];
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const k = iz * n + ix;
      const hx = heights[iz * n + Math.min(n - 1, ix + 1)] - heights[iz * n + Math.max(0, ix - 1)];
      const hz = heights[Math.min(n - 1, iz + 1) * n + ix] - heights[Math.max(0, iz - 1) * n + ix];
      const slope = Math.hypot(hx, hz) / (2 * CELL);
      const alt = smooth(t.base + t.amp * 0.55, t.base + t.amp + t.rim * 0.4, heights[k]);
      const rf = Math.max(smooth(0.32, 0.8, slope), alt * 0.85);
      colors[k * 3] = 1 + (rock[0] * 1.6 - 1) * rf;
      colors[k * 3 + 1] = 1 + (rock[1] * 1.6 - 1) * rf;
      colors[k * 3 + 2] = 1 + (rock[2] * 1.6 - 1) * rf;
    }
  }

  const indices = new Uint32Array((n - 1) * (n - 1) * 6);
  let w = 0;
  for (let iz = 0; iz < n - 1; iz++) {
    for (let ix = 0; ix < n - 1; ix++) {
      const a = iz * n + ix;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      indices[w++] = a;
      indices[w++] = c;
      indices[w++] = b;
      indices[w++] = b;
      indices[w++] = c;
      indices[w++] = d;
    }
  }

  const terrain: Terrain = { heightAt, vertices, indices, uvs, colors };
  cache.set(mapId, terrain);
  return terrain;
}
