"use client";

import { useEffect } from "react";
import { MAPS, getMap } from "./maps";
import { generateCenterline, getTrackLength } from "./trackPath";
import { useSettingsUi } from "./settingsUi";

const PAD = 20;

function Preview({ id }: { id: string }) {
  const map = getMap(id);
  const path = generateCenterline(id); // cached per map, cheap to call
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of path) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const view = {
    x: minX - PAD,
    y: minZ - PAD,
    w: maxX - minX + PAD * 2,
    h: maxZ - minZ + PAD * 2,
    points: [...path, path[0]].map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)}`).join(" "),
  };
  const t = map.theme;

  return (
    <div
      className="relative h-40 w-full overflow-hidden rounded-xl row:h-32 short:h-24"
      style={{ background: `linear-gradient(180deg, ${t.previewSky[0]}, ${t.previewSky[1]})` }}
    >
      <div className="absolute inset-x-0 bottom-0 top-1/3" style={{ background: t.previewGround, opacity: 0.9 }} />
      <svg className="absolute inset-0 h-full w-full" viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} preserveAspectRatio="xMidYMid meet">
        <polyline points={view.points} fill="none" stroke="#ffffff" strokeWidth={18} strokeLinejoin="round" opacity={0.9} />
        <polyline points={view.points} fill="none" stroke="#252525" strokeWidth={12} strokeLinejoin="round" />
        {map.ramps.map((r, i) => (
          <circle key={i} cx={r.at[0]} cy={r.at[1]} r={8} fill="#ffd23f" stroke="#111" strokeWidth={2.5} />
        ))}
        <rect x={path[0].x - 2.5} y={path[0].z - 9} width={5} height={18} fill="#fff" />
      </svg>
    </div>
  );
}

/** Map picker: arrows / dots / ←→ keys. Pass `readOnly` to show the map without letting the viewer change it. */
export function MapCarousel({
  value,
  onChange,
  readOnly = false,
}: {
  value: string;
  onChange: (id: string) => void;
  readOnly?: boolean;
}) {
  const index = Math.max(0, MAPS.findIndex((m) => m.id === value));
  const map = MAPS[index];

  const go = (delta: number) => onChange(MAPS[(index + delta + MAPS.length) % MAPS.length].id);

  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || useSettingsUi.getState().open) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, readOnly]);

  const km = (getTrackLength(map.id) / 1000).toFixed(2);
  const peak = Math.round(Math.max(...generateCenterline(map.id).map((p) => p.y)));

  return (
    <div className="pointer-events-auto flex w-[26rem] max-w-full items-center gap-2 sm:gap-3 short:w-[24rem]">
      {!readOnly && (
        <button
          aria-label="Previous map"
          onClick={() => go(-1)}
          className="h-12 w-12 shrink-0 rounded-full bg-white/10 text-2xl font-black hover:bg-white/25 active:bg-white/30"
        >
          ‹
        </button>
      )}
      <div className="min-w-0 flex-1 rounded-2xl bg-black/50 p-3 backdrop-blur-md">
        <Preview id={map.id} />
        <div className="mt-2 text-center short:mt-1">
          <div className="text-xl font-black tracking-tight short:text-base">{map.name}</div>
          <div className="text-xs text-zinc-300">{map.tagline}</div>
          <div className="mt-2 flex justify-center gap-2 text-[11px] font-semibold">
            <span className="rounded-full bg-white/10 px-2 py-0.5">{km} km lap</span>
            <span className="rounded-full bg-yellow-400/20 px-2 py-0.5 text-yellow-300">{map.ramps.length} ramps</span>
            <span className="rounded-full bg-cyan-400/20 px-2 py-0.5 text-cyan-300">{peak} m peak</span>
          </div>
          <div className="mt-2 flex justify-center gap-1.5">
            {MAPS.map((m) => (
              <span key={m.id} className={`h-1.5 w-1.5 rounded-full ${m.id === map.id ? "bg-white" : "bg-white/30"}`} />
            ))}
          </div>
        </div>
      </div>
      {!readOnly && (
        <button
          aria-label="Next map"
          onClick={() => go(1)}
          className="h-12 w-12 shrink-0 rounded-full bg-white/10 text-2xl font-black hover:bg-white/25 active:bg-white/30"
        >
          ›
        </button>
      )}
    </div>
  );
}
