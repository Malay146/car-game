"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";

export interface Placement {
  x: number;
  z: number;
  y?: number;
  rot: number;
  scale: number;
}

interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
}

/** Flattens a glTF into world-space geometry parts, re-centered so (0,0,0) is bottom-center. */
function useBakedParts(url: string): Part[] {
  const { scene } = useGLTF(url);
  return useMemo(() => {
    scene.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(scene);
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    const parts: Part[] = [];
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const geometry = o.geometry.clone();
        geometry.applyMatrix4(o.matrixWorld);
        geometry.translate(-cx, -box.min.y, -cz);
        parts.push({ geometry, material: o.material });
      }
    });
    return parts;
  }, [scene]);
}

export function Prop({
  url,
  x,
  z,
  rot,
  scale,
}: {
  url: string;
  x: number;
  z: number;
  rot: number;
  scale: number;
}) {
  const parts = useBakedParts(url);
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]} scale={scale}>
      {parts.map((p, i) => (
        <mesh key={i} geometry={p.geometry} material={p.material} castShadow receiveShadow />
      ))}
    </group>
  );
}

const CHUNK = 140; // world units per culling cell

/** Groups placements into spatial cells so each cell can be frustum-culled (main view and shadow pass). */
function chunkPlacements(placements: Placement[]): Placement[][] {
  const cells = new Map<string, Placement[]>();
  for (const pl of placements) {
    const key = `${Math.floor(pl.x / CHUNK)},${Math.floor(pl.z / CHUNK)}`;
    const list = cells.get(key);
    if (list) list.push(pl);
    else cells.set(key, [pl]);
  }
  return [...cells.values()];
}

function PartInstances({
  part,
  placements,
  castShadow,
  maxDistance,
}: {
  part: Part;
  placements: Placement[];
  castShadow: boolean;
  maxDistance?: number;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const centre = useMemo(() => {
    const c = new THREE.Vector3();
    placements.forEach((pl) => c.add(new THREE.Vector3(pl.x, pl.y ?? 0, pl.z)));
    return c.divideScalar(Math.max(1, placements.length));
  }, [placements]);

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    placements.forEach((pl, i) => {
      q.setFromAxisAngle(up, pl.rot);
      s.setScalar(pl.scale);
      p.set(pl.x, pl.y ?? 0, pl.z);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    // Bounding sphere over all instances of this cell, so three can cull the whole cell.
    mesh.computeBoundingSphere();
  }, [placements]);

  // Small ground cover is only drawn near the camera.
  useFrame(({ camera }) => {
    const mesh = ref.current;
    if (!mesh || maxDistance === undefined) return;
    mesh.visible = camera.position.distanceTo(centre) < maxDistance + CHUNK * 0.75;
  });

  if (placements.length === 0) return null;
  return (
    <instancedMesh
      ref={ref}
      args={[part.geometry, part.material as THREE.Material, placements.length]}
      castShadow={castShadow}
      receiveShadow
    />
  );
}

export function InstancedProps({
  url,
  placements,
  castShadow = false,
  maxDistance,
}: {
  url: string;
  placements: Placement[];
  castShadow?: boolean;
  /** Hide cells whose centre is farther than this from the camera (for small ground cover). */
  maxDistance?: number;
}) {
  const parts = useBakedParts(url);
  const chunks = useMemo(() => chunkPlacements(placements), [placements]);
  return (
    <>
      {chunks.map((chunk, c) =>
        parts.map((p, i) => (
          <PartInstances
            key={`${c}-${i}`}
            part={p}
            placements={chunk}
            castShadow={castShadow}
            maxDistance={maxDistance}
          />
        ))
      )}
    </>
  );
}
