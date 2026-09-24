const timers = { boostUntil: 0 };

/** Camera shake amplitude 0..1: bumped on hard impacts and decayed by the camera rig. */
export const shake = { amp: 0 };
export const addShake = (a: number) => {
  shake.amp = Math.min(1, Math.max(shake.amp, a));
};

export const activateBoost = (now: number, ms = 2200) => {
  timers.boostUntil = now + ms;
};
export const isBoosting = (now: number) => timers.boostUntil > now;

export interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
  grow: number;
  r: number;
  g: number;
  b: number;
}

export const MAX_PARTICLES = 260;
export const particles: Particle[] = [];

export function emitParticle(p: Omit<Particle, "age">) {
  if (particles.length >= MAX_PARTICLES) particles.shift();
  particles.push({ ...p, age: 0 });
}

export interface SkidMark {
  x: number;
  y: number;
  z: number;
  heading: number;
}

export const MAX_SKIDS = 700;
export const skids: SkidMark[] = [];
export let skidHead = 0;

export function addSkid(x: number, y: number, z: number, heading: number) {
  const mark = { x, y, z, heading };
  if (skids.length < MAX_SKIDS) skids.push(mark);
  else {
    skids[skidHead] = mark;
    skidHead = (skidHead + 1) % MAX_SKIDS;
  }
}

export function resetFx() {
  timers.boostUntil = 0;
  shake.amp = 0;
  particles.length = 0;
  skids.length = 0;
  skidHead = 0;
}
