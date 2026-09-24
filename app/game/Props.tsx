"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";

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

function PartInstances({
  part,
  placements,
  castShadow,
}: {
  part: Part;
  placements: Placement[];
  castShadow: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
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
    mesh.computeBoundingSphere();
  }, [placements]);

  if (placements.length === 0) return null;
  return (
    <instancedMesh
      ref={ref}
      args={[part.geometry, part.material as THREE.Material, placements.length]}
      castShadow={castShadow}
      receiveShadow
      frustumCulled={false}
    />
  );
}

export function InstancedProps({
  url,
  placements,
  castShadow = false,
}: {
  url: string;
  placements: Placement[];
  castShadow?: boolean;
}) {
  const parts = useBakedParts(url);
  return (
    <>
      {parts.map((p, i) => (
        <PartInstances key={i} part={p} placements={placements} castShadow={castShadow} />
      ))}
    </>
  );
}
