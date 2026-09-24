import { PathPoint, TRACK, nearestIndex } from "./trackPath";
import { DriveInput } from "./vehicleTypes";

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/**
 * Pure-pursuit steering toward a speed-dependent look-ahead point, plus a corner
 * speed planner: it scans the curvature ahead and brakes early enough to take
 * each bend at a sensible speed instead of driving on rails.
 */
export function createBotDriver(path: PathPoint[], skill = 1.0, lineOffset = 0) {
  let progressIndex = 0;
  const n = path.length;

  function drive(x: number, z: number, heading: number, speed: number): DriveInput {
    progressIndex = nearestIndex(path, x, z, progressIndex, 60);

    const lookUnits = clamp(5 + Math.abs(speed) * 0.35, 6, 22);
    const t = path[(progressIndex + Math.round(lookUnits / TRACK.spacing)) % n];
    // Aim slightly off the centerline so bots don't all stack on the same line.
    const tx = t.x + Math.cos(t.heading) * lineOffset;
    const tz = t.z - Math.sin(t.heading) * lineOffset;
    const targetHeading = Math.atan2(tx - x, tz - z);
    let diff = targetHeading - heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    // diff > 0 means the target is to the left; steer > 0 means right.
    const steer = clamp(-diff * 1.8, -1, 1);

    // Corner speed planning: worst curvature within braking distance.
    const scan = Math.round(clamp(Math.abs(speed) * 1.6, 20, 70) / TRACK.spacing);
    let worst = 0;
    for (let i = 0; i <= scan; i += 2) {
      worst = Math.max(worst, Math.abs(path[(progressIndex + i) % n].curvature));
    }
    const vTarget = clamp(Math.sqrt(27 / Math.max(worst, 0.0005)) * skill, 13, 44);

    let throttle = 1;
    let brake = 0;
    if (speed > vTarget + 1.5) {
      throttle = 0;
      brake = clamp((speed - vTarget) / 8, 0, 1);
    } else if (speed > vTarget) {
      throttle = 0.25;
    }
    if (Math.abs(diff) > 0.9) throttle = Math.min(throttle, 0.4);

    return { steer, throttle, brake, handbrake: 0 };
  }

  return {
    drive,
    getProgress: () => progressIndex / n,
  };
}
