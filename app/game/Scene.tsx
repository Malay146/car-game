"use client";

import { useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { FrameDriver } from "./FrameDriver";
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
import { getCar, isHexColor, pickOpponentLook } from "./cars";
import { useQualityLevel } from "./settings";
import { QUALITY } from "./quality";
import { PerfMonitor } from "./PerfMonitor";
import { SceneProgress } from "./SceneProgress";

const paintOf = (car: ReturnType<typeof getCar>, paint: unknown) => (isHexColor(paint) ? paint : car.defaultPaint);

export function Scene() {
  const mapId = useGameStore((s) => s.mapId);
  const mode = useGameStore((s) => s.mode);
  const raceId = useGameStore((s) => s.raceId);
  const myId = useGameStore((s) => s.myId);
  const roomPlayers = useGameStore((s) => s.roomPlayers);
  const profile = useGameStore((s) => s.profile);
  const quality = QUALITY[useQualityLevel()];

  const playerTransform = useRef<CarTransform>({ x: 0, y: 0.6, z: 0, heading: 0, speedKmh: 0, vx: 0, vz: 0 });
  const botTransform = useRef<CarTransform>({ x: 0, y: 0.6, z: 0, heading: 0, speedKmh: 0, vx: 0, vz: 0 });

  const online = mode === "online" && myId !== null;
  const mySlot = online ? Math.max(0, roomPlayers.findIndex((p) => p.id === myId)) : 0;
  const me = getGridSlot(mySlot);
  const bot = getGridSlot(1);
  const myCar = getCar(profile.carId);
  const myPaint = paintOf(myCar, profile.paint);
  const botLook = pickOpponentLook(raceId, myCar.id, myPaint);
  const botCar = getCar(botLook.carId);

  return (
    <>
    <SceneProgress />
    {/* `flat` = no tone mapping, matching the look the post-processing pipeline produces; `dpr` is capped per quality level. */}
    <Canvas
      flat
      frameloop="demand"
      shadows={quality.shadows}
      dpr={[1, quality.dpr]}
      camera={{ fov: 60, near: 0.1, far: 900 }}
      // "default" lets dual-GPU laptops stay on the integrated GPU instead of waking the discrete one.
      gl={{ powerPreference: "default" }}
      style={{ touchAction: "none" }}
    >
      <FrameDriver />
      <PerfMonitor />
      <WeatherRig target={playerTransform} />

      <Physics gravity={[0, -9.81, 0]} timeStep={1 / 60}>
        <Track key={`track-${mapId}`} />
        <ItemBoxes key={`items-${mapId}`} target={playerTransform} />
        <Effects />
        <group key={`${mapId}-${raceId}`}>
          <Car
            isPlayer
            model={myCar.url}
            color={myPaint}
            stats={myCar.stats}
            startX={me.x}
            startZ={me.z}
            startHeading={me.heading}
            transformRef={playerTransform}
          />
          {online ? (
            roomPlayers.map((p, i) => {
              if (p.id === myId) return null;
              const g = getGridSlot(i);
              const rc = getCar(p.carId);
              return (
                <RemoteCar
                  key={p.id}
                  id={p.id}
                  model={rc.url}
                  color={paintOf(rc, p.paint)}
                  startX={g.x}
                  startZ={g.z}
                  startHeading={g.heading}
                />
              );
            })
          ) : (
            <Car
              isPlayer={false}
              model={botCar.url}
              color={botLook.paint}
              stats={botCar.stats}
              startX={bot.x}
              startZ={bot.z}
              startHeading={bot.heading}
              transformRef={botTransform}
            />
          )}
        </group>
      </Physics>

      <CameraRig target={playerTransform} />

      {/* Only High pays for a post-processing pass (bloom); the vignette is a free CSS overlay below. */}
      {quality.post === "full" && (
        <EffectComposer multisampling={2}>
          <Bloom intensity={0.35} luminanceThreshold={0.7} mipmapBlur />
        </EffectComposer>
      )}
    </Canvas>
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{ background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.45) 100%)" }}
    />
    </>
  );
}
