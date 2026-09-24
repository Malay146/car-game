"use client";

import { useEffect, useRef } from "react";
import { DriveInput } from "./vehicleTypes";
import { ACTIONS, useBindings } from "./bindings";
import { useSettingsUi } from "./settingsUi";
import { useGameStore } from "./store";
import { emptyRaw, readGamepad, tiltInput, touchInput } from "./inputSources";

const isTypingTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);

/** Analog steering (touch / tilt / gamepad) response, per second. Faster when returning to centre. */
const STEER_RATE_IN = 16;
const STEER_RATE_OUT = 26;

/**
 * Merges keyboard (rebindable), gamepad, touch overlay and tilt into a single DriveInput.
 * Returns a `read()` to call once per physics tick; no re-renders.
 */
export function useKeyboardInput() {
  const inputRef = useRef<DriveInput>({ steer: 0, throttle: 0, brake: 0, handbrake: 0 });
  const pressed = useRef<Set<string>>(new Set());
  const analog = useRef({ steer: 0, last: 0 });
  const pad = useRef(emptyRaw());

  useEffect(() => {
    const tracked = () => {
      const set = new Set<string>();
      const b = useBindings.getState().bindings;
      for (const a of ACTIONS) for (const c of b[a]) if (c) set.add(c);
      return set;
    };
    const blocked = () => useSettingsUi.getState().open;

    const onDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || blocked()) return;
      if (tracked().has(e.code)) {
        pressed.current.add(e.code);
        // Only steal keys (Space, arrows, Enter) from the page while actually racing.
        if (useGameStore.getState().phase === "playing") e.preventDefault();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      pressed.current.delete(e.code);
    };
    const clear = () => pressed.current.clear();
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", clear);
    };
  }, []);

  // Called once per frame from the car's physics loop.
  const read = (): DriveInput => {
    const out = inputRef.current;
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0.001, (now - analog.current.last) / 1000));
    analog.current.last = now;

    if (useSettingsUi.getState().open) {
      // Settings panel open: hands off the wheel, the car just coasts.
      analog.current.steer = 0;
      out.throttle = 0;
      out.steer = 0;
      out.brake = 0;
      out.handbrake = 0;
      out.useItem = false;
      out.reset = false;
      out.flip = false;
      return out;
    }

    const b = useBindings.getState().bindings;
    const has = (codes: string[]) => codes.some((c) => c && pressed.current.has(c));

    const fwd = has(b.forward);
    const back = has(b.back);
    const left = has(b.left);
    const right = has(b.right);
    const kbThrottle = fwd ? 1 : back ? -1 : 0;
    const kbSteer = (left ? -1 : 0) + (right ? 1 : 0);

    const g = pad.current;
    const gpOn = readGamepad(g);

    // Analog steering: the strongest of gamepad / touch / tilt, then smoothed so it is never binary.
    let target = 0;
    if (gpOn && Math.abs(g.steer) > Math.abs(target)) target = g.steer;
    if (Math.abs(touchInput.steer) > Math.abs(target)) target = touchInput.steer;
    if (tiltInput.active && Math.abs(tiltInput.steer) > Math.abs(target)) target = tiltInput.steer;
    const a = analog.current;
    const rate = Math.abs(target) < Math.abs(a.steer) || target * a.steer < 0 ? STEER_RATE_OUT : STEER_RATE_IN;
    a.steer += (target - a.steer) * (1 - Math.exp(-rate * dt));
    if (Math.abs(a.steer) < 0.002 && target === 0) a.steer = 0;

    const touchThrottle = touchInput.gas ? 1 : touchInput.reverse ? -1 : 0;
    const padThrottle = gpOn ? g.throttle : 0;
    let throttle = kbThrottle;
    if (Math.abs(touchThrottle) > Math.abs(throttle)) throttle = touchThrottle;
    if (Math.abs(padThrottle) > Math.abs(throttle)) throttle = padThrottle;

    out.throttle = throttle;
    out.steer = Math.max(-1, Math.min(1, kbSteer + a.steer));
    out.brake = has(b.brake) || (gpOn && g.brake > 0) ? 1 : 0;
    out.handbrake = has(b.handbrake) || touchInput.handbrake || (gpOn && g.handbrake > 0) ? 1 : 0;
    out.useItem = has(b.item) || touchInput.item || (gpOn && g.item);
    out.reset = has(b.reset) || touchInput.reset || (gpOn && g.reset);
    out.flip = has(b.flip) || touchInput.flip || (gpOn && g.flip);
    return out;
  };

  return read;
}
