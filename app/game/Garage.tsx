"use client";

import { useSettingsUi } from "./settingsUi";
import { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { useGameStore } from "./store";
import { CARS, PAINTS, getCar, isHexColor, type CarStats } from "./cars";
import { cloneCar, tintPaint } from "./carModel";
import { ShadowBlob } from "./ShadowBlob";

const STAT_ROWS: { key: keyof CarStats; label: string }[] = [
  { key: "accel", label: "Acceleration" },
  { key: "topSpeed", label: "Top speed" },
  { key: "grip", label: "Grip" },
  { key: "handling", label: "Handling" },
];
const bar = (v: number) => Math.max(0.08, Math.min(1, (v - 0.86) / 0.26));

function Turntable({ url, paint }: { url: string; paint: string }) {
  const { scene } = useGLTF(url);
  const inst = useMemo(() => cloneCar(scene, "high"), [scene]);
  const group = useRef<THREE.Group>(null);
  const size = useMemo(() => new THREE.Box3().setFromObject(inst.root).getSize(new THREE.Vector3()), [inst]);

  useEffect(() => {
    tintPaint(inst.paint, paint);
  }, [inst, paint]);
  useEffect(() => {
    return () => inst.paint.forEach((m) => m.dispose());
  }, [inst]);

  useFrame((_, dt) => {
    if (group.current) group.current.rotation.y += dt * 0.6;
  });

  return (
    <group ref={group}>
      <primitive object={inst.root} />
      <ShadowBlob width={size.x * 1.5} length={size.z * 1.3} y={0.01} opacity={0.7} />
    </group>
  );
}

function Preview({ url, paint }: { url: string; paint: string }) {
  return (
    <Canvas dpr={[1, 1.5]} camera={{ fov: 32, position: [5.6, 2.8, 7.0], near: 0.1, far: 60 }} gl={{ antialias: true }}>
      <color attach="background" args={["#14161c"]} />
      <fog attach="fog" args={["#14161c", 12, 26]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[4, 6, 3]} intensity={1.8} />
      <directionalLight position={[-5, 3, -4]} intensity={1.1} color="#8fb4ff" />
      <Environment files="/hdr/overcast.hdr" environmentIntensity={0.8} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <circleGeometry args={[2.7, 48]} />
        <meshStandardMaterial color="#23262f" roughness={0.6} metalness={0.3} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <ringGeometry args={[2.7, 2.78, 64]} />
        <meshBasicMaterial color="#ef4444" />
      </mesh>
      <Suspense fallback={null}>
        <Turntable key={url} url={url} paint={paint} />
      </Suspense>
      <CameraLook />
    </Canvas>
  );
}

function CameraLook() {
  useFrame(({ camera }) => camera.lookAt(0, 0.55, 0));
  return null;
}

/** Full-screen garage: pick a car, see it on a turntable, tweak the paint and name. Everything persists via ProfileSync. */
export function Garage({ onClose }: { onClose: () => void }) {
  const profile = useGameStore((s) => s.profile);
  const setProfile = useGameStore((s) => s.setProfile);
  const car = getCar(profile.carId);
  const paint = isHexColor(profile.paint) ? profile.paint : car.defaultPaint;

  // The garage covers the whole screen: stop rendering the race scene behind it.
  useEffect(() => {
    useSettingsUi.getState().setSceneHidden(true);
    return () => useSettingsUi.getState().setSceneHidden(false);
  }, []);

  useEffect(() => {
    CARS.forEach((c) => useGLTF.preload(c.url));
  }, []);

  const step = (d: number) => {
    const i = CARS.findIndex((c) => c.id === car.id);
    setProfile({ carId: CARS[(i + d + CARS.length) % CARS.length].id });
  };

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex flex-col bg-zinc-950 text-white md:flex-row">
      <div className="relative min-h-[38%] flex-1">
        <Preview url={car.url} paint={paint} />
        <div className="pointer-events-none absolute left-5 top-4">
          <p className="text-xs uppercase tracking-[0.3em] text-zinc-400">Garage</p>
          <h2 className="text-3xl font-black">{car.name}</h2>
          <p className="text-sm text-zinc-400">{car.cls}</p>
        </div>
        <button
          aria-label="Previous car"
          className="absolute left-3 top-1/2 h-11 w-11 -translate-y-1/2 rounded-full bg-white/10 text-2xl hover:bg-white/20"
          onClick={() => step(-1)}
        >
          ‹
        </button>
        <button
          aria-label="Next car"
          className="absolute right-3 top-1/2 h-11 w-11 -translate-y-1/2 rounded-full bg-white/10 text-2xl hover:bg-white/20"
          onClick={() => step(1)}
        >
          ›
        </button>
      </div>

      <div className="flex w-full flex-col gap-4 overflow-y-auto p-5 md:w-[26rem]">
        <label className="block">
          <span className="text-xs uppercase tracking-widest text-zinc-400">Driver name</span>
          <input
            value={profile.name}
            maxLength={16}
            onChange={(e) => setProfile({ name: e.target.value })}
            onBlur={(e) => {
              if (!e.target.value.trim()) setProfile({ name: "Player" });
            }}
            className="mt-1 w-full rounded-md bg-black/50 px-3 py-2 text-lg outline-none ring-1 ring-white/25 focus:ring-white/70"
          />
        </label>

        <div>
          <p className="mb-2 text-xs uppercase tracking-widest text-zinc-400">Choose a car</p>
          <div className="grid grid-cols-3 gap-2">
            {CARS.map((c) => (
              <button
                key={c.id}
                onClick={() => setProfile({ carId: c.id })}
                className={`rounded-lg px-2 py-2 text-left text-sm leading-tight ring-1 transition ${
                  c.id === car.id ? "bg-red-600/80 ring-red-300" : "bg-white/5 ring-white/15 hover:bg-white/10"
                }`}
              >
                <span className="block font-bold">{c.name}</span>
                <span className="block text-[11px] text-zinc-300">{c.cls}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1 text-sm text-zinc-300">{car.blurb}</p>
          <div className="space-y-1.5">
            {STAT_ROWS.map((r) => (
              <div key={r.key} className="flex items-center gap-3 text-xs">
                <span className="w-24 text-zinc-400">{r.label}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-red-500" style={{ width: `${bar(car.stats[r.key]) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs uppercase tracking-widest text-zinc-400">Paint</p>
          <div className="flex flex-wrap items-center gap-2">
            {PAINTS.map((p) => (
              <button
                key={p}
                aria-label={`Paint ${p}`}
                onClick={() => setProfile({ paint: p })}
                className={`h-8 w-8 rounded-full ring-2 transition ${p.toLowerCase() === paint.toLowerCase() ? "scale-110 ring-white" : "ring-white/20 hover:ring-white/60"}`}
                style={{ background: p }}
              />
            ))}
            <label className="relative flex h-8 cursor-pointer items-center gap-2 rounded-full bg-white/10 px-3 text-xs hover:bg-white/20">
              Custom
              <input
                type="color"
                value={paint}
                onChange={(e) => setProfile({ paint: e.target.value })}
                className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0"
              />
            </label>
            <button className="rounded-full bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20" onClick={() => setProfile({ paint: car.defaultPaint })}>
              Stock
            </button>
          </div>
        </div>

        <button
          onClick={onClose}
          className="mt-auto rounded-full bg-red-600 px-8 py-3 text-lg font-bold uppercase tracking-wide shadow-lg transition-transform hover:scale-105 hover:bg-red-500"
        >
          Done
        </button>
      </div>
    </div>
  );
}
