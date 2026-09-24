export interface RampDef {
  /** World position (x, z) of the ramp's low lip; snapped to the nearest centerline sample. */
  at: [number, number];
  len?: number;
  height?: number;
}

export interface SceneryGroup {
  url: string;
  count: number;
  scale: [number, number];
}

export interface MapTheme {
  hdr: string;
  envIntensity: number;
  fog: { color: string; near: number; far: number };
  ground: { key: string; tint: string; repeat: number };
  roadTint: string;
  sun: { color: string; intensity: number; position: [number, number, number]; ambient: number };
  kerb: [string, string];
  wall: [string, string];
  neon?: boolean;
  headlights?: boolean;
  scenery: SceneryGroup[];
  previewSky: [string, string];
  previewGround: string;
  terrain: {
    /** Baseline height of the land away from the road. */
    base: number;
    /** Rolling hill / mountain amplitude. */
    amp: number;
    /** Height of the mountain ring that closes the horizon. */
    rim: number;
    rock: string;
  };
}

export interface MapDef {
  id: string;
  name: string;
  tagline: string;
  /** Centerline control points [x, z, elevation]. Runs of collinear points make true straights. */
  points: [number, number, number][];
  start: [number, number];
  ramps: RampDef[];
  items: number[];
  theme: MapTheme;
}

const N = "/models/nature/";
const R = "/models/real/";

