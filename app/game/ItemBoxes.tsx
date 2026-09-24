"use client";

import { RefObject, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { pointAtFraction } from "./trackPath";
import { getMap } from "./maps";
import { CarTransform } from "./vehicleTypes";
import { useGameStore } from "./store";
import { playPickup } from "./AudioManager";

const LANE_OFFSETS = [-2.8, 0, 2.8];
const RESPAWN_MS = 6000;
const PICKUP_RADIUS = 2.6;

/** Floating item boxes along the racing line; the local player collects them by driving through. */
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

  const meshes = useRef<(THREE.Mesh | null)[]>([]);
  const respawnAt = useRef<number[]>(boxes.map(() => 0));
  const prev = useRef({ x: 0, z: 0, valid: false });

  useFrame((state) => {
    const now = performance.now();
    const store = useGameStore.getState();
    const t = target.current;
    const canPick = store.phase === "playing" && store.raceState === "racing" && store.item === null;

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

    boxes.forEach((b, i) => {
      const mesh = meshes.current[i];
      if (!mesh) return;
      const active = now >= respawnAt.current[i];
      mesh.visible = active;
      if (!active) return;
      mesh.rotation.y = state.clock.elapsedTime * 1.6;
      mesh.position.y = b.y + 0.9 + Math.sin(state.clock.elapsedTime * 2 + i) * 0.12;
      if (canPick && distToSeg(b.x, b.z) < PICKUP_RADIUS) {
        respawnAt.current[i] = now + RESPAWN_MS;
        store.setItem("boost");
        playPickup();
      }
    });
  });

  return (
    <group>
      {boxes.map((b, i) => (
        <mesh
          key={i}
          ref={(el) => {
            meshes.current[i] = el;
          }}
          position={[b.x, b.y + 0.9, b.z]}
        >
          <boxGeometry args={[0.7, 0.7, 0.7]} />
          <meshStandardMaterial color="#ffd23f" emissive="#ffb000" emissiveIntensity={1.4} />
        </mesh>
      ))}
    </group>
  );
}
