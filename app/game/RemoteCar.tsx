"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { RigidBody, CuboidCollider } from "@react-three/rapier";
import type { RapierRigidBody } from "@react-three/rapier";
import * as THREE from "three";
import { remoteStates } from "./net";
import { markers, setMarker } from "./markers";

const FRONT_WHEELS = ["wheel-front-left", "wheel-front-right"];
const ALL_WHEELS = [...FRONT_WHEELS, "wheel-back-left", "wheel-back-right"];
const WHEEL_RADIUS = 0.3;

interface Props {
  id: string;
  model: string;
  color: string;
  startX: number;
  startZ: number;
  startHeading: number;
}

/**
 * A remote player's car: a kinematic body that follows network snapshots. It
 * shoves the local car on contact; the remote player's own client resolves the
 * same contact for their car.
 */
export function RemoteCar({ id, model, color, startX, startZ, startHeading }: Props) {
  const bodyRef = useRef<RapierRigidBody | null>(null);
  const { scene } = useGLTF(model);
  const clone = useMemo(() => scene.clone(true), [scene]);
  const wheels = useRef<THREE.Object3D[]>([]);
  const wheelSpin = useRef(0);

  const pos = useRef(new THREE.Vector3(startX, 0.6, startZ));
  const quat = useRef(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, startHeading, 0)));
  const target = useMemo(() => ({ pos: new THREE.Vector3(), quat: new THREE.Quaternion() }), []);

  useEffect(() => {
    wheels.current = ALL_WHEELS.map((n) => clone.getObjectByName(n)).filter(
      (o): o is THREE.Object3D => !!o
    );
    wheels.current.forEach((w) => (w.rotation.order = "YXZ"));
    const body = clone.getObjectByName("body");
    if (body instanceof THREE.Mesh) {
      const mat = (body.material as THREE.MeshStandardMaterial).clone();
      mat.color = new THREE.Color(color);
      body.material = mat;
    }
  }, [clone, color]);

  const gem = useRef<THREE.Mesh | null>(null);

  useEffect(() => {
    setMarker(id, startX, startZ, startHeading, color, -0.05);
    return () => {
      markers.delete(id);
    };
  }, [id, startX, startZ, startHeading, color]);

  useFrame((state, delta) => {
    const body = bodyRef.current;
    if (!body) return;
    const snap = remoteStates.get(id);
    if (gem.current) gem.current.rotation.y = state.clock.elapsedTime * 2;
    if (snap) {
      // Dead-reckon from the last snapshot so motion stays smooth between network updates.
      const age = snap.t ? Math.min(0.25, (performance.now() - snap.t) / 1000) : 0;
      target.pos.set(snap.x + snap.vx * age, snap.y, snap.z + snap.vz * age);
      target.quat.set(snap.qx, snap.qy, snap.qz, snap.qw);
      const k = 1 - Math.exp(-14 * delta);
      pos.current.lerp(target.pos, k);
      quat.current.slerp(target.quat, k);

      const heading = Math.atan2(2 * (target.quat.w * target.quat.y + target.quat.x * target.quat.z), 1 - 2 * (target.quat.y * target.quat.y + target.quat.z * target.quat.z));
      setMarker(id, pos.current.x, pos.current.z, heading, color, snap.total);

      wheelSpin.current += ((snap.speedKmh / 3.6) * delta) / WHEEL_RADIUS;
      wheels.current.forEach((w) => {
        w.rotation.x = wheelSpin.current;
        w.rotation.y = FRONT_WHEELS.includes(w.name) ? snap.steer : 0;
      });
    }
    body.setNextKinematicTranslation(pos.current);
    body.setNextKinematicRotation(quat.current);
  });

  return (
    <RigidBody
      ref={bodyRef}
      type="kinematicPosition"
      colliders={false}
      position={[startX, 0.6, startZ]}
      rotation={[0, startHeading, 0]}
    >
      <CuboidCollider args={[0.6, 0.26, 1.2]} position={[0, 0.52, 0]} />
      <primitive object={clone} />
      <mesh ref={gem} position={[0, 2.6, 0]}>
        <octahedronGeometry args={[0.35]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </RigidBody>
  );
}
