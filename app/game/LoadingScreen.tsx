"use client";

import { useEffect, useState } from "react";
import { isSceneReady, useLoadProgress } from "./loadProgress";
import { useGameStore } from "./store";

/** Debounced "is the scene still loading" flag (asset batches arrive in waves, so avoid flicker). */
export function useSceneLoading(): { loading: boolean; percent: number; engine: boolean } {
  const mounted = useLoadProgress((s) => s.mounted);
  const active = useLoadProgress((s) => s.active);
  const total = useLoadProgress((s) => s.total);
  const progress = useLoadProgress((s) => s.progress);
  const busy = !isSceneReady({ mounted, active, total });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (busy) {
      const on = setTimeout(() => setLoading(true), 0);
      // Never lock the UI forever (e.g. no WebGL, or a stalled download): give up after a minute.
      const giveUp = setTimeout(() => setLoading(false), 60000);
      return () => {
        clearTimeout(on);
        clearTimeout(giveUp);
      };
    }
    const t = setTimeout(() => setLoading(false), 350);
    return () => clearTimeout(t);
  }, [busy]);

  return { loading, percent: Math.round(progress), engine: !mounted };
}

/**
 * Loading UI: a full-screen cover while racing (never a blank canvas),
 * and a slim non-blocking bar on the menu so the shell is usable immediately.
 */
export function LoadingScreen() {
  const phase = useGameStore((s) => s.phase);
  const raceId = useGameStore((s) => s.raceId);
  const { loading, percent, engine } = useSceneLoading();
  // Remember which race has already seen a fully loaded scene: later top-ups (e.g. quality stepping up) only show the slim bar.
  const [readyRace, setReadyRace] = useState(-1);
  useEffect(() => {
    if (loading) return;
    const t = setTimeout(() => setReadyRace(raceId), 0);
    return () => clearTimeout(t);
  }, [loading, raceId]);
  if (!loading) return null;
  const label = engine ? "Starting engine…" : `Loading track… ${percent}%`;

  if (phase === "playing" && readyRace !== raceId) {
    return (
      <div className="pointer-events-auto absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-zinc-950 px-6">
        <h2 className="text-3xl font-black tracking-tight">CHAOS CIRCUIT</h2>
        <div className="h-2 w-64 max-w-full overflow-hidden rounded-full bg-white/15">
          <div className="h-full rounded-full bg-red-600 transition-[width] duration-300" style={{ width: `${engine ? 8 : Math.max(percent, 4)}%` }} />
        </div>
        <p className="text-sm text-zinc-400">{label}</p>
      </div>
    );
  }
  return (
    <div
      className="pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs font-semibold text-zinc-200"
      style={{ top: "max(0.5rem, env(safe-area-inset-top))" }}
    >
      <span>{label}</span>
      <div className="mt-1 h-1 w-32 overflow-hidden rounded-full bg-white/15">
        <div className="h-full rounded-full bg-red-500 transition-[width] duration-300" style={{ width: `${engine ? 6 : Math.max(percent, 4)}%` }} />
      </div>
    </div>
  );
}
