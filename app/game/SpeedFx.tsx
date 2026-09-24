"use client";

import { useEffect, useRef } from "react";
import { useGameStore } from "./store";
import { useQualityLevel } from "./settings";

/**
 * Speed lines: radial streaks around the screen edge that fade in above ~110 km/h and intensify while boosting.
 * A single CSS layer driven directly from the store (no React re-renders); disabled on Low quality.
 */
export function SpeedFx() {
  const quality = useQualityLevel();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (quality === "low") return;
    const el = ref.current;
    if (!el) return;
    let last = -1;
    const apply = () => {
      const { phase, raceState, player } = useGameStore.getState();
      const racing = phase === "playing" && raceState === "racing";
      const v = racing ? Math.min(1, Math.max(0, (player.speedKmh - 110) / 90)) : 0;
      const o = Math.min(0.85, v * 0.5 + (racing && player.boosting ? 0.4 : 0));
      if (o > 0) el.style.transform = `scale(1.5) rotate(${((performance.now() * 0.012) % 13).toFixed(2)}deg)`;
      if (Math.abs(o - last) > 0.02) {
        last = o;
        el.style.opacity = String(o);
      }
    };
    apply();
    return useGameStore.subscribe(apply);
  }, [quality]);

  if (quality === "low") return null;
  return (
    <div
      ref={ref}
      className="speedfx pointer-events-none absolute inset-0"
      style={{
        opacity: 0,
        background:
          "repeating-conic-gradient(from 0deg at 50% 50%, rgba(255,255,255,0) 0deg 2.2deg, rgba(255,255,255,0.55) 2.5deg 2.8deg, rgba(255,255,255,0) 3.1deg 5.6deg, rgba(255,255,255,0) 5.6deg 9.3deg, rgba(255,255,255,0.4) 9.5deg 9.7deg, rgba(255,255,255,0) 10deg 13deg)",
        WebkitMaskImage: "radial-gradient(ellipse at center, transparent 42%, black 88%)",
        maskImage: "radial-gradient(ellipse at center, transparent 42%, black 88%)",
        transition: "opacity 0.15s linear",
      }}
    />
  );
}
