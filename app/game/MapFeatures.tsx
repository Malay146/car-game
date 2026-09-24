"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { RigidBody, TrimeshCollider } from "@react-three/rapier";
import { generateCenterline, getCheckpoints, nearestIndex } from "./trackPath";
import { getMap } from "./maps";
import { useGameStore } from "./store";

const DEFAULT_LEN = 16;
const DEFAULT_HEIGHT = 2.6;
// Full width between the barriers: there are no reachable side faces to clip.
const RAMP_WIDTH = 18;

/** Wedge in world space: low lip at the front (in travel direction), high edge at the back. */
function buildRamp(cx: number, cy: number, cz: number, heading: number, len: number, height: number): THREE.BufferGeometry {
  const w = RAMP_WIDTH / 2;
  const l = len / 2;
  const v = {
    a: [-w, 0, -l], // low left
    b: [w, 0, -l], // low right
    c: [-w, 0, l], // high-end floor left
    d: [w, 0, l], // high-end floor right
    e: [-w, height, l], // top left
    f: [w, height, l], // top right
  } as Record<string, number[]>;
  // triangles: slope, back face, left side, right side
  const tris: [string, string, string][] = [
    ["a", "b", "f"],
    ["a", "f", "e"],
    ["c", "e", "f"],
    ["c", "f", "d"],
    ["a", "e", "c"],
    ["b", "d", "f"],
  ];
  const uvOf: Record<string, [number, number]> = {
    a: [0, 0],
    b: [1, 0],
    c: [0, 0],
    d: [1, 0],
    e: [0, 1],
    f: [1, 1],
  };
  const pos: number[] = [];
  const uvs: number[] = [];
  for (const t of tris) {
    for (const k of t) {
      pos.push(...v[k]);
      uvs.push(...uvOf[k]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  const m = new THREE.Matrix4().makeRotationY(heading).setPosition(cx, cy + 0.03, cz);
  g.applyMatrix4(m);
  return g;
}

function stripeTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffd23f";
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = "#1a1a1a";
  for (let i = -2; i < 6; i++) {
    g.beginPath();
    g.moveTo(i * 32, 128);
    g.lineTo(i * 32 + 16, 128);
    g.lineTo(i * 32 + 16 + 128, 0);
    g.lineTo(i * 32 + 128, 0);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 3);
  t.anisotropy = 8;
  return t;
}

/** Jump ramps (with physics) for the active map. */
export function MapFeatures() {
  const mapId = useGameStore((s) => s.mapId);

  const ramps = useMemo(
    () =>
      getMap(mapId).ramps.map((r) => {
        const path = generateCenterline(mapId);
        const p = path[nearestIndex(path, r.at[0], r.at[1])];
        const geo = buildRamp(p.x, p.y, p.z, p.heading, r.len ?? DEFAULT_LEN, r.height ?? DEFAULT_HEIGHT);
        return {
          geo,
          vertices: new Float32Array(geo.getAttribute("position").array),
          indices: new Uint32Array(Array.from({ length: geo.getAttribute("position").count }, (_, i) => i)),
        };
      }),
    [mapId]
  );
  const stripes = useMemo(() => stripeTexture(), []);
  const gates = useMemo(() => {
    const path = generateCenterline(mapId);
    return getCheckpoints(mapId)
      .slice(1)
      .map((i) => path[i]);
  }, [mapId]);
  const accent = getMap(mapId).theme.kerb[0];

  return (
    <group>
      {ramps.map((r, i) => (
        <mesh key={i} geometry={r.geo} castShadow receiveShadow>
          <meshStandardMaterial map={stripes} roughness={0.6} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {gates.map((p, i) => (
        <group key={`cp${i}`} position={[p.x, p.y, p.z]} rotation={[0, p.heading, 0]}>
          {[-6.4, 6.4].map((x) => (
            <mesh key={x} position={[x, 2.6, 0]}>
              <cylinderGeometry args={[0.22, 0.22, 5.2, 8]} />
              <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.7} />
            </mesh>
          ))}
          <mesh position={[0, 5.1, 0]}>
            <boxGeometry args={[13, 0.5, 0.4]} />
            <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.7} />
          </mesh>
        </group>
      ))}
      <RigidBody type="fixed" colliders={false} friction={0.6}>
        {ramps.map((r, i) => (
          <TrimeshCollider key={i} args={[r.vertices, r.indices]} />
        ))}
      </RigidBody>
    </group>
  );
}
