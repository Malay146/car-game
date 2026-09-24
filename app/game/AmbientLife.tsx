"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { TRACK, generateCenterline } from "./trackPath";
import { getMap } from "./maps";
import { useQualityLevel, type QualityLevel } from "./settings";
import { animateVertices, uTime } from "./visualTime";

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HASH = "float h1(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }";

/** Set every instance to a translation (+ optional colour). */
function useInstances(ref: React.RefObject<THREE.InstancedMesh | null>, centres: THREE.Vector3[], colors?: THREE.Color[]) {
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    centres.forEach((c, i) => {
      m.makeTranslation(c.x, c.y, c.z);
      mesh.setMatrixAt(i, m);
      if (colors) mesh.setColorAt(i, colors[i % colors.length]);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [ref, centres, colors]);
}

/** Flapping bird / butterfly wings: a body-less V of two triangles. Forward = +z, span along x. */
function wingGeometry(span: number, chord: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const s = span / 2;
  const c = chord / 2;
  const pos = new Float32Array([
    0, 0, c, -s, 0, -c * 0.4, 0, 0, -c,
    0, 0, c, 0, 0, -c, s, 0, -c * 0.4,
  ]);
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function Birds({ centres, color }: { centres: THREE.Vector3[]; color: string }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => wingGeometry(1.5, 0.6), []);
  const mat = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    animateVertices(
      m,
      "birds",
      HASH,
      `
      float ph = h1(instanceMatrix[3].xz);
      float a = uTime * (0.14 + ph * 0.1) + ph * 6.2831;
      float R = 22.0 + fract(ph * 7.31) * 38.0;
      transformed.y += abs(position.x) * sin(uTime * 8.5 + ph * 20.0) * 0.7;
      float cs = cos(-a);
      float sn = sin(-a);
      transformed.xz = vec2(cs * transformed.x + sn * transformed.z, -sn * transformed.x + cs * transformed.z);
      transformed += vec3(cos(a) * R, sin(a * 3.0 + ph * 9.0) * 2.5, sin(a) * R);
      `
    );
    return m;
  }, [color]);
  useInstances(ref, centres);
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat]
  );
  return <instancedMesh ref={ref} args={[geo, mat, centres.length]} frustumCulled={false} />;
}

function Butterflies({ centres, colors }: { centres: THREE.Vector3[]; colors: THREE.Color[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => wingGeometry(0.42, 0.26), []);
  const mat = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    animateVertices(
      m,
      "butterflies",
      HASH,
      `
      float ph = h1(instanceMatrix[3].xz);
      float a = uTime * (0.5 + ph * 0.4) + ph * 6.2831;
      float R = 2.0 + fract(ph * 5.7) * 5.0;
      transformed.y += abs(position.x) * sin(uTime * 22.0 + ph * 30.0) * 1.3;
      float yaw = -a;
      float cs = cos(yaw);
      float sn = sin(yaw);
      transformed.xz = vec2(cs * transformed.x + sn * transformed.z, -sn * transformed.x + cs * transformed.z);
      transformed += vec3(sin(a) * R, sin(a * 2.3 + ph * 7.0) * 0.7, sin(a * 2.0) * R * 0.6);
      `
    );
    return m;
  }, []);
  useInstances(ref, centres, colors);
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat]
  );
  return <instancedMesh ref={ref} args={[geo, mat, centres.length]} frustumCulled={false} />;
}

/** Glowing drifting fireflies (additive points, positions computed on the GPU). */
function Fireflies({ centres, color }: { centres: THREE.Vector3[]; color: string }) {
  const { geo, mat } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(centres.length * 3);
    centres.forEach((c, i) => c.toArray(pos, i * 3));
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime, uColor: { value: new THREE.Color(color) } },
      vertexShader: `
        uniform float uTime;
        varying float vA;
        ${HASH}
        void main() {
          float ph = h1(position.xz);
          vec3 p = position;
          float a = uTime * (0.25 + ph * 0.3) + ph * 6.2831;
          p += vec3(sin(a) * 3.0, sin(a * 1.7 + ph * 5.0) * 1.2, cos(a * 1.3) * 3.0);
          vA = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * (1.5 + ph * 2.0) + ph * 20.0), 2.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = clamp(90.0 / -mv.z, 2.0, 9.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float k = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(uColor * 2.0, k * k * vA);
        }`,
    });
    return { geo: g, mat: m };
  }, [centres, color]);
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat]
  );
  return <points geometry={geo} material={mat} frustumCulled={false} />;
}

