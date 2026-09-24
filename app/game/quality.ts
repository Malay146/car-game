import type { QualityLevel } from "./settings";

export interface QualityPreset {
  /** Upper bound for the canvas device-pixel-ratio. */
  dpr: number;
  shadows: boolean;
  shadowMapSize: number;
  /** Multiplier applied to each theme's scenery counts. */
  sceneryDensity: number;
  /** Draw small ground cover (ferns, grass, shrubs)? */
  groundCover: boolean;
  post: "none" | "light" | "full";
  anisotropy: number;
}

export const QUALITY: Record<QualityLevel, QualityPreset> = {
  low: { dpr: 1, shadows: false, shadowMapSize: 512, sceneryDensity: 0.3, groundCover: false, post: "none", anisotropy: 2 },
  medium: { dpr: 1.25, shadows: true, shadowMapSize: 1024, sceneryDensity: 0.65, groundCover: true, post: "light", anisotropy: 4 },
  high: { dpr: 1.5, shadows: true, shadowMapSize: 2048, sceneryDensity: 1, groundCover: true, post: "full", anisotropy: 8 },
};

export const LEVELS: QualityLevel[] = ["low", "medium", "high"];

/** Small ground cover models that are skipped on Low. */
export const isGroundCover = (url: string) => /fern|grass|shrub/.test(url);
