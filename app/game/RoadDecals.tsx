"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { generateCenterline, getCheckpoints } from "./trackPath";
import { getMap } from "./maps";

function arrowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, 128, 256);
  g.fillStyle = "#ffffff";
  // bent turn arrow: shaft up the middle, bending toward the upper-left, with a head
  g.beginPath();
  g.moveTo(52, 250);
  g.lineTo(52, 130);
  g.lineTo(30, 100);
  g.lineTo(14, 112);
  g.lineTo(20, 60);
  g.lineTo(72, 74);
  g.lineTo(56, 84);
  g.lineTo(76, 116);
  g.lineTo(76, 250);
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Painted turn arrows on the road approaching each sharp corner (one instanced draw call). */
export function RoadDecals({ mapId }: { mapId: string }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const tint = getMap(mapId).theme.neon ? "#8892b8" : "#e8e8e8";
  const spots = useMemo(() => {
    const path = generateCenterline(mapId);
    const n = path.length;
    const out: { x: number; y: number; z: number; heading: number; pitch: number; dir: number }[] = [];
    const cps = getCheckpoints(mapId);
    let last = -100;
    for (let i = 2; i < n - 2; i++) {
      const strong = Math.abs(path[i].curvature) > 0.022;
      const prevStrong = Math.abs(path[i - 1].curvature) > 0.022;
      if (!strong || prevStrong || i - last < 60) continue;
      last = i;
      const dir = path[i].curvature > 0 ? 1 : -1; // + = right turn
      // three arrows leading into the corner, ~25 m apart, in the lane centres
      for (let k = 0; k < 2; k++) {
        let j = (i - 20 - k * 17 + n) % n;
        // keep clear of checkpoint gates (they have their own road chevrons): slide back along the road
        for (let t = 0; t < 4 && cps.some((c) => Math.min(Math.abs(c - j), n - Math.abs(c - j)) < 9); t++) j = (j - 10 + n) % n;
        const p = path[j];
        const a = path[(j - 2 + n) % n];
        const b = path[(j + 2) % n];
        out.push({ x: p.x, y: p.y, z: p.z, heading: p.heading, pitch: Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z)), dir });
      }
    }
    return out;
  }, [mapId]);

  const tex = useMemo(() => arrowTexture(), []);
  const mat = useMemo(
    () => new THREE.MeshStandardMaterial({ map: tex, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, color: tint }),
    [tex, tint]
  );
  const geo = useMemo(() => new THREE.PlaneGeometry(1.7, 3.4), []);

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    spots.forEach((d, i) => {
      // lie flat, image-up along the direction of travel, follow the road pitch, mirror for right turns
      e.set(-Math.PI / 2 - d.pitch, d.heading, Math.PI, "YXZ");
      q.setFromEuler(e);
      s.set(d.dir > 0 ? -1 : 1, 1, 1);
      p.set(d.x, d.y + 0.085, d.z);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [spots]);
  useEffect(
    () => () => {
      tex.dispose();
      mat.dispose();
      geo.dispose();
    },
    [tex, mat, geo]
  );

  if (!spots.length) return null;
  return <instancedMesh ref={ref} args={[geo, mat, spots.length]} frustumCulled={false} receiveShadow />;
}
