"use client";

import { useEffect } from "react";
import { useProgress } from "@react-three/drei";
import { useLoadProgress } from "./loadProgress";

/** Bridges drei's loading manager to the lightweight progress store used by the loading UI. */
export function SceneProgress() {
  const { active, progress, total } = useProgress();
  useEffect(() => {
    useLoadProgress.getState().set({ mounted: true, active, progress, total });
  }, [active, progress, total]);
  useEffect(() => () => useLoadProgress.getState().set({ mounted: false }), []);
  return null;
}
