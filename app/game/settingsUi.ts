import { create } from "zustand";

export type SettingsTab = "controls" | "graphics" | "touch" | "audio";

interface SettingsUi {
  open: boolean;
  tab: SettingsTab;
  show: (tab?: SettingsTab) => void;
  hide: () => void;
  toggle: () => void;
  /** True while a key is being rebound, so Escape cancels the rebind instead of closing the panel. */
  rebinding: boolean;
  setRebinding: (v: boolean) => void;
  /** A full-screen overlay (garage) hides the 3D view: the scene stops rendering. */
  sceneHidden: boolean;
  setSceneHidden: (v: boolean) => void;
}

export const useSettingsUi = create<SettingsUi>((set) => ({
  open: false,
  tab: "controls",
  show: (tab) => set((s) => ({ open: true, tab: tab ?? s.tab })),
  hide: () => set({ open: false, rebinding: false }),
  toggle: () => set((s) => ({ open: !s.open, rebinding: false })),
  rebinding: false,
  setRebinding: (rebinding) => set({ rebinding }),
  sceneHidden: false,
  setSceneHidden: (sceneHidden) => set({ sceneHidden }),
}));
