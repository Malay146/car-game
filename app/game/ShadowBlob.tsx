"use client";

import { useMemo } from "react";
import * as THREE from "three";

let sharedTex: THREE.CanvasTexture | null = null;
function blobTexture(): THREE.CanvasTexture {
  if (sharedTex) return sharedTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, "rgba(0,0,0,1)");
  grad.addColorStop(0.45, "rgba(0,0,0,0.7)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  sharedTex = new THREE.CanvasTexture(c);
  return sharedTex;
}

/** Soft dark ellipse that grounds a car on the road (a cheap contact shadow that works at every quality level). */
export function ShadowBlob({ width, length, y = 0.03, opacity = 0.6 }: { width: number; length: number; y?: number; opacity?: number }) {
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: blobTexture(),
        transparent: true,
        opacity,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        fog: false,
      }),
    [opacity]
  );
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} scale={[width, length, 1]} renderOrder={2} material={material}>
      <planeGeometry args={[1, 1]} />
    </mesh>
  );
}
