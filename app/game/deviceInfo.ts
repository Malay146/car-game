"use client";

import { useSyncExternalStore } from "react";
import { useSettings } from "./settings";

let touchSeen = false;
const listeners = new Set<() => void>();
let installed = false;

function notify() {
  listeners.forEach((l) => l());
}

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  // Touch-capable hybrids (touch laptops): show the overlay once a real touch happens.
  window.addEventListener(
    "touchstart",
    () => {
      if (!touchSeen) {
        touchSeen = true;
        notify();
      }
    },
    { passive: true }
  );
  const mq = window.matchMedia("(pointer: coarse)");
  mq.addEventListener?.("change", notify);
}

function subscribe(cb: () => void) {
  install();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const coarseSnapshot = () => touchSeen || (typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches);

/** True on touch-first devices (coarse primary pointer, or a touch was seen). */
export function useIsTouchDevice(): boolean {
  return useSyncExternalStore(subscribe, coarseSnapshot, () => false);
}

/** Should the on-screen touch controls be shown? Honors the user's Auto / On / Off setting. */
export function useShowTouchControls(): boolean {
  const pref = useSettings((s) => s.touchControls);
  const touch = useIsTouchDevice();
  return pref === "on" || (pref === "auto" && touch);
}

const portraitSnapshot = () => typeof window !== "undefined" && window.matchMedia("(orientation: portrait)").matches;
function subscribePortrait(cb: () => void) {
  const mq = window.matchMedia("(orientation: portrait)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function useIsPortrait(): boolean {
  return useSyncExternalStore(subscribePortrait, portraitSnapshot, () => false);
}

// --- Fullscreen -------------------------------------------------------------

type FsDoc = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
};
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };

export function fullscreenSupported(): boolean {
  if (typeof document === "undefined") return false;
  const d = document as FsDoc;
  return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
}

const fsElement = () => {
  const d = document as FsDoc;
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
};

export async function toggleFullscreen(): Promise<void> {
  const d = document as FsDoc;
  try {
    if (fsElement()) {
      await (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
      return;
    }
    const el = document.documentElement as FsEl;
    await (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.());
    // Phones: landscape is the right orientation for racing (not supported everywhere; ignore failures).
    const so = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await so?.lock?.("landscape").catch(() => {});
  } catch {
    /* denied or unsupported */
  }
}

function subscribeFs(cb: () => void) {
  document.addEventListener("fullscreenchange", cb);
  document.addEventListener("webkitfullscreenchange", cb);
  return () => {
    document.removeEventListener("fullscreenchange", cb);
    document.removeEventListener("webkitfullscreenchange", cb);
  };
}

export function useFullscreenState(): { supported: boolean; active: boolean } {
  const supported = useSyncExternalStore(
    () => () => {},
    fullscreenSupported,
    () => false
  );
  const active = useSyncExternalStore(subscribeFs, () => !!fsElement(), () => false);
  return { supported, active };
}
