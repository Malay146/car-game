"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { TRACK, generateCenterline } from "./trackPath";
import { getMap } from "./maps";
import { useGameStore } from "./store";
import { useQualityLevel } from "./settings";
import { Grandstand } from "./Spectators";
import { animateVertices } from "./visualTime";

const HDR = 2.4; // >1 so bright emissive parts bloom

function StartLights({ y }: { y: number }) {
  const phase = useGameStore((s) => s.phase);
  const raceState = useGameStore((s) => s.raceState);
  const countdown = useGameStore((s) => s.countdownValue);
  const [goFlash, setGoFlash] = useState(false);

  // brief green after the lights go out
  useEffect(() => {
    if (phase !== "playing" || raceState !== "racing") {
      const t = setTimeout(() => setGoFlash(false), 0);
      return () => clearTimeout(t);
    }
    const on = setTimeout(() => setGoFlash(true), 0);
    const off = setTimeout(() => setGoFlash(false), 1600);
    return () => {
      clearTimeout(on);
      clearTimeout(off);
    };
  }, [phase, raceState]);

  const lit = phase !== "playing" ? 0 : raceState === "countdown" ? (countdown >= 3 ? 2 : countdown === 2 ? 4 : 5) : 0;

  const mats = useMemo(
    () => ({
      red: new THREE.MeshBasicMaterial({ color: new THREE.Color("#ff2a18").multiplyScalar(HDR), toneMapped: false }),
      off: new THREE.MeshBasicMaterial({ color: "#2b0a0a" }),
      green: new THREE.MeshBasicMaterial({ color: new THREE.Color("#22ff66").multiplyScalar(HDR), toneMapped: false }),
    }),
    []
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  return (
    <group position={[0, y, -1.0]}>
      <mesh>
        <boxGeometry args={[6.1, 1.3, 0.3]} />
        <meshStandardMaterial color="#111318" roughness={0.6} />
      </mesh>
      {[0, 1, 2, 3, 4].map((i) => {
        const on = i < lit;
        const mat = goFlash && raceState === "racing" ? mats.green : on ? mats.red : mats.off;
        return (
          <mesh key={i} position={[(i - 2) * 1.15, 0, -0.17]} rotation={[Math.PI / 2, 0, 0]} material={mat}>
            <cylinderGeometry args={[0.42, 0.42, 0.12, 20]} />
          </mesh>
        );
      })}
    </group>
  );
}

function makeSignTexture(name: string, tagline: string, accent: string, neon: boolean): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 224;
  const g = c.getContext("2d")!;
  g.fillStyle = neon ? "#0a0620" : "#14171f";
  g.fillRect(0, 0, 1024, 224);
  g.strokeStyle = accent;
  g.lineWidth = 10;
  g.strokeRect(8, 8, 1008, 208);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = "900 96px Arial, Helvetica, sans-serif";
  if (neon) {
    g.shadowColor = accent;
    g.shadowBlur = 28;
  }
  g.fillStyle = neon ? "#ffffff" : "#f8fafc";
  g.fillText(name.toUpperCase(), 512, 92);
  g.shadowBlur = 0;
  g.font = "600 34px Arial, Helvetica, sans-serif";
  g.fillStyle = accent;
  g.fillText(tagline, 512, 172);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Map-name billboard sitting on top of the start gantry, readable from the grid. */
function MapSign({ mapId, y }: { mapId: string; y: number }) {
  const map = getMap(mapId);
  const accent = map.theme.kerb[0];
  const neon = !!map.theme.neon;
  const tex = useMemo(() => makeSignTexture(map.name, map.tagline, accent, neon), [map, accent, neon]);
  useEffect(() => () => tex.dispose(), [tex]);
  const W = 10.2;
  const H = W * (224 / 1024);
  return (
    <group position={[0, y + H / 2, 0]}>
      <mesh>
        <boxGeometry args={[W + 0.2, H + 0.2, 0.3]} />
        <meshStandardMaterial color="#20232b" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0, -0.17]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[W, H]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0, 0.17]}>
        <planeGeometry args={[W, H]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </group>
  );
}

const FLAG_W = 3.2;
const FLAG_H = 1.9;
const POLE_H = 8;

