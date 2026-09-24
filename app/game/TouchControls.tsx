"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useSettings } from "./settings";
import { useGameStore } from "./store";
import { clearTouchInput, disableTilt, enableTilt, touchInput } from "./inputSources";

type HoldField = "gas" | "reverse" | "handbrake" | "item" | "flip" | "reset";

const base =
  "pointer-events-auto flex select-none items-center justify-center rounded-full border border-white/25 font-black uppercase tracking-wide text-white backdrop-blur-sm [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] touch-none transition-[background-color,transform] duration-75";

function HoldButton({
  field,
  size,
  children,
  tone = "bg-black/45",
  activeTone = "bg-white/40",
  glow = false,
  allowMouse,
  label,
}: {
  field: HoldField;
  size: string;
  children: ReactNode;
  tone?: string;
  activeTone?: string;
  glow?: boolean;
  allowMouse: boolean;
  label: string;
}) {
  const [down, setDown] = useState(false);

  const press = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && !allowMouse) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
    touchInput[field] = true;
    setDown(true);
  };
  const release = () => {
    touchInput[field] = false;
    setDown(false);
  };

  return (
    <div
      role="button"
      aria-label={label}
      onPointerDown={press}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(e) => e.preventDefault()}
      className={`${base} ${down ? `${activeTone} scale-95` : tone} ${glow && !down ? "animate-pulse ring-2 ring-yellow-300/80" : ""}`}
      style={{ width: size, height: size }}
    >
      {children}
    </div>
  );
}

/** Horizontal steering slider: thumb position maps to analog steering, released = centred. Multi-touch safe (own pointer capture). */
function SteerPad({ allowMouse }: { allowMouse: boolean }) {
  const knob = useRef<HTMLDivElement>(null);
  const active = useRef<number | null>(null);

  const apply = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const half = r.width / 2 - r.height * 0.45;
    let v = (e.clientX - (r.left + r.width / 2)) / half;
    v = Math.max(-1, Math.min(1, v));
    if (Math.abs(v) < 0.05) v = 0;
    touchInput.steer = v;
    if (knob.current) knob.current.style.transform = `translateX(${v * half}px)`;
  };
  const end = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (active.current !== e.pointerId) return;
    active.current = null;
    touchInput.steer = 0;
    if (knob.current) knob.current.style.transform = "translateX(0px)";
  };

  return (
    <div
      role="slider"
      aria-label="Steering"
      aria-valuemin={-1}
      aria-valuemax={1}
      aria-valuenow={0}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse" && !allowMouse) return;
        e.preventDefault();
        if (active.current !== null) return;
        active.current = e.pointerId;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* best-effort */
        }
        apply(e);
      }}
      onPointerMove={(e) => {
        if (active.current === e.pointerId) apply(e);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onContextMenu={(e) => e.preventDefault()}
      className={`${base} relative justify-center !rounded-[999px] bg-black/35`}
      style={{ width: "min(calc(var(--u) * 4.8), 46vw)", height: "calc(var(--u) * 1.35)" }}
    >
      <span className="pointer-events-none absolute left-[7%] text-[calc(var(--u)*0.5)] font-black leading-none text-white/50">‹</span>
      <span className="pointer-events-none absolute right-[7%] text-[calc(var(--u)*0.5)] font-black leading-none text-white/50">›</span>
      <span className="pointer-events-none absolute h-[45%] w-px bg-white/25" />
      <div
        ref={knob}
        className="pointer-events-none rounded-full border-2 border-white/60 bg-white/25"
        style={{ width: "calc(var(--u) * 1.05)", height: "calc(var(--u) * 1.05)" }}
      />
    </div>
  );
}

/** On-screen controls for touch devices; feeds the shared touchInput state read by useKeyboardInput. */
export function TouchControls() {
  const scale = useSettings((s) => s.touchScale);
  const tilt = useSettings((s) => s.tilt);
  const mode = useSettings((s) => s.touchControls);
  const item = useGameStore((s) => s.item);
  const allowMouse = mode === "on";

  useEffect(() => {
    if (!tilt) return;
    let alive = true;
    enableTilt().then((ok) => {
      if (!ok && alive) useSettings.getState().set({ tilt: false });
    });
    return () => {
      alive = false;
      disableTilt();
    };
  }, [tilt]);

  useEffect(() => {
    return () => clearTouchInput();
  }, []);

  const style = {
    "--u": `calc(clamp(50px, 12vmin, 92px) * ${scale})`,
  } as CSSProperties;
  const u = (k: number) => `calc(var(--u) * ${k})`;
  const insetB = "max(12px, env(safe-area-inset-bottom))";
  const insetR = "max(12px, env(safe-area-inset-right))";
  const insetL = "max(12px, env(safe-area-inset-left))";

  return (
    <div className="pointer-events-none absolute inset-0 z-20 touch-none select-none" style={style} onContextMenu={(e) => e.preventDefault()}>
      {!tilt && (
        <div className="absolute" style={{ left: insetL, bottom: insetB }}>
          <SteerPad allowMouse={allowMouse} />
        </div>
      )}
      <div className="absolute flex flex-col items-end" style={{ right: insetR, bottom: insetB, gap: u(0.14) }}>
        <div className="flex" style={{ gap: u(0.14) }}>
          <HoldButton field="flip" size={u(0.78)} allowMouse={allowMouse} label="Flip car upright">
            <span className="text-[calc(var(--u)*0.2)]">Flip</span>
          </HoldButton>
          <HoldButton field="reset" size={u(0.78)} allowMouse={allowMouse} label="Back to checkpoint">
            <span className="text-[calc(var(--u)*0.2)]">Reset</span>
          </HoldButton>
        </div>
        <div className="flex" style={{ gap: u(0.14) }}>
          <HoldButton field="handbrake" size={u(0.98)} allowMouse={allowMouse} label="Handbrake" tone="bg-amber-700/50">
            <span className="text-[calc(var(--u)*0.2)]">Drift</span>
          </HoldButton>
          <HoldButton field="item" size={u(0.98)} allowMouse={allowMouse} label="Use boost" tone={item ? "bg-orange-500/70" : "bg-black/45"} glow={!!item}>
            <span className="text-[calc(var(--u)*0.2)]">Boost</span>
          </HoldButton>
        </div>
        <div className="flex items-end" style={{ gap: u(0.14) }}>
          <HoldButton field="reverse" size={u(1.2)} allowMouse={allowMouse} label="Brake / reverse" tone="bg-red-800/55">
            <span className="text-[calc(var(--u)*0.22)]">Brake</span>
          </HoldButton>
          <HoldButton field="gas" size={u(1.7)} allowMouse={allowMouse} label="Gas" tone="bg-emerald-600/55" activeTone="bg-emerald-400/70">
            <span className="text-[calc(var(--u)*0.3)]">Gas</span>
          </HoldButton>
        </div>
      </div>
      {tilt && (
        <div
          className="pointer-events-none absolute rounded-full bg-black/40 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-white/80"
          style={{ left: insetL, bottom: insetB }}
        >
          Tilt to steer
        </div>
      )}
    </div>
  );
}
