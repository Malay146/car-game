export interface DriveInput {
  steer: number; // -1..1, negative = left
  throttle: number; // -1..1, negative = reverse
  brake: number; // 0..1
  handbrake: number; // 0..1
  useItem?: boolean;
  reset?: boolean;
}

export interface CarTransform {
  x: number;
  z: number;
  y: number;
  heading: number; // radians, world convention: heading 0 = +Z, matches trackPath
  speedKmh: number;
  vx: number;
  vz: number;
  /** Car's up-axis y component: 1 = upright, <0 = upside down. */
  upY?: number;
}

export const ZERO_INPUT: DriveInput = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };
