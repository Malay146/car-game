import { create } from "zustand";

/** Rebindable keyboard actions. Each action can have up to two keys (KeyboardEvent.code). */
export const ACTIONS = [
  "forward",
  "back",
  "left",
  "right",
  "brake",
  "handbrake",
  "item",
  "flip",
  "reset",
] as const;
export type Action = (typeof ACTIONS)[number];
export type Bindings = Record<Action, string[]>;

export const ACTION_LABELS: Record<Action, string> = {
  forward: "Accelerate",
  back: "Brake / reverse",
  left: "Steer left",
  right: "Steer right",
  brake: "Brake",
  handbrake: "Handbrake / drift",
  item: "Use boost",
  flip: "Flip car upright",
  reset: "Back to checkpoint",
};

export const DEFAULT_BINDINGS: Bindings = {
  forward: ["KeyW", "ArrowUp"],
  back: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  brake: ["Space"],
  handbrake: ["ShiftLeft", "ShiftRight"],
  item: ["KeyE", "Enter"],
  flip: ["KeyF"],
  reset: ["KeyR"],
};

/** Keys that can never be bound (Escape opens the settings panel / cancels rebinding). */
export const RESERVED_KEYS = ["Escape"];

const KEY = "chaos.bindings";

interface BindingsStore {
  bindings: Bindings;
  /** Assign `code` to slot `slot` of `action`. Any other action using that key loses it. Returns the action it was taken from. */
  bind: (action: Action, slot: number, code: string) => Action | null;
  clear: (action: Action, slot: number) => void;
  resetAll: () => void;
  hydrate: () => void;
}

function save(b: Bindings) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    /* private mode: bindings just won't persist */
  }
}

const clone = (b: Bindings): Bindings => {
  const out = {} as Bindings;
  for (const a of ACTIONS) out[a] = [...b[a]];
  return out;
};

let hydratedOnce = false;

export const useBindings = create<BindingsStore>((set, get) => ({
  bindings: clone(DEFAULT_BINDINGS),
  bind: (action, slot, code) => {
    const next = clone(get().bindings);
    let stolenFrom: Action | null = null;
    for (const a of ACTIONS) {
      for (let i = 0; i < next[a].length; i++) {
        if (next[a][i] === code && !(a === action && i === slot)) {
          next[a][i] = "";
          if (a !== action) stolenFrom = a;
        }
      }
    }
    while (next[action].length <= slot) next[action].push("");
    next[action][slot] = code;
    set({ bindings: next });
    save(next);
    return stolenFrom;
  },
  clear: (action, slot) => {
    const next = clone(get().bindings);
    while (next[action].length <= slot) next[action].push("");
    next[action][slot] = "";
    set({ bindings: next });
    save(next);
  },
  resetAll: () => {
    const next = clone(DEFAULT_BINDINGS);
    set({ bindings: next });
    save(next);
  },
  hydrate: () => {
    if (hydratedOnce) return;
    hydratedOnce = true;
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Record<Action, unknown>>;
      const next = clone(DEFAULT_BINDINGS);
      for (const a of ACTIONS) {
        const v = parsed[a];
        if (Array.isArray(v)) next[a] = v.filter((c): c is string => typeof c === "string").slice(0, 2);
      }
      set({ bindings: next });
    } catch {
      /* corrupt storage: keep defaults */
    }
  },
}));

/** Pretty label for a KeyboardEvent.code. */
export function keyLabel(code: string): string {
  if (!code) return "-";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Arrow")) return { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" }[code] ?? code;
  if (code.startsWith("Numpad")) return "Num " + code.slice(6);
  return (
    {
      Space: "Space",
      ShiftLeft: "L-Shift",
      ShiftRight: "R-Shift",
      ControlLeft: "L-Ctrl",
      ControlRight: "R-Ctrl",
      AltLeft: "L-Alt",
      AltRight: "R-Alt",
      Enter: "Enter",
      Backspace: "Bksp",
      Tab: "Tab",
    } as Record<string, string>
  )[code] ?? code;
}
