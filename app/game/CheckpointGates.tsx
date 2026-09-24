"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { TRACK, generateCenterline, getCheckpoints } from "./trackPath";
import { getMap } from "./maps";
import { useQualityLevel } from "./settings";

function chevronTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, 128, 128);
  g.strokeStyle = "#fff";
  g.lineWidth = 16;
  g.lineJoin = "miter";
  g.lineCap = "butt";
  for (let i = 0; i < 2; i++) {
    const y = 20 + i * 64;
    g.beginPath();
    g.moveTo(14, y + 40);
    g.lineTo(64, y);
    g.lineTo(114, y + 40);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 2);
  t.anisotropy = 4;
  return t;
}

function beamTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 128, 0, 0);
  grad.addColorStop(0, "rgba(255,255,255,0.75)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 8, 128);
  return new THREE.CanvasTexture(c);
}

function bannerTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, 512, 64);
  g.fillStyle = "rgba(10,12,18,0.9)";
  g.fillRect(0, 0, 512, 64);
  g.fillStyle = "#fff";
  g.font = "800 34px Arial, Helvetica, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("CHECKPOINT", 256, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const HDR = 2.2;

/** Glowing checkpoint gates: emissive posts, light beams, a name banner and chevrons that stream along the road. */
export function CheckpointGates({ mapId }: { mapId: string }) {
  const quality = useQualityLevel();
  const accent = getMap(mapId).theme.kerb[0];
  const gates = useMemo(() => {
    const path = generateCenterline(mapId);
    return getCheckpoints(mapId)
      .slice(1)
      .map((i) => {
        const a = path[(i - 3 + path.length) % path.length];
        const b = path[(i + 3) % path.length];
        return { ...path[i], pitch: Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z)) };
      });
  }, [mapId]);

  const res = useMemo(() => {
    const chev = chevronTexture();
    const beam = beamTexture();
    const banner = bannerTexture();
    const glow = new THREE.Color(accent).multiplyScalar(HDR);
    return {
      chev,
      beam,
      banner,
      post: new THREE.MeshBasicMaterial({ color: glow, toneMapped: false }),
      chevMat: new THREE.MeshBasicMaterial({ map: chev, color: glow, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, opacity: 0.9 }),
      beamMat: new THREE.MeshBasicMaterial({ map: beam, color: new THREE.Color(accent).multiplyScalar(1.4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: true }),
      bannerMat: new THREE.MeshBasicMaterial({ map: banner, toneMapped: false }),
    };
  }, [accent]);
  const anim = useRef<{ chev: THREE.Texture; beamMat: THREE.Material } | null>(null);
  useEffect(() => {
    anim.current = { chev: res.chev, beamMat: res.beamMat };
    return () => {
      anim.current = null;
      res.chev.dispose();
      res.beam.dispose();
      res.banner.dispose();
      res.post.dispose();
      res.chevMat.dispose();
      res.beamMat.dispose();
      res.bannerMat.dispose();
    };
  }, [res]);

  useFrame((state) => {
    // chevrons stream forward along the road (texture space)
    const a = anim.current;
    if (!a) return;
    a.chev.offset.y = -((state.clock.elapsedTime * 0.9) % 1);
    a.beamMat.opacity = 0.75 + Math.sin(state.clock.elapsedTime * 3) * 0.2;
  });

  const half = TRACK.roadWidth / 2 + TRACK.kerbWidth + 0.5;
  return (
    <group>
      {gates.map((p, i) => (
        <group key={i} position={[p.x, p.y, p.z]} rotation={[0, p.heading, 0]}>
          {[-half, half].map((x) => (
            <group key={x} position={[x, 0, 0]}>
              <mesh position={[0, 2.6, 0]} material={res.post}>
                <cylinderGeometry args={[0.2, 0.26, 5.2, 8]} />
              </mesh>
              {quality !== "low" && (
                <mesh position={[0, 9, 0]} material={res.beamMat}>
                  <cylinderGeometry args={[0.55, 0.9, 18, 10, 1, true]} />
                </mesh>
              )}
            </group>
          ))}
          <mesh position={[0, 5.15, 0]} material={res.post}>
            <boxGeometry args={[half * 2 + 0.5, 0.36, 0.36]} />
          </mesh>
          <mesh position={[0, 4.35, -0.05]} rotation={[0, Math.PI, 0]} material={res.bannerMat}>
            <planeGeometry args={[half * 1.5, half * 1.5 * (64 / 512)]} />
          </mesh>
          <mesh position={[0, 4.35, 0.05]} material={res.bannerMat}>
            <planeGeometry args={[half * 1.5, half * 1.5 * (64 / 512)]} />
          </mesh>
          <mesh position={[0, 0.1, 0]} rotation={[-Math.PI / 2 - p.pitch, 0, Math.PI]} material={res.chevMat}>
            <planeGeometry args={[TRACK.roadWidth - 1, 5]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