/** Slowly drifting balloons (hot-air style, striped) or glowing sky lanterns at night. */
function Balloons({ centres, colors, radius, glow }: { centres: THREE.Vector3[]; colors: THREE.Color[]; radius: number; glow: boolean }) {
  const envRef = useRef<THREE.InstancedMesh>(null);
  const basketRef = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => {
    const g = new THREE.SphereGeometry(radius, 14, 10);
    g.scale(1, 1.15, 1);
    // stripes: alternate light / dark bands around the vertical axis
    const pos = g.getAttribute("position");
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const a = Math.atan2(pos.getZ(i), pos.getX(i));
      const band = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 12) % 2 === 0;
      const v = band ? 1 : 0.55;
      col.set([v, v, v], i * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const basket = new THREE.BoxGeometry(radius * 0.32, radius * 0.24, radius * 0.32);
    basket.translate(0, -radius * 1.35, 0);
    return { g, basket };
  }, [radius]);
  const mats = useMemo(() => {
    const drift = `
      float ph = h1(instanceMatrix[3].xz);
      transformed += vec3(sin(uTime * 0.035 + ph * 6.0) * 70.0, sin(uTime * 0.22 + ph * 9.0) * 2.5, cos(uTime * 0.03 + ph * 5.0) * 70.0);
    `;
    const env = glow
      ? new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })
      : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
    const basket = new THREE.MeshStandardMaterial({ color: "#7c5a3a", roughness: 0.9 });
    animateVertices(env, glow ? "lantern" : "balloon", HASH, drift);
    animateVertices(basket, "basket", HASH, drift);
    return { env, basket };
  }, [glow]);
  useInstances(envRef, centres, colors);
  useInstances(basketRef, centres);
  useEffect(
    () => () => {
      geo.g.dispose();
      geo.basket.dispose();
      mats.env.dispose();
      mats.basket.dispose();
    },
    [geo, mats]
  );
  return (
    <>
      <instancedMesh ref={envRef} args={[geo.g, mats.env, centres.length]} frustumCulled={false} />
      {!glow && <instancedMesh ref={basketRef} args={[geo.basket, mats.basket, centres.length]} frustumCulled={false} />}
    </>
  );
}

const scale = (q: QualityLevel, hi: number, med: number) => (q === "high" ? hi : q === "medium" ? med : 0);

/** Ambient life per map theme: birds, butterflies, balloons, fireflies. All GPU-animated and instanced; off on Low quality. */
export function AmbientLife({ mapId }: { mapId: string }) {
  const quality = useQualityLevel();
  const map = getMap(mapId);

  const world = useMemo(() => {
    const path = generateCenterline(mapId);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of path) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    return { path, minX, maxX, minZ, maxZ };
  }, [mapId]);

  const data = useMemo(() => {
    const rand = mulberry32(4242 + mapId.length * 977);
    const sky = (n: number, y0: number, y1: number) =>
      Array.from({ length: n }, () => new THREE.Vector3(world.minX + rand() * (world.maxX - world.minX), y0 + rand() * (y1 - y0), world.minZ + rand() * (world.maxZ - world.minZ)));
    const nearRoad = (n: number, h0: number, h1: number, off0: number, off1: number) =>
      Array.from({ length: n }, () => {
        const p = world.path[Math.floor(rand() * world.path.length)];
        const side = rand() < 0.5 ? -1 : 1;
        const off = (TRACK.wallOffset + off0 + rand() * (off1 - off0)) * side;
        return new THREE.Vector3(p.x + Math.cos(p.heading) * off, p.y + h0 + rand() * (h1 - h0), p.z - Math.sin(p.heading) * off);
      });
    return { sky, nearRoad, rand };
  }, [world, mapId]);

  const bright = useMemo(() => ["#ef4444", "#f97316", "#facc15", "#22c55e", "#38bdf8", "#a78bfa", "#f472b6"].map((c) => new THREE.Color(c)), []);
  const lanterns = useMemo(() => ["#ffb347", "#ff7a59", "#ffd166", "#ff5d8f"].map((c) => new THREE.Color(c).multiplyScalar(2.6)), []);
  const bfly = useMemo(() => ["#fde047", "#fb923c", "#60a5fa", "#f9a8d4", "#ffffff"].map((c) => new THREE.Color(c)), []);

  const items = useMemo(() => {
    if (quality === "low") return null;
    const id = map.id;
    const night = !!map.theme.neon;
    return {
      birds: night ? [] : data.sky(scale(quality, id === "desert" ? 8 : 14, 6), 45, 85),
      butterflies: id === "circuit" ? data.nearRoad(scale(quality, 70, 30), 0.8, 2.6, 4, 16) : [],
      fireflies: night ? data.nearRoad(scale(quality, 260, 110), 0.5, 4, 3, 22) : [],
      balloons: night ? [] : id === "snow" ? [] : data.sky(scale(quality, 4, 2), 60, 90),
      lanterns: night ? data.sky(scale(quality, 26, 12), 30, 80) : [],
    };
  }, [quality, map, data]);

  if (!items) return null;
  const birdColor = map.id === "snow" ? "#1f2937" : "#222";
  return (
    <group>
      {items.birds.length > 0 && <Birds centres={items.birds} color={birdColor} />}
      {items.butterflies.length > 0 && <Butterflies centres={items.butterflies} colors={bfly} />}
      {items.fireflies.length > 0 && <Fireflies centres={items.fireflies} color="#c8ff7a" />}
      {items.balloons.length > 0 && <Balloons centres={items.balloons} colors={bright} radius={5} glow={false} />}
      {items.lanterns.length > 0 && <Balloons centres={items.lanterns} colors={lanterns} radius={2.6} glow />}
    </group>
  );
}
