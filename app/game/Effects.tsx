"use client";

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { MAX_PARTICLES, MAX_SKIDS, particles, skids } from "./fx";

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

  useEffect(() => {
    const mesh = skidMesh.current;
    if (!mesh) return;
    mesh.count = 0;
  }, []);

  useFrame((_, delta) => {
    const t = tmp.current;
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
        t.m.compose(t.p, t.q.identity(), t.s);
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
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial transparent opacity={0.55} depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={skidMesh} args={[undefined, undefined, MAX_SKIDS]} frustumCulled={false}>
        <planeGeometry args={[0.26, 0.9]} />
        <meshBasicMaterial color="#0d0d0d" transparent opacity={0.55} depthWrite={false} />
      </instancedMesh>
    </group>
  );
}
