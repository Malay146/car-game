"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { MAX_PARTICLES, MAX_SKIDS, particles, skids } from "./fx";

function radialTexture(stops: [number, string][], size = 64): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

/** Rubber mark: solid core with feathered edges across the width and a soft start/end along the length. */
function skidTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 64;
  const g = c.getContext("2d")!;
  const across = g.createLinearGradient(0, 0, 32, 0);
  across.addColorStop(0, "rgba(0,0,0,0)");
  across.addColorStop(0.3, "rgba(0,0,0,0.95)");
  across.addColorStop(0.7, "rgba(0,0,0,0.95)");
  across.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = across;
  g.fillRect(0, 0, 32, 64);
  g.globalCompositeOperation = "destination-in";
  const along = g.createLinearGradient(0, 0, 0, 64);
  along.addColorStop(0, "rgba(0,0,0,0.25)");
  along.addColorStop(0.3, "rgba(0,0,0,1)");
  along.addColorStop(0.7, "rgba(0,0,0,1)");
  along.addColorStop(1, "rgba(0,0,0,0.25)");
  g.fillStyle = along;
  g.fillRect(0, 0, 32, 64);
  return new THREE.CanvasTexture(c);
}

/** Renders drift smoke, boost flames and tire marks from the shared fx pools. */
export function Effects() {
  const particleMesh = useRef<THREE.InstancedMesh>(null);
  const skidMesh = useRef<THREE.InstancedMesh>(null);
  const tmp = useRef({
    m: new THREE.Matrix4(),
    q: new THREE.Quaternion(),
    e: new THREE.Euler(),
    p: new THREE.Vector3(),
    s: new THREE.Vector3(),
    c: new THREE.Color(),
    zero: new THREE.Matrix4().makeScale(0, 0, 0),
  });

  const tex = useMemo(
    () => ({
      puff: radialTexture([
        [0, "rgba(255,255,255,0.9)"],
        [0.45, "rgba(255,255,255,0.45)"],
        [1, "rgba(255,255,255,0)"],
      ]),
      skid: skidTexture(),
    }),
    []
  );
  useEffect(() => {
    const mesh = skidMesh.current;
    if (mesh) mesh.count = 0;
    return () => {
      tex.puff.dispose();
      tex.skid.dispose();
    };
  }, [tex]);

  useFrame((state, delta) => {
    const t = tmp.current;
    const camQ = state.camera.quaternion;
    const pm = particleMesh.current;
    if (pm) {
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.age += delta;
        if (p.age >= p.life) {
          particles.splice(i, 1);
          continue;
        }
        p.x += p.vx * delta;
        p.y += p.vy * delta;
        p.z += p.vz * delta;
      }
      for (let i = 0; i < MAX_PARTICLES; i++) {
        const p = particles[i];
        if (!p) {
          pm.setMatrixAt(i, t.zero);
          continue;
        }
        const k = p.age / p.life;
        const size = p.size * (1 + p.grow * k) * (1 - k * k);
        t.p.set(p.x, p.y, p.z);
        t.s.setScalar(Math.max(size, 0.001));
        t.m.compose(t.p, camQ, t.s); // camera-facing puff
        pm.setMatrixAt(i, t.m);
        t.c.setRGB(p.r, p.g, p.b);
        pm.setColorAt(i, t.c);
      }
      pm.instanceMatrix.needsUpdate = true;
      if (pm.instanceColor) pm.instanceColor.needsUpdate = true;
    }

    const sm = skidMesh.current;
    if (sm) {
      sm.count = skids.length;
      for (let i = 0; i < skids.length; i++) {
        const s = skids[i];
        t.e.set(-Math.PI / 2, 0, -s.heading, "YXZ");
        t.q.setFromEuler(t.e);
        t.p.set(s.x, s.y, s.z);
        t.s.set(1, 1, 1);
        t.m.compose(t.p, t.q, t.s);
        sm.setMatrixAt(i, t.m);
      }
      sm.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group>
      <instancedMesh ref={particleMesh} args={[undefined, undefined, MAX_PARTICLES]} frustumCulled={false}>
        <planeGeometry args={[2.2, 2.2]} />
        <meshBasicMaterial map={tex.puff} transparent opacity={0.6} depthWrite={false} fog />
      </instancedMesh>
      <instancedMesh ref={skidMesh} args={[undefined, undefined, MAX_SKIDS]} frustumCulled={false}>
        <planeGeometry args={[0.34, 1.0]} />
        <meshBasicMaterial map={tex.skid} color="#050505" transparent opacity={0.6} depthWrite={false} polygonOffset polygonOffsetFactor={-8} polygonOffsetUnits={-8} />
      </instancedMesh>
    </group>
  );
}
