"use client";

import type { ReactNode } from "react";
import { useGameStore } from "./store";
import { changeRoomOptions } from "./net";
import {
  TOD_IDS,
  TOD_LABEL,
  TodId,
  WEATHER_GRIP,
  WEATHER_IDS,
  WEATHER_LABEL,
  WeatherId,
  useTodId,
  useWeatherGrip,
  useWeatherId,
} from "./weather";

const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const CLOUD = "M7 13a3.5 3.5 0 0 1-.4-6.98 5 5 0 0 1 9.6 1.2A3 3 0 0 1 16 13z";

const ICONS: Record<WeatherId | TodId, ReactNode> = {
  clear: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
    </>
  ),
  cloudy: <path d="M7 18a4 4 0 0 1-.5-7.97 5.5 5.5 0 0 1 10.6 1.47A3.25 3.25 0 0 1 17 18z" />,
  fog: <path d="M4 8h16M3 12h13M7 16h14M4 20h9" />,
  rain: (
    <>
      <path d={CLOUD} />
      <path d="M8 16l-1 3M12 16l-1 3M16 16l-1 3" />
    </>
  ),
  storm: (
    <>
      <path d={CLOUD} />
      <path d="M12.5 14l-2.5 4h3l-1.5 4" />
    </>
  ),
  snow: (
    <>
      <path d={CLOUD} />
      <path d="M8 17v.01M12 19v.01M16 17v.01M10 21v.01M14 21v.01" strokeWidth={2.6} />
    </>
  ),
  dawn: (
    <>
      <path d="M4 18h16M7 18a5 5 0 0 1 10 0M12 5v4M9.5 7.5L12 5l2.5 2.5" />
    </>
  ),
  day: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
    </>
  ),
  dusk: (
    <>
      <path d="M4 18h16M7 18a5 5 0 0 1 10 0M12 9V5M9.5 6.5L12 9l2.5-2.5" />
    </>
  ),
  night: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
};

export function WeatherIcon({ id, size = 20 }: { id: WeatherId | TodId; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...S}>
      {ICONS[id]}
    </svg>
  );
}

/** Set weather / time of day. Online only the host may call this; it is synced to the whole room. */
function setChoice(key: "weather" | "tod", value: string) {
  const s = useGameStore.getState();
  s.setOption(key, value);
  if (s.mode === "online") changeRoomOptions({ [key]: value });
}

/** Back to the map's own weather / time of day (call when the map changes). */
export function resetWeatherToMapDefault() {
  const s = useGameStore.getState();
  s.setOption("weather", "auto");
  s.setOption("tod", "auto");
  if (s.mode === "online") changeRoomOptions({ weather: "auto", tod: "auto" });
}

function Chip({ id, label, active, disabled, onClick }: { id: WeatherId | TodId; label: string; active: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[10px] font-semibold leading-none transition-colors ${
        active ? "bg-white/25 text-white ring-1 ring-white/70" : "bg-white/5 text-zinc-300"
      } ${disabled ? "cursor-default" : "hover:bg-white/15"} ${disabled && !active ? "opacity-60" : ""}`}
    >
      <WeatherIcon id={id} size={20} />
      {label}
    </button>
  );
}

/** Compact weather + time-of-day picker for the menu / lobby. Pass `readOnly` for lobby guests. */
export function WeatherPicker({ readOnly = false }: { readOnly?: boolean }) {
  const weather = useWeatherId();
  const tod = useTodId();
  return (
    <div className="pointer-events-auto flex w-[26rem] max-w-[92vw] flex-col gap-1.5 rounded-2xl bg-black/50 p-2 backdrop-blur-md">
      <div className="flex gap-1" role="group" aria-label="Weather">
        {WEATHER_IDS.map((id) => (
          <Chip key={id} id={id} label={WEATHER_LABEL[id]} active={weather === id} disabled={readOnly} onClick={() => setChoice("weather", id)} />
        ))}
      </div>
      <div className="flex gap-1" role="group" aria-label="Time of day">
        {TOD_IDS.map((id) => (
          <Chip key={id} id={id} label={TOD_LABEL[id]} active={tod === id} disabled={readOnly} onClick={() => setChoice("tod", id)} />
        ))}
      </div>
    </div>
  );
}

/** HUD pill: current weather and what it does to grip. Hidden in clear weather. */
export function WeatherBadge() {
  const weather = useWeatherId();
  const grip = useWeatherGrip();
  if (weather === "clear") return null;
  const note = grip < 1 ? `Grip ${Math.round(grip * 100)}%` : weather === "fog" ? "Low visibility" : "";
  return (
    <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-300" title={`Grip x${WEATHER_GRIP[weather].toFixed(2)}`}>
      <WeatherIcon id={weather} size={16} />
      <span>{WEATHER_LABEL[weather]}</span>
      {note && <span className={grip < 0.8 ? "text-orange-300" : "text-yellow-200"}>{note}</span>}
    </div>
  );
}
