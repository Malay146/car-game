"use client";

import { useEffect, useState } from "react";
import { useSettings, useQualityLevel } from "./settings";
import { perfStats } from "./PerfMonitor";

/** Small stats overlay (fps, frame time, draw calls, triangles) toggled from Settings > Graphics. */
export function FpsCounter() {
  const show = useSettings((s) => s.showFps);
  const level = useQualityLevel();
  const [stats, setStats] = useState({ ...perfStats });

  useEffect(() => {
    if (!show) return;
    const id = window.setInterval(() => setStats({ ...perfStats }), 500);
    return () => window.clearInterval(id);
  }, [show]);

  if (!show) return null;
  const tone = stats.fps >= 55 ? "text-emerald-300" : stats.fps >= 35 ? "text-yellow-300" : "text-red-400";
  return (
    <div
      className="pointer-events-none absolute left-1/2 z-30 -translate-x-1/2 rounded-md bg-black/60 px-2 py-1 text-center font-mono text-[11px] leading-tight"
      style={{ top: "calc(max(0.25rem, env(safe-area-inset-top)) + 2.75rem)" }}
    >
      <span className={`text-sm font-bold ${tone}`}>{Math.round(stats.fps)}</span> fps · {stats.frameMs.toFixed(1)} ms
      <div className="text-zinc-300">
        {level} · {stats.calls} draws · {(stats.triangles / 1000).toFixed(0)}k tris
      </div>
    </div>
  );
}
