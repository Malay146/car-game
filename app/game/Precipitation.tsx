"use client";

import { RefObject, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { CarTransform } from "./vehicleTypes";
import { useQualityLevel } from "./settings";
import { PARTICLE_COUNTS, useTodId, useWeatherId } from "./weather";

// Everything here is GPU-animated: geometry is built once, the vertex shader wraps every particle
// around a box that follows the camera, and per frame we only update a handful of uniforms.

const _dir = new THREE.Vector3();
const _center = new THREE.Vector3();
const LUM: Record<string, number> = { day: 1, dawn: 0.7, dusk: 0.6, night: 0.32 };

function rand01(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Pixels-per-world-unit-at-depth-1 for the current camera/canvas (for min pixel widths / point sizes). */
function pixelScale(camera: THREE.Camera, heightPx: number): number {
  const fov = (camera as THREE.PerspectiveCamera).fov ?? 60;
  return heightPx / (2 * Math.tan((fov * Math.PI) / 360));
}

/** Places the wrap box slightly ahead of the camera so most particles are in view. */
function boxCenter(camera: THREE.Camera, ahead: number) {
  camera.getWorldDirection(_dir);
  _center.set(camera.position.x + _dir.x * ahead, camera.position.y + 3, camera.position.z + _dir.z * ahead);
  return _center;
}

// ----- rain streaks ------------------------------------------------------------------------------

const RAIN_VERT = /* glsl */ `
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform vec3 uFall;
uniform vec3 uVel;
uniform float uLen;
uniform float uWidth;
uniform float uPx;
attribute vec3 aSeed;
attribute vec2 aCorner;
varying float vAlpha;
varying vec2 vC;
void main() {
  vec3 p = aSeed * uBox + uFall * uTime;
  vec3 rel = mod(p - uCenter + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 world = uCenter + rel;
  vec4 a = viewMatrix * vec4(world, 1.0);
  vec4 b = viewMatrix * vec4(world - uVel * uLen, 1.0);
  vec3 dir = b.xyz - a.xyz;
  vec3 side = normalize(cross(dir, a.xyz));
  float w = max(uWidth, -a.z * 1.3 / uPx);
  vec3 pos = mix(a.xyz, b.xyz, aCorner.y) + side * aCorner.x * w * 0.5;
  vec3 e = abs(rel) / (uBox * 0.5);
  float edge = 1.0 - max(e.x, max(e.y, e.z));
  float h = fract(aSeed.x * 91.7 + aSeed.z * 37.3);
  vAlpha = smoothstep(0.0, 0.2, edge) * (0.45 + 0.55 * h) * clamp(uWidth / w, 0.35, 1.0);
  vC = aCorner;
  gl_Position = projectionMatrix * vec4(pos, 1.0);
}
`;

const RAIN_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
varying vec2 vC;
void main() {
  float a = vAlpha * (1.0 - abs(vC.x)) * (0.25 + 0.75 * (1.0 - vC.y)) * uOpacity;
  gl_FragColor = vec4(uColor, a);
}
`;

function Rain({ target, count, storm, bright }: { target: RefObject<CarTransform>; count: number; storm: boolean; bright: number }) {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const geo = useMemo(() => {
    const seeds = new Float32Array(count * 4 * 3);
    const corners = new Float32Array(count * 4 * 2);
    const index = new Uint32Array(count * 6);
    for (let i = 0; i < count; i++) {
      const sx = rand01(i * 3 + 1);
      const sy = rand01(i * 3 + 2);
      const sz = rand01(i * 3 + 3);
      for (let v = 0; v < 4; v++) {
        seeds.set([sx, sy, sz], (i * 4 + v) * 3);
        corners.set([v & 1 ? 1 : -1, v & 2 ? 1 : 0], (i * 4 + v) * 2);
      }
      index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 4 * 3), 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 3));
    g.setAttribute("aCorner", new THREE.BufferAttribute(corners, 2));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    return g;
  }, [count]);
  useEffect(() => () => geo.dispose(), [geo]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(46, 26, 46) },
      uFall: { value: new THREE.Vector3() },
      uVel: { value: new THREE.Vector3() },
      uLen: { value: 0.03 },
      uWidth: { value: 0.045 },
      uPx: { value: 800 },
      uColor: { value: new THREE.Color() },
      uOpacity: { value: 0.5 },
    }),
    []
  );

  useFrame((state) => {
    const m = mat.current;
    if (!m) return;
    const u = m.uniforms;
    const t = target.current;
    const fall = storm ? 46 : 36;
    const wx = storm ? 9 : 2.5;
    const wz = storm ? 3 : 1;
    u.uTime.value = state.clock.elapsedTime % 1000;
    u.uCenter.value.copy(boxCenter(state.camera, 14));
    u.uFall.value.set(wx, -fall, wz);
    // streaks lean against the car's own motion, so speed makes the rain rush past
    u.uVel.value.set(wx - t.vx * 0.6, -fall, wz - t.vz * 0.6);
    u.uPx.value = pixelScale(state.camera, state.size.height);
    u.uColor.value.setRGB(0.72 * bright, 0.8 * bright, 0.9 * bright);
    u.uOpacity.value = storm ? 0.85 : 0.75;
  });

  return (
    <mesh geometry={geo} frustumCulled={false} renderOrder={5}>
      <shaderMaterial
        ref={mat}
        vertexShader={RAIN_VERT}
        fragmentShader={RAIN_FRAG}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
        fog={false}
      />
    </mesh>
  );
}

// ----- snow flakes -------------------------------------------------------------------------------

const SNOW_VERT = /* glsl */ `
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform vec3 uWind;
uniform float uFall;
uniform float uSize;
uniform float uPx;
attribute vec3 aSeed;
varying float vAlpha;
void main() {
  float h = fract(aSeed.x * 91.7 + aSeed.z * 37.3);
  vec3 p = aSeed * uBox;
  p.y -= uFall * (0.7 + 0.6 * h) * uTime;
  p.xz += uWind.xz * uTime;
  p.x += sin(uTime * (0.6 + h) + aSeed.z * 40.0) * 1.1;
  p.z += cos(uTime * (0.5 + h) + aSeed.x * 40.0) * 1.1;
  vec3 rel = mod(p - uCenter + uBox * 0.5, uBox) - uBox * 0.5;
  vec4 mv = viewMatrix * vec4(uCenter + rel, 1.0);
  vec3 e = abs(rel) / (uBox * 0.5);
  float edge = 1.0 - max(e.x, max(e.y, e.z));
  vAlpha = smoothstep(0.0, 0.2, edge) * (0.55 + 0.45 * h);
  gl_PointSize = clamp(uSize * (0.6 + 0.8 * h) * uPx / max(-mv.z, 0.1), 1.5, 22.0);
  gl_Position = projectionMatrix * mv;
}
`;

const SNOW_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.35, 1.0, d)) * vAlpha;
  if (a < 0.02) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

function Snow({ count, bright }: { count: number; bright: number }) {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const geo = useMemo(() => {
    const seeds = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) seeds.set([rand01(i * 3 + 11), rand01(i * 3 + 12), rand01(i * 3 + 13)], i * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 3));
    return g;
  }, [count]);
  useEffect(() => () => geo.dispose(), [geo]);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(46, 24, 46) },
      uWind: { value: new THREE.Vector3(1.6, 0, 0.6) },
      uFall: { value: 2.4 },
      uSize: { value: 0.16 },
      uPx: { value: 800 },
      uColor: { value: new THREE.Color() },
    }),
    []
  );
  useFrame((state) => {
    const m = mat.current;
    if (!m) return;
    const u = m.uniforms;
    u.uTime.value = state.clock.elapsedTime % 1000;
    u.uCenter.value.copy(boxCenter(state.camera, 16));
    u.uPx.value = pixelScale(state.camera, state.size.height);
    u.uColor.value.setRGB(0.95 * bright, 0.97 * bright, bright);
  });
  return (
    <points geometry={geo} frustumCulled={false} renderOrder={5}>
      <shaderMaterial
        ref={mat}
        vertexShader={SNOW_VERT}
        fragmentShader={SNOW_FRAG}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        fog={false}
      />
    </points>
  );
}

// ----- ground splash ripples ----------------------------------------------------------------------

const RIPPLE_VERT = /* glsl */ `
uniform float uTime;
uniform float uLife;
attribute vec4 aData; // x, y, z, birth time
attribute vec2 aCorner;
varying vec2 vC;
varying float vAge;
void main() {
  float age = (uTime - aData.w) / uLife;
  vAge = age;
  vC = aCorner;
  if (age < 0.0 || age > 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float r = mix(0.08, 0.7, age);
  vec3 pos = aData.xyz + vec3(aCorner.x * r, 0.0, aCorner.y * r);
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}
`;

const RIPPLE_FRAG = /* glsl */ `
uniform vec3 uColor;
varying vec2 vC;
varying float vAge;
void main() {
  float d = length(vC);
  float ring = smoothstep(0.55, 0.78, d) * (1.0 - smoothstep(0.78, 1.0, d));
  float a = ring * (1.0 - vAge) * 0.8;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

/** Small expanding rings on the ground around the car; positions are re-rolled on the CPU (few per frame). */
function Ripples({ target, count, storm, bright }: { target: RefObject<CarTransform>; count: number; storm: boolean; bright: number }) {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const LIFE = 0.55;
  const geo = useMemo(() => {
    const data = new Float32Array(count * 4 * 4);
    const corners = new Float32Array(count * 4 * 2);
    const index = new Uint32Array(count * 6);
    for (let i = 0; i < count; i++) {
      for (let v = 0; v < 4; v++) {
        data.set([0, -1000, 0, -1000], (i * 4 + v) * 4);
        corners.set([v & 1 ? 1 : -1, v & 2 ? 1 : -1], (i * 4 + v) * 2);
      }
      index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 4 * 3), 3));
    g.setAttribute("aData", new THREE.BufferAttribute(data, 4));
    g.setAttribute("aCorner", new THREE.BufferAttribute(corners, 2));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    return g;
  }, [count]);
  useEffect(() => () => geo.dispose(), [geo]);
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uLife: { value: LIFE }, uColor: { value: new THREE.Color() } }), []);
  // birth times are staggered so the ripples do not all respawn on the same frame
  const births = useRef<Float32Array | null>(null);

  useFrame((state) => {
    const m = mat.current;
    if (!m) return;
    const now = state.clock.elapsedTime;
    if (!births.current) {
      births.current = new Float32Array(count);
      for (let i = 0; i < count; i++) births.current[i] = now - LIFE * 2 * rand01(i + 5);
    }
    const b = births.current;
    const attr = geo.getAttribute("aData") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const t = target.current;
    const groundY = t.y + 0.06; // the car transform sits on the road surface (its pivot is ~6 cm below the tarmac)
    let dirty = false;
    for (let i = 0; i < count; i++) {
      if (now - b[i] < LIFE * (storm ? 0.9 : 1.2)) continue;
      const a = Math.random() * Math.PI * 2;
      const r = 1.5 + Math.random() * 11;
      const x = t.x + t.vx * 0.25 + Math.cos(a) * r;
      const z = t.z + t.vz * 0.25 + Math.sin(a) * r;
      b[i] = now;
      for (let v = 0; v < 4; v++) {
        const o = (i * 4 + v) * 4;
        arr[o] = x;
        arr[o + 1] = groundY + 0.06;
        arr[o + 2] = z;
        arr[o + 3] = now;
      }
      dirty = true;
    }
    if (dirty) attr.needsUpdate = true;
    m.uniforms.uTime.value = now;
    m.uniforms.uColor.value.setRGB(0.8 * bright, 0.86 * bright, 0.95 * bright);
  });

  return (
    <mesh geometry={geo} frustumCulled={false} renderOrder={4}>
      <shaderMaterial
        ref={mat}
        vertexShader={RIPPLE_VERT}
        fragmentShader={RIPPLE_FRAG}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
        fog={false}
        polygonOffset
        polygonOffsetFactor={-4}
        polygonOffsetUnits={-4}
      />
    </mesh>
  );
}

/** Rain, storm rain + splashes, or snow depending on the resolved weather; counts scale with quality. */
export function Precipitation({ target }: { target: RefObject<CarTransform> }) {
  const weather = useWeatherId();
  const tod = useTodId();
  const quality = useQualityLevel();
  const counts = PARTICLE_COUNTS[quality];
  const bright = LUM[tod] ?? 1;
  if (weather === "rain" || weather === "storm") {
    const storm = weather === "storm";
    return (
      <>
        <Rain key={counts.rain} target={target} count={Math.round(counts.rain * (storm ? 1.6 : 1))} storm={storm} bright={bright} />
        {counts.ripples > 0 && <Ripples key={counts.ripples} target={target} count={counts.ripples} storm={storm} bright={bright} />}
      </>
    );
  }
  if (weather === "snow") return <Snow count={counts.snow} bright={bright} />;
  return null;
}
