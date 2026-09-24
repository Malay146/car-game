"use client";

import { useEffect, useState, type ComponentType } from "react";
import { HUD } from "./game/HUD";
import { AudioManager } from "./game/AudioManager";
import { useSettings } from "./game/settings";
import { useBindings } from "./game/bindings";

/**
 * The heavy 3D scene (three, rapier, drei, postprocessing) loads in its own chunk after the menu shell is on screen.
 * A plain dynamic import() in an effect, not next/dynamic + Suspense: a Suspense re-reveal replays effects on the R3F
 * <Canvas> in dev and kills its WebGL context.
 */
function LazyScene() {
  const [Scene, setScene] = useState<ComponentType | null>(null);
  useEffect(() => {
    let alive = true;
    import("./game/Scene").then((m) => {
      if (alive) setScene(() => m.Scene);
    });
    return () => {
      alive = false;
    };
  }, []);
  return Scene ? <Scene /> : null;
}

export default function Home() {
  useEffect(() => {
    useSettings.getState().hydrate();
    useBindings.getState().hydrate();
    // iOS Safari ignores user-scalable=no: block the pinch-zoom gesture so the page never zooms mid-race.
    const block = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", block);
    return () => document.removeEventListener("gesturestart", block);
  }, []);

  return (
    <div className="relative h-dvh w-screen overflow-hidden bg-black">
      <LazyScene />
      <HUD />
      <AudioManager />
    </div>
  );
}
