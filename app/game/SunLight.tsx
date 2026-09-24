"use client";

import { RefObject, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CarTransform } from "./vehicleTypes";
import type { MapTheme } from "./maps";

/** Directional sun whose shadow box follows the player car. */
export function SunLight({
  target,
  sun,
  shadows = true,
  mapSize = 2048,
}: {
  target: RefObject<CarTransform>;
  sun: MapTheme["sun"];
  shadows?: boolean;
  mapSize?: number;
}) {
  const light = useRef<THREE.DirectionalLight>(null);
  const aim = useRef<THREE.Object3D>(null);

  useFrame(() => {
    const l = light.current;
    const a = aim.current;
    if (!l || !a) return;
    const t = target.current;
    a.position.set(t.x, 0, t.z);
    l.position.set(t.x + sun.position[0], sun.position[1], t.z + sun.position[2]);
    l.target.updateMatrixWorld();
  });

  return (
    <>
      <object3D ref={aim} />
      <directionalLight
        key={mapSize /* a new shadow-map size needs a fresh light */}
        ref={(l) => {
          light.current = l;
          if (l && aim.current) l.target = aim.current;
        }}
        intensity={sun.intensity}
        color={sun.color}
        castShadow={shadows}
        shadow-mapSize={[mapSize, mapSize]}
        shadow-camera-left={-45}
        shadow-camera-right={45}
        shadow-camera-top={45}
        shadow-camera-bottom={-45}
        shadow-camera-near={1}
        shadow-camera-far={200}
        shadow-bias={-0.0004}
      />
    </>
  );
}
