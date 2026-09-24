"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { TRACK, generateCenterline } from "./trackPath";
import { getMap } from "./maps";
import { getTerrain } from "./terrain";
import { useQualityLevel, type QualityLevel } from "./settings";
import { InstancedProps, Prop, type Placement } from "./Props";
import { animateVertices } from "./visualTime";

const R = "/models/racing/";

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

/** Pit lane buildings, tents and cones beside the start straight (Kenney Racing Kit, CC0). */
function PitArea({ mapId }: { mapId: string }) {
  const start = useMemo(() => generateCenterline(mapId)[0], [mapId]);
  const h = start.heading;
  // start-local (x = driver's left / +n, z = forward) -> world
  const w = (lx: number, lz: number) => ({
    x: start.x + lx * Math.cos(h) + lz * Math.sin(h),
    z: start.z - lx * Math.sin(h) + lz * Math.cos(h),
  });
  const off = -(TRACK.wallOffset + 12);
  // buildings face the road: rotate the model's local +z toward +x (the road side)
  const face = h + Math.PI / 2;
  const cones = useMemo<Placement[]>(() => {
    const out: Placement[] = [];
    for (let k = 0; k < 12; k++) {
      const p = { x: start.x + -(TRACK.wallOffset + 2.2) * Math.cos(h) + (-14 + k * 3.2) * Math.sin(h), z: start.z + (TRACK.wallOffset + 2.2) * Math.sin(h) + (-14 + k * 3.2) * Math.cos(h) };
      out.push({ x: p.x, z: p.z, y: start.y, rot: k * 1.3, scale: 5 });
    }
    return out;
  }, [start, h]);

  const g = [4, 13.5, 23];
  return (
    <group>
      {g.map((z, i) => {
        const p = w(off, z);
        return <Prop key={i} url={i === 1 ? `${R}pitsGarageClosed.glb` : `${R}pitsGarage.glb`} x={p.x} z={p.z} rot={face} scale={9} />;
      })}
      {(() => {
        const p = w(off, -6);
        return <Prop url={`${R}pitsOffice.glb`} x={p.x} z={p.z} rot={face} scale={9} />;
      })()}
      {(() => {
        const p = w(off - 12, 14);
        return <Prop url={`${R}tentLong.glb`} x={p.x} z={p.z} rot={face + Math.PI / 2} scale={7} />;
      })()}
      <InstancedProps url={`${R}pylon.glb`} placements={cones} castShadow />
    </group>
  );
}

/** Round hay bales stacked on the outside of sharp corners. */
function HayBales({ mapId, quality }: { mapId: string; quality: QualityLevel }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const items = useMemo(() => {
    const path = generateCenterline(mapId);
    const out: { x: number; y: number; z: number; rot: number }[] = [];
    const rand = mulberry32(99 + mapId.length);
    const step = quality === "high" ? 4 : 8;
    for (let i = 6; i < path.length - 6; i += step) {
      const p = path[i];
      if (Math.abs(p.curvature) < 0.02) continue;
      const side = p.curvature > 0 ? 1 : -1; // outside of the corner
      const off = (TRACK.wallOffset + 1.9) * side;
      const nx = Math.cos(p.heading);
      const nz = -Math.sin(p.heading);
      const x = p.x + nx * off;
      const z = p.z + nz * off;
      // two on the ground, one on top
      out.push({ x: x + Math.sin(p.heading) * -0.75, y: p.y + 0.6, z: z + Math.cos(p.heading) * -0.75, rot: p.heading + rand() * 0.2 });
      out.push({ x: x + Math.sin(p.heading) * 0.75, y: p.y + 0.6, z: z + Math.cos(p.heading) * 0.75, rot: p.heading + rand() * 0.2 });
      out.push({ x, y: p.y + 1.55, z, rot: p.heading + rand() * 0.2 });
    }
    return out;
  }, [mapId, quality]);
  const geo = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.72, 0.72, 1.25, 14);
    g.rotateZ(Math.PI / 2); // lying on its side: axis along x
    return g;
  }, []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#d8b048", roughness: 1 }), []);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    items.forEach((it, i) => {
      q.setFromAxisAngle(up, it.rot);
      p.set(it.x, it.y, it.z);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [items]);
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat]
  );
  if (!items.length) return null;
  return <instancedMesh ref={ref} args={[geo, mat, items.length]} frustumCulled={false} castShadow receiveShadow />;
}

