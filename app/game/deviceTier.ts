import type { QualityLevel } from "./settings";

export type DeviceClass = "phone" | "tablet" | "laptop" | "desktop";

export interface DeviceTier {
  kind: DeviceClass;
  /** Overall capability: picks the first-run quality and the ceiling "Auto" never goes above. */
  tier: "low" | "mid" | "high";
  defaultLevel: QualityLevel;
  ceiling: QualityLevel;
  defaultFps: "30" | "60";
  /** Suggested render scale on first run (1 = native up to the quality's DPR cap). */
  defaultRenderScale: number;
  reducedMotion: boolean;
  /** Unmasked GPU name when the browser exposes it (empty otherwise). */
  gpu: string;
  /** Short human label for the settings panel, e.g. "Phone, low-end GPU". */
  label: string;
}

/** GPUs that struggle with this game even at medium settings (older / entry-level mobile and integrated parts). */
const WEAK_GPU =
  /mali-(4|t6|t7|t8|g3|g5[12]|g6[08]|g7[12])|adreno \(tm\) ?([1-5]\d\d|6[0-2]\d)\b|adreno ([1-5]\d\d|6[0-2]\d)\b|powervr|sgx|intel.*(hd|uhd) graphics( [1-6]\d\d)?\b|intel.*gma|swiftshader|llvmpipe|softpipe|microsoft basic|videocore|apple a(8|9|10|11)\b/i;
/** Discrete or strong integrated GPUs that comfortably run High. */
const STRONG_GPU = /nvidia|geforce|rtx|quadro|radeon (rx|pro)|amd radeon(?!.*vega [38])|apple m[1-9]|iris xe|arc/i;

function gpuName(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") || canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return "";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return name;
  } catch {
    return "";
  }
}

let cached: DeviceTier | null = null;

/** Classifies this device once (touch / UA / memory / cores / screen / GPU name). Client-only. */
export function getDeviceTier(): DeviceTier {
  if (cached) return cached;
  const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } };
  const ua = nav.userAgent || "";
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // iPadOS reports a desktop Mac UA; its touch points give it away.
  const iPad = /ipad/i.test(ua) || (/macintosh/i.test(ua) && nav.maxTouchPoints > 1);
  const mobileUa = nav.userAgentData?.mobile ?? /android|iphone|ipod|mobile|iemobile|opera mini/i.test(ua);
  const shortSide = Math.min(screen.width, screen.height);
  const cores = nav.hardwareConcurrency || 4;
  const mem = nav.deviceMemory ?? (mobileUa || iPad ? 3 : 8);
  const gpu = gpuName();
  const weakGpu = WEAK_GPU.test(gpu);
  const strongGpu = STRONG_GPU.test(gpu);

  let kind: DeviceClass;
  if (iPad || ((coarse || mobileUa) && shortSide >= 600)) kind = "tablet";
  else if (mobileUa || (coarse && shortSide < 600)) kind = "phone";
  else if (cores <= 4 || mem <= 4 || weakGpu || /intel/i.test(gpu)) kind = "laptop";
  else kind = "desktop";

  let tier: DeviceTier["tier"];
  if (kind === "phone") tier = !weakGpu && mem >= 6 && cores >= 8 ? "mid" : "low";
  else if (kind === "tablet") tier = weakGpu || mem <= 3 ? "low" : "mid";
  else if (kind === "laptop") tier = weakGpu || mem <= 4 || cores <= 2 ? "low" : strongGpu ? "high" : "mid";
  else tier = weakGpu ? "mid" : "high";

  // Software renderers and tiny-memory devices get Low whatever they are.
  const veryWeak = /swiftshader|llvmpipe|softpipe|microsoft basic/i.test(gpu) || mem <= 2;
  let defaultLevel: QualityLevel;
  let ceiling: QualityLevel;
  if (kind === "phone") {
    defaultLevel = "low";
    ceiling = tier === "mid" ? "medium" : "low";
  } else if (kind === "tablet") {
    defaultLevel = tier === "low" ? "low" : "medium";
    ceiling = tier === "low" ? "medium" : "high";
  } else if (kind === "laptop") {
    defaultLevel = tier === "high" ? "high" : "medium";
    ceiling = tier === "low" ? "medium" : "high";
  } else {
    defaultLevel = tier === "high" ? "high" : "medium";
    ceiling = "high";
  }
  if (veryWeak) {
    tier = "low";
    defaultLevel = "low";
  }
  const pick = { defaultLevel, ceiling, defaultFps: kind === "phone" ? ("30" as const) : ("60" as const) };
  const kindLabel = { phone: "Phone", tablet: "Tablet", laptop: "Laptop", desktop: "Desktop" }[kind];
  const tierLabel = { low: "entry-level", mid: "mid-range", high: "high-end" }[tier];
  cached = {
    kind,
    tier,
    defaultLevel: pick.defaultLevel,
    ceiling: pick.ceiling,
    defaultFps: pick.defaultFps,
    defaultRenderScale: kind === "phone" && tier === "low" ? 0.85 : 1,
    reducedMotion,
    gpu,
    label: `${kindLabel}, ${tierLabel}`,
  };
  return cached;
}
