/**
 * Car roster: every selectable car, its model and its handling multipliers.
 *
 * All models follow one convention (see public/models/CREDITS.md): forward is +Z, left is +X, the four wheels
 * are separate nodes named "wheel-front-left" / "wheel-front-right" / "wheel-back-left" / "wheel-back-right",
 * and the tintable body paint is a material named "paint".
 */

/** Handling multipliers applied on top of the core physics model (1 = baseline). */
export interface CarStats {
  accel: number;
  topSpeed: number;
  grip: number;
  handling: number;
}

export interface CarDef {
  id: string;
  name: string;
  url: string;
  cls: string;
  blurb: string;
  stats: CarStats;
  defaultPaint: string;
}

export const DEFAULT_CAR_ID = "race";
export const NEUTRAL_STATS: CarStats = { accel: 1, topSpeed: 1, grip: 1, handling: 1 };

export const CARS: CarDef[] = [
  {
    id: "race",
    name: "Comet",
    url: "/models/cars/race.glb",
    cls: "Formula",
    blurb: "Balanced open-wheeler: quick everywhere, nothing to prove.",
    stats: { accel: 1.05, topSpeed: 1.05, grip: 1.0, handling: 1.02 },
    defaultPaint: "#e0322f",
  },
  {
    id: "race-future",
    name: "Volt",
    url: "/models/cars/race-future.glb",
    cls: "Prototype",
    blurb: "Futuristic and very fast in a straight line, but a little loose.",
    stats: { accel: 1.08, topSpeed: 1.09, grip: 0.95, handling: 1.0 },
    defaultPaint: "#3b82f6",
  },
  {
    id: "sedan-sports",
    name: "Striker",
    url: "/models/cars/sedan-sports.glb",
    cls: "Sport sedan",
    blurb: "Sporty saloon with a big wing. Stable and forgiving.",
    stats: { accel: 1.02, topSpeed: 1.03, grip: 1.03, handling: 1.02 },
    defaultPaint: "#f2c14e",
  },
  {
    id: "hatchback-sports",
    name: "Pocket Rocket",
    url: "/models/cars/hatchback-sports.glb",
    cls: "Hot hatch",
    blurb: "Punchy off the line and grips like glue, runs out of legs up top.",
    stats: { accel: 1.07, topSpeed: 0.97, grip: 1.07, handling: 1.06 },
    defaultPaint: "#22c55e",
  },
  {
    id: "suv-luxury",
    name: "Nomad",
    url: "/models/cars/suv-luxury.glb",
    cls: "Luxury SUV",
    blurb: "Heavy and planted. Slow to launch, hard to unsettle.",
    stats: { accel: 0.94, topSpeed: 0.96, grip: 1.08, handling: 0.92 },
    defaultPaint: "#a855f7",
  },
  {
    id: "taxi",
    name: "Cabbie",
    url: "/models/cars/taxi.glb",
    cls: "Taxi",
    blurb: "Knows every shortcut. Steady all-rounder.",
    stats: { accel: 0.98, topSpeed: 0.98, grip: 1.0, handling: 0.98 },
    defaultPaint: "#f59e0b",
  },
  {
    id: "police",
    name: "Interceptor",
    url: "/models/cars/police.glb",
    cls: "Patrol",
    blurb: "Pursuit-tuned: strong acceleration and a high top speed.",
    stats: { accel: 1.04, topSpeed: 1.04, grip: 1.0, handling: 1.0 },
    defaultPaint: "#f4f4f5",
  },
  {
    id: "van",
    name: "Bruiser Van",
    url: "/models/cars/van.glb",
    cls: "Van",
    blurb: "A brick on wheels. Slowest of the bunch but very sure-footed.",
    stats: { accel: 0.9, topSpeed: 0.93, grip: 1.05, handling: 0.9 },
    defaultPaint: "#60a5fa",
  },
  {
    id: "kart-oodi",
    name: "Go-Kart",
    url: "/models/cars/kart-oodi.glb",
    cls: "Kart",
    blurb: "Tiny, twitchy and grippy. Wins the corners, loses the straights.",
    stats: { accel: 1.1, topSpeed: 0.92, grip: 1.1, handling: 1.1 },
    defaultPaint: "#ec4899",
  },
  {
    id: "muscle",
    name: "Thunder",
    url: "/models/cars/muscle.glb",
    cls: "Muscle car",
    blurb: "Big engine, big slides. Monstrous power, tricky to steer.",
    stats: { accel: 1.09, topSpeed: 1.07, grip: 0.92, handling: 0.94 },
    defaultPaint: "#facc15",
  },
  {
    id: "roadster",
    name: "Breeze",
    url: "/models/cars/roadster.glb",
    cls: "Roadster",
    blurb: "Light open-top cruiser with sweet, precise steering.",
    stats: { accel: 1.02, topSpeed: 1.01, grip: 1.0, handling: 1.07 },
    defaultPaint: "#2563eb",
  },
  {
    id: "sports",
    name: "Vanta",
    url: "/models/cars/sports.glb",
    cls: "Supercar",
    blurb: "Low, wide and hungry. Highest top speed of the sports cars.",
    stats: { accel: 1.06, topSpeed: 1.08, grip: 0.98, handling: 1.0 },
    defaultPaint: "#dc2626",
  },
  {
    id: "pickup",
    name: "Rancher",
    url: "/models/cars/pickup.glb",
    cls: "Pickup",
    blurb: "Rugged and stable, happy on any surface.",
    stats: { accel: 0.95, topSpeed: 0.95, grip: 1.04, handling: 0.94 },
    defaultPaint: "#16a34a",
  },
];

const BY_ID = new Map(CARS.map((c) => [c.id, c]));

/** Look up a car; unknown, empty or legacy ids fall back to the default car. */
export function getCar(id: string | null | undefined): CarDef {
  return (id ? BY_ID.get(id) : undefined) ?? BY_ID.get(DEFAULT_CAR_ID)!;
}

export function isKnownCar(id: unknown): id is string {
  return typeof id === "string" && BY_ID.has(id);
}

export const PAINTS = [
  "#e0322f",
  "#f97316",
  "#f2c14e",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
  "#f4f4f5",
  "#71717a",
  "#18181b",
];

export const isHexColor = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);

/** Deterministic small hash so bots get varied but stable (per race) cars and colours without Math.random in render. */
function hash(n: number): number {
  let x = (n + 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

/** A bot/opponent look that differs from `avoidCarId` / `avoidPaint`. */
export function pickOpponentLook(seed: number, avoidCarId: string, avoidPaint: string): { carId: string; paint: string } {
  const pool = CARS.filter((c) => c.id !== avoidCarId);
  const car = pool[hash(seed) % pool.length];
  const colours = PAINTS.filter((p) => p.toLowerCase() !== avoidPaint.toLowerCase());
  const paint = colours[hash(seed * 31 + 7) % colours.length];
  return { carId: car.id, paint };
}
