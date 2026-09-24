"use client";

import { RefObject, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { pointAtFraction } from "./trackPath";
import { getMap } from "./maps";
import { CarTransform } from "./vehicleTypes";
import { useGameStore } from "./store";
import { playPickup } from "./AudioManager";
import { emitParticle } from "./fx";

const LANE_OFFSETS = [-2.8, 0, 2.8];
const RESPAWN_MS = 6000;
const PICKUP_RADIUS = 2.6;
const LANE_COLORS = ["#ff4d6d", "#ffd23f", "#38bdf8"];

type PartKey = "cube" | "ribbonA" | "ribbonB" | "bow" | "glow";
const PART_KEYS: PartKey[] = ["cube", "ribbonA", "ribbonB", "bow", "glow"];

/**
 * Item boxes along the racing line, drawn as glowing rotating gift boxes (ribbon + bow + halo, 5 instanced draw
 * calls in total); the local player collects them by driving through.
 */
export function ItemBoxes({ target }: { target: RefObject<CarTransform> }) {
  const mapId = useGameStore((st) => st.mapId);
  const boxes = useMemo(() => {
    const out: { x: number; y: number; z: number }[] = [];
    const ramps = getMap(mapId).ramps;
    for (const f of getMap(mapId).items) {
      const p = pointAtFraction(f, mapId);
      const lx = Math.cos(p.heading);
      const lz = -Math.sin(p.heading);
      // keep boxes off the ramps and their landing zones
      if (ramps.some((r) => Math.hypot(p.x - r.at[0], p.z - r.at[1]) < 45)) continue;
      for (const o of LANE_OFFSETS) out.push({ x: p.x + lx * o, y: p.y, z: p.z + lz * o });
    }
    return out;
  }, [mapId]);

  const respawnAt = useRef<number[]>(boxes.map(() => 0));
  const prev = useRef({ x: 0, z: 0, valid: false });
  const parts = useRef<Record<PartKey, THREE.InstancedMesh | null>>({ cube: null, ribbonA: null, ribbonB: null, bow: null, glow: null });
  const tmp = useMemo(
    () => ({
      m: new THREE.Matrix4(),
      q: new THREE.Quaternion(),
      e: new THREE.Euler(),
      p: new THREE.Vector3(),
      v: new THREE.Vector3(),
      s: new THREE.Vector3(),
      c: new THREE.Color(),
      zero: new THREE.Matrix4().makeScale(0, 0, 0),
    }),
    []
  );
  const res = useMemo(
    () => ({
      cube: new THREE.BoxGeometry(0.72, 0.72, 0.72),
      ribbonA: new THREE.BoxGeometry(0.78, 0.78, 0.16),
      ribbonB: new THREE.BoxGeometry(0.16, 0.78, 0.78),
      bow: new THREE.OctahedronGeometry(0.2),
      glow: new THREE.SphereGeometry(1, 14, 10),
      cubeMat: new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.2, emissive: "#ff9d00", emissiveIntensity: 0.5 }),
      ribbonMat: new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 0.6, roughness: 0.3 }),
      glowMat: new THREE.MeshBasicMaterial({
        color: new THREE.Color("#ffc233").multiplyScalar(1.6),
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    }),
    []
  );
  useEffect(() => {
    const cube = parts.current.cube;
    if (!cube) return;
    boxes.forEach((_, i) => cube.setColorAt(i, tmp.c.set(LANE_COLORS[i % 3])));
    if (cube.instanceColor) cube.instanceColor.needsUpdate = true;
  }, [boxes, tmp]);
  useEffect(
    () => () => {
      res.cube.dispose();
      res.ribbonA.dispose();
      res.ribbonB.dispose();
      res.bow.dispose();
      res.glow.dispose();
      res.cubeMat.dispose();
      res.ribbonMat.dispose();
      res.glowMat.dispose();
    },
    [res]
  );

  useFrame((state) => {
    const now = performance.now();
    const store = useGameStore.getState();
    const t = target.current;
    const canPick = store.phase === "playing" && store.raceState === "racing" && store.item === null;
    const time = state.clock.elapsedTime;

    // Test the whole path travelled since last frame so fast cars can't tunnel through a box.
    const p0 = prev.current.valid ? prev.current : { x: t.x, z: t.z };
    const segX = t.x - p0.x;
    const segZ = t.z - p0.z;
    const segLen2 = segX * segX + segZ * segZ;
    const distToSeg = (bx: number, bz: number) => {
      const k = segLen2 > 1e-6 ? Math.max(0, Math.min(1, ((bx - p0.x) * segX + (bz - p0.z) * segZ) / segLen2)) : 0;
      return Math.hypot(bx - (p0.x + segX * k), bz - (p0.z + segZ * k));
    };
    prev.current = { x: t.x, z: t.z, valid: true };

    const P = parts.current;
    boxes.forEach((b, i) => {
      if (now < respawnAt.current[i]) {
        for (const k of PART_KEYS) P[k]?.setMatrixAt(i, tmp.zero);
        return;
      }
      const cy = b.y + 0.95 + Math.sin(time * 2 + i) * 0.14;
      // spin about the vertical axis with a gentle tumble
      tmp.e.set(Math.sin(time * 1.3 + i) * 0.22, time * 1.6 + i, Math.cos(time * 1.1 + i) * 0.18, "YXZ");
      tmp.q.setFromEuler(tmp.e);
      tmp.p.set(b.x, cy, b.z);
      tmp.s.set(1, 1, 1);
      tmp.m.compose(tmp.p, tmp.q, tmp.s);
      P.cube?.setMatrixAt(i, tmp.m);
      P.ribbonA?.setMatrixAt(i, tmp.m);
      P.ribbonB?.setMatrixAt(i, tmp.m);
      // bow on top of the box (box space -> world)
      tmp.v.set(0, 0.46, 0).applyQuaternion(tmp.q).add(tmp.p);
      tmp.m.compose(tmp.v, tmp.q, tmp.s);
      P.bow?.setMatrixAt(i, tmp.m);
      // pulsing halo
      tmp.q.identity();
      tmp.s.setScalar(1.15 + Math.sin(time * 3 + i * 1.7) * 0.12);
      tmp.m.compose(tmp.p, tmp.q, tmp.s);
      P.glow?.setMatrixAt(i, tmp.m);

      if (canPick && distToSeg(b.x, b.z) < PICKUP_RADIUS) {
        respawnAt.current[i] = now + RESPAWN_MS;
        store.setItem("boost");
        playPickup();
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2;
          emitParticle({ x: b.x, y: cy, z: b.z, vx: Math.cos(a) * 5, vy: 2 + Math.random() * 3, vz: Math.sin(a) * 5, life: 0.6, size: 0.22, grow: -0.3, r: 1, g: 0.8, b: 0.2 });
        }
      }
    });
    for (const k of PART_KEYS) {
      const mesh = P[k];
      if (mesh) mesh.instanceMatrix.needsUpdate = true;
    }
  });

  const n = boxes.length;
  return (
    <group>
      <instancedMesh ref={(el) => void (parts.current.cube = el)} args={[res.cube, res.cubeMat, n]} frustumCulled={false} castShadow />
      <instancedMesh ref={(el) => void (parts.current.ribbonA = el)} args={[res.ribbonA, res.ribbonMat, n]} frustumCulled={false} />
      <instancedMesh ref={(el) => void (parts.current.ribbonB = el)} args={[res.ribbonB, res.ribbonMat, n]} frustumCulled={false} />
      <instancedMesh ref={(el) => void (parts.current.bow = el)} args={[res.bow, res.ribbonMat, n]} frustumCulled={false} />
      <instancedMesh ref={(el) => void (parts.current.glow = el)} args={[res.glow, res.glowMat, n]} frustumCulled={false} />
    </group>
  );
}
