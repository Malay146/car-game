"use client";

import { RefObject, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CarTransform } from "./vehicleTypes";
import { isBoosting, shake } from "./fx";

const HEIGHT = 2.9;
const LOOK_HEIGHT = 1.0;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Chase camera that swings toward the direction of travel, so drifts read clearly. */
export function CameraRig({ target }: { target: RefObject<CarTransform> }) {
  const pos = useRef(new THREE.Vector3());
  const look = useRef(new THREE.Vector3());
  const angle = useRef(0);
  const init = useRef(false);

  useFrame(({ camera }, delta) => {
    const t = target.current;
    const speed = Math.hypot(t.vx, t.vz);
    let desiredAngle = t.heading;
    if (speed > 8) {
      const travel = Math.atan2(t.vx, t.vz);
      desiredAngle = t.heading + wrap(travel - t.heading) * 0.55;
    }
    if (!init.current) angle.current = desiredAngle;
    angle.current += wrap(desiredAngle - angle.current) * (1 - Math.exp(-5 * delta));

    const dist = 6 + Math.min(speed, 46) * 0.04;
    const desired = new THREE.Vector3(
      t.x - Math.sin(angle.current) * dist,
      t.y + HEIGHT + Math.min(speed, 46) * 0.012,
      t.z - Math.cos(angle.current) * dist
    );
    const aim = new THREE.Vector3(
      t.x + Math.sin(angle.current) * 3,
      t.y + LOOK_HEIGHT,
      t.z + Math.cos(angle.current) * 3
    );
    if (!init.current) {
      pos.current.copy(desired);
      look.current.copy(aim);
      init.current = true;
    }
    pos.current.lerp(desired, 1 - Math.exp(-22 * delta));
    look.current.lerp(aim, 1 - Math.exp(-12 * delta));

    if (camera instanceof THREE.PerspectiveCamera) {
      const targetFov = 60 + Math.min(speed, 46) * 0.3 + (isBoosting(performance.now()) ? 14 : 0);
      camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-4 * delta));
      camera.updateProjectionMatrix();
    }
    camera.position.copy(pos.current);
    camera.lookAt(look.current);
    // Small decaying shake after hard landings / impacts.
    if (shake.amp > 0.01) {
      const a = shake.amp * shake.amp * 0.32;
      camera.position.x += (Math.random() - 0.5) * a;
      camera.position.y += (Math.random() - 0.5) * a;
      camera.position.z += (Math.random() - 0.5) * a;
      shake.amp *= Math.exp(-5.5 * delta);
    } else shake.amp = 0;
  });

  return null;
}