/** Slowly turning wind turbines on the far hills: instanced towers plus GPU-rotated blades. */
function WindFarm({ mapId, count }: { mapId: string; count: number }) {
  const towerRef = useRef<THREE.InstancedMesh>(null);
  const bladeRef = useRef<THREE.InstancedMesh>(null);
  const spots = useMemo(() => {
    const path = generateCenterline(mapId);
    const terrain = getTerrain(mapId);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of path) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const rx = (maxX - minX) / 2 + 95;
    const rz = (maxZ - minZ) / 2 + 95;
    const rand = mulberry32(555 + mapId.length * 31);
    const out: { x: number; y: number; z: number; yaw: number }[] = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rand() * 0.5;
      const x = cx + Math.cos(a) * rx * (1 + rand() * 0.25);
      const z = cz + Math.sin(a) * rz * (1 + rand() * 0.25);
      out.push({ x, y: terrain.heightAt(x, z), z, yaw: rand() * 0.6 - 0.3 });
    }
    return out;
  }, [mapId, count]);

  const H = 34;
  const geo = useMemo(() => {
    const tower = new THREE.CylinderGeometry(0.7, 1.3, H, 8);
    tower.translate(0, H / 2, 0);
    const nacelle = new THREE.BoxGeometry(1.6, 1.6, 4.2);
    nacelle.translate(0, H + 0.3, 0.6);
    const towerAll = mergeSimple([tower, nacelle]);
    // three blades around the +z hub, rotating about z
    const parts: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 3; k++) {
      const b = new THREE.BoxGeometry(0.55, 15, 0.16);
      b.translate(0, 7.8, 0);
      b.rotateZ((k * Math.PI * 2) / 3);
      parts.push(b);
    }
    const hub = new THREE.SphereGeometry(0.8, 8, 6);
    parts.push(hub);
    const blades = mergeSimple(parts);
    blades.translate(0, H + 0.3, 3.1);
    return { tower: towerAll, blades };
  }, []);
  const mats = useMemo(() => {
    const tower = new THREE.MeshStandardMaterial({ color: "#eef2f5", roughness: 0.6 });
    const blades = new THREE.MeshStandardMaterial({ color: "#f8fafc", roughness: 0.5, side: THREE.DoubleSide });
    animateVertices(
      blades,
      "turbine",
      "float h1(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }",
      `
      float ph = h1(instanceMatrix[3].xz);
      float ang = uTime * (0.7 + ph * 0.3) + ph * 6.28;
      float hy = ${(H + 0.3).toFixed(2)};
      vec2 q = transformed.xy - vec2(0.0, hy);
      float c = cos(ang);
      float s = sin(ang);
      transformed.xy = vec2(c * q.x - s * q.y, s * q.x + c * q.y) + vec2(0.0, hy);
      `
    );
    return { tower, blades };
  }, []);
  useEffect(() => {
    const t = towerRef.current;
    const b = bladeRef.current;
    if (!t || !b) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    spots.forEach((it, i) => {
      q.setFromAxisAngle(up, it.yaw);
      p.set(it.x, it.y, it.z);
      m.compose(p, q, s);
      t.setMatrixAt(i, m);
      b.setMatrixAt(i, m);
    });
    t.instanceMatrix.needsUpdate = true;
    b.instanceMatrix.needsUpdate = true;
  }, [spots]);
  useEffect(
    () => () => {
      geo.tower.dispose();
      geo.blades.dispose();
      mats.tower.dispose();
      mats.blades.dispose();
    },
    [geo, mats]
  );
  return (
    <>
      <instancedMesh ref={towerRef} args={[geo.tower, mats.tower, spots.length]} frustumCulled={false} castShadow />
      <instancedMesh ref={bladeRef} args={[geo.blades, mats.blades, spots.length]} frustumCulled={false} />
    </>
  );
}

/** Concatenate simple (position + normal only) geometries. */
function mergeSimple(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const g of list) {
    const p = g.getAttribute("position");
    const n = g.getAttribute("normal");
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    const gi = g.getIndex();
    if (gi) for (let i = 0; i < gi.count; i++) idx.push(gi.getX(i) + base);
    else for (let i = 0; i < p.count; i++) idx.push(i + base);
    base += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}

/** Extra roadside and skyline dressing, scaled by quality level. Purely visual. */
export function TrackProps({ mapId }: { mapId: string }) {
  const quality = useQualityLevel();
  const id = getMap(mapId).id;
  return (
    <group>
      <PitArea mapId={mapId} />
      {quality !== "low" && id !== "night" && <HayBales mapId={mapId} quality={quality} />}
      {quality !== "low" && id !== "night" && <WindFarm mapId={mapId} count={quality === "high" ? 7 : 4} />}
    </group>
  );
}

["pylon", "pitsGarage", "pitsGarageClosed", "pitsOffice", "tentLong"].forEach((n) => useGLTF.preload(`${R}${n}.glb`));
