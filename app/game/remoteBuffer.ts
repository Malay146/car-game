/**
 * Snapshot interpolation for remote cars. Each remote player has a short buffer of timestamped
 * snapshots; cars are rendered `INTERP_DELAY_MS` in the past so there are almost always two
 * snapshots to blend between. If the buffer runs dry we extrapolate with the last velocity, capped.
 *
 * Timestamps are the *sender's* clock (performance.now() on their page). Clocks differ between
 * machines, so per player we track `offset = arrival - sentAt` and follow its minimum, which
 * approximates the one-way latency plus the clock difference and ignores network jitter.
 */

export const INTERP_DELAY_MS = 100;
export const MAX_EXTRAPOLATE_MS = 250;
/** A gap this long means the sender was paused (hidden tab, respawn): jump instead of gliding across it. */
const GAP_SNAP_MS = 400;
const MAX_SNAPS = 24;

export interface Snapshot {
  /** Sender clock, ms. */
  t: number;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  vx: number;
  vz: number;
  speedKmh: number;
  steer: number;
  total: number;
}

export interface Sample extends Omit<Snapshot, "t"> {
  /** True when the car is being extrapolated because no newer snapshot has arrived. */
  extrapolated: boolean;
}

interface Track {
  snaps: Snapshot[];
  offset: number | null;
  lastArrival: number;
}

const tracks = new Map<string, Track>();

export function pushSnapshot(id: string, snap: Snapshot, arrival: number) {
  let tr = tracks.get(id);
  if (!tr) {
    tr = { snaps: [], offset: null, lastArrival: arrival };
    tracks.set(id, tr);
  }
  const sample = arrival - snap.t;
  if (tr.offset === null || sample < tr.offset) tr.offset = sample;
  else tr.offset += (sample - tr.offset) * 0.004; // let it drift up slowly so a route change can be followed
  tr.lastArrival = arrival;
  const last = tr.snaps[tr.snaps.length - 1];
  if (last && snap.t <= last.t) return; // out of order or duplicate
  tr.snaps.push(snap);
  if (tr.snaps.length > MAX_SNAPS) tr.snaps.shift();
}

export function removeRemote(id: string) {
  tracks.delete(id);
}

export function clearRemotes() {
  tracks.clear();
}

/** Estimated milliseconds since we last heard from this player (Infinity if never). */
export function silenceMs(id: string, now: number): number {
  const tr = tracks.get(id);
  return tr ? now - tr.lastArrival : Infinity;
}

/**
 * Writes the interpolated state for local time `now` into `out`. Returns false if nothing has been
 * received from this player yet.
 */
export function sampleRemote(id: string, now: number, out: Sample, delay = INTERP_DELAY_MS): boolean {
  const tr = tracks.get(id);
  if (!tr || tr.offset === null || tr.snaps.length === 0) return false;
  const renderT = now - tr.offset - delay; // in the sender's clock
  const snaps = tr.snaps;
  const first = snaps[0];
  const last = snaps[snaps.length - 1];

  const copy = (s: Snapshot, extrapolated: boolean) => {
    out.x = s.x;
    out.y = s.y;
    out.z = s.z;
    out.qx = s.qx;
    out.qy = s.qy;
    out.qz = s.qz;
    out.qw = s.qw;
    out.vx = s.vx;
    out.vz = s.vz;
    out.speedKmh = s.speedKmh;
    out.steer = s.steer;
    out.total = s.total;
    out.extrapolated = extrapolated;
  };

  if (renderT <= first.t) {
    copy(first, false);
    return true;
  }
  if (renderT >= last.t) {
    copy(last, true);
    const ahead = Math.min(MAX_EXTRAPOLATE_MS, renderT - last.t) / 1000;
    out.x += last.vx * ahead;
    out.z += last.vz * ahead;
    return true;
  }
  let i = snaps.length - 1;
  while (i > 0 && snaps[i - 1].t > renderT) i--;
  const a = snaps[i - 1];
  const b = snaps[i];
  const span = b.t - a.t;
  if (span > GAP_SNAP_MS) {
    copy(renderT - a.t < span / 2 ? a : b, false);
    return true;
  }
  const k = span > 0 ? (renderT - a.t) / span : 1;
  const lerp = (p: number, q: number) => p + (q - p) * k;
  out.x = lerp(a.x, b.x);
  out.y = lerp(a.y, b.y);
  out.z = lerp(a.z, b.z);
  // Normalised lerp on the shorter arc: snapshots are ~33 ms apart, so this is indistinguishable from slerp.
  const sign = a.qx * b.qx + a.qy * b.qy + a.qz * b.qz + a.qw * b.qw < 0 ? -1 : 1;
  let qx = lerp(a.qx, b.qx * sign);
  let qy = lerp(a.qy, b.qy * sign);
  let qz = lerp(a.qz, b.qz * sign);
  let qw = lerp(a.qw, b.qw * sign);
  const n = Math.hypot(qx, qy, qz, qw) || 1;
  qx /= n;
  qy /= n;
  qz /= n;
  qw /= n;
  out.qx = qx;
  out.qy = qy;
  out.qz = qz;
  out.qw = qw;
  out.vx = lerp(a.vx, b.vx);
  out.vz = lerp(a.vz, b.vz);
  out.speedKmh = lerp(a.speedKmh, b.speedKmh);
  out.steer = lerp(a.steer, b.steer);
  out.total = b.total;
  out.extrapolated = false;
  return true;
}

export function makeSample(): Sample {
  return { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vz: 0, speedKmh: 0, steer: 0, total: 0, extrapolated: false };
}
