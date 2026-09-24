import * as THREE from "three";
import { useGameStore } from "./store";
import { getMap } from "./maps";

// ---------------------------------------------------------------------------------------------
// Weather + time of day: ids, defaults, gameplay effects and the lighting/fog lookup.
// The chosen values live in the store's synced `options` ("weather" / "tod"); a missing or
// "auto" value means "use the map's default". Everything is resolved through `resolveWeather`
// / `resolveTod` so joiners, the host and offline play all agree.
// ---------------------------------------------------------------------------------------------

export type WeatherId = "clear" | "cloudy" | "fog" | "rain" | "storm" | "snow";
export type TodId = "dawn" | "day" | "dusk" | "night";

export const WEATHER_IDS: WeatherId[] = ["clear", "cloudy", "fog", "rain", "storm", "snow"];
export const TOD_IDS: TodId[] = ["dawn", "day", "dusk", "night"];

export const WEATHER_LABEL: Record<WeatherId, string> = {
  clear: "Clear",
  cloudy: "Cloudy",
  fog: "Fog",
  rain: "Rain",
  storm: "Storm",
  snow: "Snow",
};
export const TOD_LABEL: Record<TodId, string> = { dawn: "Dawn", day: "Day", dusk: "Dusk", night: "Night" };

/** Lateral-grip multiplier applied on top of the map (Car.tsx). Fog only affects visibility. */
export const WEATHER_GRIP: Record<WeatherId, number> = {
  clear: 1,
  cloudy: 1,
  fog: 1,
  rain: 0.85,
  storm: 0.78,
  snow: 0.8,
};

export function resolveWeather(mapId: string, value: string | undefined): WeatherId {
  if (value && (WEATHER_IDS as string[]).includes(value)) return value as WeatherId;
  return getMap(mapId).weather ?? "clear";
}
export function resolveTod(mapId: string, value: string | undefined): TodId {
  if (value && (TOD_IDS as string[]).includes(value)) return value as TodId;
  return getMap(mapId).timeOfDay ?? "day";
}

/** Headlights come on automatically when it is dark. */
export function isDarkConditions(weather: WeatherId, tod: TodId): boolean {
  return tod === "night" || tod === "dusk" || weather === "storm" || (tod === "dawn" && weather !== "clear");
}

// ----- store selectors ------------------------------------------------------------------------

export function useWeatherId(): WeatherId {
  return useGameStore((s) => resolveWeather(s.mapId, s.options.weather));
}
export function useTodId(): TodId {
  return useGameStore((s) => resolveTod(s.mapId, s.options.tod));
}
/** True at dusk/night/storm: cars turn their headlights on. */
export function useIsDark(): boolean {
  return useGameStore((s) => isDarkConditions(resolveWeather(s.mapId, s.options.weather), resolveTod(s.mapId, s.options.tod)));
}
/** Effective grip multiplier (1 = dry). Hook version for the HUD. */
export function useWeatherGrip(): number {
  return useGameStore((s) => WEATHER_GRIP[resolveWeather(s.mapId, s.options.weather)]);
}
/** Non-reactive version for the physics loop. */
export function getWeatherGrip(): number {
  const s = useGameStore.getState();
  return WEATHER_GRIP[resolveWeather(s.mapId, s.options.weather)];
}

// ----- lightning audio hook --------------------------------------------------------------------

/**
 * AUDIO HOOK (owned by the audio engineer): called once for every lightning strike, at the moment
 * of the visual flash. `distance01` is 0 (right overhead) .. 1 (far away); a realistic engine
 * would delay the rumble by ~distance01 * 2.5 s and lower the volume with distance.
 * TODO(audio): call playThunder(distance01) here once it exists.
 */
export function onThunder(distance01: number): void {
  void distance01;
}

// ----- lighting / fog lookup -------------------------------------------------------------------

export interface EnvParams {
  hdr: string;
  envI: number;
  /** scene.backgroundIntensity (darkens the sky in storms) */
  bgI: number;
  /** Fog weather: paint the background the fog colour instead of showing the sky. */
  solidBg: boolean;
  fogColor: THREE.Color;
  fogNear: number;
  fogFar: number;
  sunColor: THREE.Color;
  sunI: number;
  sunPos: [number, number, number];
  amb: number;
  ambColor: THREE.Color;
}

interface TodPreset {
  hdr: string;
  envI: number;
  sunColor: string;
  sunI: number;
  sunPos: [number, number, number];
  amb: number;
  ambColor: string;
  fog: string;
  near: number;
  far: number;
  /** how bright the sky is: scales grey weather fog colours and overcast lighting */
  lum: number;
}

