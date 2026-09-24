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

function SkyEnvironment({ file, solid }: { file: string; solid: boolean }) {
  return <Environment files={file} background={!solid} />;
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

  // the HDRI currently shown (swapped only once the new one is loaded)
  const [shownHdr, setShownHdr] = useState(env.hdr);

  const envRef = useRef<EnvParams>(env);
  const stormRef = useRef(false);
  useEffect(() => {
    envRef.current = env;
    stormRef.current = weather === "storm";
  }, [env, weather]);

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
    if (envRef.current.solidBg && fog) scene.background = fog.color;
  });

  return (
    <>
      <fog ref={fogRef} attach="fog" args={FOG_ARGS} />
      <ambientLight ref={ambRef} />
      <SunLight target={target} sunRef={sun} shadows={quality.shadows} mapSize={quality.shadowMapSize} />
      <Suspense fallback={null}>
        <HdrLoader file={env.hdr} onReady={setShownHdr} />
      </Suspense>
      <Suspense fallback={null}>
        <SkyEnvironment file={shownHdr} solid={env.solidBg} />
      </Suspense>
      <Precipitation target={target} />
    </>
  );
}
