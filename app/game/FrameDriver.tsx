"use client";

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { useSettings } from "./settings";
import { useSettingsUi } from "./settingsUi";
import { useGameStore } from "./store";

const MENU_FPS = 30;

/**
 * Drives a `frameloop="demand"` Canvas at a capped rate instead of the display's refresh rate
 * (120 Hz on ProMotion MacBooks doubles the GPU work for no gameplay gain).
 * Menu/lobby: 30 fps. Racing: the user's limit (60 by default). Covered by the garage: paused.
 */
export function FrameDriver() {
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (useSettingsUi.getState().sceneHidden) return;
      const racing = useGameStore.getState().phase === "playing";
      const pref = useSettings.getState().maxFps;
      const fps = racing ? (pref === "max" ? 0 : Number(pref)) : MENU_FPS;
      if (fps > 0) {
        const interval = 1000 / fps;
        // Small tolerance so a 60 Hz display still hits every frame at a 60 cap.
        if (now - last < interval - 2) return;
        // Keep a steady cadence: carry the remainder instead of drifting.
        last = now - ((now - last) % interval);
      } else {
        last = now;
      }
      invalidate();
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [invalidate]);

  return null;
}
