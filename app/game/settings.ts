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
};

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
    const { quality, autoLevel, showFps, masterVolume, musicVolume, sfxVolume } = get();
    save({ quality, autoLevel, showFps, masterVolume, musicVolume, sfxVolume });
  },
  hydrate: () => {
    if (get().hydrated) return;
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) set({ ...defaults, ...JSON.parse(raw), hydrated: true });
      else set({ hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },
}));

/** The quality level actually in effect ("auto" resolves to the monitored level). */
export function useQualityLevel(): QualityLevel {
  return useSettings((s) => (s.quality === "auto" ? s.autoLevel : s.quality));
}
