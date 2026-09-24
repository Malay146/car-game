"use client";

import { RefObject, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CarTransform } from "./vehicleTypes";

/** Live sun parameters, eased every frame by WeatherRig (colour / intensity / direction). */
export interface LiveSun {
  color: THREE.Color;
  intensity: number;
  pos: THREE.Vector3;
}

/** Directional sun whose shadow box follows the player car. */
export function SunLight({
  target,
  sunRef,
  shadows = true,
  mapSize = 2048,
}: {
  target: RefObject<CarTransform>;
  sunRef: RefObject<LiveSun | null>;
  shadows?: boolean;
  mapSize?: number;
}) {
  const light = useRef<THREE.DirectionalLight>(null);
  const aim = useRef<THREE.Object3D>(null);

  useFrame(() => {
    const l = light.current;
    const a = aim.current;
    const sun = sunRef.current;
    if (!l || !a || !sun) return;
    const t = target.current;
    a.position.set(t.x, 0, t.z);
    l.position.set(t.x + sun.pos.x, sun.pos.y, t.z + sun.pos.z);
    l.color.copy(sun.color);
    l.intensity = sun.intensity;
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
        intensity={0}
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
