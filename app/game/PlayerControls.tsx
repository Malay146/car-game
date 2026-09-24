"use client";

import { useEffect, useRef } from "react";
import { DriveInput } from "./vehicleTypes";

const KEYS = {
  forward: ["KeyW", "ArrowUp"],
  back: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  brake: ["Space"],
  handbrake: ["ShiftLeft", "ShiftRight"],
  item: ["KeyE", "Enter"],
  reset: ["KeyR"],
  flip: ["KeyF"],
};

/** Tracks keyboard state and returns a ref updated every frame — no re-renders. */
export function useKeyboardInput() {
  const inputRef = useRef<DriveInput>({ steer: 0, throttle: 0, brake: 0, handbrake: 0 });
  const pressed = useRef<Set<string>>(new Set());

  useEffect(() => {
    const isTracked = (code: string) =>
      ([] as string[]).concat(
        KEYS.forward,
        KEYS.back,
        KEYS.left,
        KEYS.right,
        KEYS.brake,
        KEYS.handbrake,
        KEYS.item,
        KEYS.reset,
        KEYS.flip
      ).includes(code);

    const onDown = (e: KeyboardEvent) => {
      if (isTracked(e.code)) {
        pressed.current.add(e.code);
        e.preventDefault();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      pressed.current.delete(e.code);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, []);

  const has = (codes: string[]) => codes.some((c) => pressed.current.has(c));

  // Called once per frame from the car's useFrame loop.
  const read = (): DriveInput => {
    const fwd = has(KEYS.forward);
    const back = has(KEYS.back);
    const left = has(KEYS.left);
    const right = has(KEYS.right);
    inputRef.current.throttle = fwd ? 1 : back ? -1 : 0;
    inputRef.current.steer = (left ? -1 : 0) + (right ? 1 : 0);
    inputRef.current.brake = has(KEYS.brake) ? 1 : 0;
    inputRef.current.handbrake = has(KEYS.handbrake) ? 1 : 0;
    inputRef.current.useItem = has(KEYS.item);
    inputRef.current.reset = has(KEYS.reset);
    inputRef.current.flip = has(KEYS.flip);
    return inputRef.current;
  };

  return read;
}
