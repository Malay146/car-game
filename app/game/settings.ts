import { create } from "zustand";

export type QualityPref = "auto" | "low" | "medium" | "high";
export type QualityLevel = "low" | "medium" | "high";

export interface SettingsData {
  /** User's quality choice; "auto" follows `autoLevel`, which the performance monitor adjusts. */
  quality: QualityPref;
  autoLevel: QualityLevel;
  showFps: boolean;
  masterVolume: number; // 0..1
  musicVolume: number; // 0..1
  sfxVolume: number; // 0..1
  /** On-screen touch controls: "auto" shows them on touch devices only. */
  touchControls: "auto" | "on" | "off";
  /** Steer by tilting the device (touch overlay). */
  tilt: boolean;
  /** Size multiplier for the touch controls (0.8..1.3). */
  touchScale: number;
}

interface SettingsStore extends SettingsData {
  hydrated: boolean;
  set: (patch: Partial<SettingsData>) => void;
  /** Load saved settings from localStorage (call once on the client). */
  hydrate: () => void;
}

const KEY = "chaos.settings";

const defaults: SettingsData = {
  quality: "auto",
  autoLevel: "high",
  showFps: false,
  masterVolume: 0.8,
  musicVolume: 0.5,
  sfxVolume: 0.8,
  touchControls: "auto",
  tilt: false,
  touchScale: 1,
};

/** Best starting quality guess for this device (used on the very first visit). */
function detectInitialLevel(): QualityLevel {
  try {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const cores = nav.hardwareConcurrency ?? 8;
    const mem = nav.deviceMemory ?? 8;
    const weak = cores <= 4 || mem <= 4;
    if (coarse) return weak ? "low" : "medium";
    return weak ? "medium" : "high";
  } catch {
    return "high";
  }
}

function save(data: SettingsData) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable (private mode): settings just won't persist */
  }
}

export const useSettings = create<SettingsStore>((set, get) => ({
  ...defaults,
  hydrated: false,
  set: (patch) => {
    set(patch);
    const st = get();
    const data = {} as Record<string, unknown>;
    for (const k of Object.keys(defaults)) data[k] = st[k as keyof SettingsData];
    save(data as unknown as SettingsData);
  },
  hydrate: () => {
    if (get().hydrated) return;
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) set({ ...defaults, ...JSON.parse(raw), hydrated: true });
      else set({ hydrated: true, autoLevel: detectInitialLevel() });
    } catch {
      set({ hydrated: true });
    }
  },
}));

/** The quality level actually in effect ("auto" resolves to the monitored level). */
export function useQualityLevel(): QualityLevel {
  return useSettings((s) => (s.quality === "auto" ? s.autoLevel : s.quality));
}