export const MAPS: MapDef[] = [
  {
    id: "circuit",
    name: "Greenwood Loop",
    tagline: "Sunny hills, fast sweepers, a hairpin to remember.",
    points: [
      [-120, -100, 0],
      [-72, -100, 0],
      [-24, -100, 0],
      [24, -100, 0],
      [72, -100, 0],
      [120, -100, 0],
      [168, -100, 0],
      [215, -88, 2],
      [248, -45, 6],
      [245, 15, 11],
      [205, 55, 15],
      [150, 50, 17],
      [118, 88, 14],
      [135, 138, 10],
      [100, 172, 6],
      [40, 178, 2],
      [-10, 150, 0],
      [-60, 150, 0],
      [-110, 150, 0],
      [-160, 150, 0],
      [-210, 150, 0],
      [-255, 120, 4],
      [-262, 60, 9],
      [-220, 15, 13],
      [-250, -38, 7],
      [-200, -78, 3],
      [-160, -98, 0],
    ],
    start: [0, -91],
    ramps: [{ at: [40, -100] }, { at: [-70, 150], len: 20, height: 3.4 }],
    items: [0.16, 0.3, 0.42, 0.62, 0.76, 0.86],
    theme: {
      hdr: "/hdr/sky.hdr",
      envIntensity: 0.9,
      fog: { color: "#bcd3e6", near: 90, far: 420 },
      ground: { key: "grass", tint: "#b9dc98", repeat: 120 },
      roadTint: "#ffffff",
      sun: { color: "#fff3dc", intensity: 2.4, position: [40, 60, 25], ambient: 0.35 },
      kerb: ["#d8352a", "#f0f0f0"],
      wall: ["#d8352a", "#ececec"],
      scenery: [
        { url: N + "tree_pineTallA.glb", count: 60, scale: [5, 8] },
        { url: N + "tree_default.glb", count: 60, scale: [5, 8] },
        { url: N + "tree_oak.glb", count: 60, scale: [5, 8] },
        { url: R + "boulder_01.glb", count: 30, scale: [3, 6] },
        { url: R + "rock_moss_set_01.glb", count: 8, scale: [1.6, 2.6] },
        { url: R + "rock_moss_set_02.glb", count: 8, scale: [1.6, 2.6] },
        { url: R + "fern_02.glb", count: 45, scale: [2, 3.4] },
        { url: R + "shrub_sorrel_01.glb", count: 55, scale: [5, 9] },
        { url: R + "grass_medium_01.glb", count: 40, scale: [2.4, 4] },
        { url: R + "dead_tree_trunk_02.glb", count: 6, scale: [1.4, 2] },
      ],
      previewSky: ["#7db8ff", "#e7f2ff"],
      previewGround: "#5d9a45",
      terrain: { base: 4, amp: 22, rim: 70, rock: "#7a7466" },
    },
  },
  {
    id: "desert",
    name: "Dune Runner",
    tagline: "Long straights, huge jumps, sunset over the sand.",
    points: [
      [-100, -115, 0],
      [-52, -115, 0],
      [-4, -115, 0],
      [44, -115, 0],
      [92, -115, 0],
      [140, -115, 0],
      [188, -115, 0],
      [235, -95, 3],
      [265, -45, 8],
      [250, 10, 12],
      [205, 42, 14],
      [218, 95, 10],
      [258, 132, 5],
      [243, 188, 2],
      [200, 220, 0],
      [150, 215, 0],
      [100, 215, 0],
      [50, 215, 0],
      [0, 215, 0],
      [-50, 215, 0],
      [-100, 215, 0],
      [-150, 215, 0],
      [-205, 200, 3],
      [-245, 150, 7],
      [-225, 92, 12],
      [-262, 40, 15],
      [-238, -20, 10],
      [-255, -72, 5],
      [-215, -105, 1],
    ],
    start: [0, -112],
    ramps: [{ at: [44, -115], len: 20, height: 3.4 }, { at: [100, 215] }, { at: [-20, 215], len: 22, height: 4 }],
    items: [0.12, 0.28, 0.48, 0.6, 0.75, 0.9],
    theme: {
      hdr: "/hdr/dusk.hdr",
      envIntensity: 1.1,
      fog: { color: "#e8b98a", near: 120, far: 520 },
      ground: { key: "red_sand", tint: "#f4d2ad", repeat: 90 },
      roadTint: "#d9b79a",
      sun: { color: "#ffb36b", intensity: 3.0, position: [-60, 38, 45], ambient: 0.4 },
      kerb: ["#ff7a1a", "#fff2dc"],
      wall: ["#c65a2e", "#f0d6b8"],
      scenery: [
        { url: N + "tree_palmTall.glb", count: 22, scale: [5, 8] },
        { url: N + "cactus_tall.glb", count: 45, scale: [4, 6.5] },
        { url: N + "cactus_short.glb", count: 45, scale: [3, 5] },
        { url: R + "namaqualand_boulder_02.glb", count: 45, scale: [3, 7] },
        { url: R + "dead_tree_trunk_02.glb", count: 14, scale: [1.5, 2.4] },
        { url: R + "shrub_sorrel_01.glb", count: 30, scale: [5, 8] },
      ],
      previewSky: ["#ff9a55", "#ffd9a8"],
      previewGround: "#c98a54",
      terrain: { base: 2, amp: 26, rim: 60, rock: "#9a5a3a" },
    },
  },
  {
    id: "snow",
    name: "Frostbite Pass",
    tagline: "Twisty mountain road with tight hairpins and quick hops.",
    points: [
      [-60, -90, 0],
      [-15, -90, 0],
      [30, -90, 0],
      [75, -90, 0],
      [120, -90, 0],
      [165, -90, 0],
      [212, -72, 5],
      [240, -25, 12],
      [205, 22, 20],
      [145, 38, 27],
      [105, 18, 33],
      [75, 52, 38],
      [105, 95, 42],
      [165, 105, 46],
      [200, 145, 50],
      [170, 190, 50],
      [120, 195, 48],
      [70, 195, 48],
      [20, 195, 48],
      [-30, 195, 48],
      [-80, 195, 48],
      [-130, 195, 48],
      [-180, 180, 44],
      [-222, 135, 36],
      [-190, 88, 28],
      [-232, 42, 20],
      [-205, -8, 12],
      [-165, -48, 6],
      [-115, -75, 1],
    ],
    start: [0, -84],
    ramps: [{ at: [30, -90] }, { at: [20, 195], len: 20, height: 3.4 }],
    items: [0.14, 0.24, 0.33, 0.47, 0.62, 0.8],
    theme: {
      hdr: "/hdr/overcast.hdr",
      envIntensity: 0.9,
      fog: { color: "#dfe8f0", near: 60, far: 380 },
      ground: { key: "snow_02", tint: "#ffffff", repeat: 90 },
      roadTint: "#c9ced8",
      sun: { color: "#dfe8ff", intensity: 1.7, position: [30, 50, -30], ambient: 0.6 },
      kerb: ["#2b6fe0", "#ffffff"],
      wall: ["#3a86ff", "#f2f6ff"],
      scenery: [
        { url: N + "tree_pineTallA.glb", count: 130, scale: [6, 9] },
        { url: N + "tree_pineRoundA.glb", count: 80, scale: [5, 8] },
        { url: R + "boulder_01.glb", count: 35, scale: [3, 7] },
        { url: R + "rock_moss_set_01.glb", count: 8, scale: [1.8, 3] },
        { url: R + "rock_moss_set_02.glb", count: 8, scale: [1.8, 3] },
        { url: R + "dead_tree_trunk_02.glb", count: 8, scale: [1.4, 2.2] },
      ],
      previewSky: ["#b9c9d8", "#eef3f8"],
      previewGround: "#e9eef4",
      terrain: { base: 16, amp: 38, rim: 110, rock: "#9aa3ad" },
    },
  },
  {
    id: "night",
    name: "Neon Nights",
    tagline: "After dark. Glowing barriers, a big straight, headlights on.",
    points: [
      [-130, -70, 0],
      [-80, -70, 0],
      [-30, -70, 0],
      [20, -70, 0],
      [70, -70, 0],
      [120, -70, 0],
      [170, -70, 0],
      [215, -45, 2],
      [232, 10, 5],
      [200, 52, 9],
      [216, 102, 6],
      [186, 142, 3],
      [140, 155, 0],
      [90, 155, 0],
      [40, 155, 0],
      [-10, 155, 0],
      [-60, 155, 0],
      [-110, 155, 0],
      [-160, 155, 0],
      [-205, 142, 3],
      [-232, 92, 7],
      [-197, 46, 10],
      [-236, 0, 6],
      [-205, -38, 2],
      [-168, -62, 0],
    ],
    start: [0, -64],
    ramps: [{ at: [30, -70], len: 16, height: 2.8 }, { at: [90, 155], len: 20, height: 3.6 }, { at: [-20, 155] }],
    items: [0.14, 0.24, 0.38, 0.6, 0.7, 0.85],
    theme: {
      hdr: "/hdr/night.hdr",
      envIntensity: 0.35,
      fog: { color: "#0a1024", near: 50, far: 300 },
      ground: { key: "grass", tint: "#3d4c66", repeat: 120 },
      roadTint: "#8a93a8",
      sun: { color: "#8fa8ff", intensity: 0.8, position: [-30, 60, 30], ambient: 0.18 },
      kerb: ["#ff2bd6", "#19f0ff"],
      wall: ["#19f0ff", "#ff2bd6"],
      neon: true,
      headlights: true,
      scenery: [
        { url: N + "tree_default_dark.glb", count: 60, scale: [5, 8] },
        { url: N + "tree_cone_dark.glb", count: 60, scale: [5, 8] },
        { url: R + "boulder_01.glb", count: 24, scale: [3, 6] },
        { url: R + "rock_moss_set_01.glb", count: 8, scale: [1.6, 2.6] },
        { url: R + "fern_02.glb", count: 40, scale: [2, 3.2] },
        { url: R + "grass_medium_01.glb", count: 30, scale: [2.4, 4] },
      ],
      previewSky: ["#0b1030", "#3a1a66"],
      previewGround: "#1c2540",
      terrain: { base: 3, amp: 18, rim: 60, rock: "#2b3448" },
    },
  },
];

export const DEFAULT_MAP_ID = MAPS[0].id;

export function getMap(id: string): MapDef {
  return MAPS.find((m) => m.id === id) ?? MAPS[0];
}
