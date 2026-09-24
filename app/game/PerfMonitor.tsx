"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { InstancedMesh, Mesh, Scene } from "three";
import { resolveMaxFps, useSettings, type QualityLevel } from "./settings";
import { useGameStore } from "./store";
import { MENU_FPS } from "./FrameDriver";
import { LEVELS } from "./quality";

/** Live render stats, written by <PerfMonitor/> inside the Canvas and read by the FPS overlay. */
export const perfStats = { fps: 0, frameMs: 0, calls: 0, triangles: 0 };

/** Visible mesh draws and triangles in the scene graph (post-processing passes make gl.info unreliable). */
function sceneStats(scene: Scene) {
  let calls = 0;
  let triangles = 0;
  scene.traverseVisible((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const g = m.geometry;
    const per = (g.index ? g.index.count : g.getAttribute("position").count) / 3;
    triangles += per * ((o as InstancedMesh).isInstancedMesh ? (o as InstancedMesh).count : 1);
    calls += Array.isArray(m.material) ? m.material.length : 1;
  });
  return { calls, triangles };
}

const WINDOW_S = 1.5; // measurement window
const WARMUP_S = 5; // ignore shader-compile / asset-load hitches after (re)start or a level change
/** Slow / fast thresholds as a fraction of the frame cap in effect (so a 30 fps cap is not mistaken for a slow device). */
const DOWN_RATIO = 0.63; // 38 fps at a 60 cap, 19 fps at 30
const UP_RATIO = 0.93; // 56 fps at a 60 cap, 28 fps at 30
const DISPLAY_FPS = 60; // assumed refresh when uncapped
const DOWN_WINDOWS = 2; // consecutive slow windows before stepping down
const UP_WINDOWS = 8; // consecutive fast windows (12 s) before stepping up
const BASE_BLOCK_S = 90; // after stepping down from a level, don't retry it for this long (doubles each time)

/**
 * Samples frame times. Always publishes perfStats; when quality is "Auto" it also steps `autoLevel`
 * down quickly when the game is slow and up slowly (with hysteresis and back-off) when there is headroom.
 */
export function PerfMonitor() {
  const s = useRef({
    acc: 0,
    frames: 0,
    settle: WARMUP_S,
    bad: 0,
    good: 0,
    blockedUntil: { low: 0, medium: 0, high: 0 } as Record<QualityLevel, number>,
    strikes: { low: 0, medium: 0, high: 0 } as Record<QualityLevel, number>,
    clock: 0,
  });

  useFrame(({ scene }, delta) => {
    const st = s.current;
    if (document.hidden || delta > 2) {
      // Tab switch / long stall: restart the window instead of counting it as slow.
      st.acc = 0;
      st.frames = 0;
      st.settle = Math.max(st.settle, 1.5);
      return;
    }
    st.clock += delta;
    st.acc += delta;
    st.frames++;
    if (st.settle > 0) st.settle -= delta;
    if (st.acc < WINDOW_S) return;

    const fps = st.frames / st.acc;
    perfStats.fps = fps;
    perfStats.frameMs = (st.acc / st.frames) * 1000;
    const settings = useSettings.getState();
    // Walking the scene graph costs CPU: only do it while the FPS overlay is showing.
    if (settings.showFps) {
      const stats = sceneStats(scene);
      perfStats.calls = stats.calls;
      perfStats.triangles = stats.triangles;
    }
    st.acc = 0;
    st.frames = 0;
    if (st.settle > 0) return;

    if (settings.quality !== "auto" || settings.batterySaver) {
      st.bad = st.good = 0;
      return;
    }
    const level = settings.autoLevel;
    const idx = LEVELS.indexOf(level);

    const racing = useGameStore.getState().phase === "playing";
    const cap = racing ? resolveMaxFps(settings) || DISPLAY_FPS : MENU_FPS;
    const ceilingIdx = LEVELS.indexOf(settings.autoCeiling);
    if (idx > ceilingIdx) {
      settings.set({ autoLevel: settings.autoCeiling });
      st.settle = WARMUP_S;
      return;
    }

    if (fps < cap * DOWN_RATIO) {
      st.good = 0;
      if (++st.bad >= DOWN_WINDOWS && idx > 0) {
        st.strikes[level]++;
        st.blockedUntil[level] = st.clock + BASE_BLOCK_S * Math.pow(2, Math.min(st.strikes[level] - 1, 4));
        settings.set({ autoLevel: LEVELS[idx - 1] });
        st.bad = 0;
        st.settle = WARMUP_S;
      }
    } else if (fps >= cap * UP_RATIO) {
      st.bad = 0;
      const next = idx < ceilingIdx ? LEVELS[idx + 1] : undefined;
      if (next && st.clock >= st.blockedUntil[next] && ++st.good >= UP_WINDOWS) {
        settings.set({ autoLevel: next });
        st.good = 0;
        st.settle = WARMUP_S;
      }
    } else {
      st.bad = 0;
      st.good = 0;
    }
  });

  return null;
}