/** Waving pennants on tall poles along both sides of the start straight (GPU vertex-shader wave, 2 draw calls). */
function Flags({ colors, count }: { colors: string[]; count: number }) {
  const poleRef = useRef<THREE.InstancedMesh>(null);
  const flagRef = useRef<THREE.InstancedMesh>(null);
  const spots = useMemo(() => {
    const out: { x: number; z: number; c: THREE.Color; side: number }[] = [];
    const n = Math.floor(count / 2);
    for (let i = 0; i < n; i++) {
      for (const side of [-1, 1]) {
        out.push({ x: side * (TRACK.wallOffset + 2.2), z: -46 + i * (110 / Math.max(1, n - 1)), c: new THREE.Color(colors[(i + (side > 0 ? 1 : 0)) % colors.length]), side });
      }
    }
    return out;
  }, [colors, count]);

  const geo = useMemo(() => {
    const flag = new THREE.PlaneGeometry(FLAG_W, FLAG_H, 14, 6);
    flag.translate(FLAG_W / 2, 0, 0);
    flag.rotateY(-Math.PI / 2); // width runs along +z, parallel to the road
    const pole = new THREE.CylinderGeometry(0.07, 0.09, POLE_H, 6);
    pole.translate(0, POLE_H / 2, 0);
    return { flag, pole };
  }, []);
  const mats = useMemo(() => {
    const flag = new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide });
    animateVertices(
      flag,
      "flag",
      "",
      `
      float fph = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831;
      float fw = uv.x;
      transformed.x += sin(fw * 7.0 - uTime * 5.5 + fph) * 0.32 * fw;
      transformed.y += sin(fw * 5.0 - uTime * 4.0 + fph) * 0.12 * fw;
      `
    );
    const pole = new THREE.MeshStandardMaterial({ color: "#d1d5db", roughness: 0.4, metalness: 0.5 });
    return { flag, pole };
  }, []);

  useEffect(() => {
    const p = poleRef.current;
    const f = flagRef.current;
    if (!p || !f) return;
    const m = new THREE.Matrix4();
    spots.forEach((s, i) => {
      m.makeTranslation(s.x, 0, s.z);
      p.setMatrixAt(i, m);
      m.makeTranslation(s.x, POLE_H - FLAG_H / 2 - 0.3, s.z);
      f.setMatrixAt(i, m);
      f.setColorAt(i, s.c);
    });
    p.instanceMatrix.needsUpdate = true;
    f.instanceMatrix.needsUpdate = true;
    if (f.instanceColor) f.instanceColor.needsUpdate = true;
  }, [spots]);
  useEffect(
    () => () => {
      geo.flag.dispose();
      geo.pole.dispose();
      mats.flag.dispose();
      mats.pole.dispose();
    },
    [geo, mats]
  );

  return (
    <>
      <instancedMesh ref={poleRef} args={[geo.pole, mats.pole, spots.length]} castShadow frustumCulled={false} />
      <instancedMesh ref={flagRef} args={[geo.flag, mats.flag, spots.length]} frustumCulled={false} />
    </>
  );
}

/** Everything around the start/finish line: signal lights, map sign, grandstand with crowd, waving flags. */
export function StartArea({ mapId }: { mapId: string }) {
  const quality = useQualityLevel();
  const map = getMap(mapId);
  const start = useMemo(() => generateCenterline(mapId)[0], [mapId]);
  const accent = map.theme.kerb[0];
  const flagColors = useMemo(() => [map.theme.kerb[0], "#f8fafc", map.theme.kerb[1], "#facc15"], [map]);
  const crowd = quality === "low" ? 0.45 : quality === "medium" ? 0.75 : 1;

  return (
    <group position={[start.x, start.y, start.z]} rotation={[0, start.heading, 0]}>
      <StartLights y={3.75} />
      <MapSign mapId={mapId} y={5.65} />
      <Grandstand frontX={TRACK.wallOffset + 5} z0={-8} accent={accent} seed={mapId.length * 131 + 7} crowd={crowd} />
      <Flags colors={flagColors} count={quality === "low" ? 6 : 10} />
    </group>
  );
}