const TOD: Record<TodId, TodPreset> = {
  day: { hdr: "/hdr/sky.hdr", envI: 0.9, sunColor: "#fff3dc", sunI: 2.4, sunPos: [40, 60, 25], amb: 0.35, ambColor: "#ffffff", fog: "#bcd3e6", near: 90, far: 420, lum: 1 },
  dawn: { hdr: "/hdr/dawn.hdr", envI: 0.6, sunColor: "#ffc59a", sunI: 1.5, sunPos: [70, 24, -30], amb: 0.32, ambColor: "#ffe2cf", fog: "#e6c3b8", near: 80, far: 400, lum: 0.62 },
  dusk: { hdr: "/hdr/dusk.hdr", envI: 1.1, sunColor: "#ffb36b", sunI: 3.0, sunPos: [-60, 38, 45], amb: 0.4, ambColor: "#ffd9bc", fog: "#e8b98a", near: 120, far: 520, lum: 0.5 },
  night: { hdr: "/hdr/night.hdr", envI: 0.35, sunColor: "#8fa8ff", sunI: 0.8, sunPos: [-30, 60, 30], amb: 0.18, ambColor: "#a8b8ff", fog: "#0a1024", near: 50, far: 300, lum: 0.08 },
};

interface WeatherMod {
  sun: number;
  env: number;
  amb: number;
  /** sky brightness for the (overcast) background */
  sky: number;
  fogTint: string;
  fogMix: number;
  near: number;
  far: number;
  overcast: boolean;
  solidBg?: boolean;
}

const WEATHER_MOD: Record<WeatherId, WeatherMod> = {
  clear: { sun: 1, env: 1, amb: 1, sky: 1, fogTint: "#ffffff", fogMix: 0, near: 1, far: 1, overcast: false },
  cloudy: { sun: 0.42, env: 0.95, amb: 1.15, sky: 1, fogTint: "#b4bdc6", fogMix: 0.55, near: 0.8, far: 0.85, overcast: true },
  fog: { sun: 0.28, env: 0.85, amb: 1.25, sky: 1, fogTint: "#c9d0d6", fogMix: 0.92, near: 0.03, far: 0.26, overcast: true, solidBg: true },
  rain: { sun: 0.28, env: 0.75, amb: 1.1, sky: 0.8, fogTint: "#818c96", fogMix: 0.75, near: 0.5, far: 0.5, overcast: true },
  storm: { sun: 0.12, env: 0.5, amb: 0.9, sky: 0.42, fogTint: "#4a525d", fogMix: 0.85, near: 0.35, far: 0.4, overcast: true },
  snow: { sun: 0.5, env: 0.95, amb: 1.25, sky: 1, fogTint: "#dbe3ea", fogMix: 0.8, near: 0.35, far: 0.5, overcast: true },
};

// Overcast sky (and its lighting) relative to the day, per time of day.
const OVERCAST_TOD: Record<TodId, number> = { day: 1, dawn: 0.62, dusk: 0.5, night: 1 };

/**
 * The lighting/fog/HDRI for any map at any time of day and weather. The map's own theme is used
 * verbatim when both match the map's default, so the hand-tuned art direction is preserved.
 */
export function computeEnv(mapId: string, weather: WeatherId, tod: TodId): EnvParams {
  const map = getMap(mapId);
  const theme = map.theme;
  const isDefault = weather === (map.weather ?? "clear") && tod === (map.timeOfDay ?? "day");
  if (isDefault) {
    const p = TOD[tod];
    const solid = !!WEATHER_MOD[weather].solidBg;
    return {
      hdr: theme.hdr,
      envI: theme.envIntensity,
      bgI: weather === "clear" ? 1 : WEATHER_MOD[weather].sky,
      solidBg: solid,
      fogColor: new THREE.Color(theme.fog.color),
      fogNear: theme.fog.near,
      fogFar: theme.fog.far,
      sunColor: new THREE.Color(theme.sun.color),
      sunI: theme.sun.intensity,
      sunPos: theme.sun.position,
      amb: theme.sun.ambient,
      ambColor: new THREE.Color(p.ambColor),
    };
  }

  const p = TOD[tod];
  const w = WEATHER_MOD[weather];
  const night = tod === "night";
  const overcastK = night ? 1 : OVERCAST_TOD[tod];
  const lightK = w.overcast && !night ? overcastK : 1;
  const fog = new THREE.Color(p.fog);
  if (w.fogMix > 0) {
    const tint = new THREE.Color(w.fogTint).multiplyScalar(0.1 + 0.9 * p.lum);
    fog.lerp(tint, w.fogMix);
  }
  return {
    hdr: w.overcast && !night ? "/hdr/overcast.hdr" : p.hdr,
    envI: (w.overcast && !night ? 0.9 * overcastK : p.envI) * w.env,
    bgI: w.overcast ? w.sky * (night ? 1 : overcastK) : 1,
    solidBg: !!w.solidBg,
    fogColor: fog,
    fogNear: Math.max(2, p.near * w.near),
    fogFar: p.far * w.far,
    sunColor: new THREE.Color(p.sunColor),
    sunI: p.sunI * w.sun * (w.overcast ? lightK : 1),
    sunPos: p.sunPos,
    amb: p.amb * w.amb,
    ambColor: new THREE.Color(p.ambColor),
  };
}

// ----- particle counts per quality --------------------------------------------------------------

export type Quality = "low" | "medium" | "high";
/** Rain streaks / snow flakes / ground ripples allocated at each quality level (storm rain is x1.6). */
export const PARTICLE_COUNTS: Record<Quality, { rain: number; snow: number; ripples: number }> = {
  low: { rain: 300, snow: 300, ripples: 0 },
  medium: { rain: 1100, snow: 1200, ripples: 24 },
  high: { rain: 2400, snow: 2600, ripples: 48 },
};
