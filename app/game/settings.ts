import { create } from "zustand";
import { getDeviceTier, type DeviceTier } from "./deviceTier";

export type QualityPref = "auto" | "low" | "medium" | "high";
export type QualityLevel = "low" | "medium" | "high";

export interface SettingsData {
  /** User's quality choice; "auto" follows `autoLevel`, which the performance monitor adjusts. */
  quality: QualityPref;
  autoLevel: QualityLevel;
  showFps: boolean;
  /** Frame-rate cap while racing: "30", "60" or "max" (display refresh). Lower = cooler, quieter laptop. */
  maxFps: "30" | "60" | "max";
  masterVolume: number; // 0..1
  musicVolume: number; // 0..1
  sfxVolume: number; // 0..1
  /** On-screen touch controls: "auto" shows them on touch devices only. */
  touchControls: "auto" | "on" | "off";
  /** Steer by tilting the device (touch overlay). */
  tilt: boolean;
  /** Size multiplier for the touch controls (0.8..1.3). */
  touchScale: number;
  /** Multiplier on the quality level's pixel density (0.5..1). Lower = fewer pixels = cooler, longer battery. */
  renderScale: number;
  /** Battery saver: forces Low quality and a 30 fps cap without touching the chosen values. */
  batterySaver: boolean;
}

interface SettingsStore extends SettingsData {
  hydrated: boolean;
  /** Highest level "Auto" may pick on this device (from the device tier; not persisted). */
  autoCeiling: QualityLevel;
  set: (patch: Partial<SettingsData>) => void;
  /** Load saved settings from localStorage (call once on the client). */
  hydrate: () => void;
}

const KEY = "chaos.settings";

const defaults: SettingsData = {
  quality: "auto",
  autoLevel: "high",
  showFps: false,
  maxFps: "60",
  masterVolume: 0.8,
  musicVolume: 0.5,
  sfxVolume: 0.8,
  touchControls: "auto",
  tilt: false,
  touchScale: 1,
  renderScale: 1,
  batterySaver: false,
};

export const LEVEL_ORDER: QualityLevel[] = ["low", "medium", "high"];

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
  autoCeiling: "high",
  set: (patch) => {
    set(patch);
    const st = get();
    const data = {} as Record<string, unknown>;
    for (const k of Object.keys(defaults)) data[k] = st[k as keyof SettingsData];
    save(data as unknown as SettingsData);
  },
  hydrate: () => {
    if (get().hydrated) return;
    let tier: DeviceTier | null = null;
    try {
      tier = getDeviceTier();
    } catch {
      /* detection failed: keep desktop defaults */
    }
    const ceiling = tier?.ceiling ?? "high";
    const clampLevel = (l: QualityLevel) => (LEVEL_ORDER.indexOf(l) > LEVEL_ORDER.indexOf(ceiling) ? ceiling : l);
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) {
        // Never override saved choices; only keep the Auto level within this device's ceiling.
        const saved = { ...defaults, ...JSON.parse(raw) } as SettingsData;
        set({ ...saved, autoLevel: clampLevel(saved.autoLevel), autoCeiling: ceiling, hydrated: true });
      } else if (tier) {
        // First visit: sensible defaults for this class of device (still "Auto", so it keeps adapting).
        set({
          hydrated: true,
          autoCeiling: ceiling,
          autoLevel: tier.defaultLevel,
          maxFps: tier.defaultFps,
          renderScale: tier.defaultRenderScale,
        });
      } else {
        set({ hydrated: true });
      }
    } catch {
      set({ hydrated: true, autoCeiling: ceiling });
    }
  },
}));

/** Quality level in effect: battery saver forces Low, "auto" resolves to the monitored level. */
export function resolveLevel(s: SettingsData): QualityLevel {
  if (s.batterySaver) return "low";
  return s.quality === "auto" ? s.autoLevel : s.quality;
}

/** Frame cap in effect while racing, in fps (0 = uncapped). Battery saver forces 30. */
export function resolveMaxFps(s: SettingsData): number {
  if (s.batterySaver) return 30;
  return s.maxFps === "max" ? 0 : Number(s.maxFps);
}

/** The quality level actually in effect. */
export function useQualityLevel(): QualityLevel {
  return useSettings(resolveLevel);
}
