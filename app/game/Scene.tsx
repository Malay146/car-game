"use client";

import { useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import { Track } from "./Track";
import { Car } from "./Car";
import { RemoteCar } from "./RemoteCar";
import { CameraRig } from "./CameraRig";
import { ItemBoxes } from "./ItemBoxes";
import { Effects } from "./Effects";
import { WeatherRig } from "./WeatherRig";
import { getGridSlot } from "./trackPath";
import { CarTransform } from "./vehicleTypes";
import { useGameStore } from "./store";

const CAR_COLORS = ["#e0322f", "#f2c14e", "#3b82f6", "#22c55e"];
const CAR_MODELS = [
  "/models/cars/race.glb",
  "/models/cars/race-future.glb",
  "/models/cars/hatchback.glb",
  "/models/cars/sedan.glb",
];

export function Scene() {
  const mapId = useGameStore((s) => s.mapId);
  const mode = useGameStore((s) => s.mode);
  const raceId = useGameStore((s) => s.raceId);
  const myId = useGameStore((s) => s.myId);
  const roomPlayers = useGameStore((s) => s.roomPlayers);

  const playerTransform = useRef<CarTransform>({ x: 0, y: 0.6, z: 0, heading: 0, speedKmh: 0, vx: 0, vz: 0 });
  const botTransform = useRef<CarTransform>({ x: 0, y: 0.6, z: 0, heading: 0, speedKmh: 0, vx: 0, vz: 0 });

  const online = mode === "online" && myId !== null;
  const mySlot = online ? Math.max(0, roomPlayers.findIndex((p) => p.id === myId)) : 0;
  const me = getGridSlot(mySlot);
  const bot = getGridSlot(1);

  return (
    <Canvas shadows camera={{ fov: 60, near: 0.1, far: 900 }}>
      <WeatherRig target={playerTransform} />

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

      <EffectComposer>
        <Bloom intensity={0.35} luminanceThreshold={0.7} mipmapBlur />
        <Vignette eskil={false} offset={0.15} darkness={0.6} />
      </EffectComposer>
    </Canvas>
  );
}
