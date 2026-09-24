"use client";

import { useEffect, useState } from "react";
import { toggleFullscreen, useFullscreenState, useIsPortrait, useIsTouchDevice } from "./deviceInfo";
import { keyLabel, useBindings, type Action } from "./bindings";

/** Fullscreen toggle; hidden where the Fullscreen API is unavailable (e.g. iPhone Safari). */
export function FullscreenButton({ className = "" }: { className?: string }) {
  const { supported, active } = useFullscreenState();
  if (!supported) return null;
  return (
    <button
      aria-label={active ? "Exit fullscreen" : "Enter fullscreen"}
      onClick={() => void toggleFullscreen()}
      className={`pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-black/45 backdrop-blur-sm hover:bg-black/65 ${className}`}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {active ? (
          <path d="M9 4v4a1 1 0 0 1-1 1H4M15 4v4a1 1 0 0 0 1 1h4M9 20v-4a1 1 0 0 0-1-1H4M15 20v-4a1 1 0 0 1 1-1h4" />
        ) : (
          <path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" />
        )}
      </svg>
    </button>
  );
}

/** Friendly nudge shown on touch devices held upright during a race. */
export function RotateHint() {
  const portrait = useIsPortrait();
  const touch = useIsTouchDevice();
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDismissed(true), 8000);
    return () => clearTimeout(t);
  }, []);
  // Only phones need the nudge; tablets are fine either way.
  if (!portrait || !touch || dismissed || (typeof window !== "undefined" && window.innerWidth >= 700)) return null;
  return (
    <div
      className="pointer-events-auto absolute left-1/2 z-20 flex w-[min(92vw,22rem)] -translate-x-1/2 items-center gap-3 rounded-2xl bg-black/80 px-4 py-3 text-sm shadow-xl backdrop-blur-md"
      style={{ top: "38%" }}
      role="status"
    >
      <svg viewBox="0 0 24 24" width="34" height="34" className="shrink-0 animate-pulse text-yellow-300" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="7" y="3" width="10" height="18" rx="2" />
        <path d="M20 8c1.6 1.2 2 3 2 4M4 16c-1.6-1.2-2-3-2-4" />
      </svg>
      <span className="flex-1">
        <b>Rotate your phone</b> for the best racing experience.
      </span>
      <button onClick={() => setDismissed(true)} aria-label="Dismiss" className="h-10 w-10 shrink-0 rounded-full text-xl hover:bg-white/15">
        ×
      </button>
    </div>
  );
}

const keys = (b: Record<Action, string[]>, a: Action) => b[a].filter(Boolean).map(keyLabel).join(" / ") || "-";

const driveKeys = (b: Record<Action, string[]>, slot: number) =>
  (["forward", "left", "back", "right"] as Action[])
    .map((a) => b[a][slot])
    .filter(Boolean)
    .map(keyLabel)
    .join(" ");

/** Keyboard cheat-sheet built from the current bindings. Not shown on touch devices. */
export function ControlsHint({ compact = false }: { compact?: boolean }) {
  const b = useBindings((s) => s.bindings);
  const touch = useIsTouchDevice();
  if (touch) return <p className="max-w-md text-center text-sm text-zinc-300">Use the on-screen wheel and pedals. Tilt steering is in Settings.</p>;
  if (compact) {
    return (
      <div className="pointer-events-none text-[11px] text-white/70">
        {keys(b, "flip")}: flip car upright · {keys(b, "reset")}: back to checkpoint · {keys(b, "item")}: boost
      </div>
    );
  }
  return (
    <p className="max-w-md text-center text-sm text-zinc-300">
      {driveKeys(b, 0)}
      {driveKeys(b, 1) ? ` or ${driveKeys(b, 1)}` : ""} to drive, {keys(b, "brake")} to brake, {keys(b, "handbrake")} to handbrake-drift, {keys(b, "item")} to boost, {keys(b, "flip")} to flip the car upright, {keys(b, "reset")} to return to your last checkpoint.
    </p>
  );
}
