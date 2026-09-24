"use client";

import { useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import { Track } from "./Track";
import { Car } from "./Car";
import { RemoteCar } from "./RemoteCar";
import { CameraRig } from "./CameraRig";
import { ItemBoxes } from "./ItemBoxes";
import { HiddenTabKeeper } from "./HiddenTabKeeper";
import { Effects } from "./Effects";
import { SunLight } from "./SunLight";
import { getGridSlot } from "./trackPath";
import { CarTransform } from "./vehicleTypes";
import { useGameStore } from "./store";
import { getMap } from "./maps";
import { useQualityLevel } from "./settings";
import { QUALITY } from "./quality";
import { PerfMonitor } from "./PerfMonitor";
import { SceneProgress } from "./SceneProgress";

const CAR_COLORS = ["#e0322f", "#f2c14e", "#3b82f6", "#22c55e"];
const CAR_MODELS = [
  "/models/cars/race.glb",
  "/models/cars/race-future.glb",
  "/models/cars/hatchback.glb",
  "/models/cars/sedan.glb",
];

export function Scene() {
  const mapId = useGameStore((s) => s.mapId);
  const theme = getMap(mapId).theme;
  const mode = useGameStore((s) => s.mode);
  const raceId = useGameStore((s) => s.raceId);
  const myId = useGameStore((s) => s.myId);
  const roomPlayers = useGameStore((s) => s.roomPlayers);
  const quality = QUALITY[useQualityLevel()];

  const playerTransform = useRef<CarTransform>({ x: 0, y: 0.6, z: 0, heading: 0, speedKmh: 0, vx: 0, vz: 0 });
  const botTransform = useRef<CarTransform>({ x: 0, y: 0.6, z: 0, heading: 0, speedKmh: 0, vx: 0, vz: 0 });

  const online = mode === "online" && myId !== null;
  const mySlot = online ? Math.max(0, roomPlayers.findIndex((p) => p.id === myId)) : 0;
  const me = getGridSlot(mySlot);
  const bot = getGridSlot(1);

  return (
    <>
    <SceneProgress />
    {/* `flat` = no tone mapping, matching the look the post-processing pipeline produces; `dpr` is capped per quality level. */}
    <Canvas flat shadows={quality.shadows} dpr={[1, quality.dpr]} camera={{ fov: 60, near: 0.1, far: 900 }} gl={{ powerPreference: "high-performance" }} style={{ touchAction: "none" }}>
      <PerfMonitor />
      <fog attach="fog" args={[theme.fog.color, theme.fog.near, theme.fog.far]} />
      <ambientLight intensity={theme.sun.ambient} />
      <SunLight target={playerTransform} sun={theme.sun} shadows={quality.shadows} mapSize={quality.shadowMapSize} />
      <Environment key={mapId} files={theme.hdr} background environmentIntensity={theme.envIntensity} />

      <Physics gravity={[0, -9.81, 0]} timeStep={1 / 60}>
        <Track key={`track-${mapId}`} />
        <ItemBoxes key={`items-${mapId}`} target={playerTransform} />
        <Effects />
        <group key={`${mapId}-${raceId}`}>
          <Car
            isPlayer
            model={CAR_MODELS[mySlot % CAR_MODELS.length]}
            color={CAR_COLORS[mySlot % CAR_COLORS.length]}
            startX={me.x}
            startZ={me.z}
            startHeading={me.heading}
            transformRef={playerTransform}
          />
          {online ? (
            roomPlayers.map((p, i) => {
              if (p.id === myId) return null;
              const g = getGridSlot(i);
              return (
                <RemoteCar
                  key={p.id}
                  id={p.id}
                  model={CAR_MODELS[i % CAR_MODELS.length]}
                  color={CAR_COLORS[i % CAR_COLORS.length]}
                  name={p.name}
                  startX={g.x}
                  startZ={g.z}
                  startHeading={g.heading}
                />
              );
            })
          ) : (
            <Car
              isPlayer={false}
              model={CAR_MODELS[1]}
              color={CAR_COLORS[1]}
              startX={bot.x}
              startZ={bot.z}
              startHeading={bot.heading}
              transformRef={botTransform}
            />
          )}
        </group>
      </Physics>

      <CameraRig target={playerTransform} />
      <HiddenTabKeeper />

      {quality.post === "full" && (
        <EffectComposer multisampling={4}>
          <Bloom intensity={0.35} luminanceThreshold={0.7} mipmapBlur />
          <Vignette eskil={false} offset={0.15} darkness={0.6} />
        </EffectComposer>
      )}
      {quality.post === "light" && (
        <EffectComposer multisampling={0}>
          <Vignette eskil={false} offset={0.15} darkness={0.6} />
        </EffectComposer>
      )}
    </Canvas>
    </>
  );
}
