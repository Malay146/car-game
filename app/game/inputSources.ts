import { useSettingsUi } from "./settingsUi";

/** Raw, non-React state written by input sources and read once per physics tick. */
export interface RawInput {
  steer: number; // -1..1
  throttle: number; // -1..1
  brake: number; // 0..1
  handbrake: number; // 0..1
  item: boolean;
  flip: boolean;
  reset: boolean;
}

export const emptyRaw = (): RawInput => ({ steer: 0, throttle: 0, brake: 0, handbrake: 0, item: false, flip: false, reset: false });

/** Written by the touch overlay's pointer handlers. */
export const touchInput = {
  steer: 0,
  gas: false,
  reverse: false,
  handbrake: false,
  item: false,
  flip: false,
  reset: false,
};

export function clearTouchInput() {
  touchInput.steer = 0;
  touchInput.gas = false;
  touchInput.reverse = false;
  touchInput.handbrake = false;
  touchInput.item = false;
  touchInput.flip = false;
  touchInput.reset = false;
}

// ---------------------------------------------------------------------------
// Tilt steering (DeviceOrientation)
// ---------------------------------------------------------------------------

export const tiltInput = { steer: 0, active: false, supported: false };

const TILT_RANGE = 32; // degrees of wheel rotation for full lock
const TILT_DEAD = 2.5;

const wrapDeg = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

function screenAngle(): number {
  if (typeof screen !== "undefined" && screen.orientation && typeof screen.orientation.angle === "number") return screen.orientation.angle;
  const w = (window as unknown as { orientation?: number }).orientation;
  return typeof w === "number" ? w : 0;
}

/** Steering-wheel angle in degrees (+ = clockwise) from device orientation, independent of screen rotation. */
export function tiltAngleFromOrientation(beta: number, gamma: number, screenDeg: number): number {
  const b = (beta * Math.PI) / 180;
  const g = (gamma * Math.PI) / 180;
  // Gravity direction in device coordinates.
  const gx = Math.cos(b) * Math.sin(g);
  const gy = -Math.sin(b);
  const phi = (Math.atan2(gx, -gy) * 180) / Math.PI;
  return wrapDeg(phi + screenDeg);
}

function onOrientation(e: DeviceOrientationEvent) {
  if (e.beta === null || e.gamma === null) return;
  const deg = tiltAngleFromOrientation(e.beta, e.gamma, screenAngle());
  tiltInput.supported = true;
  const mag = Math.max(0, Math.abs(deg) - TILT_DEAD) / (TILT_RANGE - TILT_DEAD);
  tiltInput.steer = Math.sign(deg) * Math.min(1, mag);
}

let tiltListening = false;

/** Ask for permission (iOS needs a user gesture) and start listening. Resolves false if unavailable or denied. */
export async function enableTilt(): Promise<boolean> {
  if (typeof window === "undefined" || typeof DeviceOrientationEvent === "undefined") return false;
  const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<"granted" | "denied"> };
  if (typeof DOE.requestPermission === "function") {
    try {
      if ((await DOE.requestPermission()) !== "granted") return false;
    } catch {
      return false;
    }
  }
  if (!tiltListening) {
    window.addEventListener("deviceorientation", onOrientation);
    tiltListening = true;
  }
  tiltInput.active = true;
  return true;
}

export function disableTilt() {
  if (tiltListening) window.removeEventListener("deviceorientation", onOrientation);
  tiltListening = false;
  tiltInput.active = false;
  tiltInput.steer = 0;
}

// ---------------------------------------------------------------------------
// Gamepad
// ---------------------------------------------------------------------------

export const gamepadStatus = { connected: false, name: "" };

const STICK_DEAD = 0.14;
const TRIGGER_DEAD = 0.05;
let startWasDown = false;

/** Radial-free per-axis deadzone with rescale and a mild response curve for fine control. */
export function shapeAxis(v: number, dead = STICK_DEAD): number {
  const a = Math.abs(v);
  if (a <= dead) return 0;
  const n = (a - dead) / (1 - dead);
  return Math.sign(v) * Math.pow(Math.min(1, n), 1.35);
}

/** Polls the first connected gamepad into `out`. Returns false when none is connected. */
export function readGamepad(out: RawInput): boolean {
  if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return false;
  let pad: Gamepad | null = null;
  for (const p of navigator.getGamepads()) {
    if (p && p.connected) {
      pad = p;
      break;
    }
  }
  if (!pad) {
    gamepadStatus.connected = false;
    return false;
  }
  gamepadStatus.connected = true;
  gamepadStatus.name = pad.id;
  const b = (i: number) => pad!.buttons[i];
  const pressed = (i: number) => !!b(i)?.pressed;
  const value = (i: number) => {
    const v = b(i)?.value ?? 0;
    return v > TRIGGER_DEAD ? v : b(i)?.pressed ? 1 : 0;
  };

  let steer = shapeAxis(pad.axes[0] ?? 0);
  if (pressed(14)) steer = -1;
  else if (pressed(15)) steer = 1;

  const gas = Math.max(value(7), pressed(0) ? 1 : 0, pressed(12) ? 1 : 0);
  const rev = Math.max(value(6), pressed(13) ? 1 : 0);
  out.steer = steer;
  out.throttle = gas > rev ? gas : rev > 0 ? -rev : 0;
  out.brake = 0;
  out.handbrake = pressed(1) || pressed(4) ? 1 : 0;
  out.item = pressed(2) || pressed(5);
  out.flip = pressed(3);
  out.reset = pressed(8);

  // Start toggles the settings panel.
  const start = pressed(9);
  if (start && !startWasDown) useSettingsUi.getState().toggle();
  startWasDown = start;
  return true;
}
