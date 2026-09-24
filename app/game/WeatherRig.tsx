"use client";

import { RefObject, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Environment, useEnvironment } from "@react-three/drei";
import * as THREE from "three";
import { SunLight, LiveSun } from "./SunLight";
import { Precipitation } from "./Precipitation";
import type { CarTransform } from "./vehicleTypes";
import { EnvParams, computeEnv, onThunder, useTodId, useWeatherId } from "./weather";
import { useGameStore } from "./store";
import { useQualityLevel } from "./settings";
import { QUALITY } from "./quality";

/** Working state that eases towards the target lighting, so changing weather / time of day crossfades. */
interface Live {
  fog: THREE.Color;
  near: number;
  far: number;
  amb: number;
  ambColor: THREE.Color;
  sunColor: THREE.Color;
  sunI: number;
  sunPos: THREE.Vector3;
  envI: number;
  bgI: number;
  /** lightning */
  strikeAge: number;
  nextStrike: number;
}

const FLASH_COLOR = new THREE.Color("#c9d6ff");
// Placeholder fog args: the real values are eased in useFrame (changing args would recreate the fog and skip the crossfade).
const FOG_ARGS: [string, number, number] = ["#bcd3e6", 90, 420];
const SETTLE_RATE = 2.5; // 1/s: about a second to crossfade

/** Lightning brightness envelope (0..1) for `age` seconds after a strike: a sharp flash plus a weaker re-strike. */
function flashAt(age: number): number {
  if (age < 0) return 0;
  let f = age < 0.05 ? age / 0.05 : Math.exp(-(age - 0.05) * 9);
  if (age > 0.22) f = Math.max(f, 0.65 * Math.exp(-(age - 0.22) * 8));
  return age > 1.5 ? 0 : f;
}

/** Loads an HDRI in its own Suspense boundary and tells us when it is cached, so the swap never blanks the scene. */
function HdrLoader({ file, onReady }: { file: string; onReady: (file: string) => void }) {
  useEnvironment({ files: file });
  useEffect(() => {
    const id = setTimeout(() => onReady(file), 0);
    return () => clearTimeout(id);
  }, [file, onReady]);
  return null;
}

/**
 * Sky + image-based lighting from one HDRI. When the file changes, the previous HDRI is dropped from the
 * loader cache and its GPU texture freed, so switching maps / weather never piles up 1k HDRIs (iOS memory).
 */
function SkyEnvironment({ file, background }: { file: string; background: boolean }) {
  const map = useEnvironment({ files: file });
  useEffect(
    () => () => {
      map.dispose();
      useEnvironment.clear({ files: file });
    },
    [map, file]
  );
  return <Environment map={map} background={background} />;
}

const SKY_BLUE = new THREE.Color("#3f6fb5");
const _c = new THREE.Color();

/** Writes the gradient; re-uploads (16 bytes) only when a texel actually changed. */
function paintSky(tex: THREE.DataTexture, horizon: THREE.Color, mid: THREE.Color, zenith: THREE.Color) {
  const d = tex.image.data as Uint8Array;
  const before = checksum(d);
  writeTexel(d, 0, horizon);
  writeTexel(d, 1, horizon);
  writeTexel(d, 2, mid);
  writeTexel(d, 3, zenith);
  if (checksum(d) !== before) tex.needsUpdate = true;
}

function checksum(d: Uint8Array): number {
  let h = 0;
  for (let i = 0; i < d.length; i++) h = (h * 31 + d[i]) | 0;
  return h;
}

/** A 1x4 texel gradient (horizon at the bottom, zenith at the top) used as a flat sky on Low quality. */
function makeSkyGradient(): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array(16), 1, 4, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

function writeTexel(data: Uint8Array, row: number, c: THREE.Color) {
  _c.copy(c).convertLinearToSRGB();
  data[row * 4] = Math.round(Math.min(1, _c.r) * 255);
  data[row * 4 + 1] = Math.round(Math.min(1, _c.g) * 255);
  data[row * 4 + 2] = Math.round(Math.min(1, _c.b) * 255);
  data[row * 4 + 3] = 255;
}

/**
 * Owns the sky/lighting/fog for the whole scene: fog, ambient light, the shadow-casting sun, the
 * HDRI environment, plus rain/snow and storm lightning. Lighting values ease towards the lookup in
 * `computeEnv` (weather.ts) every frame, so it is safe to change weather at any time.
 */
export function WeatherRig({ target }: { target: RefObject<CarTransform> }) {
  const mapId = useGameStore((s) => s.mapId);
  const weather = useWeatherId();
  const tod = useTodId();
  const quality = QUALITY[useQualityLevel()];
  const env = useMemo<EnvParams>(() => computeEnv(mapId, weather, tod), [mapId, weather, tod]);

  // Low uses a 128x64 copy of each HDRI for lighting only (32 KB instead of 1-1.7 MB; the sky is a gradient).
  const hdrFile = quality.cheapSky ? env.hdr.replace("/hdr/", "/hdr/lo/") : env.hdr;
  // the HDRI currently shown (swapped only once the new one is loaded)
  const [shownHdr, setShownHdr] = useState(hdrFile);

  const envRef = useRef<EnvParams>(env);
  const stormRef = useRef(false);
  useEffect(() => {
    envRef.current = env;
    stormRef.current = weather === "storm";
  }, [env, weather]);

  const cheapRef = useRef(quality.cheapSky);
  useEffect(() => {
    cheapRef.current = quality.cheapSky;
  }, [quality.cheapSky]);
  const skyTex = useMemo(() => makeSkyGradient(), []);
  useEffect(() => () => skyTex.dispose(), [skyTex]);
  const zenith = useRef(new THREE.Color());
  const mid = useRef(new THREE.Color());

  const fogRef = useRef<THREE.Fog>(null);
  const ambRef = useRef<THREE.AmbientLight>(null);
  const live = useRef<Live | null>(null);
  const sun = useRef<LiveSun | null>(null);

  useFrame((state, dt) => {
    const t = envRef.current;
    let L = live.current;
    if (!L) {
      L = live.current = {
        fog: t.fogColor.clone(),
        near: t.fogNear,
        far: t.fogFar,
        amb: t.amb,
        ambColor: t.ambColor.clone(),
        sunColor: t.sunColor.clone(),
        sunI: t.sunI,
        sunPos: new THREE.Vector3(...t.sunPos),
        envI: t.envI,
        bgI: t.bgI,
        strikeAge: 99,
        nextStrike: 3,
      };
      sun.current = { color: new THREE.Color(), intensity: t.sunI, pos: new THREE.Vector3() };
    } else {
      const k = 1 - Math.exp(-Math.min(dt, 0.1) * SETTLE_RATE);
      L.fog.lerp(t.fogColor, k);
      L.near += (t.fogNear - L.near) * k;
      L.far += (t.fogFar - L.far) * k;
      L.amb += (t.amb - L.amb) * k;
      L.ambColor.lerp(t.ambColor, k);
      L.sunColor.lerp(t.sunColor, k);
      L.sunI += (t.sunI - L.sunI) * k;
      L.sunPos.x += (t.sunPos[0] - L.sunPos.x) * k;
      L.sunPos.y += (t.sunPos[1] - L.sunPos.y) * k;
      L.sunPos.z += (t.sunPos[2] - L.sunPos.z) * k;
      L.envI += (t.envI - L.envI) * k;
      L.bgI += (t.bgI - L.bgI) * k;
    }

    // ----- lightning (storm only) -----
    let flash = 0;
    if (stormRef.current) {
      L.strikeAge += dt;
      L.nextStrike -= dt;
      if (L.nextStrike <= 0) {
        L.strikeAge = 0;
        L.nextStrike = 4 + Math.random() * 8;
        // AUDIO: thunder hook (see weather.ts). Distance is random: near strikes are louder and later strikes further.
        onThunder(Math.random());
      }
      flash = flashAt(L.strikeAge);
    } else {
      L.strikeAge = 99;
      L.nextStrike = 2 + Math.random() * 3;
    }

    const fog = fogRef.current;
    if (fog) {
      fog.color.copy(L.fog).lerp(FLASH_COLOR, flash * 0.55);
      fog.near = L.near;
      fog.far = L.far;
    }
    const amb = ambRef.current;
    if (amb) {
      amb.color.copy(L.ambColor);
      amb.intensity = L.amb + flash * 1.1;
    }
    const s = sun.current;
    if (s) {
      s.color.copy(L.sunColor).lerp(FLASH_COLOR, flash);
      s.intensity = L.sunI + flash * 7;
      s.pos.copy(L.sunPos);
    }
    const scene = state.scene;
    scene.environmentIntensity = L.envI + flash * 1.4;
    scene.backgroundIntensity = L.bgI + flash * 1.8;
    const cheap = cheapRef.current;
    if (fog && cheap && !envRef.current.solidBg) {
      // Low: flat gradient sky whose horizon matches the fog, so clipping at the fog distance is seamless.
      const lum = Math.max(fog.color.r, fog.color.g, fog.color.b);
      zenith.current.copy(fog.color).multiplyScalar(0.72).lerp(_c.copy(SKY_BLUE).multiplyScalar(lum), 0.35);
      mid.current.copy(fog.color).lerp(zenith.current, 0.55);
      paintSky(skyTex, fog.color, mid.current, zenith.current);
      scene.background = skyTex;
    } else if (envRef.current.solidBg && fog) {
      scene.background = fog.color;
    }
    // Low: nothing past the fog is visible, so do not draw it (the far plane also culls far scenery cells).
    const cam = state.camera as THREE.PerspectiveCamera;
    const far = cheap ? Math.max(160, L.far * 1.05) : 900;
    if (Math.abs(cam.far - far) > 2) {
      cam.far = far;
      cam.updateProjectionMatrix();
    }
  });

  return (
    <>
      <fog ref={fogRef} attach="fog" args={FOG_ARGS} />
      <ambientLight ref={ambRef} />
      <SunLight target={target} sunRef={sun} shadows={quality.shadows} mapSize={quality.shadowMapSize} />
      <Suspense fallback={null}>
        <HdrLoader file={hdrFile} onReady={setShownHdr} />
      </Suspense>
      <Suspense fallback={null}>
        <SkyEnvironment file={shownHdr} background={!env.solidBg && !quality.cheapSky} />
      </Suspense>
      <Precipitation target={target} />
    </>
  );
}
