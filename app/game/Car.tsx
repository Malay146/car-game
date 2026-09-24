"use client";

import { useEffect, useMemo, useRef, RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { RigidBody, CuboidCollider, ConvexHullCollider, useRapier, useBeforePhysicsStep } from "@react-three/rapier";
import type { RapierRigidBody } from "@react-three/rapier";
import * as THREE from "three";
import type { DynamicRayCastVehicleController } from "@dimforge/rapier3d-compat";
import { generateCenterline, getCheckpoints, nearestIndex } from "./trackPath";
import { createBotDriver } from "./BotController";
import { useKeyboardInput } from "./PlayerControls";
import { DriveInput, CarTransform } from "./vehicleTypes";
import { useGameStore } from "./store";
import { playBoost, playCrash } from "./AudioManager";
import { sendFinish, sendState } from "./net";
import { markers, setMarker } from "./markers";
import { getMap } from "./maps";
import {
  activateBoost,
  addSkid,
  emitParticle,
  isBoosting,
  resetFx,
} from "./fx";

const WHEEL_DEFS = [
  { name: "wheel-front-left", front: true },
  { name: "wheel-front-right", front: true },
  { name: "wheel-back-left", front: false },
  { name: "wheel-back-right", front: false },
] as const;

const WHEEL_RADIUS = 0.3;
const SUSPENSION_REST = 0.26;
const DT = 1 / 60;

// Handling (world units per second). Tuned for a snappy, drift-happy arcade feel.
const VMAX = 46;
const ACCEL = 27;
const REVERSE_MAX = 12;
const BRAKE_DECEL = 44;
const GRIP = 18; // lateral grip while gripping (1/s)
const GRIP_SLIDE = 2.0; // lateral grip while drifting (1/s)
const MAX_YAW = 3.6; // rad/s at low speed: much sharper turn-in
const DISPLAY_SCALE = 4; // world speed -> HUD "km/h"

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

interface CarProps {
  isPlayer: boolean;
  model: string;
  color: string;
  startX: number;
  startZ: number;
  startHeading: number;
  transformRef: RefObject<CarTransform>;
}

export function Car({ isPlayer, model, color, startX, startZ, startHeading, transformRef }: CarProps) {
  const { world, rapier } = useRapier();
  const bodyRef = useRef<RapierRigidBody | null>(null);
  const controllerRef = useRef<DynamicRayCastVehicleController | null>(null);
  const visualRef = useRef<THREE.Group | null>(null);
  const wheelMeshes = useRef<(THREE.Object3D | null)[]>([null, null, null, null]);

  const { scene } = useGLTF(model);
  const carClone = useMemo(() => scene.clone(true), [scene]);

  const wheelDefs = useMemo(
    () =>
      WHEEL_DEFS.map((w) => {
        const n = carClone.getObjectByName(w.name);
        return { ...w, x: n?.position.x ?? 0.3, y: n?.position.y ?? WHEEL_RADIUS, z: n?.position.z ?? 0 };
      }),
    [carClone]
  );
  const dims = useMemo(() => {
    const size = new THREE.Box3().setFromObject(carClone).getSize(new THREE.Vector3());
    const hx = (size.x / 2) * 0.92;
    const hz = (size.z / 2) * 0.94;
    // Hull with chamfered nose and tail: any low edge slides under it and lifts the car instead of stopping it.
    const yb = 0.5; // underside well above the wheels: only tyres ever touch the road
    const yt = 0.95;
    const rise = 0.4; // height of the chamfer
    const run = 0.75; // horizontal length of the chamfer (gentle ~28 degree slope)
    const pts: number[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        pts.push(sx * hx, yb, sz * (hz - run), sx * hx, yb + rise, sz * hz, sx * hx, yt, sz * hz);
      }
    }
    return { hx, hz, hull: new Float32Array(pts) };
  }, [carClone]);

  const mapId = useGameStore((s) => s.mapId);
  const centerline = useMemo(() => generateCenterline(mapId), [mapId]);
  const cps = useMemo(() => getCheckpoints(mapId), [mapId]);
  const headlights = !!getMap(mapId).theme.headlights;
  const lightTarget = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(0, 0, 14);
    return o;
  }, []);
  const readPlayerInput = useKeyboardInput();
  const botDriver = useMemo(() => (isPlayer ? null : createBotDriver(centerline)), [isPlayer, centerline]);

  const raceState = useGameStore((s) => s.raceState);
  const totalLaps = useGameStore((s) => s.totalLaps);
  const setPlayerTelemetry = useGameStore((s) => s.setPlayerTelemetry);
  const setPlayerLapTime = useGameStore((s) => s.setPlayerLapTime);
  const incrementPlayerLap = useGameStore((s) => s.incrementPlayerLap);
  const incrementBotLap = useGameStore((s) => s.incrementBotLap);
  const finishRace = useGameStore((s) => s.finishRace);

  const sim = useRef({
    lapProgress: 0,
    lapCount: 0,
    lapTimer: 0,
    started: false,
    itemHeld: false,
    netTick: 0,
    sliding: false,
    hardSteerTime: 0,
    airTime: 0,
    landGrace: 0,
    cp: 0,
    resetReadyAt: 0,
    lastV: null as { x: number; y: number; z: number } | null,
    impactAt: 0,
    tangentVy: 0,
    wasGrounded: false,
    flipped: 0,
    stuck: 0,
    tick: 0,
    steerVisual: 0,
    wheelSpin: 0,
    speed: 0,
    lean: 0,
    pitch: 0,
    lastVf: 0,
    rpm: 0.2,
    collisionAt: 0,
  });

  useEffect(() => {
    wheelDefs.forEach((w, i) => {
      const mesh = carClone.getObjectByName(w.name) ?? null;
      wheelMeshes.current[i] = mesh;
      if (mesh) mesh.rotation.order = "YXZ";
    });
    const body = carClone.getObjectByName("body");
    if (body instanceof THREE.Mesh && color) {
      const mat = (body.material as THREE.MeshStandardMaterial).clone();
      mat.color = new THREE.Color(color);
      body.material = mat;
    }
    carClone.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
  }, [carClone, wheelDefs, color]);

  useEffect(() => {
    const out = transformRef.current;
    out.x = startX;
    out.z = startZ;
    out.y = 0.6;
    out.heading = startHeading;
    out.speedKmh = 0;
    out.vx = 0;
    out.vz = 0;
  }, [transformRef, startX, startZ, startHeading]);

  useEffect(() => {
    if (isPlayer) resetFx();
    const id = isPlayer ? "me" : "bot";
    return () => {
      markers.delete(id);
    };
  }, [isPlayer]);

  // The raycast vehicle only provides suspension + ground contact; drive and grip are custom.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const controller = world.createVehicleController(body);
    wheelDefs.forEach((w) => {
      controller.addWheel(
        { x: w.x, y: w.y + SUSPENSION_REST, z: w.z },
        { x: 0, y: -1, z: 0 },
        { x: 1, y: 0, z: 0 },
        SUSPENSION_REST,
        WHEEL_RADIUS
      );
    });
    for (let i = 0; i < wheelDefs.length; i++) {
      controller.setWheelSuspensionStiffness(i, 36);
      controller.setWheelSuspensionCompression(i, 5.5);
      controller.setWheelSuspensionRelaxation(i, 6);
      controller.setWheelMaxSuspensionTravel(i, 0.4);
      controller.setWheelMaxSuspensionForce(i, 80000);
      controller.setWheelFrictionSlip(i, 0.001);
      controller.setWheelSideFrictionStiffness(i, 0.001);
    }
    controllerRef.current = controller;
    return () => {
      world.removeVehicleController(controller);
      controllerRef.current = null;
    };
  }, [world, wheelDefs]);

  const rearLocal = useMemo(
    () => wheelDefs.filter((w) => !w.front).map((w) => new THREE.Vector3(w.x, 0.05, w.z)),
    [wheelDefs]
  );

  useBeforePhysicsStep(() => {
    const controller = controllerRef.current;
    const body = bodyRef.current;
    if (!controller || !body) return;
    const s = sim.current;

    if (raceState !== "racing") {
      s.lastV = null;
      controller.updateVehicle(DT);
      const v = body.linvel();
      body.setLinvel({ x: 0, y: v.y, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      return;
    }

    const t = body.translation();
    const rot = body.rotation();
    const quat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
    const f3 = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
    const heading = Math.atan2(f3.x, f3.z);
    const fl = Math.hypot(f3.x, f3.z) || 1;
    const fwd = { x: f3.x / fl, z: f3.z / fl };
    const right = { x: fwd.z, z: -fwd.x }; // points to the car's left (heading increases toward it)

    const lv0 = body.linvel();
    const vf0 = lv0.x * fwd.x + lv0.z * fwd.z;

    // Impact sounds: only a real, sudden velocity change (wall, car, hard landing) - never mere contact.
    if (s.lastV && isPlayer) {
      const dvh = Math.hypot(lv0.x - s.lastV.x, lv0.z - s.lastV.z);
      const dvy = lv0.y - s.lastV.y;
      const strength = Math.max(dvh / 22, dvy > 10 ? (dvy - 6) / 30 : 0);
      const nowMs = performance.now();
      if ((dvh > 5 || dvy > 10) && nowMs - s.impactAt > 300) {
        s.impactAt = nowMs;
        playCrash(Math.min(1, Math.max(0.15, strength)));
      }
    }

    const input: DriveInput = isPlayer ? readPlayerInput() : botDriver!.drive(t.x, t.z, heading, vf0);
    const now = performance.now();

    // Items (player only)
    if (isPlayer) {
      const pressed = !!input.useItem;
      const store = useGameStore.getState();
      if (pressed && !s.itemHeld && store.item) {
        store.setItem(null);
        activateBoost(now);
        body.applyImpulse({ x: fwd.x * 4500, y: 0, z: fwd.z * 4500 }, true);
        playBoost();
      }
      s.itemHeld = pressed;
    }
    const boosting = isPlayer && isBoosting(now);

    // Suspension pass (wheel forces are disabled, this only holds the car up).
    for (let i = 0; i < wheelDefs.length; i++) {
      controller.setWheelSteering(i, 0);
      controller.setWheelEngineForce(i, 0);
      controller.setWheelBrake(i, 0);
    }
    controller.updateVehicle(DT);
    let contacts = 0;
    for (let i = 0; i < wheelDefs.length; i++) if (controller.wheelIsInContact(i)) contacts++;
    const grounded = contacts >= 2;
    // Landing assist: after a real jump, briefly clamp down lateral slip and spin so the car lands straight.
    let justLanded = false;
    if (!grounded) s.airTime += DT;
    else {
      if (s.airTime > 0.25) {
        s.landGrace = 0.6;
        justLanded = true;
      }
      s.airTime = 0;
    }
    if (s.landGrace > 0) s.landGrace -= DT;
    const landing = grounded && s.landGrace > 0;

    const lv = body.linvel();
    const av = body.angvel();
    const vf = lv.x * fwd.x + lv.z * fwd.z;
    const vl = lv.x * right.x + lv.z * right.z;
    const speed = Math.hypot(vf, vl);
    const slipRatio = Math.abs(vl) / (Math.abs(vf) + 5);

    // Slide state: handbrake, or shoving the car hard into a fast corner, breaks the rear loose.
    if (Math.abs(input.steer) > 0.85 && Math.abs(vf) > 38) s.hardSteerTime += DT;
    else s.hardSteerTime = Math.max(0, s.hardSteerTime - DT * 2);
    if (!s.sliding && grounded && (slipRatio > 0.5 || (input.handbrake > 0.5 && speed > 10) || s.hardSteerTime > 0.3)) {
      s.sliding = true;
    }
    if (s.sliding && slipRatio < 0.14 && input.handbrake < 0.5 && s.hardSteerTime < 0.05) s.sliding = false;
    if (!grounded || landing) s.sliding = false;

    let vfN = vf;
    let vlN = vl;
    if (grounded) {
      const vmax = boosting ? VMAX * 1.3 : VMAX;
      let a = 0;
      if (input.throttle > 0) {
        a += input.throttle * ACCEL * (boosting ? 2 : 1) * Math.max(0, 1 - Math.pow(Math.max(vf, 0) / vmax, 2));
      } else if (input.throttle < 0) {
        if (vf > 1) a -= BRAKE_DECEL * 0.9 * -input.throttle;
        else a += input.throttle * 14 * Math.max(0, 1 - Math.pow(Math.abs(vf) / REVERSE_MAX, 2));
      }
      const resist = 0.5 + 0.0016 * vf * vf + Math.abs(vl) * (s.sliding ? 0.4 : 0.08);
      const passive = resist + input.brake * BRAKE_DECEL + (input.handbrake > 0.5 ? 6 : 0);
      vfN = vf + a * DT;
      const reversing = input.throttle < 0 && vf <= 1;
      if (!reversing) vfN = Math.sign(vfN) * Math.max(0, Math.abs(vfN) - passive * DT);

      let G = landing ? 45 : s.sliding ? GRIP_SLIDE : GRIP;
      if (s.sliding && slipRatio > 1.1) G = 6;
      const aMax = s.sliding ? 20 : 48;
      vlN = vl + clamp(-vl * G, -aMax, aMax) * DT;
    }
    const vxN = fwd.x * vfN + right.x * vlN;
    const vzN = fwd.z * vfN + right.z * vlN;
    // On real slopes (ramps) follow the surface so the car launches off the lip instead of digging in.
    const groundN = { x: 0, y: 1, z: 0 }; // average contact normal: what the body should level toward
    let vyN = lv.y;
    if (justLanded && vyN < -2) vyN *= 0.35; // soak up the landing so the car doesn't bounce
    if (grounded) {
      let nx = 0;
      let ny = 0;
      let nz = 0;
      let cnt = 0;
      for (let i = 0; i < wheelDefs.length; i++) {
        if (!controller.wheelIsInContact(i)) continue;
        const n = controller.wheelContactNormal(i);
        if (n) {
          nx += n.x;
          ny += n.y;
          nz += n.z;
          cnt++;
        }
      }
      if (cnt > 0) {
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;
        if (ny > 0.5) {
          groundN.x = nx;
          groundN.y = ny;
          groundN.z = nz;
        }
        // remembered only for take-off: while driving, the suspension alone holds the car on the surface
        s.tangentVy = ny > 0.2 && ny < 0.999 ? -(nx * vxN + nz * vzN) / ny : 0;
      }
    }
    // Leaving a ramp lip / crest: carry the surface's upward speed into the air.
    if (s.wasGrounded && !grounded && s.tangentVy > 0) vyN = Math.max(vyN, s.tangentVy * 0.95);
    if (!grounded) s.tangentVy = 0;
    s.wasGrounded = grounded;
    // Cap upward speed so a hard clip against an edge can never catapult the car.
    const vyOut = Math.min(vyN, 10);
    body.setLinvel({ x: vxN, y: vyOut, z: vzN }, true);
    s.lastV = { x: vxN, y: vyOut, z: vzN };

    // Yaw: steering sets a target yaw rate; drifting overrotates and settles more slowly.
    let yaw = av.y * 0.99;
    if (!grounded) {
      // In the air: hold the nose along the direction of travel so jumps land straight on the road.
      const hv = Math.hypot(lv.x, lv.z);
      if (hv > 8) {
        const diff = Math.atan2(Math.sin(Math.atan2(lv.x, lv.z) - heading), Math.cos(Math.atan2(lv.x, lv.z) - heading));
        yaw = av.y * 0.85 + diff * 5 * DT * 10;
      } else {
        yaw = av.y * 0.9;
      }
    }
    if (grounded) {
      const dir = vf >= -0.5 ? 1 : -1;
      const sp = Math.abs(vf);
      let wmax = MAX_YAW / (1 + Math.pow(sp / 28, 2));
      if (sp < 1.5) wmax *= sp / 1.5;
      let target = -input.steer * wmax * dir * (s.sliding ? 1.75 : 1);
      if (input.handbrake > 0.5 && speed > 8) target *= 1.35;
      if (s.sliding) target += vl * 0.09 * (1 - Math.abs(input.steer) * 0.6); // self-aligning
      yaw = av.y + (target - av.y) * Math.min(1, (s.sliding ? 6 : 14) * DT);
      if (landing && Math.hypot(lv.x, lv.z) > 8 && Math.abs(input.steer) < 0.3) {
        const d = Math.atan2(Math.sin(Math.atan2(lv.x, lv.z) - heading), Math.cos(Math.atan2(lv.x, lv.z) - heading));
        yaw = clamp(d * 8, -3, 3);
      }
    }
    // Keep the car level with the road surface: damp roll/pitch and align to the ground.
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
    const lvl = grounded ? 9 : 4;
    // error axis = up x target; target is the ground normal while driving, world-up in the air
    const tg = grounded ? groundN : { x: 0, y: 1, z: 0 };
    const ex = up.y * tg.z - up.z * tg.y;
    const ez = up.x * tg.y - up.y * tg.x;
    body.setAngvel({ x: av.x * (1 - 3 * DT) + ex * lvl * DT, y: yaw, z: av.z * (1 - 3 * DT) + ez * lvl * DT }, true);

    // Particles + tire marks
    s.tick++;
    const skidding = grounded && ((s.sliding && speed > 6) || (input.throttle > 0.8 && vf < 6 && vf > 0.5));
    if (skidding) {
      rearLocal.forEach((p) => {
        const w = p.clone().applyQuaternion(quat);
        if (s.tick % 2 === 0) addSkid(t.x + w.x, t.y + 0.06, t.z + w.z, heading);
        if (s.tick % 3 === 0) {
          emitParticle({
            x: t.x + w.x,
            y: 0.25,
            z: t.z + w.z,
            vx: -fwd.x * 1.5 + (Math.random() - 0.5) * 2,
            vy: 1 + Math.random(),
            vz: -fwd.z * 1.5 + (Math.random() - 0.5) * 2,
            life: 0.9,
            size: 0.35,
            grow: 2.4,
            r: 0.85,
            g: 0.85,
            b: 0.85,
          });
        }
      });
    }
    if (boosting) {
      const rear = new THREE.Vector3(0, 0.4, -1.3).applyQuaternion(quat);
      const c = [1, 0.6, 0.15];
      emitParticle({
        x: t.x + rear.x,
        y: t.y + rear.y,
        z: t.z + rear.z,
        vx: -fwd.x * 8 + (Math.random() - 0.5) * 1.5,
        vy: (Math.random() - 0.5) * 1.2,
        vz: -fwd.z * 8 + (Math.random() - 0.5) * 1.5,
        life: 0.28,
        size: 0.38,
        grow: -0.2,
        r: c[0],
        g: c[1],
        b: c[2],
      });
    }

    // Respawn: manual reset (F / R) or automatic when flipped, stuck or out of bounds -> back to the last checkpoint.
    let respawned = false;
    const respawnAt = (idx: number) => {
      const p = centerline[idx % centerline.length];
      body.setTranslation({ x: p.x, y: p.y + 0.8, z: p.z }, true);
      body.setRotation(new rapier.Quaternion(0, Math.sin(p.heading / 2), 0, Math.cos(p.heading / 2)), true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      s.lapProgress = idx / centerline.length;
      if (idx < centerline.length * 0.5 && s.lapCount === -1) s.lapCount = 0;
      s.flipped = 0;
      s.stuck = 0;
      s.sliding = false;
      s.landGrace = 0;
      s.airTime = 0;
      s.lastV = null;
      respawned = true;
    };
    // Flipped or badly tilted: right the car where it is (keep position and heading) instead of sending it back.
    const rightInPlace = () => {
      body.setTranslation({ x: t.x, y: t.y + 1, z: t.z }, true);
      body.setRotation(new rapier.Quaternion(0, Math.sin(heading / 2), 0, Math.cos(heading / 2)), true);
      const keep = up.y > 0.6 ? 1 : 0; // already upright: keep rolling
      body.setLinvel({ x: lv0.x * keep, y: 0, z: lv0.z * keep }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      s.flipped = 0;
      s.sliding = false;
      s.lastV = null;
    };
    s.flipped = up.y < 0.25 && speed < 5 ? s.flipped + DT : 0;
    s.stuck = (!isPlayer || input.throttle > 0.5) && speed < 1.2 ? s.stuck + DT : 0;
    if (isPlayer && (input.flip || input.reset) && now > s.resetReadyAt) {
      s.resetReadyAt = now + 1000;
      if (input.flip) {
        // F: flip / straighten the car right where it is
        rightInPlace();
        useGameStore.getState().flash("Car flipped upright");
      } else {
        // R: back to the last checkpoint
        respawnAt(cps[s.cp]);
        useGameStore.getState().flash("Back to checkpoint");
      }
    } else if (s.flipped > 1.5) {
      rightInPlace();
    } else if (s.stuck > 3 || t.y < -5) {
      respawnAt(cps[s.cp]);
    }

    // Telemetry
    const gearSpan = (VMAX * 1.05) / 5;
    const gear = Math.min(4, Math.floor(Math.abs(vfN) / gearSpan));
    const within = clamp((Math.abs(vfN) - gear * gearSpan) / gearSpan, 0, 1);
    s.rpm += (0.28 + 0.72 * within + (input.throttle > 0 ? 0.08 : 0) - s.rpm) * 0.25;
    s.lean = clamp(vl * -0.012, -0.1, 0.1);
    s.pitch = clamp(((-(vfN - s.lastVf)) / DT) * 0.0025, -0.06, 0.06);
    s.lastVf = vfN;
    s.speed = vfN;
    s.steerVisual += (-input.steer * 0.6 - s.steerVisual) * 0.35;

    const out = transformRef.current;
    out.x = t.x;
    out.y = t.y;
    out.z = t.z;
    out.heading = heading;
    out.speedKmh = vfN * 3.6;
    out.upY = up.y;
    out.vx = fwd.x * vfN + right.x * vlN;
    out.vz = fwd.z * vfN + right.z * vlN;

    const progressIdx = nearestIndex(centerline, t.x, t.z, undefined, centerline.length);
    const progress = respawned ? s.lapProgress : progressIdx / centerline.length;
    if (!respawned) {
      const nextCp = (s.cp + 1) % cps.length;
      const gap = Math.abs(progressIdx - cps[nextCp]);
      if (Math.min(gap, centerline.length - gap) < 20) {
        s.cp = nextCp;
        if (isPlayer && nextCp !== 0) useGameStore.getState().flash("Checkpoint");
      }
    }
    if (!s.started) {
      s.started = true;
      s.lapProgress = progress;
      if (progress > 0.5) s.lapCount = -1;
    }
    if (s.lapProgress > 0.85 && progress < 0.15) {
      s.lapCount += 1;
      if (s.lapCount <= 0) {
        s.lapTimer = 0;
      } else if (isPlayer) {
        incrementPlayerLap(s.lapTimer);
        s.lapTimer = 0;
        if (s.lapCount >= totalLaps) {
          finishRace("player");
          if (useGameStore.getState().mode === "online") sendFinish();
        }
      } else {
        incrementBotLap();
        if (s.lapCount >= totalLaps) finishRace("bot");
      }
    }
    s.lapProgress = progress;
    s.lapTimer += DT;

    const total = s.lapCount + progress;
    setMarker(isPlayer ? "me" : "bot", t.x, t.z, heading, color, total);

    if (isPlayer && useGameStore.getState().mode === "online") {
      s.netTick++;
      if (s.netTick % 2 === 0) {
        sendState({
          x: t.x,
          y: t.y,
          z: t.z,
          qx: rot.x,
          qy: rot.y,
          qz: rot.z,
          qw: rot.w,
          vx: out.vx,
          vz: out.vz,
          speedKmh: vfN * 3.6,
          steer: s.steerVisual,
          total,
        });
      }
    }

    if (isPlayer) {
      setPlayerTelemetry({
        speedKmh: Math.abs(vfN) * DISPLAY_SCALE,
        rpm: s.rpm,
        slip: s.sliding ? Math.min(1, 0.55 + slipRatio) : Math.min(0.5, slipRatio),
        throttle: input.throttle,
        boosting,
      });
      setPlayerLapTime(s.lapTimer);
    }
  });

  useFrame((_, delta) => {
    const s = sim.current;
    const controller = controllerRef.current;
    s.wheelSpin += (s.speed * delta) / WHEEL_RADIUS;
    wheelDefs.forEach((w, i) => {
      const mesh = wheelMeshes.current[i];
      if (!mesh) return;
      const susp = controller?.wheelSuspensionLength(i) ?? SUSPENSION_REST;
      mesh.position.set(w.x, w.y + SUSPENSION_REST - susp, w.z);
      mesh.rotation.y = w.front ? s.steerVisual : 0;
      mesh.rotation.x = s.wheelSpin;
    });
    const v = visualRef.current;
    if (v) {
      const k = 1 - Math.exp(-10 * delta);
      v.rotation.z += (s.lean - v.rotation.z) * k;
      v.rotation.x += (s.pitch - v.rotation.x) * k;
    }
  });

  return (
    <RigidBody
      ref={bodyRef}
      colliders={false}
      position={[startX, 0.6, startZ]}
      rotation={[0, startHeading, 0]}
      linearDamping={0.05}
      angularDamping={0.4}
      canSleep={false}
    >
      <ConvexHullCollider args={[dims.hull]} density={500} friction={0.1} restitution={0} />
      <CuboidCollider args={[dims.hx * 0.5, 0.04, dims.hz * 0.5]} position={[0, 0.56, 0]} density={4000} friction={0} />
      <group ref={visualRef}>
        <primitive object={carClone} />
      </group>
      {headlights && (
        <>
          <primitive object={lightTarget} />
          <spotLight position={[0, 0.9, 1.2]} target={lightTarget} angle={0.55} penumbra={0.7} intensity={1800} distance={90} decay={1.5} color="#fff4d6" />
        </>
      )}
    </RigidBody>
  );
}

useGLTF.preload("/models/cars/race.glb");
useGLTF.preload("/models/cars/race-future.glb");
