"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { RigidBody, CuboidCollider } from "@react-three/rapier";
import type { RapierRigidBody } from "@react-three/rapier";
import * as THREE from "three";
import { makeSample, sampleRemote } from "./remoteBuffer";
import { markers, setMarker } from "./markers";

const FRONT_WHEELS = ["wheel-front-left", "wheel-front-right"];
const ALL_WHEELS = [...FRONT_WHEELS, "wheel-back-left", "wheel-back-right"];
const WHEEL_RADIUS = 0.3;

/** Name plate: colour swatch + player name drawn on a canvas (no font downloads). */
function makeLabelTexture(name: string, color: string): THREE.CanvasTexture | null {
  if (!name || typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.font = "bold 54px system-ui, sans-serif";
  const textW = Math.min(ctx.measureText(name).width, 400);
  const w = textW + 96;
  const x0 = (512 - w) / 2;
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.beginPath();
  ctx.roundRect(x0, 20, w, 88, 44);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x0 + 44, 64, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.fillText(name, x0 + 76, 68, 400);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface Props {
  id: string;
  model: string;
  color: string;
  /** Shown on a floating label above the car. */
  name?: string;
  startX: number;
  startZ: number;
  startHeading: number;
}

/**
 * A remote player's car: a kinematic body that follows network snapshots. It
 * shoves the local car on contact; the remote player's own client resolves the
 * same contact for their car.
 */
export function RemoteCar({ id, model, color, name, startX, startZ, startHeading }: Props) {
  const bodyRef = useRef<RapierRigidBody | null>(null);
  const { scene } = useGLTF(model);
  const clone = useMemo(() => scene.clone(true), [scene]);
  const wheels = useRef<THREE.Object3D[]>([]);
  const wheelSpin = useRef(0);

  const pos = useRef(new THREE.Vector3(startX, 0.6, startZ));
  const quat = useRef(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, startHeading, 0)));
  const target = useMemo(() => ({ pos: new THREE.Vector3(), quat: new THREE.Quaternion() }), []);
  const sample = useMemo(() => makeSample(), []);
  const label = useMemo(() => makeLabelTexture(name ?? "", color), [name, color]);
  useEffect(() => () => label?.dispose(), [label]);

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
    if (gem.current) gem.current.rotation.y = state.clock.elapsedTime * 2;
    // Rendered ~100 ms in the past by interpolating buffered snapshots (see remoteBuffer.ts).
    if (sampleRemote(id, performance.now(), sample)) {
      target.pos.set(sample.x, sample.y, sample.z);
      target.quat.set(sample.qx, sample.qy, sample.qz, sample.qw);
      const k = 1 - Math.exp(-30 * delta);
      pos.current.lerp(target.pos, k);
      quat.current.slerp(target.quat, k);

      const heading = Math.atan2(2 * (target.quat.w * target.quat.y + target.quat.x * target.quat.z), 1 - 2 * (target.quat.y * target.quat.y + target.quat.z * target.quat.z));
      setMarker(id, pos.current.x, pos.current.z, heading, color, sample.total);

      wheelSpin.current += ((sample.speedKmh / 3.6) * delta) / WHEEL_RADIUS;
      wheels.current.forEach((w) => {
        w.rotation.x = wheelSpin.current;
        w.rotation.y = FRONT_WHEELS.includes(w.name) ? sample.steer : 0;
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
      {label && (
        <sprite position={[0, 3.5, 0]} scale={[3.6, 0.9, 1]}>
          <spriteMaterial map={label} transparent toneMapped={false} fog={false} />
        </sprite>
      )}
    </RigidBody>
  );
}
