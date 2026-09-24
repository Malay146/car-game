"use client";

import { useEffect } from "react";
import { useGameStore, type PlayerProfile } from "./store";
import { getCar, isHexColor, isKnownCar } from "./cars";

const KEY = "chaos.profile";

/** Read the saved profile (name, car, paint), validating every field; unknown values are dropped. */
function load(): Partial<PlayerProfile> {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const d = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<PlayerProfile> = {};
    if (typeof d.name === "string" && d.name.trim()) out.name = d.name.trim().slice(0, 16);
    if (isKnownCar(d.carId)) out.carId = d.carId;
    if (isHexColor(d.paint)) out.paint = d.paint;
    return out;
  } catch {
    return {};
  }
}

function save(p: PlayerProfile) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ name: p.name, carId: p.carId, paint: p.paint }));
  } catch {
    /* storage unavailable (private mode): the profile just won't persist */
  }
}

/** Hydrates the local player profile from localStorage once on the client, then saves every change. Renders nothing. */
export function ProfileSync() {
  useEffect(() => {
    const saved = load();
    const store = useGameStore.getState();
    if (Object.keys(saved).length) store.setProfile(saved);
    // A fresh profile (no saved paint) takes its car's stock colour instead of the generic default.
    else store.setProfile({ paint: getCar(store.profile.carId).defaultPaint });
    let last = useGameStore.getState().profile;
    return useGameStore.subscribe((s) => {
      if (s.profile === last) return;
      last = s.profile;
      save(s.profile);
    });
  }, []);
  return null;
}
