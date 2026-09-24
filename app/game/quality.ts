import type { QualityLevel } from "./settings";

export interface QualityPreset {
  /** Upper bound for the canvas device-pixel-ratio (multiplied by the Render scale setting). */
  dpr: number;
  shadows: boolean;
  shadowMapSize: number;
  /** Multiplier applied to each theme's scenery counts. */
  sceneryDensity: number;
  /** Multiplier for roadside dressing (lamps, barrels, crates, tyre walls). */
  dressing: number;
  /** Draw small ground cover (ferns, grass, shrubs)? */
  groundCover: boolean;
  post: "none" | "light" | "full";
  anisotropy: number;
  /**
   * Cheap sky: no HDRI background (a tiny gradient texture instead), a very small HDRI for lighting only,
   * and the camera's far plane pulled in to the fog distance so fully fogged geometry is never drawn.
   */
  cheapSky: boolean;
  /** Diffuse-only 512 px ground/road textures on Lambert materials (no normal/roughness maps). */
  lightMaterials: boolean;
}

export const QUALITY: Record<QualityLevel, QualityPreset> = {
  low: {
    dpr: 1,
    shadows: false,
    shadowMapSize: 512,
    sceneryDensity: 0.25,
    dressing: 0.3,
    groundCover: false,
    post: "none",
    anisotropy: 1,
    cheapSky: true,
    lightMaterials: true,
  },
  medium: {
    dpr: 1.25,
    shadows: true,
    shadowMapSize: 1024,
    sceneryDensity: 0.65,
    dressing: 0.75,
    groundCover: true,
    post: "light",
    anisotropy: 4,
    cheapSky: false,
    lightMaterials: false,
  },
  high: {
    dpr: 1.5,
    shadows: true,
    shadowMapSize: 2048,
    sceneryDensity: 1,
    dressing: 1,
    groundCover: true,
    post: "full",
    anisotropy: 8,
    cheapSky: false,
    lightMaterials: false,
  },
};

export const LEVELS: QualityLevel[] = ["low", "medium", "high"];

/** Battery saver also caps the render scale at this. */
export const BATTERY_RENDER_SCALE = 0.75;

/** Small ground cover models that are skipped on Low. */
export const isGroundCover = (url: string) => /fern|grass|shrub/.test(url);
