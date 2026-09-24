"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { generateCenterline } from "./trackPath";
import { markers } from "./markers";
import { useGameStore } from "./store";
import { getMap } from "./maps";

const MAX_MARKERS = 6;
const PAD = 22;

/** North-up track map with a dot per car, plus live race position. */
export function Minimap() {
  const mapId = useGameStore((s) => s.mapId);
  const path = useMemo(() => generateCenterline(mapId), [mapId]);
  const map = getMap(mapId);
  const view = useMemo(() => {
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
    const w = maxX - minX + PAD * 2;
    const h = maxZ - minZ + PAD * 2;
    const points = path.map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)}`).join(" ");
    return { x: minX - PAD, y: minZ - PAD, w, h, points };
  }, [path]);

  const dots = useRef<(SVGGElement | null)[]>([]);
  const [position, setPosition] = useState<{ place: number; of: number } | null>(null);

  useEffect(() => {
    let raf = 0;
    let lastPlace = "";
    const tick = () => {
      const entries = [...markers.entries()];
      const me = markers.get("me");
      for (let i = 0; i < MAX_MARKERS; i++) {
        const g = dots.current[i];
        if (!g) continue;
        const e = entries[i];
        if (!e) {
          g.setAttribute("visibility", "hidden");
          continue;
        }
        const [id, m] = e;
        g.setAttribute("visibility", "visible");
        const scale = id === "me" ? 1.25 : 1;
        // heading 0 = +Z (down on the map), pi/2 = +X (right): rotate the arrow accordingly.
        g.setAttribute(
          "transform",
          `translate(${m.x.toFixed(1)} ${m.z.toFixed(1)}) rotate(${((180 - (m.heading * 180) / Math.PI) % 360).toFixed(0)}) scale(${scale})`
        );
        const arrow = g.firstElementChild as SVGPolygonElement | null;
        if (arrow) {
          arrow.setAttribute("fill", m.color);
          arrow.setAttribute("stroke", id === "me" ? "#ffffff" : "#111111");
        }
      }
      if (me) {
        let place = 1;
        for (const [id, m] of markers) if (id !== "me" && m.total > me.total) place++;
        const key = `${place}/${markers.size}`;
        if (key !== lastPlace) {
          lastPlace = key;
          setPosition({ place, of: markers.size });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const start = path[0];

  return (
    <div className="pointer-events-none absolute bottom-6 left-6 rounded-xl bg-black/60 p-2 backdrop-blur-sm">
      <svg
        width={210}
        height={Math.round((210 * view.h) / view.w)}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      >
        <polyline points={view.points + ` ${path[0].x},${path[0].z}`} fill="none" stroke="#f4f4f4" strokeWidth={17} strokeLinejoin="round" opacity={0.85} />
        <polyline points={view.points + ` ${path[0].x},${path[0].z}`} fill="none" stroke="#2b2b2b" strokeWidth={11} strokeLinejoin="round" />
        <rect x={start.x - 2} y={start.z - 9} width={4} height={18} fill="#fff" />
        {map.ramps.map((r, i) => (
          <circle key={`r${i}`} cx={r.at[0]} cy={r.at[1]} r={7} fill="#ffd23f" stroke="#111" strokeWidth={2} />
        ))}
        {Array.from({ length: MAX_MARKERS }, (_, i) => (
          <g
            key={i}
            ref={(el) => {
              dots.current[i] = el;
            }}
            visibility="hidden"
          >
            <polygon points="0,-11 8,9 0,5 -8,9" strokeWidth={3} strokeLinejoin="round" />
          </g>
        ))}
      </svg>
      {position && position.of > 1 && (
        <div className="absolute -top-10 left-0 rounded-lg bg-black/60 px-3 py-1 font-black leading-none backdrop-blur-sm">
          <span className="text-2xl">{position.place}</span>
          <span className="text-sm text-zinc-300">/{position.of}</span>
        </div>
      )}
    </div>
  );
}
