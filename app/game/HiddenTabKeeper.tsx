"use client";

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";

const TICK_MS = 16;
/** If a real animation frame ran this recently, the browser is still driving the loop: do not double-step. */
const RAF_ALIVE_MS = 60;

/**
 * Browsers stop requestAnimationFrame in hidden tabs, which freezes our car (and, online, makes
 * it look frozen to everyone else). While the tab is hidden this drives the simulation with R3F's
 * `advance()` from a Web Worker timer: worker timers are not throttled the way main-thread timers
 * are (setInterval in a background tab is clamped to 1 Hz, and to once a minute after a few minutes).
 *
 * `advance()` runs every useFrame callback (Rapier stepping, our car sim, network sends) with real
 * frame deltas, so nothing else needs to know. When the tab is visible again rAF resumes on its
 * own and the worker is shut down. Limits: hidden tabs still cost CPU (a full render per tick), and
 * browsers may freeze a tab outright (mobile OS backgrounding, "Memory Saver"), in which case
 * nothing can run and the seat is held by the server's reconnect grace period instead.
 */
export function HiddenTabKeeper() {
  const advance = useThree((s) => s.advance);

  useEffect(() => {
    let worker: Worker | null = null;
    let workerUrl: string | null = null;
    let fallback: ReturnType<typeof setInterval> | null = null;
    let lastRaf = performance.now();
    let rafId = 0;

    const rafLoop = () => {
      lastRaf = performance.now();
      rafId = requestAnimationFrame(rafLoop);
    };
    rafId = requestAnimationFrame(rafLoop);

    const tick = () => {
      if (!document.hidden) return;
      if (performance.now() - lastRaf < RAF_ALIVE_MS) return;
      advance(performance.now() / 1000);
    };

    const start = () => {
      if (worker || fallback) return;
      try {
        const blob = new Blob([`setInterval(function(){postMessage(0)},${TICK_MS})`], { type: "text/javascript" });
        workerUrl = URL.createObjectURL(blob);
        worker = new Worker(workerUrl);
        worker.onmessage = tick;
      } catch {
        // No worker support (or blocked by CSP): a main-thread timer is throttled but better than nothing.
        fallback = setInterval(tick, 250);
      }
    };
    const stop = () => {
      worker?.terminate();
      worker = null;
      if (workerUrl) URL.revokeObjectURL(workerUrl);
      workerUrl = null;
      if (fallback) clearInterval(fallback);
      fallback = null;
    };
    const onVisibility = () => (document.hidden ? start() : stop());

    document.addEventListener("visibilitychange", onVisibility);
    if (document.hidden) start();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      cancelAnimationFrame(rafId);
      stop();
    };
  }, [advance]);

  return null;
}
