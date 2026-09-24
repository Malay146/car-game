"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { animateVertices } from "./visualTime";

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BODY_COLORS = ["#ef4444", "#f97316", "#facc15", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7", "#ec4899", "#f4f4f5", "#1f2937"];
const SKIN = ["#f5d0b0", "#e0ac83", "#c68642", "#8d5524", "#5c3a21"];

const ROWS = 6;
const ROW_DEPTH = 1.5;
const ROW_STEP = 0.85;
const LENGTH = 36;

interface Props {
  /** Distance from the centre line to the front row (local +x, the side the stand is on). */
  frontX: number;
  z0: number;
  accent: string;
  seed: number;
  /** 0..1: how full the stand is (quality scales the crowd). */
  crowd: number;
  side?: 1 | -1;
}

/**
 * A tiered grandstand with a roof, filled with a colourful crowd. Lives in the start-line local frame
 * (+z forward, +x to the right of the road). The crowd is two instanced meshes bobbing via a vertex shader.
 */
export function Grandstand({ frontX, z0, accent, seed, crowd, side = 1 }: Props) {
  const bodyRef = useRef<THREE.InstancedMesh>(null);
  const headRef = useRef<THREE.InstancedMesh>(null);

  const people = useMemo(() => {
    const rand = mulberry32(seed);
    const out: { x: number; y: number; z: number; s: number; body: THREE.Color; skin: THREE.Color }[] = [];
    for (let r = 0; r < ROWS; r++) {
      const top = 0.7 + r * ROW_STEP;
      const x = side * (frontX + r * ROW_DEPTH + ROW_DEPTH * 0.55);
      for (let k = 0; k < LENGTH; k++) {
        if (rand() > 0.9 * crowd) continue;
        out.push({
          x: x + (rand() - 0.5) * 0.3,
          y: top,
          z: z0 + 0.8 + k * 1.0 + (rand() - 0.5) * 0.4,
          s: 0.85 + rand() * 0.3,
          body: new THREE.Color(BODY_COLORS[Math.floor(rand() * BODY_COLORS.length)]),
          skin: new THREE.Color(SKIN[Math.floor(rand() * SKIN.length)]),
        });
      }
    }
    return out;
  }, [frontX, z0, seed, crowd, side]);

  const geo = useMemo(() => {
    const body = new THREE.CapsuleGeometry(0.2, 0.5, 2, 6);
    body.translate(0, 0.45, 0);
    const head = new THREE.IcosahedronGeometry(0.17, 1);
    head.translate(0, 1.2, 0);
    return { body, head };
  }, []);

  const mats = useMemo(() => {
    const pre = "";
    const code = `
      float ph = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
      float jump = step(0.7, ph);
      float bob = abs(sin(uTime * (2.0 + ph * 2.5) + ph * 6.2831));
      transformed.y += bob * (0.03 + jump * 0.17);
    `;
    const body = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    const head = new THREE.MeshStandardMaterial({ roughness: 0.7 });
    animateVertices(body, "crowd", pre, code);
    animateVertices(head, "crowd", pre, code);
    return { body, head };
  }, []);

  useEffect(() => {
    const b = bodyRef.current;
    const h = headRef.current;
    if (!b || !h) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    people.forEach((pl, i) => {
      // face the road
      q.setFromAxisAngle(up, side > 0 ? -Math.PI / 2 : Math.PI / 2);
      s.setScalar(pl.s);
      p.set(pl.x, pl.y, pl.z);
      m.compose(p, q, s);
      b.setMatrixAt(i, m);
      h.setMatrixAt(i, m);
      b.setColorAt(i, pl.body);
      h.setColorAt(i, pl.skin);
    });
    b.instanceMatrix.needsUpdate = true;
    h.instanceMatrix.needsUpdate = true;
    if (b.instanceColor) b.instanceColor.needsUpdate = true;
    if (h.instanceColor) h.instanceColor.needsUpdate = true;
  }, [people, side]);

  useEffect(() => {
    return () => {
      geo.body.dispose();
      geo.head.dispose();
      mats.body.dispose();
      mats.head.dispose();
    };
  }, [geo, mats]);

  const totalDepth = ROWS * ROW_DEPTH;
  const midZ = z0 + LENGTH / 2;
  const roofTop = 0.7 + ROWS * ROW_STEP + 3.4;

  return (
    <group>
      {/* tiers: concrete blocks with a coloured seat strip on each */}
      {Array.from({ length: ROWS }, (_, r) => {
        const top = 0.7 + r * ROW_STEP;
        const x = side * (frontX + r * ROW_DEPTH + ROW_DEPTH / 2);
        return (
          <group key={r}>
            <mesh position={[x, top / 2 - 1.5, midZ]} receiveShadow castShadow>
              <boxGeometry args={[ROW_DEPTH, top + 3, LENGTH + 1]} />
              <meshStandardMaterial color="#9aa0a6" roughness={0.9} />
            </mesh>
            <mesh position={[x - side * 0.2, top + 0.01, midZ]}>
              <boxGeometry args={[ROW_DEPTH * 0.5, 0.05, LENGTH + 1]} />
              <meshStandardMaterial color={r % 2 ? "#e5e7eb" : accent} roughness={0.7} />
            </mesh>
          </group>
        );
      })}
      {/* back wall and side walls */}
      <mesh position={[side * (frontX + totalDepth + 0.15), roofTop / 2 - 1, midZ]} castShadow>
        <boxGeometry args={[0.3, roofTop + 2, LENGTH + 1]} />
        <meshStandardMaterial color="#6b7280" roughness={0.9} />
      </mesh>
      {/* roof */}
      <mesh position={[side * (frontX + totalDepth * 0.66), roofTop, midZ]} castShadow>
        <boxGeometry args={[totalDepth * 0.75, 0.3, LENGTH + 2]} />
        <meshStandardMaterial color={accent} roughness={0.6} />
      </mesh>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} position={[side * (frontX + totalDepth * 0.26), roofTop / 2 + 0.3, z0 + (i / 3) * LENGTH]} castShadow>
          <boxGeometry args={[0.22, roofTop - 0.6, 0.22]} />
          <meshStandardMaterial color="#e5e7eb" roughness={0.5} metalness={0.3} />
        </mesh>
      ))}
      <instancedMesh ref={bodyRef} args={[geo.body, mats.body, people.length]} frustumCulled={false} />
      <instancedMesh ref={headRef} args={[geo.head, mats.head, people.length]} frustumCulled={false} />
    </group>
  );
}
