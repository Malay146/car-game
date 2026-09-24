"use client";

import { AudioSettingsSection } from "./AudioSettingsSection";
import { useEffect, useState, type ReactNode } from "react";
import { useSettings, useQualityLevel, type QualityPref } from "./settings";
import { useSettingsUi, type SettingsTab } from "./settingsUi";
import { ACTIONS, ACTION_LABELS, RESERVED_KEYS, keyLabel, useBindings, type Action } from "./bindings";
import { disableTilt, enableTilt } from "./inputSources";
import { useGameStore } from "./store";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "controls", label: "Controls" },
  { id: "graphics", label: "Graphics" },
  { id: "touch", label: "Touch" },
  { id: "audio", label: "Audio" },
];

const chip = "rounded-lg px-3 py-2 text-sm font-semibold transition-colors";

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={o.id === value}
          onClick={() => onChange(o.id)}
          className={`${chip} min-h-11 min-w-16 ${o.id === value ? "bg-red-600 text-white" : "bg-white/10 text-zinc-200 hover:bg-white/20"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg bg-white/5 px-3 py-2 text-left hover:bg-white/10"
    >
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        {hint && <span className="block text-xs text-zinc-400">{hint}</span>}
      </span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? "bg-red-600" : "bg-white/25"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

function Field({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-bold uppercase tracking-wider text-zinc-300">{title}</div>
        {hint && <div className="text-xs text-zinc-400">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

// --- Controls ---------------------------------------------------------------

function ControlsSection() {
  const bindings = useBindings((s) => s.bindings);
  const bind = useBindings((s) => s.bind);
  const clear = useBindings((s) => s.clear);
  const resetAll = useBindings((s) => s.resetAll);
  const setRebinding = useSettingsUi((s) => s.setRebinding);
  const [listening, setListening] = useState<{ action: Action; slot: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setRebinding(listening !== null);
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (e.code === "Escape") {
        setListening(null);
        return;
      }
      if (e.code === "Backspace" || e.code === "Delete") {
        clear(listening.action, listening.slot);
        setMessage(null);
        setListening(null);
        return;
      }
      if (RESERVED_KEYS.includes(e.code)) return;
      const from = bind(listening.action, listening.slot, e.code);
      setMessage(from ? `${keyLabel(e.code)} moved here from "${ACTION_LABELS[from]}".` : null);
      setListening(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      setRebinding(false);
    };
  }, [listening, bind, clear, setRebinding]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-400">
        Click a key slot, then press the new key. Backspace clears a slot, Escape cancels. Keys already used elsewhere are moved to the new action.
      </p>
      <div className="divide-y divide-white/10 rounded-lg bg-white/5">
        {ACTIONS.map((a) => (
          <div key={a} className="flex items-center justify-between gap-2 px-3 py-1.5">
            <span className="text-sm">{ACTION_LABELS[a]}</span>
            <span className="flex gap-1.5">
              {[0, 1].map((slot) => {
                const isListening = listening?.action === a && listening.slot === slot;
                return (
                  <button
                    key={slot}
                    onClick={() => {
                      setMessage(null);
                      setListening({ action: a, slot });
                    }}
                    className={`min-h-10 min-w-20 rounded-md px-2 py-1 font-mono text-sm ${
                      isListening ? "animate-pulse bg-red-600 text-white" : "bg-black/50 text-zinc-100 hover:bg-white/20"
                    }`}
                  >
                    {isListening ? "Press key…" : keyLabel(bindings[a][slot] ?? "")}
                  </button>
                );
              })}
            </span>
          </div>
        ))}
      </div>
      {message && <p className="text-xs text-yellow-300">{message}</p>}
      <button
        onClick={() => {
          resetAll();
          setListening(null);
          setMessage("Controls reset to defaults.");
        }}
        className={`${chip} min-h-11 border border-white/30 hover:bg-white/10`}
      >
        Reset to defaults
      </button>
      <div className="rounded-lg bg-white/5 px-3 py-2 text-xs text-zinc-400">
        <span className="font-semibold text-zinc-200">Gamepad</span> (plug in and press any button): left stick or D-pad steers, RT / A gas, LT brake and reverse, B / LB handbrake, X / RB boost, Y flip car, Back reset, Start settings.
      </div>
    </div>
  );
}

// --- Graphics ---------------------------------------------------------------

const QUALITY_INFO: Record<QualityPref, string> = {
  auto: "Adapts to your device and keeps the frame rate smooth.",
  low: "No shadows or post effects, low resolution, sparse scenery. Best for phones.",
  medium: "Soft shadows, light effects, medium resolution.",
  high: "Full detail, shadows, bloom and sharp resolution.",
};

function GraphicsSection() {
  const quality = useSettings((s) => s.quality);
  const showFps = useSettings((s) => s.showFps);
  const maxFps = useSettings((s) => s.maxFps);
  const set = useSettings((s) => s.set);
  const level = useQualityLevel();
  return (
    <div className="space-y-4">
      <Field title="Quality" hint={QUALITY_INFO[quality]}>
        <Segmented<QualityPref>
          value={quality}
          onChange={(v) => set({ quality: v })}
          options={[
            { id: "auto", label: "Auto" },
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
            { id: "high", label: "High" },
          ]}
        />
        {quality === "auto" && <p className="text-xs text-zinc-400">Currently using: <b className="text-zinc-200">{level}</b></p>}
      </Field>
      <Field title="Frame rate limit" hint="60 is smooth and keeps laptops cool. Max uses your display's full refresh rate (e.g. 120 Hz) and much more power.">
        <Segmented<"30" | "60" | "max">
          value={maxFps}
          onChange={(v) => set({ maxFps: v })}
          options={[
            { id: "30", label: "30" },
            { id: "60", label: "60" },
            { id: "max", label: "Max" },
          ]}
        />
      </Field>
      <Toggle checked={showFps} onChange={(v) => set({ showFps: v })} label="FPS counter" hint="Shows frame rate, scene draws and triangles." />
    </div>
  );
}

// --- Touch ------------------------------------------------------------------

function TouchSection() {
  const touchControls = useSettings((s) => s.touchControls);
  const tilt = useSettings((s) => s.tilt);
  const touchScale = useSettings((s) => s.touchScale);
  const set = useSettings((s) => s.set);
  const flash = useGameStore((s) => s.flash);
  const [tiltMsg, setTiltMsg] = useState<string | null>(null);

  const toggleTilt = async (on: boolean) => {
    if (!on) {
      set({ tilt: false });
      setTiltMsg(null);
      return;
    }
    // Must run inside the tap: iOS only shows the motion permission prompt from a user gesture.
    const ok = await enableTilt();
    if (ok) {
      disableTilt(); // the touch overlay turns it on while racing
      set({ tilt: true });
      setTiltMsg("Hold your phone in landscape and rotate it like a steering wheel.");
    } else {
      setTiltMsg("Tilt steering is not available (permission denied or no motion sensor).");
      flash("Tilt unavailable");
    }
  };

  return (
    <div className="space-y-4">
      <Field title="On-screen controls" hint="Auto shows them on phones and tablets only.">
        <Segmented
          value={touchControls}
          onChange={(v) => set({ touchControls: v })}
          options={[
            { id: "auto", label: "Auto" },
            { id: "on", label: "Always on" },
            { id: "off", label: "Off" },
          ]}
        />
      </Field>
      <Toggle checked={tilt} onChange={toggleTilt} label="Tilt steering" hint="Steer by rotating your device like a wheel." />
      {tiltMsg && <p className="text-xs text-zinc-400">{tiltMsg}</p>}
      <Field title={`Control size ${Math.round(touchScale * 100)}%`}>
        <input
          type="range"
          min={0.8}
          max={1.3}
          step={0.05}
          value={touchScale}
          onChange={(e) => set({ touchScale: Number(e.target.value) })}
          className="h-8 w-full accent-red-600"
          aria-label="Touch control size"
        />
      </Field>
    </div>
  );
}

// --- Panel ------------------------------------------------------------------

export function SettingsPanel() {
  const open = useSettingsUi((s) => s.open);
  const tab = useSettingsUi((s) => s.tab);
  const hide = useSettingsUi((s) => s.hide);
  const show = useSettingsUi((s) => s.show);

  // Escape toggles the panel (a rebinding in progress swallows Escape itself).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Escape" || e.repeat) return;
      const ui = useSettingsUi.getState();
      if (ui.rebinding) return;
      if (ui.open) ui.hide();
      else ui.show();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;
  return (
    <div
      className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-black/75 p-2 backdrop-blur-sm"
      style={{
        paddingTop: "max(0.5rem, env(safe-area-inset-top))",
        paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))",
        paddingLeft: "max(0.5rem, env(safe-area-inset-left))",
        paddingRight: "max(0.5rem, env(safe-area-inset-right))",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) hide();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div className="flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-zinc-900/95 shadow-2xl ring-1 ring-white/15">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-4 py-1 short:py-0">
          <h2 className="text-lg font-black tracking-tight">Settings</h2>
          <button aria-label="Close settings" onClick={hide} className="h-11 w-11 rounded-full text-2xl leading-none hover:bg-white/15">
            ×
          </button>
        </div>
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-white/10 px-2 py-1.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => show(t.id)}
              className={`${chip} min-h-11 shrink-0 ${t.id === tab ? "bg-white/20 text-white" : "text-zinc-300 hover:bg-white/10"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          {tab === "controls" && <ControlsSection />}
          {tab === "graphics" && <GraphicsSection />}
          {tab === "touch" && <TouchSection />}
          {tab === "audio" && (
            <div className="space-y-3">
              <AudioSettingsSection />
            </div>
          )}
        </div>
        <div className="shrink-0 border-t border-white/10 px-4 py-2 text-right short:py-1">
          <button onClick={hide} className={`${chip} min-h-11 bg-red-600 px-6 hover:bg-red-500`}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/** Round gear button that opens the settings panel. */
export function SettingsButton({ className = "" }: { className?: string }) {
  const show = useSettingsUi((s) => s.show);
  return (
    <button
      aria-label="Settings"
      onClick={() => show()}
      className={`pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-black/45 backdrop-blur-sm hover:bg-black/65 ${className}`}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
      </svg>
    </button>
  );
}
