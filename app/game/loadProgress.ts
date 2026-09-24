"use client";

import { create } from "zustand";

/**
 * Asset loading progress, written by <SceneProgress/> inside the lazily loaded 3D chunk
 * and read by the loading UI in the main bundle (so drei/three never land in the first bundle).
 */
interface LoadProgress {
  /** The 3D scene chunk has been downloaded and mounted. */
  mounted: boolean;
  /** Something is currently loading (models, textures, environment). */
  active: boolean;
  /** 0..100 */
  progress: number;
  /** Total items the loader has seen; 0 = nothing requested yet. */
  total: number;
  set: (p: Partial<Omit<LoadProgress, "set">>) => void;
}

export const useLoadProgress = create<LoadProgress>((set) => ({
  mounted: false,
  active: true,
  progress: 0,
  total: 0,
  set: (p) => set(p),
}));

/** True once the scene is mounted and every requested asset has finished loading. */
export const isSceneReady = (s: Pick<LoadProgress, "mounted" | "active" | "total">) => s.mounted && !s.active && s.total > 0;
